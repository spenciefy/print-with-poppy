// Poppy 0.3 sign-in types: Device Sign-In (§4.6), audited Direct (§4.5) and
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
const { clientId, deviceGrant, clientAuth, makeAgent, postJson, startDevice, deviceBrowser, code, approveDevice, mediated, deviceSignIn, approveVia } = h;
test("discovery offers all three sign-in types: Direct and Device by grant type, Mediated in poppy.json", async () => {
  const d = await (await fetch(origin + "/.well-known/poppy.json")).json();
  assert.equal(d.auth.direct, undefined);
  assert.equal(d.auth.device, undefined);
  assert.equal(d.auth.mediated, undefined);
  assert.deepEqual(d.extensions["mediated-sign-in"].scopes, ["orders:read", "orders:write"]);
  const m = await (await fetch(origin + "/.well-known/oauth-authorization-server")).json();
  assert.equal(m.device_authorization_endpoint, origin + "/oauth/device");
  assert.equal(m.authorization_endpoint, origin + "/oauth/authorize");
  for (const grant of ["refresh_token", "authorization_code", deviceGrant, h.mediatedGrant])
    assert.ok(m.grant_types_supported.includes(grant), grant);
  assert.ok(!m.grant_types_supported.includes("urn:ietf:params:oauth:grant-type:jwt-bearer"));
  assert.equal(m.authorization_response_iss_parameter_supported, true);
  const agent = await (await fetch(clientId)).json();
  assert.equal(agent.client_id, clientId);
  assert.equal(agent.client_name, "Demo Personal Agent");
  assert.deepEqual(agent.redirect_uris, [origin + "/api/demo/callback"]);
  const openapi = await (await fetch(origin + "/openapi.json")).json();
  for (const path of ["/api/account/addresses", "/api/account/orders/{id}/reorder", "/api/sandbox/device-sign-in/email"])
    assert.ok(openapi.paths[path], path);
  const guide = await (await fetch(origin + "/agent.txt")).text();
  assert.match(guide, /device_code grant/);
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
  // Device sign-in belongs to the client: any Session of the same agent can read it.
  const other = await makeAgent();
  assert.equal(
    (await other.request("/api/sandbox/device-sign-in/email", postJson({ device_code: d.device_code }))).status,
    200,
  );
  const wrong = await b.post("/device/verify", { code: shown === "000000" ? "111111" : "000000" });
  assert.match(wrong.html, /did not match/);
  const verified = await b.post("/device/verify", { code: shown! });
  assert.match(verified.html, /Allow access/);
  assert.match(verified.html, new RegExp(email.replace(/[.]/g, "\\.")));
  assert.equal((await a.poll(d.device_code)).body.error, "slow_down");
  const none = await b.post("/device/approve", { decision: "approve" });
  assert.match(none.html, /Choose at least one permission/);
  const done = await b.post("/device/approve", { decision: "approve", scopes: "orders:read" });
  assert.match(done.html, /You’re connected/);

  const tokens = await a.poll(d.device_code);
  assert.equal(tokens.status, 200, JSON.stringify(tokens.body));
  assert.equal(tokens.headers.get("cache-control"), "no-store");
  assert.equal(tokens.body.token_type, "Bearer");
  // Plain OAuth: the approved, narrower scope; no session_id, signed_in or refresh_token_expires_in (0.3).
  assert.equal(tokens.body.scope, "orders:read");
  for (const field of ["session_id", "signed_in", "refresh_token_expires_in"]) assert.equal(tokens.body[field], undefined);
  assert.ok(tokens.body.refresh_token);
  // One-time use.
  assert.equal((await a.poll(d.device_code)).body.error, "invalid_grant");
  Object.assign(a.session, tokens.body);
  const account = await a.request("/api/account");
  assert.equal(account.status, 200);
  assert.equal(account.body.email, email);
  assert.equal(account.body.scope, "orders:read");
  // Read-only access can't save addresses.
  const write = await a.request("/api/account/addresses", postJson({ address: sampleAddress }));
  assert.equal(write.status, 403);
  assert.equal(write.body.error, "insufficient_scope");
  // Renew with the Account Token, then revoke: renewal fails afterwards.
  const renewed = await a.tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.body.refresh_token });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.body.scope, "orders:read");
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

  // Missing client auth, bad scopes.
  const unauthenticated = await startDevice("orders:read", false);
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.body.error, "invalid_client");
  assert.equal((await startDevice("poppy:read")).body.error, "invalid_scope");
  assert.equal((await startDevice("")).body.error, "invalid_scope");

  // Per-agent rate limit: a plain 429 with Retry-After (§5.6).
  const rateKey = `device-start:${clientId}`;
  store.put("signin-rate", rateKey, { count: 30, expires: Date.now() + 60000 });
  const limited = await startDevice();
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, undefined);
  assert.ok(limited.headers.get("retry-after"));
  store.remove("signin-rate", rateKey);
});

test("tokens for a second account are refused in a Session already signed in to another (invalid_session)", async () => {
  const a = await makeAgent();
  await mediated(a, `${randomUUID()}@example.com`, "orders:read");
  assert.equal((await a.request("/api/account")).status, 200);
  const d = (await startDevice("orders:read")).body;
  assert.equal((await a.poll(d.device_code)).body.error, "authorization_pending");
  await approveDevice(d.user_code, `${randomUUID()}@example.com`, ["orders:read"]);
  const r = await a.poll(d.device_code);
  assert.equal(r.status, 200);
  const mixed = await a.request("/api/account", { token: r.body.access_token });
  assert.equal(mixed.status, 400);
  assert.equal(mixed.body.error, "invalid_session");
  assert.equal(mixed.headers.get("www-authenticate"), null);
  // A new Session (new sid) works with them.
  const b = await makeAgent(a.user);
  assert.equal((await b.request("/api/account", { token: r.body.access_token })).status, 200);
  assert.equal((await a.poll(d.device_code)).body.error, "invalid_grant");
});

test("demo code helpers never reveal codes for non-synthetic accounts", async () => {
  const a = await makeAgent();
  const d = (await startDevice("orders:read")).body;
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
    postJson({ scope: "orders:read", credentials: { email: `${randomUUID()}@gmail.test` } }),
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
      scope: "orders:read orders:write",
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
  assert.equal((await redirected(params({ scope: "poppy:read" }), "invalid_scope")).searchParams.get("state"), "st_123");
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

test("mediated sign-in: missing or unknown scopes are invalid_scope; the email is never echoed", async () => {
  const email = `${randomUUID()}@example.com`;
  const missing = await h.tokenRequest({ grant_type: h.mediatedGrant, email });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, "invalid_scope");
  const unknown = await h.tokenRequest({ grant_type: h.mediatedGrant, scope: "orders:read addresses", email });
  assert.equal(unknown.body.error, "invalid_scope");
  assert.equal((await h.tokenRequest({ grant_type: h.mediatedGrant, scope: "orders:read" })).body.error, "invalid_request");
  assert.equal((await h.tokenRequest({ grant_type: h.mediatedGrant, scope: "orders:read", email, phone: "1" })).body.error, "invalid_request");
  const started = await h.tokenRequest({ grant_type: h.mediatedGrant, scope: "orders:read", email });
  assert.equal(started.body.error, "code_required");
  assert.equal(started.headers.get("cache-control"), "no-store");
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
/** Operations v2: propose (403 approval_required), then approve by sending the same request again. */
async function proposeAndApprove(a: Agent, route: string, body: unknown) {
  const proposed = await a.request(route, postJson(body));
  assert.equal(proposed.status, 403, JSON.stringify(proposed.body));
  assert.equal(proposed.body.error, "approval_required");
  const done = await approveVia(a, route, body, proposed.body.operation);
  assert.equal(done.status, 201, JSON.stringify(done.body));
  await worker.tick();
  return { op: proposed.body.operation, orderId: done.body.id as string };
}

test("saved addresses let signed-in orders omit address and email; guests are unchanged", async () => {
  const guest = await makeAgent();
  const guestPhoto = await uploadPhoto(guest);
  const guestOrder = await guest.request(
    "/api/orders",
    postJson({ items: [{ photoId: guestPhoto, quantity: 1 }] }),
  );
  assert.equal(guestOrder.status, 400);
  assert.equal(guestOrder.body.error, "invalid_request");
  const guestSaved = await guest.request(
    "/api/orders",
    postJson({ email: "g@example.com", addressId: "addr_x", items: [{ photoId: guestPhoto, quantity: 1 }] }),
  );
  assert.equal(guestSaved.status, 401);
  assert.match(guestSaved.headers.get("www-authenticate")!, /^Bearer scope="[^"]*addresses"$/);
  assert.equal((await guest.request("/api/account/addresses")).status, 401);

  const a = await makeAgent();
  const email = `${randomUUID()}@example.com`;
  await deviceSignIn(a, email);
  const photo = await uploadPhoto(a);
  const none = await a.request(
    "/api/orders",
    postJson({ items: [{ photoId: photo, quantity: 1 }] }),
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
    postJson({ items: [{ photoId: photo, quantity: 2, fit: "contain" }] }),
  );
  assert.equal(proposed.status, 403, JSON.stringify(proposed.body));
  assert.match(proposed.body.operation.summary, /500 Poppy Lane, Denver, CO 80202/);
  assert.match(proposed.body.operation.summary, new RegExp(email.replace(/[.]/g, "\\.")));
  const byId = await a.request(
    "/api/orders",
    postJson({ addressId: work.body.id, items: [{ photoId: photo, quantity: 1 }] }),
  );
  assert.match(byId.body.operation.summary, /1 Office Park/);
  const both = await a.request(
    "/api/orders",
    postJson({ addressId: work.body.id, address: sampleAddress, items: [{ photoId: photo, quantity: 1 }] }),
  );
  assert.equal(both.status, 400);
  // Another account can't use or delete these addresses.
  const b = await makeAgent();
  await deviceSignIn(b);
  assert.equal((await b.request(`/api/account/addresses/${work.body.id}`, { method: "DELETE" })).status, 404);
  assert.equal(
    (
      await b.request(
        "/api/orders",
        postJson({ addressId: work.body.id, items: [{ photoId: await uploadPhoto(b), quantity: 1 }] }),
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

test("reorder asks for approval (Operations v2), places one order once approved, and is account-scoped", async () => {
  const a = await makeAgent();
  await deviceSignIn(a);
  await a.request("/api/account/addresses", postJson({ address: sampleAddress }));
  const photo = await uploadPhoto(a);
  const first = await proposeAndApprove(a, "/api/orders", { items: [{ photoId: photo, quantity: 3, fit: "contain" }] });
  const orderId = first.orderId;
  const history = await a.request("/api/account/orders");
  assert.equal(history.body.orders[0].id, orderId);
  assert.equal(history.body.orders[0].reorderable, true);

  // A new Session of the same User, signed out: a challenge.
  const later = await makeAgent(a.user);
  const notSignedIn = await later.request(`/api/account/orders/${orderId}/reorder`, postJson({}));
  assert.equal(notSignedIn.status, 401);
  // The same new Session, with a refreshed access token.
  const renewed = await a.tokenRequest({ grant_type: "refresh_token", refresh_token: a.session.refresh_token! });
  later.session.access_token = renewed.body.access_token;
  const before = store.all("order").length;
  const route = `/api/account/orders/${orderId}/reorder`;
  const re = await later.request(route, postJson({}));
  assert.equal(re.status, 403, JSON.stringify(re.body));
  assert.equal(re.body.error, "approval_required");
  const op = re.body.operation;
  for (const k of ["operation_id", "revision", "summary", "terms", "expires_at"]) assert.ok(k in op, k);
  for (const k of ["state", "confirmation", "result", "user_approval_required", "owner", "principal", "request"]) assert.equal(k in op, false, k);
  assert.notEqual(op.operation_id, first.op.operation_id);
  assert.notEqual(op.terms.items[0].photoId, photo);
  assert.equal(op.terms.items[0].quantity, 3);
  assert.equal(op.terms.items[0].fit, "contain");
  assert.match(op.summary, /500 Poppy Lane/);
  assert.equal(store.all("order").length, before, "a reorder never places an order by itself");
  // The same request again: the same operation, and no new photo copies.
  const photos = store.all("photo").length;
  const retry = await later.request(route, postJson({}));
  assert.equal(retry.body.operation.operation_id, op.operation_id);
  assert.equal(store.all("photo").length, photos);
  // A different request is a different operation.
  const elsewhere = await later.request(route, postJson({ address: { ...sampleAddress, line1: "9 Gift Street" } }));
  assert.match(elsewhere.body.operation.summary, /9 Gift Street/);
  assert.notEqual(elsewhere.body.operation.operation_id, op.operation_id);
  // Approve: one order; retried, the same one.
  const placed = await approveVia(later, route, {}, op);
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  assert.notEqual(placed.body.id, orderId);
  assert.equal((await approveVia(later, route, {}, op)).body.id, placed.body.id);
  assert.equal(store.all("order").length, before + 1);
  // After it's performed, the same request without approval proposes anew.
  const again = await later.request(route, postJson({}));
  assert.equal(again.status, 403);
  assert.notEqual(again.body.operation.operation_id, op.operation_id);
  // Other accounts and read-only tokens can't reorder.
  const b = await makeAgent();
  await deviceSignIn(b);
  assert.equal((await b.request(route, postJson({}))).status, 404);
  const readOnly = await a.tokenRequest({ grant_type: "refresh_token", refresh_token: a.session.refresh_token!, scope: "orders:read" });
  const denied = await a.request(route, { ...postJson({}), token: readOnly.body.access_token });
  assert.equal(denied.body.error, "insufficient_scope");
  // Expired photos can't be reordered.
  store.put("photo", photo, { ...store.get<any>("photo", photo), deleted: true });
  const gone = await a.request(route, postJson({ email: "new@example.com" }));
  assert.equal(gone.status, 410);
  assert.equal(gone.body.error, "photo_expired");
});

test("consent CSP allows only the agent's logo origin and its callback origin as a form target", async () => {
  const { consentPolicy } = await import("../server/signin-pages.js");
  let header = "";
  consentPolicy({ set: (_: string, v: string) => (header = v) } as any, "https://agent.example/logo.png", "https://agent.example/oauth/callback");
  assert.match(header, /img-src 'self' blob: data: https:\/\/agent\.example;/);
  assert.match(header, /form-action 'self' https:\/\/agent\.example;/);
  assert.match(header, /object-src 'none'/);
  consentPolicy({ set: (_: string, v: string) => (header = v) } as any);
  assert.match(header, /form-action 'self';/);
});
