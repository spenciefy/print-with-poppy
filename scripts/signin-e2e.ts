/**
 * Sign-in reference run for a local demo store (APP_MODE=demo, optionally
 * AGENT_SANDBOX=true): drives Direct, Device and Mediated Sign-In with the
 * store's demo agent identity, then renews with the Account Token, reads the
 * account and history, places a signed-in order with the saved address through
 * Operations approval, reorders it, and revokes the Account Token.
 *
 * Prints a redacted transcript: no tokens, codes, device codes or proofs.
 * The "person" steps (verification page, consent) are scripted here only
 * because this is a demo store with synthetic accounts.
 */
import { SignJWT, generateKeyPair, exportJWK, importJWK } from "jose";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import Database from "better-sqlite3";

const origin = process.env.PUBLIC_URL || "http://localhost:5173";
const log = (line = "") => console.log(line);
const step = (label: string, detail = "") => log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (message: string): never => {
  throw new Error(message);
};
const redact = (id: string) => (id ? `${id.slice(0, 4)}…` : "");
const json = async (r: Response) => {
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
};
const errorOf = (b: any) => b?.error || b?.raw || "unknown";

// Discovery (spec §3): version, issuer metadata and the two-way domain check.
const discovery = await json(await fetch(`${origin}/.well-known/poppy.json`));
if (discovery.protocol_version !== "0.2") fail("Needs Poppy 0.2.");
const host = new URL(origin).hostname;
if (discovery.organization.domain.toLowerCase() !== host) fail("organization.domain mismatch");
const oauth = await json(await fetch(`${discovery.auth.issuer}/.well-known/oauth-authorization-server`));
if (oauth.issuer !== discovery.auth.issuer || !oauth.poppy_domains.includes(discovery.organization.domain))
  fail("Issuer discovery mismatch.");
const cfg = await json(await fetch(`${origin}/api/config`));
if (cfg.mode !== "demo") fail("This script uses the local demo identity; demo mode only.");
const types = ["direct", "device", "mediated"].filter((t) => discovery.auth[t]);
log(`Store: ${discovery.organization.name} (${discovery.organization.domain}), environment ${cfg.environment}`);
log(`Sign-in types advertised: ${types.map((t) => `${t} [${discovery.auth[t].scopes.join(" ")}]`).join(", ")}`);
log(`Issuer metadata: device_authorization_endpoint=${oauth.device_authorization_endpoint ? "yes" : "no"}, iss-in-redirect=${oauth.authorization_response_iss_parameter_supported}`);

// Demo agent identity: the store's own demo key, read from its local database.
const db = new Database(`${process.env.DATA_DIR || ".data"}/poppy.sqlite`, { readonly: true });
const row = db.prepare("SELECT body FROM records WHERE kind='demo-key' AND id='identity'").get() as any;
db.close();
if (!row) fail("Start the demo store once so it creates its demo identity.");
const privateJwk = JSON.parse(row.body).private;
const identity = await importJWK(privateJwk, "ES256");
const clientId = `${origin}/api/demo/agent.json`;
const metadata = await json(await fetch(clientId));
log(`Agent: ${metadata.client_name} (${new URL(clientId).hostname}), redirect_uris ${metadata.redirect_uris.length}`);
const digest = (s: string) => createHash("sha256").update(s).digest("base64url");
const assertion = (sub: string) =>
  new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: privateJwk.kid || "demo" })
    .setIssuer(clientId)
    .setSubject(sub)
    .setAudience(oauth.issuer)
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(randomUUID())
    .sign(identity);
const clientAuth = async () => ({
  client_id: clientId,
  client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
  client_assertion: await assertion(clientId),
});
const form = { "Content-Type": "application/x-www-form-urlencoded" };

/** One User ID at this store, with its own DPoP key; tokens stay in this object. */
async function agentFor(userId: string) {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(pair.publicKey);
  const proof = (method: string, url: string, token?: string) =>
    new SignJWT({ htm: method, htu: url.split("?")[0], ...(token ? { ath: digest(token) } : {}) })
      .setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk })
      .setIssuedAt()
      .setJti(randomUUID())
      .sign(pair.privateKey);
  const state: { session: any; accountToken?: string } = { session: undefined };
  async function token(body: Record<string, string>) {
    const r = await fetch(oauth.token_endpoint, {
      method: "POST",
      headers: { ...form, DPoP: await proof("POST", oauth.token_endpoint) },
      body: new URLSearchParams({ ...body, ...(await clientAuth()) }),
    });
    return { status: r.status, body: await json(r) };
  }
  async function call(route: string, init: RequestInit = {}) {
    const url = origin + route;
    const r = await fetch(url, {
      ...init,
      headers: {
        Authorization: `DPoP ${state.session.access_token}`,
        DPoP: await proof(init.method || "GET", url, state.session.access_token),
        ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    return { status: r.status, body: await json(r) };
  }
  const started = await token({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: await assertion(userId),
  });
  if (started.status !== 200) fail(`session: ${errorOf(started.body)}`);
  state.session = started.body;
  const signedIn = (b: any) => {
    if (!b.signed_in || !b.refresh_token) fail("sign-in did not return an Account Token");
    state.accountToken = b.refresh_token; // Account Token: kept out of logs and context.
    state.session = b;
  };
  return { state, token, call, signedIn };
}
type Agent = Awaited<ReturnType<typeof agentFor>>;

/** A person's browser: same-origin form posts with the store's sign-in cookie. */
function browser(cookieName: string) {
  let cookie = "";
  let fields: Record<string, string> = {};
  return async function post(route: string, values: Record<string, string> | URLSearchParams, method = "POST") {
    const body = new URLSearchParams(fields);
    for (const [k, v] of values instanceof URLSearchParams ? values : Object.entries(values)) body.append(k, v);
    const r = await fetch(origin + route + (method === "GET" ? `?${body}` : ""), {
      method,
      redirect: "manual",
      headers: { ...(method === "POST" ? { ...form, Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      ...(method === "POST" ? { body } : {}),
    });
    const set = r.headers.get("set-cookie");
    if (set?.startsWith(`${cookieName}=`) && !cookie) cookie = set.split(";")[0];
    const html = await r.text();
    const flow = html.match(/name="flow" value="([^"]+)"/)?.[1];
    if (flow) fields = { flow, csrf: html.match(/name="csrf" value="([^"]+)"/)![1] };
    return { status: r.status, html, location: r.headers.get("location") };
  };
}
const shownCode = (html: string) => html.match(/captured code is <strong>(\d{6})<\/strong>/)?.[1];
const allScopes = "poppy:read poppy:write";
const consent = () => {
  const values = new URLSearchParams({ decision: "approve" });
  for (const s of allScopes.split(" ")) values.append("scopes", s);
  return values;
};

async function mediatedSignIn(a: Agent, email: string) {
  const started = await a.call("/api/poppy/sign-in", {
    method: "POST",
    body: JSON.stringify({ scope: allScopes, credentials: { email } }),
  });
  if (started.body.status !== "code_required") fail(`mediated: ${errorOf(started.body)}`);
  step("POST auth.mediated.endpoint", `status=code_required, sent_to="${started.body.code.sent_to}"`);
  const captured = await a.call(`/api/sandbox/sign-in/${started.body.sign_in_id}/email`);
  const code = captured.body.email?.text.match(/code is (\d{6})/)?.[1] || fail("no captured code");
  step("getSandboxSignInEmail", "captured code read (redacted)");
  const done = await a.call(`/api/poppy/sign-in/${started.body.sign_in_id}`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  if (done.body.status !== "complete") fail(`mediated code: ${errorOf(done.body)}`);
  a.signedIn(done.body);
  return done.body;
}

async function directSignIn(a: Agent, email: string) {
  const verifier = digest(randomUUID()) + digest(randomUUID()).slice(0, 10);
  const state = randomUUID();
  const redirectUri = metadata.redirect_uris[0];
  const url = new URL(oauth.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: allScopes,
    state,
    code_challenge: digest(verifier),
    code_challenge_method: "S256",
  }))
    url.searchParams.set(k, v);
  step("open authorization_endpoint", "S256 PKCE, random state, registered redirect_uri");
  const post = browser("poppy_signin");
  const page = await post("/oauth/authorize", Object.fromEntries(url.searchParams), "GET");
  if (!page.html.includes(metadata.client_name)) fail("consent page does not name the agent");
  step("person: consent page", `shows "${metadata.client_name}" and its host`);
  const emailed = await post("/oauth/authorize/email", { email });
  const code = shownCode(emailed.html) || fail("no captured code on page");
  step("person: email code", "demo page shows the captured code (redacted)");
  const verified = await post("/oauth/authorize/verify", { code });
  if (!verified.html.includes("Allow access")) fail("consent step missing");
  const approved = await post("/oauth/authorize/approve", consent());
  const callback = new URL(approved.location || fail("no redirect"));
  if (callback.origin + callback.pathname !== redirectUri) fail("redirect_uri mismatch");
  if (callback.searchParams.get("state") !== state) fail("state mismatch");
  if (callback.searchParams.get("iss") !== discovery.auth.issuer) fail("iss mismatch (RFC 9207)");
  step("person: approve", `303 to redirect_uri with code, state ✓, iss ✓`);
  const exchanged = await a.token({
    grant_type: "authorization_code",
    code: callback.searchParams.get("code")!,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    session_id: a.state.session.session_id,
  });
  if (exchanged.status !== 200) fail(`code exchange: ${errorOf(exchanged.body)}`);
  a.signedIn(exchanged.body);
  return exchanged.body;
}

async function deviceSignIn(a: Agent, email: string) {
  const r = await fetch(oauth.device_authorization_endpoint, {
    method: "POST",
    headers: form,
    body: new URLSearchParams({ scope: allScopes, ...(await clientAuth()) }),
  });
  const grant = await json(r);
  if (r.status !== 200) fail(`device authorization: ${errorOf(grant)}`);
  // Spec §4.6: the link's host must be the issuer's host or a poppy_domains entry (or a subdomain).
  const linkHost = new URL(grant.verification_uri_complete).hostname.toLowerCase();
  const allowed = [new URL(oauth.issuer).hostname, ...oauth.poppy_domains].map((d: string) => d.toLowerCase());
  if (!allowed.some((d) => linkHost === d || linkHost.endsWith(`.${d}`))) fail("verification link on a foreign host");
  step(
    "POST device_authorization_endpoint",
    `expires_in=${grant.expires_in}, interval=${grant.interval}; link host checked; agent shows "${discovery.organization.name} (${discovery.organization.domain})" + link + user code (redacted)`,
  );
  const poll = () =>
    a.token({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: grant.device_code,
      session_id: a.state.session.session_id,
    });
  let interval = grant.interval;
  const first = await poll();
  step("poll token_endpoint", `${first.status} ${errorOf(first.body)}`);
  const tooFast = await poll();
  if (tooFast.body.error === "slow_down") interval = tooFast.body.interval || interval + 5;
  step("poll again immediately", `${tooFast.status} ${errorOf(tooFast.body)} → interval ${interval}s`);
  const post = browser("poppy_device");
  const opened = await fetch(grant.verification_uri_complete);
  step("person: opens link", `${opened.status}, prefilled code form (opening alone approves nothing)`);
  const entered = await post("/device", { user_code: grant.user_code });
  if (!entered.html.includes(metadata.client_name)) fail("verification page does not name the agent");
  step("person: confirms code", `page shows "${metadata.client_name}", the code to match, and the scopes next`);
  await post("/device/email", { email });
  const captured = await a.call("/api/sandbox/device-sign-in/email", {
    method: "POST",
    body: JSON.stringify({ device_code: grant.device_code }),
  });
  const code = captured.body.email?.text.match(/code is (\d{6})/)?.[1] || fail(`device helper: ${errorOf(captured.body)}`);
  step("getSandboxDeviceSignInEmail", "captured code read (redacted)");
  await post("/device/verify", { code });
  const done = await post("/device/approve", consent());
  if (!done.html.includes("You’re connected")) fail("device approval failed");
  step("person: approves both scopes");
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const result = await poll();
    if (result.status === 200) {
      a.signedIn(result.body);
      const reused = await poll();
      step("device_code reused", `${reused.status} ${errorOf(reused.body)}`);
      return result.body;
    }
    if (result.body.error === "slow_down") interval += 5;
    else if (result.body.error !== "authorization_pending") fail(`device poll: ${errorOf(result.body)}`);
  }
  return fail("device sign-in timed out");
}

const samplePhoto = async (a: Agent) => (await a.call("/api/photos/samples", { method: "POST", body: JSON.stringify({ color: "orange" }) })).body;
async function approveAndWait(a: Agent, op: any) {
  // In a real agent this is the person's explicit approval of op.summary in the agent's UI.
  let result = (
    await a.call(`/api/operations/${op.operation_id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ revision: op.revision, approved_by: "user" }),
    })
  ).body;
  for (let i = 0; i < 40 && result.state === "in_progress"; i++) {
    await new Promise((r) => setTimeout(r, 500));
    result = (await a.call(`/api/operations/${op.operation_id}`)).body;
  }
  if (result.state !== "succeeded") fail(`operation ${result.state}`);
  return result.result.data.order_id as string;
}

async function payoff(type: string, a: Agent) {
  // Renew with the Account Token into a new Session (spec §4.8).
  const renewed = await a.token({ grant_type: "refresh_token", refresh_token: a.state.accountToken! });
  if (renewed.status !== 200 || !renewed.body.signed_in) fail(`renewal: ${errorOf(renewed.body)}`);
  a.state.session = renewed.body;
  step("renew with Account Token (new session)", `signed_in=${renewed.body.signed_in}, scope="${renewed.body.scope}"`);
  const account = await a.call("/api/account");
  step("GET /api/account", `${account.status}, scope="${account.body.scope}", saved_addresses=${account.body.saved_addresses}`);
  const saved = await a.call("/api/account/addresses", {
    method: "POST",
    body: JSON.stringify({
      label: "Home",
      address: { name: `Demo ${type} Customer`, line1: "500 Poppy Lane", city: "Denver", state: "CO", postalCode: "80202", country: "US" },
    }),
  });
  step("saveAccountAddress", `${saved.status}, default=${saved.body.default}`);
  const photo = await samplePhoto(a);
  const proposed = await a.call("/api/orders", {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ items: [{ photoId: photo.id, product: "prints", quantity: 3, fit: "contain" }] }),
  });
  if (proposed.status !== 202) fail(`proposal: ${errorOf(proposed.body)}`);
  const op = proposed.body.operation;
  const shipTo = op.summary.split("\n").find((l: string) => l.startsWith("Deliver to"));
  step("proposeOrder without address or email", `202 proposed; summary "${shipTo}"`);
  const orderId = await approveAndWait(a, op);
  step("user approves → confirmOperation", `succeeded, order ${redact(orderId)}`);
  const history = await a.call("/api/account/orders");
  const listed = history.body.orders.find((o: any) => o.id === orderId);
  step("GET /api/account/orders", `${history.body.orders.length} order(s); new order listed=${!!listed}, reorderable=${listed?.reorderable}`);
  const re = await a.call(`/api/account/orders/${orderId}/reorder`, {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: "{}",
  });
  if (re.status !== 202) fail(`reorder: ${errorOf(re.body)}`);
  step("reorderOrder", `202, new operation state=${re.body.operation.state}, approval required=${re.body.operation.user_approval_required}`);
  const reorderId = await approveAndWait(a, re.body.operation);
  step("user approves reorder → confirmOperation", `succeeded, order ${redact(reorderId)}`);
  const staleToken = a.state.session.access_token;
  const revoked = await fetch(oauth.revocation_endpoint, {
    method: "POST",
    headers: form,
    body: new URLSearchParams({ token: a.state.accountToken!, token_type_hint: "refresh_token", ...(await clientAuth()) }),
  });
  step("revoke Account Token", `${revoked.status}`);
  const after = await a.token({ grant_type: "refresh_token", refresh_token: a.state.accountToken! });
  if (after.body.error !== "invalid_grant") fail("renewal still works after revocation");
  step("renew after revocation", `${after.status} ${after.body.error}`);
  a.state.session.access_token = staleToken;
  const denied = await a.call("/api/account");
  step("old Session Token on /api/account", `${denied.status} ${denied.body.error}`);
}

const run = Date.now().toString(36);
for (const type of ["mediated", "direct", "device"]) {
  log("");
  if (!types.includes(type)) {
    log(`${type.toUpperCase()} SIGN-IN — not advertised here; skipped.`);
    continue;
  }
  log(`${type.toUpperCase()} SIGN-IN`);
  const a = await agentFor(`demo-user-${type}-${randomUUID()}`);
  step("signed-out session", `session ${redact(a.state.session.session_id)}, signed_in=${a.state.session.signed_in}`);
  const email = `pap-${type}-${run}@example.com`;
  const signIn = type === "mediated" ? mediatedSignIn : type === "direct" ? directSignIn : deviceSignIn;
  const result = await signIn(a, email);
  step(
    "signed in",
    `token_type=${result.token_type}, scope="${result.scope}", same session=${result.session_id === a.state.session.session_id}, Account Token lifetime ${Math.round(result.refresh_token_expires_in / 86400)}d`,
  );
  await payoff(type, a);
}
log("");
log("All advertised sign-in types verified end to end. No tokens, codes or proofs were printed.");
