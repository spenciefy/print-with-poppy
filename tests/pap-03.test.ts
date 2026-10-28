// Published Poppy 0.3 draft, one test per change that touches a Company:
// discovery, client assertions (§4.1), the Session header (§5), Sessions keyed
// by client_id + sid, plain OAuth tokens, error shapes (§7), Device without
// key binding, and loopback redirect URIs.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { SignJWT, generateKeyPair, exportJWK, importJWK, calculateJwkThumbprint, createLocalJWKSet } from "jose";
import { signInHarness } from "./support/signin-harness.js";
import { delegate, jti, sha256 } from "../scripts/poppy-delegation.js";
const temp = await fs.mkdtemp(`${os.tmpdir()}/poppy-03-test-`);
process.env.APP_MODE = "demo";
process.env.DATA_DIR = temp;
process.env.NO_LISTEN = "1";
process.env.PUBLIC_URL = "http://localhost:8795";
const { app, limiter, oauthLimiter } = await import("../server/index.js");
beforeEach(() => {
  limiter.resetKey("127.0.0.1");
  oauthLimiter.resetKey("127.0.0.1");
});
const store = await import("../server/store.js");
const auth = await import("../server/auth.js");
const delegation = await import("../server/delegation.js");
const sessions = await import("../server/sessions.js");
let server: any;
before(async () => {
  server = app.listen(8795, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
});
after(async () => {
  await new Promise<void>((resolve) => server.close(resolve));
  store.db.close();
  await fs.rm(temp, { recursive: true, force: true });
});
const origin = "http://localhost:8795";
const h = await signInHarness(origin, store);
const { clientId, deviceGrant, makeAgent, postJson, startDevice, approveDevice, mediated, deviceSignIn, tokenRequest, mediatedGrant } = h;
const root = store.get("demo-key", "identity").private;
const rootKey = await importJWK(root, "ES256");
const catalog = origin + "/api/catalog";

/** A client assertion with overrides, signed by the jwks_uri key unless told otherwise. */
async function clientAssertion(o: { aud?: any; iss?: string; sub?: string; exp?: number; iat?: number; jti?: string; header?: any; key?: any } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: root.kid || "demo", ...o.header })
    .setIssuer(o.iss ?? clientId)
    .setSubject(o.sub ?? clientId)
    .setAudience(o.aud ?? origin)
    .setIssuedAt(o.iat ?? now)
    .setExpirationTime(o.exp ?? now + 60)
    .setJti(o.jti ?? jti())
    .sign(o.key ?? rootKey);
}
const withAssertion = async (assertion: string, body: Record<string, string> = { grant_type: "refresh_token", refresh_token: "prt_unknown" }) => {
  const r = await fetch(origin + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...body,
      client_id: clientId,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    }),
  });
  return { status: r.status, body: await r.json() };
};

/** A Session JWT with overrides, signed by a fresh delegated key. */
async function sessionJwt(o: {
  sid?: string; sub?: string; agent_id?: string; htm?: string; htu?: string; aud?: any; iss?: string; iat?: number; jti?: string | null;
  ath?: string; typ?: string; kid?: string; dlg?: Awaited<ReturnType<typeof delegate>> | null; omit?: string[];
} = {}) {
  const d = o.dlg === undefined ? await delegate(root, clientId) : o.dlg;
  const claims: Record<string, unknown> = {
    iss: o.iss ?? clientId,
    aud: o.aud ?? origin,
    sid: o.sid ?? jti(),
    sub: o.sub ?? `user-${randomUUID()}`,
    htm: o.htm ?? "GET",
    htu: o.htu ?? catalog,
    iat: o.iat ?? Math.floor(Date.now() / 1000),
    jti: o.jti === null ? undefined : (o.jti ?? jti()),
    ...(o.agent_id ? { agent_id: o.agent_id } : {}),
    ...(o.ath ? { ath: o.ath } : {}),
  };
  for (const k of o.omit ?? []) delete claims[k];
  const header: any = { alg: "ES256", typ: o.typ ?? "poppy-session+jwt", kid: o.kid ?? d?.kid ?? root.kid ?? "demo" };
  if (d) header.pap_dlg = d.delegation;
  return new SignJWT(claims).setProtectedHeader(header).sign(d ? d.key : rootKey);
}
const get = async (jwt: string | string[], url = catalog, token?: string) => {
  const headers = new Headers();
  for (const v of [jwt].flat()) headers.append("Poppy-Session", v);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const r = await fetch(url, { headers });
  return { status: r.status, body: await r.json(), challenge: r.headers.get("www-authenticate") };
};
const refusedSession = async (jwt: string | string[], label: string, url = catalog, token?: string) => {
  const r = await get(jwt, url, token);
  assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.error, "invalid_session", label);
  assert.equal(r.challenge, null, label);
};

test("discovery: protected resource metadata, issuer metadata and poppy.json for the published 0.3 draft", async () => {
  const d = await (await fetch(origin + "/.well-known/poppy.json")).json();
  const prm = await (await fetch(origin + "/.well-known/oauth-protected-resource")).json();
  const m = await (await fetch(origin + "/.well-known/oauth-authorization-server")).json();
  assert.equal(d.protocol_version, "0.3");
  assert.equal(prm.resource, "https://localhost");
  assert.deepEqual(prm.authorization_servers, [origin]);
  assert.equal(d.auth.issuer, prm.authorization_servers[0]);
  assert.equal(m.issuer, origin);
  assert.deepEqual(m.protected_resources, ["https://localhost"]);
  assert.deepEqual(m.token_endpoint_auth_methods_supported, ["private_key_jwt"]);
  for (const alg of ["ES256", "PS384"]) assert.ok(m.token_endpoint_auth_signing_alg_values_supported.includes(alg), alg);
  assert.ok(m.revocation_endpoint);
  assert.equal(m.authorization_response_iss_parameter_supported, true);
  assert.deepEqual(m.code_challenge_methods_supported, ["S256"]);
  assert.equal(m.dpop_signing_alg_values_supported, undefined);
  assert.ok(!m.grant_types_supported.includes("urn:ietf:params:oauth:grant-type:jwt-bearer"));
  for (const g of ["refresh_token", "authorization_code", deviceGrant, mediatedGrant]) assert.ok(m.grant_types_supported.includes(g), g);
  assert.deepEqual(m.scopes_supported, ["orders:read", "orders:write", "addresses"]);
  for (const scope of m.scopes_supported) {
    assert.ok(d.auth.scopes[scope]?.length > 20, `${scope} described`);
    const hint = d.auth.scope_hints[scope];
    assert.ok(["none", "reversible", "irreversible"].includes(hint.changes), scope);
    assert.equal(typeof hint.personal_data, "boolean");
  }
  assert.deepEqual(d.auth.scope_hints["orders:write"], { changes: "irreversible", personal_data: true });
  assert.equal(d.auth.mediated, undefined);
  assert.deepEqual(d.extensions.operations, { version: "2" });
  assert.equal(d.extensions["mediated-sign-in"].version, "1");
  assert.ok(d.extensions["mediated-sign-in"].scopes.every((s: string) => m.scopes_supported.includes(s)));
  assert.equal(d.web, undefined, "no browser join");
});

test("client assertions: signed directly by a jwks_uri key, aud = issuer as one string, short-lived, single-use", async () => {
  const ok = await withAssertion(await clientAssertion());
  assert.equal(ok.status, 400);
  assert.equal(ok.body.error, "invalid_grant", "the assertion is accepted; the unknown refresh token isn't");
  const refused = async (assertion: string, label: string) => {
    const r = await withAssertion(assertion);
    assert.equal(r.status, 401, `${label}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, "invalid_client", label);
  };
  await refused(await clientAssertion({ aud: [origin] }), "aud as an array");
  await refused(await clientAssertion({ aud: origin + "/oauth/token" }), "token endpoint aud");
  await refused(await clientAssertion({ aud: origin + "/" }), "trailing slash");
  await refused(await clientAssertion({ sub: "someone" }), "sub ≠ client_id");
  await refused(await clientAssertion({ iss: "https://other.example/agent.json" }), "iss ≠ client_id");
  await refused(await clientAssertion({ exp: Math.floor(Date.now() / 1000) + 3600 }), "lifetime over 5 minutes");
  await refused(await clientAssertion({ jti: "short" }), "short jti");
  const once = await clientAssertion();
  await withAssertion(once);
  await refused(once, "replayed jti");
  // A delegated key can't sign client assertions.
  const d = await delegate(root, clientId);
  await refused(await clientAssertion({ key: d.key, header: { kid: d.kid, pap_dlg: d.delegation } }), "delegated key with pap_dlg");
  await refused(await clientAssertion({ header: { typ: "poppy-session+jwt" } }), "Session JWT typ");
  await refused(await clientAssertion({ header: { kid: "unknown" } }), "unknown kid");
  // PS384 from an RSA jwks key.
  const rsa = await generateKeyPair("PS384", { extractable: true });
  const rsaPublic = { ...(await exportJWK(rsa.publicKey)), kid: "rsa", alg: "PS384" };
  const now = Math.floor(Date.now() / 1000);
  const ps = await new SignJWT({})
    .setProtectedHeader({ alg: "PS384", kid: "rsa" })
    .setIssuer(clientId).setSubject(clientId).setAudience(origin).setIssuedAt(now).setExpirationTime(now + 60).setJti(jti())
    .sign(rsa.privateKey);
  await auth.verifyClientAssertion(ps, createLocalJWKSet({ keys: [rsaPublic] }), clientId);
});

test("Session header: delegation checks (ES256 or PS384, ≤24 h, public P-256 cnf, kid = thumbprint)", async () => {
  assert.equal((await get(await sessionJwt())).status, 200);
  await refusedSession(await sessionJwt({ dlg: null }), "signed directly by the jwks_uri key");
  const now = Math.floor(Date.now() / 1000);
  await refusedSession(await sessionJwt({ dlg: await delegate(root, clientId, { iat: now - 7200, exp: now - 60 }) }), "expired delegation");
  await refusedSession(await sessionJwt({ dlg: await delegate(root, clientId, { exp: now + 90000 }) }), "delegation over 24 h");
  await refusedSession(await sessionJwt({ dlg: await delegate(root, clientId, { iss: "https://other.example/agent.json" }) }), "delegation from another client");
  await refusedSession(await sessionJwt({ dlg: await delegate(root, clientId, { typ: "JWT" }) }), "delegation typ");
  await refusedSession(await sessionJwt({ dlg: await delegate(root, clientId, { kid: "unknown" }) }), "delegation kid not in jwks");
  const privateCnf = await generateKeyPair("ES256", { extractable: true });
  await refusedSession(
    await sessionJwt({ dlg: await delegate(root, clientId, { cnf: { jwk: await exportJWK(privateCnf.privateKey) } }) }),
    "private key in cnf",
  );
  await refusedSession(await sessionJwt({ kid: "not-the-thumbprint" }), "kid ≠ thumbprint");
  // The Session JWT's iat can't be after the delegation expires.
  const short = await delegate(root, clientId, { iat: now - 100, exp: now - 10 });
  await refusedSession(await sessionJwt({ dlg: short, iat: now }), "iat after delegation exp");
  // PS384 delegations from an RSA jwks key are accepted.
  const rsa = await generateKeyPair("PS384", { extractable: true });
  const rsaJwk = { ...(await exportJWK(rsa.privateKey)), kid: "rsa", alg: "PS384" };
  const ps = await delegate(rsaJwk, clientId, { alg: "PS384" });
  const header = { alg: "ES256", typ: "poppy-session+jwt", kid: ps.kid, pap_dlg: ps.delegation };
  const verified = await delegation.delegatedKey(header, createLocalJWKSet({ keys: [{ ...(await exportJWK(rsa.publicKey)), kid: "rsa", alg: "PS384" }] }), clientId);
  assert.ok(verified.key);
  assert.equal(await calculateJwkThumbprint(ps.jwk), ps.kid);
});

test("Session header: claim checks, single use, cardinality, and an access token needs one", async () => {
  await refusedSession(await sessionJwt({ typ: "JWT" }), "typ");
  await refusedSession(await sessionJwt({ aud: origin + "/oauth/token" }), "aud");
  await refusedSession(await sessionJwt({ aud: [origin] }), "aud array");
  await refusedSession(await sessionJwt({ iss: "https://other.example/agent.json" }), "iss");
  await refusedSession(await sessionJwt({ htm: "POST" }), "htm");
  await refusedSession(await sessionJwt({ htu: origin + "/api/photos" }), "htu");
  await refusedSession(await sessionJwt({ iat: Math.floor(Date.now() / 1000) - 300 }), "old iat");
  await refusedSession(await sessionJwt({ iat: Math.floor(Date.now() / 1000) + 300 }), "future iat");
  await refusedSession(await sessionJwt({ sid: "has spaces" }), "sid characters");
  for (const claim of ["sid", "sub", "jti", "htu"]) await refusedSession(await sessionJwt({ omit: [claim] }), `missing ${claim}`);
  await refusedSession(await sessionJwt({ ath: sha256("tok") }), "ath without a token");
  await refusedSession([await sessionJwt(), await sessionJwt()], "two headers");
  // A query string isn't part of htu.
  assert.equal((await get(await sessionJwt(), catalog + "?x=1")).status, 200);
  const once = await sessionJwt();
  assert.equal((await get(once)).status, 200);
  await refusedSession(once, "replayed jti");
  // Access tokens: only with a Session header whose ath covers them.
  const a = await makeAgent();
  const tokens = await mediated(a);
  const bare = await fetch(origin + "/api/account", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  assert.equal(bare.status, 400);
  assert.equal((await bare.json()).error, "invalid_session");
  await refusedSession(await sessionJwt({ sid: a.session.sid, sub: a.user, htu: origin + "/api/account" }), "token without ath", origin + "/api/account", tokens.access_token);
  const ok = await get(await sessionJwt({ sid: a.session.sid, sub: a.user, htu: origin + "/api/account", ath: sha256(tokens.access_token) }), origin + "/api/account", tokens.access_token);
  assert.equal(ok.status, 200);
  // DPoP is gone.
  const dpop = await fetch(origin + "/api/account", { headers: { Authorization: `DPoP ${tokens.access_token}` } });
  assert.equal(dpop.status, 400);
});

test("Sessions: keyed by client_id + sid; a new sid is signed out; sub and agent_id can't change; ended sids stay refused", async () => {
  const sid = jti();
  const user = randomUUID();
  assert.equal((await get(await sessionJwt({ sid, sub: user, agent_id: "travel" }))).status, 200);
  const id = h.sessionOf(sid);
  assert.ok(id);
  assert.equal((await get(await sessionJwt({ sid, sub: user, agent_id: "travel" }))).status, 200);
  assert.equal(h.sessionOf(sid), id);
  await refusedSession(await sessionJwt({ sid, sub: `user-${randomUUID()}`, agent_id: "travel" }), "another sub");
  await refusedSession(await sessionJwt({ sid, sub: user }), "agent_id dropped");
  await refusedSession(await sessionJwt({ sid, sub: user, agent_id: "shopping" }), "another agent_id");
  // A new sid is a new, signed-out Session.
  const other = await makeAgent(user);
  assert.notEqual(other.session.session_id, id);
  assert.equal((await other.request("/api/account")).status, 401);
  // Ended Sessions are remembered and refused.
  sessions.endSession(store.get("session", id)!);
  await refusedSession(await sessionJwt({ sid, sub: user, agent_id: "travel" }), "ended sid");
});

test("tokens: plain OAuth Bearer; refresh narrows scope and accepts only this resource; grants never exceed the request", async () => {
  const a = await makeAgent();
  const t = await deviceSignIn(a, `${randomUUID()}@example.com`, ["orders:read", "orders:write"]);
  assert.deepEqual(Object.keys(t).sort(), ["access_token", "expires_in", "refresh_token", "scope", "token_type"]);
  assert.equal(t.token_type, "Bearer");
  assert.equal(t.expires_in, 3600);
  const refresh = (extra: Record<string, string> = {}) => tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token, ...extra });
  assert.equal((await refresh({ resource: "https://localhost" })).status, 200);
  assert.equal((await refresh({ resource: "https://other.example" })).body.error, "invalid_target");
  assert.equal((await refresh({ scope: "orders:read addresses" })).body.error, "invalid_scope");
  const narrow = await refresh({ scope: "orders:read" });
  assert.equal(narrow.body.scope, "orders:read");
  assert.equal(narrow.headers.get("cache-control"), "no-store");
  // Device: an approval granting fewer scopes than requested gets exactly those; none is a decline.
  const d = (await startDevice("orders:read orders:write")).body;
  await approveDevice(d.user_code, `${randomUUID()}@example.com`, ["orders:read"]);
  assert.equal((await a.poll(d.device_code)).body.scope, "orders:read");
  // Device codes aren't bound to a key or Session: any request from this client with the code works.
  const e = (await startDevice("orders:read")).body;
  await approveDevice(e.user_code, `${randomUUID()}@example.com`, ["orders:read"]);
  const polled = await tokenRequest({ grant_type: deviceGrant, device_code: e.device_code });
  assert.equal(polled.status, 200);
});

test("errors: 401 challenge without a code, insufficient_scope, invalid_token, extension_required, plain 429", async () => {
  const a = await makeAgent();
  const challenge = await a.request("/api/account/orders");
  assert.equal(challenge.status, 401);
  assert.equal(challenge.body.error, undefined);
  assert.equal(challenge.headers.get("www-authenticate"), 'Bearer scope="orders:read"');
  const t = await mediated(a, `${randomUUID()}@example.com`, "orders:read");
  const scope = await a.request("/api/account/addresses");
  assert.equal(scope.status, 403);
  assert.equal(scope.body.error, "insufficient_scope");
  assert.equal(scope.headers.get("www-authenticate"), 'Bearer error="insufficient_scope", scope="addresses"');
  const bad = await a.request("/api/account", { token: "tok_unknown" });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, "invalid_token");
  assert.equal(bad.headers.get("www-authenticate"), 'Bearer error="invalid_token"');
  assert.equal(t.token_type, "Bearer");
  // A client that doesn't list operations v2 can't order.
  const { requireOperations } = await import("../server/commerce.js");
  assert.throws(() => requireOperations({ extensions: false } as any), (e: any) => e.code === "extension_required" && e.extra.extension === "operations");
  const { errorResponse } = await import("../server/http-errors.js");
  const { HttpError } = await import("../server/errors.js");
  const ext = errorResponse(new HttpError(403, "extension_required", "x", { extension: "operations" }));
  assert.equal(ext.headers["WWW-Authenticate"], 'Bearer error="extension_required", extension="operations"');
  const limited = errorResponse(new HttpError(429, "rate_limited", "Too many."));
  assert.equal(limited.body.error, undefined);
  assert.ok(limited.headers["Retry-After"]);
});

test("Direct Sign-In: no dpop_jkt; the code exchange returns Bearer tokens", async () => {
  const verifier = jti() + jti();
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: origin + "/api/demo/callback",
    scope: "orders:read",
    state: "s1",
    code_challenge: sha256(verifier),
    code_challenge_method: "S256",
  });
  const page = await fetch(origin + "/oauth/authorize?" + q, { redirect: "manual" });
  assert.equal(page.status, 200);
  let cookie = page.headers.get("set-cookie")!.split(";")[0];
  let html = await page.text();
  const post = async (route: string, values: Record<string, string>) => {
    const form = new URLSearchParams({
      flow: html.match(/name="flow" value="([^"]+)"/)![1],
      csrf: html.match(/name="csrf" value="([^"]+)"/)![1],
      ...values,
    });
    const r = await fetch(origin + route, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, Cookie: cookie },
      body: form,
    });
    const text = await r.text();
    if (text.includes('name="flow"')) html = text;
    return { r, text };
  };
  const emailed = await post("/oauth/authorize/email", { email: `${randomUUID()}@example.com` });
  const code = h.code(emailed.text)!;
  await post("/oauth/authorize/verify", { code });
  const approved = await post("/oauth/authorize/approve", { decision: "approve", scopes: "orders:read" });
  const callback = new URL(approved.r.headers.get("location")!);
  assert.equal(callback.searchParams.get("iss"), origin);
  const t = await tokenRequest({ grant_type: "authorization_code", code: callback.searchParams.get("code")!, redirect_uri: origin + "/api/demo/callback", code_verifier: verifier });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(t.body.token_type, "Bearer");
  assert.equal(t.body.scope, "orders:read");
});

test("loopback redirect URIs (RFC 8252 §7.3) match any port", () => {
  assert.equal(auth.loopbackRedirect("http://127.0.0.1/callback"), true);
  assert.equal(auth.loopbackRedirect("http://[::1]:8080/cb"), true);
  assert.equal(auth.loopbackRedirect("http://localhost/callback"), false);
  assert.equal(auth.loopbackRedirect("https://127.0.0.1/callback"), false);
  assert.equal(auth.redirectMatches(["http://127.0.0.1/callback"], "http://127.0.0.1:53121/callback"), true);
  assert.equal(auth.redirectMatches(["http://127.0.0.1/callback"], "http://127.0.0.1:53121/other"), false);
  assert.equal(auth.redirectMatches(["https://agent.example/cb"], "https://agent.example:444/cb"), false);
  assert.equal(auth.redirectMatches(["https://agent.example/cb"], "https://agent.example/cb"), true);
});
