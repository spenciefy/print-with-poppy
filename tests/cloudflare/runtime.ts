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
  const session = await response.json();
  let token = session.access_token;
  return {
    get token() {
      return token;
    },
    useToken(value: string) {
      token = value;
    },
    session,
    proof,
    clientAuth: async () => ({
      client_id: clientId,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await assertion(clientId),
    }),
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
// One native tool call carries several files; a corrupt image does not discard successes.
assert.equal(api.paths["/api/photos/batch"].post.operationId, "uploadPhotos");
const artwork = await (
  await fetch(origin + "/photos/poppy-abstract-cluster.webp")
).arrayBuffer();
async function batchCall(
  agent: Awaited<ReturnType<typeof client>>,
  form: FormData,
  signed = true,
) {
  const url = origin + "/api/photos/batch";
  return fetch(url, {
    method: "POST",
    body: form,
    headers: signed
      ? {
          Authorization: `DPoP ${agent.token}`,
          DPoP: await agent.proof("POST", url, agent.token),
        }
      : {},
  });
}
const batchForm = new FormData();
batchForm.append("photo3", new Blob([artwork]), "private-name.png");
batchForm.append("photo1", new Blob([artwork]), "another-private-name.png");
batchForm.append("photo2", new Blob(["not an image"]), "bad.png");
assert.equal((await batchCall(a, batchForm, false)).status, 401);
const batchResponse = await batchCall(a, batchForm);
assert.equal(batchResponse.status, 200);
const batch = await batchResponse.json();
assert.deepEqual(
  batch.results.map((r: any) => [r.field, r.status]),
  [
    ["photo1", "uploaded"],
    ["photo2", "failed"],
    ["photo3", "uploaded"],
  ],
);
assert.equal(batch.uploaded, 2);
assert.equal(batch.failed, 1);
assert(!JSON.stringify(batch).includes("private-name"));
for (const r of batch.results.filter((r: any) => r.photo)) {
  assert.match(r.photo.name, /^Photo [0-9]+$/);
  assert.equal((await fetch(r.photo.previews.contain)).status, 200);
}
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

// Device Sign-In, saved addresses and reorder through the Workers transport.
const form = { "Content-Type": "application/x-www-form-urlencoded" };
const d = await client();
const deviceStart = await fetch(origin + "/oauth/device", {
  method: "POST",
  headers: form,
  body: new URLSearchParams({ scope: "poppy:read poppy:write", ...(await d.clientAuth()) }),
});
assert.equal(deviceStart.status, 200);
const deviceGrant = await deviceStart.json();
assert.equal(deviceGrant.verification_uri, origin + "/device");
const poll = async () =>
  (
    await fetch(origin + "/oauth/token", {
      method: "POST",
      headers: { ...form, DPoP: await d.proof("POST", origin + "/oauth/token") },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceGrant.device_code,
        session_id: d.session.session_id,
        ...(await d.clientAuth()),
      }),
    })
  ).json();
assert.equal((await poll()).error, "authorization_pending");
const opened = await fetch(deviceGrant.verification_uri_complete);
assert.equal(opened.status, 200);
assert.equal(opened.headers.get("cache-control"), "no-store");
let deviceCookie = "",
  deviceFields: Record<string, string> = {};
async function devicePost(route: string, values: Record<string, string> | URLSearchParams) {
  const body = new URLSearchParams(deviceFields);
  for (const [k, v] of values instanceof URLSearchParams ? values : Object.entries(values)) body.append(k, v);
  const r = await fetch(origin + route, {
    method: "POST",
    headers: { ...form, Origin: origin, ...(deviceCookie ? { Cookie: deviceCookie } : {}) },
    body,
  });
  const set = r.headers.get("set-cookie");
  if (set?.startsWith("poppy_device=") && !deviceCookie) deviceCookie = set.split(";")[0];
  const html = await r.text();
  const flow = html.match(/name="flow" value="([^"]+)"/)?.[1];
  if (flow) deviceFields = { flow, csrf: html.match(/name="csrf" value="([^"]+)"/)![1] };
  return { r, html };
}
const entered = await devicePost("/device", { user_code: deviceGrant.user_code });
assert.equal(entered.r.status, 200);
assert.equal(entered.r.headers.get("referrer-policy"), "same-origin");
assert.match(entered.r.headers.get("content-security-policy")!, /form-action 'self'/);
assert.match(entered.html, /Demo Personal Agent/);
const emailed = await devicePost("/device/email", { email: `device-${randomUUID()}@example.com` });
const otp = emailed.html.match(/captured code is <strong>(\d{6})<\/strong>/)![1];
assert.match((await devicePost("/device/verify", { code: otp })).html, /Allow access/);
const decision = new URLSearchParams({ decision: "approve" });
decision.append("scopes", "poppy:read");
decision.append("scopes", "poppy:write");
assert.match((await devicePost("/device/approve", decision)).html, /You’re connected/);
const deviceTokens = await poll();
assert.equal(deviceTokens.signed_in, true, JSON.stringify(deviceTokens.error));
assert.equal(deviceTokens.scope, "poppy:read poppy:write");
assert.equal((await poll()).error, "invalid_grant");
d.useToken(deviceTokens.access_token);
const saved = await d.call("/api/account/addresses", { address: body.address, label: "Home" });
assert.equal(saved.status, 201);
const spare = await (await d.call("/api/account/addresses", { address: { ...body.address, line1: "1 Spare Street" } })).json();
const removed = await fetch(origin + `/api/account/addresses/${spare.id}`, {
  method: "DELETE",
  headers: {
    Authorization: `DPoP ${d.token}`,
    DPoP: await d.proof("DELETE", origin + `/api/account/addresses/${spare.id}`, d.token),
  },
});
assert.equal(removed.status, 200);
const dPhoto = await (await d.call("/api/photos/samples", { color: "red" })).json();
const signedProposal = await d.call(
  "/api/orders",
  { items: [{ photoId: dPhoto.id, quantity: 2, fit: "contain" }] },
  { "Idempotency-Key": randomUUID() },
);
assert.equal(signedProposal.status, 202);
const signedOp = (await signedProposal.json()).operation;
assert.match(signedOp.summary, /123 Main Street/);
let settled = await (
  await d.call(`/api/operations/${signedOp.operation_id}/confirm`, { revision: signedOp.revision, approved_by: "user" })
).json();
for (let i = 0; i < 40 && settled.state === "in_progress"; i++) {
  await new Promise((r) => setTimeout(r, 500));
  settled = await (await d.call(`/api/operations/${signedOp.operation_id}`)).json();
}
assert.equal(settled.state, "succeeded");
const reordered = await d.call(
  `/api/account/orders/${settled.result.data.order_id}/reorder`,
  {},
  { "Idempotency-Key": randomUUID() },
);
assert.equal(reordered.status, 202);
const reorderOp = (await reordered.json()).operation;
assert.equal(reorderOp.state, "proposed");
assert.notEqual(reorderOp.terms.items[0].photoId, dPhoto.id);
assert.equal((await fetch(reorderOp.terms.previews[0].url)).status, 200);
const deviceRevoke = await fetch(origin + "/oauth/revoke", {
  method: "POST",
  headers: form,
  body: new URLSearchParams({ token: deviceTokens.refresh_token, ...(await d.clientAuth()) }),
});
assert.equal(deviceRevoke.status, 200);
assert.equal((await d.call("/api/account")).status, 403);
console.log(
  "Workers contracts passed: native auth, replay, media privacy, compatibility-off, concurrent proposal/confirmation, approval and ownership, device sign-in, saved addresses, reorder and revocation.",
);
