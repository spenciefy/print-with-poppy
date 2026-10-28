/** Reference Poppy 0.3 client. No card details are read or sent by this script. */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import Database from "better-sqlite3";
import { poppyAgent } from "./poppy-delegation.js";
const origin = process.env.PUBLIC_URL || "http://localhost:5173";
const discovery = await (await fetch(`${origin}/.well-known/poppy.json`)).json();
if (discovery.protocol_version !== "0.3") throw new Error("This reference client requires Poppy 0.3.");
const domain = discovery.organization.domain;
const prm = await (await fetch(`${origin}/.well-known/oauth-protected-resource`)).json();
const issuer: string = discovery.auth?.issuer ?? prm.authorization_servers?.[0];
const oauth = await (await fetch(`${issuer}/.well-known/oauth-authorization-server`)).json();
if (
  prm.resource !== `https://${domain}` ||
  !prm.authorization_servers?.includes(issuer) ||
  oauth.issuer !== issuer ||
  !oauth.protected_resources?.includes(`https://${domain}`)
)
  throw new Error("Issuer discovery mismatch.");
const cfg = await (await fetch(`${origin}/api/config`)).json();
if (cfg.mode !== "demo")
  throw new Error(
    "This reference script uses a local demo identity. Register your own HTTPS identity for sandbox/live.",
  );
let privateJwk: any;
if (process.env.AGENT_PRIVATE_JWK_FILE) {
  privateJwk = JSON.parse(await fs.readFile(process.env.AGENT_PRIVATE_JWK_FILE, "utf8"));
} else {
  if (cfg.environment === "agent-sandbox")
    throw new Error("Set AGENT_PRIVATE_JWK_FILE and AGENT_CLIENT_ID for the hosted sandbox.");
  const db = new Database(`${process.env.DATA_DIR || ".data"}/poppy.sqlite`, { readonly: true });
  const row = db.prepare("SELECT body FROM records WHERE kind='demo-key' AND id='identity'").get() as any;
  db.close();
  privateJwk = JSON.parse(row.body).private;
}
const clientId = process.env.AGENT_CLIENT_ID || `${origin}/api/demo/agent.json`;
// 0.3: the jwks_uri key signs client assertions and delegations; a delegated key signs Session JWTs.
const agent = await poppyAgent(privateJwk, clientId, issuer);
const session: { sid: string; sub: string; accessToken?: string; refreshToken?: string } = agent.newSession(
  `demo-user-${randomUUID()}`,
);
async function call(route: string, init: RequestInit = {}, allow: number[] = []) {
  const url = origin + route;
  const response = await fetch(url, {
    ...init,
    headers: {
      "Poppy-Session": await agent.sessionJwt(session, init.method || "GET", url, session.accessToken),
      ...(session.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      ...init.headers,
    },
  });
  const result = await response.json();
  if (!response.ok && !allow.includes(response.status)) throw new Error(JSON.stringify(result));
  return result;
}
const tokenRequest = async (body: Record<string, string>) =>
  fetch(oauth.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, ...(await agent.clientAuth()) }),
  });
await call("/api/catalog");
console.log("Poppy discovery and a signed-out Session (Poppy-Session header) verified.");
const accountTest = process.argv.includes("--sandbox-account");
if (accountTest) {
  if (cfg.environment !== "agent-sandbox")
    throw new Error("--sandbox-account requires the isolated Agent Sandbox.");
  const grant = "https://personalagentprotocol.org/grant/mediated-sign-in";
  const started = await (
    await tokenRequest({
      grant_type: grant,
      scope: "orders:read orders:write",
      email: `reference-${randomUUID()}@example.com`,
    })
  ).json();
  if (started.error !== "code_required") throw new Error("Mediated sign-in did not ask for a code.");
  const captured = await call(`/api/sandbox/sign-in/${started.sign_in_id}/email`);
  const code = captured.email.text.match(/code is (\d{6})/)?.[1];
  if (!code) throw new Error("Sandbox code capture missing.");
  const signed = await (await tokenRequest({ grant_type: grant, sign_in_id: started.sign_in_id, one_time_code: code })).json();
  if (!signed.refresh_token || !signed.access_token) throw new Error("Sandbox sign-in did not complete.");
  session.accessToken = signed.access_token;
  session.refreshToken = signed.refresh_token;
  console.log("Sandbox Mediated Sign-In verified (captured email only).");
}
const photo = new FormData();
photo.append(
  "photo",
  new Blob([await fs.readFile("public/photos/poppy-abstract-cluster.webp")], { type: "image/webp" }),
  "sample-poppy.webp",
);
const uploaded = await call("/api/photos", { method: "POST", body: photo });
const proposal = JSON.stringify({
  email: process.env.SANDBOX_TEST_EMAIL || "demo@example.com",
  address: {
    name: "Demo Recipient",
    line1: "123 Market Street",
    city: "San Francisco",
    state: "CA",
    postalCode: "94103",
    country: "US",
  },
  items: [
    { photoId: uploaded.id, product: "prints", quantity: 3, fit: "contain" },
    ...(process.argv.includes("--tshirt")
      ? [
          { photoId: uploaded.id, product: "tshirt", color: "orange", size: "m", quantity: 2, fit: "contain" },
          { photoId: uploaded.id, product: "tshirt", color: "black", size: "xl", quantity: 1, fit: "contain" },
        ]
      : []),
  ],
});
// Operations v2: the order request is refused with the operation until the User approves it.
const refused = await call("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: proposal }, [403]);
if (refused.error !== "approval_required") throw new Error(JSON.stringify(refused));
const operation = refused.operation;
console.log("\nAPPROVAL SUMMARY\n" + operation.summary);
if (!process.argv.includes("--approve-demo")) {
  console.log("\nStopped before approval. Rerun with --approve-demo to exercise demo payment/fulfillment.");
  process.exit(0);
}
if (process.argv.includes("--tshirt")) {
  await call(`/api/shirt-preview-approvals/${operation.operation_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      revision: operation.revision,
      approved_by: "user",
      previewIds: operation.terms.previews.filter((p: any) => p.product === "tshirt").map((p: any) => p.previewId),
    }),
  });
}
const approval = `operation_id="${operation.operation_id}", revision="${operation.revision}"`;
let order = await call("/api/orders", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Poppy-Approval": approval },
  body: proposal,
});
const orderId = order.id;
for (let i = 0; i < 30 && !order.checkoutUrl; i++) {
  await new Promise((r) => setTimeout(r, 500));
  order = await call(`/api/orders/${orderId}`);
}
if (!order.checkoutUrl) throw new Error("Checkout did not complete.");
const url = new URL(order.checkoutUrl);
const headers = { "X-Order-Token": url.hash.slice(1) };
if (cfg.environment === "agent-sandbox") await call(`/api/sandbox/orders/${orderId}/pay`, { method: "POST" });
else await fetch(`${origin}/api/demo/pay/${orderId}`, { method: "POST", headers });
for (let i = 0; i < 30; i++) {
  order = await call(`/api/orders/${orderId}`);
  if (order.status === "printing") break;
  await new Promise((r) => setTimeout(r, 500));
}
if (order.status !== "printing") throw new Error("Demo fulfillment did not complete.");
if (cfg.environment === "agent-sandbox") await call(`/api/sandbox/orders/${orderId}/ship`, { method: "POST" });
else await fetch(`${origin}/api/demo/ship/${orderId}`, { method: "POST", headers });
let view;
for (let i = 0; i < 30; i++) {
  view = await (await fetch(`${origin}/api/order-view/${orderId}`, { headers })).json();
  if (view.emails?.length === 2) break;
  await new Promise((r) => setTimeout(r, 500));
}
if (view.status !== "shipped" || view.emails?.length !== 2) throw new Error("Shipment/email checks failed.");
if (view.orderingMethod !== "native-poppy") throw new Error("Native order provenance missing.");
console.log("Native Poppy ordering method verified on order page API.");
console.log("\nVerified: approved → demo paid → submitted → shipped → 2 captured emails.");
if (cfg.sandboxEmailDelivery && process.env.SANDBOX_TEST_EMAIL) {
  let emails;
  for (let i = 0; i < 30; i++) {
    emails = (await call(`/api/sandbox/orders/${orderId}/emails`)).emails;
    if (emails.length === 2 && emails.every((e: any) => e.delivery === "submitted" && e.providerId)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!emails?.every((e: any) => e.delivery === "submitted" && e.providerId) || emails.length !== 2)
    throw new Error("Resend submission not verified.");
  console.log("Resend submissions:", JSON.stringify(emails.map((e: any) => ({ id: e.providerId, subject: e.subject }))));
}
if (accountTest) {
  const history = await call("/api/account/orders");
  if (!history.orders.some((o: any) => o.id === orderId)) throw new Error("Signed-in order missing from account history.");
  console.log("Signed-in account order history verified.");
  if (process.argv.includes("--revoke-demo")) {
    const renewed = await tokenRequest({ grant_type: "refresh_token", refresh_token: session.refreshToken! });
    if (!renewed.ok) throw new Error("Refresh failed.");
    session.accessToken = (await renewed.json()).access_token;
    // Another Session (new sid) of the same User can retry the approval; it's performed only once.
    const same = agent.newSession(session.sub);
    const retry = await fetch(`${origin}/api/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Poppy-Approval": approval,
        "Poppy-Session": await agent.sessionJwt(same, "POST", `${origin}/api/orders`, session.accessToken),
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: proposal,
    });
    if ((await retry.json()).id !== orderId) throw new Error("Approved order retry did not return the same order.");
    const revoked = await fetch(oauth.revocation_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: session.refreshToken!, token_type_hint: "refresh_token", ...(await agent.clientAuth()) }),
    });
    if (!revoked.ok) throw new Error("Revocation failed.");
    const denied = await call("/api/account", {}, [401]);
    if (denied.error !== "invalid_token") throw new Error("Revoked access token still authorized.");
    console.log("Refresh, approved-order retry from a new Session (same order), and immediate revocation verified.");
  }
}
console.log(`View order: ${origin}/order/${orderId}${url.hash}`);
