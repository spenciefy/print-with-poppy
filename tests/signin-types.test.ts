// Poppy 0.2 sign-in types: Device Sign-In (§4.6), audited Direct (§4.5) and
// Mediated (§4.7) behavior, and the signed-in payoff (saved addresses, reorder).
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { signInHarness, type Agent } from "./support/signin-harness.js";
const temp = await fs.mkdtemp(`${os.tmpdir()}/poppy-signin-test-`);
process.env.APP_MODE = "demo";
process.env.DATA_DIR = temp;
process.env.NO_LISTEN = "1";
process.env.PUBLIC_URL = "http://localhost:8793";
const { app, limiter, oauthLimiter } = await import("../server/index.js");
beforeEach(() => {
  limiter.resetKey("127.0.0.1");
  oauthLimiter.resetKey("127.0.0.1");
});
const store = await import("../server/store.js");
const worker = await import("../server/worker.js");
let server: any;
before(async () => {
  server = app.listen(8793, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
});
after(async () => {
  await new Promise<void>((resolve) => server.close(resolve));
  store.db.close();
  await fs.rm(temp, { recursive: true, force: true });
});
const origin = "http://localhost:8793";
const h = await signInHarness(origin, store);
const { clientId, deviceGrant, clientAuth, makeAgent, postJson, startDevice, deviceBrowser, code, approveDevice, mediated } = h;
test("discovery advertises all three sign-in types and the device endpoint", async () => {
  const d = await (await fetch(origin + "/.well-known/poppy.json")).json();
  assert.deepEqual(d.auth.direct.scopes, ["poppy:read", "poppy:write"]);
  assert.deepEqual(d.auth.device.scopes, ["poppy:read", "poppy:write"]);
  assert.deepEqual(d.auth.mediated.scopes, ["poppy:read", "poppy:write"]);
  const m = await (await fetch(origin + "/.well-known/oauth-authorization-server")).json();
  assert.equal(m.device_authorization_endpoint, origin + "/oauth/device");
  assert.ok(m.grant_types_supported.includes(deviceGrant));
  assert.equal(m.authorization_response_iss_parameter_supported, true);
  const agent = await (await fetch(clientId)).json();
  assert.equal(agent.client_id, clientId);
  assert.equal(agent.client_name, "Demo Personal Agent");
  assert.deepEqual(agent.redirect_uris, [origin + "/api/demo/callback"]);
  const openapi = await (await fetch(origin + "/openapi.json")).json();
  for (const path of ["/api/account/addresses", "/api/account/orders/{id}/reorder", "/api/sandbox/device-sign-in/email"])
    assert.ok(openapi.paths[path], path);
  const guide = await (await fetch(origin + "/agent.txt")).text();
  assert.match(guide, /auth\.device/);
});

test("device sign-in: pending, slow_down, link alone approves nothing, approve, tokens, one-time code", async () => {
  const a = await makeAgent();
  const started = await startDevice();
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.headers.get("cache-control"), "no-store");
  const d = started.body;
  assert.match(d.user_code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  assert.equal(d.verification_uri, origin + "/device");
  assert.equal(d.verification_uri_complete, `${origin}/device?user_code=${d.user_code}`);
  assert.equal(d.expires_in, 600);
  assert.equal(d.interval, 5);
  assert.ok(d.device_code.length >= 28); // 144 random bits
  // No raw codes at rest.
  const grant = store.get("device-grant", store.hash(d.device_code));
  assert.ok(!JSON.stringify(grant).includes(d.user_code.replace("-", "")));

  const pending = await a.poll(d.device_code);
  assert.equal(pending.status, 400);
  assert.equal(pending.body.error, "authorization_pending");
  const fast = await a.poll(d.device_code);
  assert.equal(fast.body.error, "slow_down");
  assert.equal(fast.body.interval, 10);
  assert.equal(store.get("device-grant", store.hash(d.device_code)).interval, 10);

  // Opening the complete link only shows a prefilled form.
  const opened = await fetch(d.verification_uri_complete);
  assert.equal(opened.status, 200);
  const openedHtml = await opened.text();
  assert.match(openedHtml, new RegExp(`value="${d.user_code}"`));
  assert.equal(opened.headers.get("set-cookie"), null);
  assert.equal(store.get("device-grant", store.hash(d.device_code)).status, "pending");

  // Cross-site form posts are refused.
  const crossSite = await fetch(origin + "/device", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example" },
    body: new URLSearchParams({ user_code: d.user_code }),
  });
  assert.equal(crossSite.status, 403);

  const b = await deviceBrowser(d.user_code);
  assert.equal(b.entered.status, 200);
  assert.match(b.entered.html, /Demo Personal Agent/);
  assert.match(b.entered.html, /demo-agent-logo\.svg/);
  assert.match(b.entered.html, new RegExp(d.user_code));
  assert.equal(b.entered.headers.get("referrer-policy"), "same-origin");
  const email = `${randomUUID()}@example.com`;
  const emailed = await b.post("/device/email", { email });
  const shown = code(emailed.html);
  assert.ok(shown, "demo page shows the captured code for synthetic accounts");
  // The agent's sandbox-style helper reads the same captured email.
  const helper = await a.request("/api/sandbox/device-sign-in/email", postJson({ device_code: d.device_code }));
  assert.equal(helper.status, 200, JSON.stringify(helper.body));
  assert.equal(helper.body.email.text.match(/code is (\d{6})/)[1], shown);
  assert.match(helper.body.email.text, /localhost is requesting permission/);
  // Another session of the same agent cannot read it once the first has polled.
  const other = await makeAgent();
  assert.equal(
    (await other.request("/api/sandbox/device-sign-in/email", postJson({ device_code: d.device_code }))).status,
    404,
  );
  const wrong = await b.post("/device/verify", { code: shown === "000000" ? "111111" : "000000" });
  assert.match(wrong.html, /did not match/);
  const verified = await b.post("/device/verify", { code: shown! });
  assert.match(verified.html, /Allow access/);
  assert.match(verified.html, new RegExp(email.replace(/[.]/g, "\\.")));
  assert.equal((await a.poll(d.device_code)).body.error, "slow_down");
  const none = await b.post("/device/approve", { decision: "approve" });
  assert.match(none.html, /Choose at least one permission/);
  const done = await b.post("/device/approve", { decision: "approve", scopes: "poppy:read" });
  assert.match(done.html, /You’re connected/);

  // A different session can't redeem the code bound to the first poller.
  assert.equal((await other.poll(d.device_code)).body.error, "invalid_grant");
  const tokens = await a.poll(d.device_code);
  assert.equal(tokens.status, 200, JSON.stringify(tokens.body));
  assert.equal(tokens.headers.get("cache-control"), "no-store");
  assert.equal(tokens.body.token_type, "DPoP");
  assert.equal(tokens.body.signed_in, true);
  assert.equal(tokens.body.scope, "poppy:read");
  assert.equal(tokens.body.session_id, a.session.session_id);
  assert.ok(tokens.body.refresh_token);
  assert.equal(tokens.body.refresh_token_expires_in > 2500000, true);
  // One-time use.
  assert.equal((await a.poll(d.device_code)).body.error, "invalid_grant");
  Object.assign(a.session, tokens.body);
  const account = await a.request("/api/account");
  assert.equal(account.status, 200);
  assert.equal(account.body.email, email);
  assert.equal(account.body.scope, "poppy:read");
  // Read-only access can't save addresses.
  const write = await a.request("/api/account/addresses", postJson({ address: sampleAddress }));
  assert.equal(write.status, 403);
  assert.equal(write.body.error, "insufficient_scope");
  // Renew with the Account Token, then revoke: renewal fails afterwards.
  const renewed = await a.tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.body.refresh_token });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.body.signed_in, true);
  const revoked = await fetch(origin + "/oauth/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: tokens.body.refresh_token, token_type_hint: "refresh_token", ...(await clientAuth()) }),
  });
  assert.equal(revoked.status, 200);
  assert.equal(
    (await a.tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.body.refresh_token })).body.error,
    "invalid_grant",
  );
});

test("device sign-in: denied, expired, wrong codes, binding and request errors", async () => {
  const a = await makeAgent();
  // Denied.
  const denied = (await startDevice()).body;
  assert.equal((await a.poll(denied.device_code)).body.error, "authorization_pending");
  const { done } = await approveDevice(denied.user_code, `${randomUUID()}@example.com`, [], "deny");
  assert.match(done.html, /Request declined/);
  assert.equal((await a.poll(denied.device_code)).body.error, "access_denied");
  assert.equal((await a.poll(denied.device_code)).body.error, "access_denied");
  // The verification page refuses a code that's already decided.
  const again = await deviceBrowser(denied.user_code);
  assert.equal(again.entered.status, 400);
  assert.match(again.entered.html, /isn’t valid or has expired/);

  // Expired.
  const expired = (await startDevice()).body;
  const id = store.hash(expired.device_code);
  store.put("device-grant", id, { ...store.get<any>("device-grant", id), expires: Date.now() - 1 });
  const late = await a.poll(expired.device_code);
  assert.equal(late.status, 400);
  assert.equal(late.body.error, "expired_token");
  assert.equal((await deviceBrowser(expired.user_code)).entered.status, 400);

  // Expiring mid-sign-in closes the page too.
  const midway = (await startDevice()).body;
  const b = await deviceBrowser(midway.user_code);
  const mid = store.hash(midway.device_code);
  store.put("device-grant", mid, { ...store.get<any>("device-grant", mid), expires: Date.now() - 1 });
  assert.equal((await b.post("/device/email", { email: `${randomUUID()}@example.com` })).status, 400);

  // Unknown user codes and device codes.
  assert.equal((await deviceBrowser("BBBB-BBBB")).entered.status, 400);
  assert.equal((await a.poll("dvc_not-a-real-code")).body.error, "invalid_grant");

  // Missing session, missing client auth, bad scopes.
  const fresh = (await startDevice()).body;
  const noSession = await a.tokenRequest({ grant_type: deviceGrant, device_code: fresh.device_code });
  assert.equal(noSession.body.error, "invalid_session");
  const unauthenticated = await startDevice("poppy:read", false);
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.body.error, "invalid_client");
  assert.equal((await startDevice("poppy:admin")).body.error, "invalid_scope");
  assert.equal((await startDevice("")).body.error, "invalid_scope");

  // Per-agent rate limit returns 429 rate_limited with Retry-After.
  const rateKey = `device-start:${clientId}`;
  store.put("signin-rate", rateKey, { count: 30, expires: Date.now() + 60000 });
  const limited = await startDevice();
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, "rate_limited");
  assert.ok(limited.headers.get("retry-after"));
  store.remove("signin-rate", rateKey);
});

test("device sign-in into a session signed in to another account returns account_mismatch and spends the code", async () => {
  const a = await makeAgent();
  await mediated(a, `${randomUUID()}@example.com`, "poppy:read");
  const d = (await startDevice("poppy:read")).body;
  assert.equal((await a.poll(d.device_code)).body.error, "authorization_pending");
  await approveDevice(d.user_code, `${randomUUID()}@example.com`, ["poppy:read"]);
  const r = await a.poll(d.device_code);
  assert.equal(r.body.error, "account_mismatch");
  assert.equal(r.body.refresh_token, undefined);
  assert.equal((await a.poll(d.device_code)).body.error, "invalid_grant");
});

test("demo code helpers never reveal codes for non-synthetic accounts", async () => {
  const a = await makeAgent();
  const d = (await startDevice("poppy:read")).body;
  await a.poll(d.device_code);
  const b = await deviceBrowser(d.user_code);
  const emailed = await b.post("/device/email", { email: `${randomUUID()}@gmail.test` });
  assert.equal(emailed.status, 200);
  assert.equal(code(emailed.html), undefined);
  assert.equal(
    (await a.request("/api/sandbox/device-sign-in/email", postJson({ device_code: d.device_code }))).status,
    404,
  );
  const started = await a.request(
    "/api/poppy/sign-in",
    postJson({ scope: "poppy:read", credentials: { email: `${randomUUID()}@gmail.test` } }),
  );
  assert.equal((await a.request(`/api/sandbox/sign-in/${started.body.sign_in_id}/email`)).status, 404);
});

test("direct sign-in: errors after a verified callback redirect with state and iss; consent shows the agent", async () => {
  const verifier = store.id("verifier") + store.id("more");
  const params = (overrides: Record<string, string | null> = {}) => {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: origin + "/api/demo/callback",
      scope: "poppy:read poppy:write",
      state: "st_123",
      code_challenge: store.hash(verifier),
      code_challenge_method: "S256",
    });
    for (const [k, v] of Object.entries(overrides)) v === null ? q.delete(k) : q.set(k, v);
    return q;
  };
  const go = (q: URLSearchParams) => fetch(origin + "/oauth/authorize?" + q, { redirect: "manual" });
  const redirected = async (q: URLSearchParams, error: string) => {
    const r = await go(q);
    assert.equal(r.status, 302, error);
    const u = new URL(r.headers.get("location")!);
    assert.equal(u.origin + u.pathname, origin + "/api/demo/callback");
    assert.equal(u.searchParams.get("error"), error);
    assert.equal(u.searchParams.get("iss"), origin);
    return u;
  };
  assert.equal((await redirected(params({ scope: "poppy:admin" }), "invalid_scope")).searchParams.get("state"), "st_123");
  await redirected(params({ scope: null }), "invalid_scope");
  await redirected(params({ code_challenge_method: "plain" }), "invalid_request");
  await redirected(params({ code_challenge: null }), "invalid_request");
  await redirected(params({ response_type: "token" }), "unsupported_response_type");
  const noState = await redirected(params({ state: null }), "invalid_request");
  assert.equal(noState.searchParams.get("state"), null);
  // Unverified callbacks are never redirected to.
  assert.equal((await go(params({ redirect_uri: origin + "/api/demo/callback/x" }))).status, 400);
  const twice = params();
  twice.append("client_id", clientId);
  assert.equal((await go(twice)).status, 400);
  // Consent page shows the agent's name, logo and host, with a CSP for the logo.
  const page = await go(params());
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Demo Personal Agent/);
  assert.match(html, /demo-agent-logo\.svg/);
  assert.match(html, /Personal agent at localhost/);
  assert.match(page.headers.get("content-security-policy")!, /img-src 'self'/);
});

test("mediated sign-in: missing or unknown scopes are invalid_scope", async () => {
  const a = await makeAgent();
  const email = `${randomUUID()}@example.com`;
  const missing = await a.request("/api/poppy/sign-in", postJson({ credentials: { email } }));
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, "invalid_scope");
  const unknown = await a.request("/api/poppy/sign-in", postJson({ scope: "poppy:read addresses", credentials: { email } }));
  assert.equal(unknown.body.error, "invalid_scope");
  // Credentials are never echoed back.
  const started = await a.request("/api/poppy/sign-in", postJson({ scope: "poppy:read", credentials: { email } }));
  assert.ok(!JSON.stringify(started.body).includes(email));
});

const sampleAddress = {
  name: "Ada Recipient",
  line1: "500 Poppy Lane",
  line2: "",
  city: "Denver",
  state: "CO",
  postalCode: "80202",
  country: "US",
};
async function uploadPhoto(a: Agent) {
  const buffer = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: "#e76f26" } })
    .jpeg()
    .toBuffer();
  const form = new FormData();
  form.append("photo", new Blob([buffer]), "test.jpg");
  const uploaded = await a.request("/api/photos", { method: "POST", body: form });
  assert.equal(uploaded.status, 201);
  return uploaded.body.id as string;
}
async function approve(a: Agent, op: any) {
  const confirmed = await a.request(
    `/api/operations/${op.operation_id}/confirm`,
    postJson({ revision: op.revision, approved_by: "user" }),
  );
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  await worker.tick();
  const view = await a.request(`/api/operations/${op.operation_id}`);
  assert.equal(view.body.state, "succeeded");
  return view.body.result.data.order_id as string;
}

test("saved addresses let signed-in orders omit address and email; guests are unchanged", async () => {
  const guest = await makeAgent();
  const guestPhoto = await uploadPhoto(guest);
  const guestOrder = await guest.request(
    "/api/orders",
    postJson({ items: [{ photoId: guestPhoto, quantity: 1 }] }, { "Idempotency-Key": randomUUID() }),
  );
  assert.equal(guestOrder.status, 400);
  assert.equal(guestOrder.body.error, "invalid_request");
  const guestSaved = await guest.request(
    "/api/orders",
    postJson({ email: "g@example.com", addressId: "addr_x", items: [{ photoId: guestPhoto, quantity: 1 }] }, { "Idempotency-Key": randomUUID() }),
  );
  assert.equal(guestSaved.body.error, "sign_in_required");
  assert.equal((await guest.request("/api/account/addresses")).body.error, "sign_in_required");

  const a = await makeAgent();
  const email = `${randomUUID()}@example.com`;
  await mediated(a, email);
  const photo = await uploadPhoto(a);
  const none = await a.request(
    "/api/orders",
    postJson({ items: [{ photoId: photo, quantity: 1 }] }, { "Idempotency-Key": randomUUID() }),
  );
  assert.equal(none.body.error, "address_required");
  const saved = await a.request("/api/account/addresses", postJson({ address: sampleAddress, label: "Home" }));
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.default, true);
  assert.equal((await a.request("/api/account/addresses", postJson({ address: sampleAddress }))).status, 200);
  const work = await a.request(
    "/api/account/addresses",
    postJson({ address: { ...sampleAddress, line1: "1 Office Park", name: "Ada at Work" }, label: "Work" }),
  );
  assert.equal(work.body.default, false);
  const listed = await a.request("/api/account/addresses");
  assert.deepEqual(listed.body.addresses.map((x: any) => x.label), ["Home", "Work"]);
  const account = await a.request("/api/account");
  assert.equal(account.body.saved_addresses, 2);
  assert.equal(account.body.default_address.id, saved.body.id);

  const proposed = await a.request(
    "/api/orders",
    postJson({ items: [{ photoId: photo, quantity: 2, fit: "contain" }] }, { "Idempotency-Key": randomUUID() }),
  );
  assert.equal(proposed.status, 202, JSON.stringify(proposed.body));
  assert.match(proposed.body.operation.summary, /500 Poppy Lane, Denver, CO 80202/);
  assert.match(proposed.body.operation.summary, new RegExp(email.replace(/[.]/g, "\\.")));
  const byId = await a.request(
    "/api/orders",
    postJson({ addressId: work.body.id, items: [{ photoId: photo, quantity: 1 }] }, { "Idempotency-Key": randomUUID() }),
  );
  assert.match(byId.body.operation.summary, /1 Office Park/);
  const both = await a.request(
    "/api/orders",
    postJson({ addressId: work.body.id, address: sampleAddress, items: [{ photoId: photo, quantity: 1 }] }, { "Idempotency-Key": randomUUID() }),
  );
  assert.equal(both.status, 400);
  // Another account can't use or delete these addresses.
  const b = await makeAgent();
  await mediated(b);
  assert.equal((await b.request(`/api/account/addresses/${work.body.id}`, { method: "DELETE" })).status, 404);
  assert.equal(
    (
      await b.request(
        "/api/orders",
        postJson({ addressId: work.body.id, items: [{ photoId: await uploadPhoto(b), quantity: 1 }] }, { "Idempotency-Key": randomUUID() }),
      )
    ).body.error,
    "address_not_found",
  );
  // Default handling.
  assert.equal((await a.request(`/api/account/addresses/${work.body.id}/default`, { method: "POST" })).body.default, true);
  assert.equal((await a.request(`/api/account/addresses/${work.body.id}`, { method: "DELETE" })).body.deleted, true);
  const after = await a.request("/api/account/addresses");
  assert.equal(after.body.addresses.length, 1);
  assert.equal(after.body.addresses[0].default, true);
});

test("reorder proposes the same items for approval; idempotent, account-scoped and needs poppy:write", async () => {
  const a = await makeAgent();
  await mediated(a);
  await a.request("/api/account/addresses", postJson({ address: sampleAddress }));
  const photo = await uploadPhoto(a);
  const first = await a.request(
    "/api/orders",
    postJson({ items: [{ photoId: photo, quantity: 3, fit: "contain" }] }, { "Idempotency-Key": randomUUID() }),
  );
  const orderId = await approve(a, first.body.operation);
  const history = await a.request("/api/account/orders");
  assert.equal(history.body.orders[0].id, orderId);
  assert.equal(history.body.orders[0].reorderable, true);

  // A new session of the same agent and user, renewed with the Account Token.
  const later = await makeAgent();
  const key = randomUUID();
  const notSignedIn = await later.request(`/api/account/orders/${orderId}/reorder`, postJson({}, { "Idempotency-Key": key }));
  assert.equal(notSignedIn.body.error, "sign_in_required");
  const renewed = await a.tokenRequest({ grant_type: "refresh_token", refresh_token: a.session.refresh_token });
  Object.assign(a.session, renewed.body);
  const before = store.all("order").length;
  const re = await a.request(`/api/account/orders/${orderId}/reorder`, postJson({}, { "Idempotency-Key": key }));
  assert.equal(re.status, 202, JSON.stringify(re.body));
  assert.equal(re.body.reorder_of, orderId);
  const op = re.body.operation;
  assert.equal(op.state, "proposed");
  assert.equal(op.user_approval_required, true);
  assert.equal(op.confirmation, null);
  assert.notEqual(op.operation_id, first.body.operation.operation_id);
  assert.notEqual(op.terms.items[0].photoId, photo);
  assert.equal(op.terms.items[0].quantity, 3);
  assert.equal(op.terms.items[0].fit, "contain");
  assert.match(op.summary, /500 Poppy Lane/);
  assert.equal(store.all("order").length, before, "a reorder never places an order by itself");
  const retry = await a.request(`/api/account/orders/${orderId}/reorder`, postJson({}, { "Idempotency-Key": key }));
  assert.equal(retry.body.operation.operation_id, op.operation_id);
  const conflict = await a.request(
    `/api/account/orders/${orderId}/reorder`,
    postJson({ email: "other@example.com" }, { "Idempotency-Key": key }),
  );
  assert.equal(conflict.status, 409);
  const elsewhere = await a.request(
    `/api/account/orders/${orderId}/reorder`,
    postJson({ address: { ...sampleAddress, line1: "9 Gift Street" } }, { "Idempotency-Key": randomUUID() }),
  );
  assert.match(elsewhere.body.operation.summary, /9 Gift Street/);
  const reorderId = await approve(a, op);
  assert.notEqual(reorderId, orderId);
  // Read-only tokens and other accounts can't reorder.
  const readOnly = await a.tokenRequest({ grant_type: "refresh_token", refresh_token: a.session.refresh_token, scope: "poppy:read" });
  const ro = await makeAgent();
  Object.assign(ro.session, readOnly.body);
  const b = await makeAgent();
  await mediated(b);
  assert.equal(
    (await b.request(`/api/account/orders/${orderId}/reorder`, postJson({}, { "Idempotency-Key": randomUUID() }))).status,
    404,
  );
  Object.assign(a.session, readOnly.body);
  const denied = await a.request(`/api/account/orders/${orderId}/reorder`, postJson({}, { "Idempotency-Key": randomUUID() }));
  assert.equal(denied.body.error, "insufficient_scope");
  // Expired photos can't be reordered.
  store.put("photo", photo, { ...store.get<any>("photo", photo), deleted: true });
  Object.assign(a.session, renewed.body);
  const gone = await a.request(`/api/account/orders/${orderId}/reorder`, postJson({}, { "Idempotency-Key": randomUUID() }));
  assert.equal(gone.status, 410);
  assert.equal(gone.body.error, "photo_expired");
});
