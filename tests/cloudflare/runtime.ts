import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";
const origin = process.env.PUBLIC_URL!;
assert(
  origin && ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
  "Runtime tests are local-only.",
);
const config = await (await fetch(origin + "/api/config")).json();
assert.equal(config.sandboxEmailDelivery, false, "CI must never send email.");
const key = JSON.parse(
  await fs.readFile(process.env.AGENT_PRIVATE_JWK_FILE!, "utf8"),
);
const identity = await importJWK(key, "ES256"),
  clientId = origin + "/api/demo/agent.json";
const digest = (v: string) =>
  createHash("sha256").update(v).digest("base64url");

// Browser form sign-in must preserve Origin while hiding cross-origin referrers.
const browserStart = await fetch(
  origin +
    "/oauth/authorize?" +
    new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: origin + "/api/demo/callback",
      scope: "poppy:read",
      state: randomUUID(),
      code_challenge: digest(randomUUID()),
      code_challenge_method: "S256",
    }),
);
assert.equal(browserStart.status, 200);
assert.equal(browserStart.headers.get("referrer-policy"), "same-origin");
const browserCookie = browserStart.headers.get("set-cookie")!.split(";")[0];
const browserHtml = await browserStart.text();
const browserFields = {
  flow: browserHtml.match(/name="flow" value="([^"]+)"/)![1],
  csrf: browserHtml.match(/name="csrf" value="([^"]+)"/)![1],
  email: "invalid-email", // Reach validation without sending mail.
};
for (const [requestOrigin, cookie, csrf, status] of [
  [origin, browserCookie, browserFields.csrf, 400],
  ["null", browserCookie, browserFields.csrf, 403],
  ["https://evil.example", browserCookie, browserFields.csrf, 403],
  ["", browserCookie, browserFields.csrf, 403],
  [origin, "", browserFields.csrf, 403],
  [origin, "poppy_signin=wrong-browser", browserFields.csrf, 403],
  [origin, browserCookie, "wrong-csrf", 403],
] as const) {
  const result = await fetch(origin + "/oauth/authorize/email", {
    method: "POST",
    headers: {
      Origin: requestOrigin,
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ ...browserFields, csrf }),
  });
  assert.equal(result.status, status);
}
assert.equal(
  (await fetch(origin + "/api/config")).headers.get("referrer-policy"),
  "no-referrer",
);
// The authorized browser must reach the code-entry page after the refused
// submissions. Demo mode captures the email; the delivery-off check above
// ensures this test cannot call an email provider.
const browserEmail = await fetch(origin + "/oauth/authorize/email", {
  method: "POST",
  headers: {
    Origin: origin,
    Cookie: browserCookie,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    ...browserFields,
    email: `browser-${randomUUID()}@example.com`,
  }),
});
assert.equal(browserEmail.status, 200);
assert.equal(browserEmail.headers.get("referrer-policy"), "same-origin");
assert.equal(browserEmail.headers.get("cache-control"), "no-store");
assert.match(await browserEmail.text(), /Check your email/);

async function client() {
  const pair = await generateKeyPair("ES256", { extractable: true }),
    jwk = await exportJWK(pair.publicKey);
  const proof = (method: string, url: string, token?: string) =>
    new SignJWT({
      htm: method,
      htu: url,
      ...(token ? { ath: digest(token) } : {}),
    })
      .setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk })
      .setIssuedAt()
      .setJti(randomUUID())
      .sign(pair.privateKey);
  const assertion = (sub: string) =>
    new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: key.kid })
      .setIssuer(clientId)
      .setSubject(sub)
      .setAudience(origin)
      .setIssuedAt()
      .setExpirationTime("60s")
      .setJti(randomUUID())
      .sign(identity);
  const response = await fetch(origin + "/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      DPoP: await proof("POST", origin + "/oauth/token"),
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      client_id: clientId,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await assertion(clientId),
      assertion: await assertion("test-" + randomUUID()),
    }),
  });
  assert.equal(response.status, 200);
  const { access_token: token } = await response.json();
  return {
    token,
    proof,
    async call(path: string, body?: any, extra: Record<string, string> = {}) {
      const method = body === undefined ? "GET" : "POST";
      return fetch(origin + path, {
        method,
        headers: {
          Authorization: `DPoP ${token}`,
          DPoP: await proof(method, origin + path, token),
          "Content-Type": "application/json",
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    },
  };
}
assert.equal(
  (
    await fetch(origin + "/api/agent-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
  ).status,
  404,
);
assert.equal((await fetch(origin + "/api/compat/openapi.json")).status, 404);
const api = await (await fetch(origin + "/openapi.json")).json();
assert(
  api.paths["/api/orders"].post.responses["202"].content[
    "application/json"
  ].schema.required.includes("operation"),
);
assert.equal(
  api.paths["/api/shirt-preview-approvals/{id}"].post.operationId,
  "approveShirtPreviews",
);
assert(
  !api.paths["/api/operations/{id}/shirt-previews"],
  "Store-specific actions must not be advertised under the protocol namespace.",
);
assert.equal(
  (
    await fetch(origin + "/api/shirt-preview-approvals/not-found", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
  ).status,
  401,
);
const a = await client(),
  b = await client();
const sample = await a.call("/api/photos/samples", { color: "yellow" });
assert.equal(sample.status, 201);
const photo = await sample.json();
assert.equal((await fetch(photo.previews.contain)).status, 200);
const expired = new URL(photo.previews.contain);
expired.searchParams.set("exp", "1");
assert.equal((await fetch(expired)).status, 403);
assert.equal(
  (
    await fetch(origin + "/api/orders/nonexistent", {
      headers: { Authorization: `Bearer ${a.token}` },
    })
  ).status,
  401,
);
const p = await a.proof("GET", origin + "/api/orders/nonexistent", a.token);
const replayHeaders = { Authorization: `DPoP ${a.token}`, DPoP: p };
assert.equal(
  (await fetch(origin + "/api/orders/nonexistent", { headers: replayHeaders }))
    .status,
  404,
);
assert.equal(
  (await fetch(origin + "/api/orders/nonexistent", { headers: replayHeaders }))
    .status,
  401,
);
const body = {
  email: "runtime@example.com",
  address: {
    name: "Runtime Tester",
    line1: "123 Main Street",
    city: "San Francisco",
    state: "CA",
    postalCode: "94103",
    country: "US",
  },
  items: [
    { photoId: photo.id, product: "prints", quantity: 5, fit: "contain" },
  ],
};
const idem = randomUUID();
const proposals = await Promise.all(
  Array.from({ length: 4 }, () =>
    a.call("/api/orders", body, { "Idempotency-Key": idem }),
  ),
);
for (const r of proposals) assert.equal(r.status, 202);
const operations = await Promise.all(proposals.map((r) => r.json()));
assert.equal(
  new Set(operations.map((r) => r.operation.operation_id)).size,
  1,
  "Concurrent proposals must converge.",
);
const op = operations[0].operation;
assert.equal(
  (await b.call(`/api/operations/${op.operation_id}`)).status,
  404,
  "Another session must not read the proposal.",
);
assert.equal(
  (
    await a.call(`/api/operations/${op.operation_id}/confirm`, {
      revision: op.revision,
      approved_by: "agent",
    })
  ).status,
  403,
);
const confirmations = await Promise.all(
  Array.from({ length: 4 }, () =>
    a.call(`/api/operations/${op.operation_id}/confirm`, {
      revision: op.revision,
      approved_by: "user",
    }),
  ),
);
for (const r of confirmations) assert.equal(r.status, 200);
const results = await Promise.all(confirmations.map((r) => r.json()));
assert.equal(new Set(results.map((r) => r.operation_id)).size, 1);
const bad = await a.call("/api/orders", JSON.stringify(body), {
  "Idempotency-Key": randomUUID(),
});
assert.equal(bad.status, 400);
console.log(
  "Workers contracts passed: native auth, replay, media privacy, compatibility-off, concurrent proposal/confirmation, approval and ownership.",
);
