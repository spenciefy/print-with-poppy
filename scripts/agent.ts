/** Reference Poppy client. No card details are read or sent by this script. */
import { SignJWT, generateKeyPair, exportJWK, importJWK } from "jose";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import Database from "better-sqlite3";
const origin = process.env.PUBLIC_URL || "http://localhost:5173";
const discovery = await (
  await fetch(`${origin}/.well-known/poppy.json`)
).json();
const oauth = await (
  await fetch(`${discovery.auth.issuer}/.well-known/oauth-authorization-server`)
).json();
if (
  oauth.issuer !== discovery.auth.issuer ||
  !oauth.poppy_domains.includes(discovery.organization.domain)
)
  throw new Error("Issuer discovery mismatch.");
const cfg = await (await fetch(`${origin}/api/config`)).json();
if (cfg.mode !== "demo")
  throw new Error(
    "This reference script uses a local demo identity. Register your own HTTPS identity for sandbox/live.",
  );
const db = new Database(`${process.env.DATA_DIR || ".data"}/poppy.sqlite`, {
  readonly: true,
});
const row = db
  .prepare("SELECT body FROM records WHERE kind='demo-key' AND id='identity'")
  .get() as any;
db.close();
const identity = await importJWK(JSON.parse(row.body).private, "ES256");
const clientId = `${origin}/api/demo/agent.json`;
const proofKey = await generateKeyPair("ES256", { extractable: true });
const jwk = await exportJWK(proofKey.publicKey);
const digest = (s: string) =>
  createHash("sha256").update(s).digest("base64url");
async function proof(method: string, url: string, token?: string) {
  return new SignJWT({
    htm: method,
    htu: url.split("?")[0],
    ...(token ? { ath: digest(token) } : {}),
  })
    .setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk })
    .setIssuedAt()
    .setJti(randomUUID())
    .sign(proofKey.privateKey);
}
async function assertion(sub: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: "demo" })
    .setIssuer(clientId)
    .setSubject(sub)
    .setAudience(oauth.token_endpoint)
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(randomUUID())
    .sign(identity);
}
const r = await fetch(oauth.token_endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    DPoP: await proof("POST", oauth.token_endpoint),
  },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    client_id: clientId,
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: await assertion(clientId),
    assertion: await assertion(`demo-user-${randomUUID()}`),
  }),
});
const session = await r.json();
if (!r.ok) throw new Error(JSON.stringify(session));
console.log("Poppy discovery and DPoP guest session verified.");
async function call(route: string, init: RequestInit = {}) {
  const url = origin + route;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `DPoP ${session.access_token}`,
      DPoP: await proof(init.method || "GET", url, session.access_token),
      ...init.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
const photo = new FormData();
photo.append(
  "photo",
  new Blob([await fs.readFile("public/photos/lake.jpg")], {
    type: "image/jpeg",
  }),
  "lake.jpg",
);
const uploaded = await call("/api/photos", { method: "POST", body: photo });
const { operation } = await call("/api/orders", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Idempotency-Key": randomUUID(),
  },
  body: JSON.stringify({
    email: "demo@example.com",
    address: {
      name: "Demo Recipient",
      line1: "123 Market Street",
      city: "San Francisco",
      state: "CA",
      postalCode: "94103",
      country: "US",
    },
    items: [{ photoId: uploaded.id, quantity: 3, fit: "contain" }],
  }),
});
console.log("\nAPPROVAL SUMMARY\n" + operation.summary);
if (!process.argv.includes("--approve-demo")) {
  console.log(
    "\nStopped before approval. Rerun with --approve-demo to exercise demo payment/fulfillment.",
  );
  process.exit(0);
}
let confirmed = await call(
  `/api/operations/${operation.operation_id}/confirm`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: operation.revision, approved_by: "user" }),
  },
);
for (let i = 0; i < 30 && confirmed.state === "in_progress"; i++) {
  await new Promise((r) => setTimeout(r, 500));
  confirmed = await call(`/api/operations/${operation.operation_id}`);
}
if (confirmed.state !== "succeeded")
  throw new Error("Checkout did not complete.");
const url = new URL(confirmed.result.data.checkout_url);
const orderId = confirmed.result.data.order_id;
const headers = { "X-Order-Token": url.hash.slice(1) };
await fetch(`${origin}/api/demo/pay/${orderId}`, { method: "POST", headers });
let order;
for (let i = 0; i < 30; i++) {
  order = await call(`/api/orders/${orderId}`);
  if (order.status === "printing") break;
  await new Promise((r) => setTimeout(r, 500));
}
if (order.status !== "printing")
  throw new Error("Demo fulfillment did not complete.");
await fetch(`${origin}/api/demo/ship/${orderId}`, { method: "POST", headers });
let view;
for (let i = 0; i < 30; i++) {
  view = await (
    await fetch(`${origin}/api/order-view/${orderId}`, { headers })
  ).json();
  if (view.emails?.length === 2) break;
  await new Promise((r) => setTimeout(r, 500));
}
if (view.status !== "shipped" || view.emails?.length !== 2)
  throw new Error("Shipment/email checks failed.");
console.log(
  "\nVerified: approved → demo paid → submitted → shipped → 2 captured emails.",
);
console.log(`View order: ${origin}/order/${orderId}${url.hash}`);
