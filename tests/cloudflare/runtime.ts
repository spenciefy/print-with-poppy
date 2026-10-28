import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { poppyAgent, delegate } from "../../scripts/poppy-delegation.js";
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
// A key that signed directly would be refused; this run also checks that below.
const clientId = origin + "/api/demo/agent.json";
// Without Docker, the media containers can't run: RUNTIME_SKIP_MEDIA=1 checks
// everything that doesn't upload or render photos.
const skipMedia = process.env.RUNTIME_SKIP_MEDIA === "1";
const runtimeAddress = {
  name: "Runtime Tester",
  line1: "123 Main Street",
  city: "San Francisco",
  state: "CA",
  postalCode: "94103",
  country: "US",
};
// The demo agent (0.3): the jwks_uri key signs client assertions and
// delegations; delegated keys sign the per-request Session JWTs.
const agent = await poppyAgent(key, clientId, origin);
const clientAuth = agent.clientAuth;
const discovery = await (await fetch(origin + "/.well-known/poppy.json")).json();
assert.equal(discovery.protocol_version, "0.3");
const metadata = await (
  await fetch(origin + "/.well-known/oauth-authorization-server")
).json();
// The local Worker runs the Agent Sandbox shape: Device and Mediated, no Direct.
assert.ok(!metadata.grant_types_supported.includes("authorization_code"));
assert.equal(
  (await fetch(origin + "/oauth/authorize?client_id=" + encodeURIComponent(clientId))).status,
  404,
);

// Browser form sign-in (the Device page) must preserve Origin while hiding cross-origin referrers.
const formStart = await fetch(origin + "/oauth/device", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ scope: "orders:read", ...(await clientAuth()) }),
});
assert.equal(formStart.status, 200);
const formGrant = await formStart.json();
const browserStart = await fetch(origin + "/device", {
  method: "POST",
  headers: {
    Origin: origin,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({ user_code: formGrant.user_code }),
});
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
  [origin, "poppy_device=wrong-browser", browserFields.csrf, 403],
  [origin, browserCookie, "wrong-csrf", 403],
] as const) {
  const result = await fetch(origin + "/device/email", {
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
const browserEmail = await fetch(origin + "/device/email", {
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
  const session = agent.newSession("test-" + randomUUID());
  let token: string | undefined;
  const sessionJwt = (method: string, url: string, t = token) => agent.sessionJwt(session, method, url, t);
  return {
    get token() {
      return token;
    },
    useToken(value: string | undefined) {
      token = value;
    },
    session,
    sessionJwt,
    clientAuth,
    async call(path: string, body?: any, extra: Record<string, string> = {}, method = body === undefined ? "GET" : "POST") {
      return fetch(origin + path, {
        method,
        headers: {
          "Poppy-Session": await sessionJwt(method, origin + path),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    },
  };
}
const approval = (op: any) => ({ "Poppy-Approval": `operation_id="${op.operation_id}", revision="${op.revision}"` });
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
assert.equal(
  api.paths["/api/orders"].post.responses["403"].content["application/json"].schema.$ref,
  "#/components/schemas/ApprovalRequired",
);
assert(api.components.schemas.ApprovalRequired.required.includes("operation"));
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
  400,
);
// 0.3: client assertions are signed directly by the jwks_uri key; one signed by a delegated key is refused.
const { importJWK } = await import("jose");
const delegated = await delegate(key, clientId);
const rootSigned = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: delegated.kid, pap_dlg: delegated.delegation })
  .setIssuer(clientId)
  .setSubject(clientId)
  .setAudience(origin)
  .setIssuedAt()
  .setExpirationTime("60s")
  .setJti(randomUUID())
  .sign(delegated.key);
void importJWK;
const undelegated = await fetch(origin + "/oauth/device", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    scope: "orders:read",
    client_id: clientId,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: rootSigned,
  }),
});
assert.equal(undelegated.status, 401);
assert.equal((await undelegated.json()).error, "invalid_client");
const a = await client(),
  b = await client();
if (!skipMedia) {
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
      ? { "Poppy-Session": await agent.sessionJwt("POST", url) }
      : {},
  });
}
const batchForm = new FormData();
batchForm.append("photo3", new Blob([artwork]), "private-name.png");
batchForm.append("photo1", new Blob([artwork]), "another-private-name.png");
batchForm.append("photo2", new Blob(["not an image"]), "bad.png");
assert.equal((await batchCall(a, batchForm, false)).status, 400);
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
assert.equal((await fetch(origin + "/api/orders/nonexistent")).status, 400);
const p = await a.sessionJwt("GET", origin + "/api/orders/nonexistent");
const replayHeaders = { "Poppy-Session": p };
assert.equal(
  (await fetch(origin + "/api/orders/nonexistent", { headers: replayHeaders }))
    .status,
  404,
);
assert.equal(
  (await fetch(origin + "/api/orders/nonexistent", { headers: replayHeaders }))
    .status,
  400,
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
const proposals = await Promise.all(Array.from({ length: 4 }, () => a.call("/api/orders", body)));
for (const r of proposals) assert.equal(r.status, 403);
const operations = await Promise.all(proposals.map((r) => r.json()));
assert.equal(
  new Set(operations.map((r) => r.operation.operation_id)).size,
  1,
  "Concurrent proposals must converge.",
);
const op = operations[0].operation;
assert.notEqual(
  (await b.call("/api/orders", body, approval(op))).status,
  201,
  "Another Session can't approve it.",
);
const confirmations = await Promise.all(Array.from({ length: 4 }, () => a.call("/api/orders", body, approval(op))));
for (const r of confirmations) assert.equal(r.status, 201);
const results = await Promise.all(confirmations.map((r) => r.json()));
assert.equal(new Set(results.map((r) => r.id)).size, 1, "At most once.");
const bad = await a.call("/api/orders", JSON.stringify(body));
assert.equal(bad.status, 400);

}
// Device Sign-In, saved addresses and reorder through the Workers transport.
const form = { "Content-Type": "application/x-www-form-urlencoded" };
const d = await client();
const deviceStart = await fetch(origin + "/oauth/device", {
  method: "POST",
  headers: form,
  body: new URLSearchParams({ scope: "orders:read orders:write addresses", ...(await d.clientAuth()) }),
});
assert.equal(deviceStart.status, 200);
const deviceGrant = await deviceStart.json();
assert.equal(deviceGrant.verification_uri, origin + "/device");
const poll = async () =>
  (
    await fetch(origin + "/oauth/token", {
      method: "POST",
      headers: form,
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceGrant.device_code,
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
decision.append("scopes", "orders:read");
decision.append("scopes", "orders:write");
decision.append("scopes", "addresses");
assert.match((await devicePost("/device/approve", decision)).html, /You’re connected/);
const deviceTokens = await poll();
assert.ok(deviceTokens.refresh_token, JSON.stringify(deviceTokens.error));
assert.equal(deviceTokens.token_type, "Bearer");
assert.equal(deviceTokens.refresh_token_expires_in, undefined);
assert.equal(deviceTokens.scope, "orders:read orders:write addresses");
assert.equal((await poll()).error, "invalid_grant");
d.useToken(deviceTokens.access_token);
const saved = await d.call("/api/account/addresses", { address: runtimeAddress, label: "Home" });
assert.equal(saved.status, 201);
const spare = await (await d.call("/api/account/addresses", { address: { ...runtimeAddress, line1: "1 Spare Street" } })).json();
const removed = await d.call(`/api/account/addresses/${spare.id}`, undefined, {}, "DELETE");
assert.equal(removed.status, 200);
if (!skipMedia) {
const dPhoto = await (await d.call("/api/photos/samples", { color: "red" })).json();
const signedBody = { items: [{ photoId: dPhoto.id, quantity: 2, fit: "contain" }] };
const signedProposal = await d.call("/api/orders", signedBody);
assert.equal(signedProposal.status, 403);
const signedOp = (await signedProposal.json()).operation;
assert.match(signedOp.summary, /123 Main Street/);
const placed = await d.call("/api/orders", signedBody, approval(signedOp));
assert.equal(placed.status, 201);
const placedOrder = await placed.json();
const reordered = await d.call(`/api/account/orders/${placedOrder.id}/reorder`, {});
assert.equal(reordered.status, 403);
const reorderOp = (await reordered.json()).operation;
assert.equal(reorderOp.expires_at !== undefined, true);
assert.notEqual(reorderOp.terms.items[0].photoId, dPhoto.id);
assert.equal((await fetch(reorderOp.terms.previews[0].url)).status, 200);
}
const deviceRevoke = await fetch(origin + "/oauth/revoke", {
  method: "POST",
  headers: form,
  body: new URLSearchParams({ token: deviceTokens.refresh_token, ...(await d.clientAuth()) }),
});
assert.equal(deviceRevoke.status, 200);
assert.equal((await d.call("/api/account")).status, 401);
console.log(
  skipMedia
    ? "Workers contracts passed WITHOUT media containers: published 0.3 discovery, direct client assertions (delegated-key assertion refused), Device page form protections, Session header, device sign-in, saved addresses and revocation. Photo upload, ordering and reorder were skipped."
    : "Workers contracts passed: Session header, replay, media privacy, compatibility-off, concurrent proposals and approvals (Operations v2, at most once), ownership, direct client assertions, device sign-in, saved addresses, reorder and revocation.",
);
