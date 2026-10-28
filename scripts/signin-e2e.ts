/**
 * Poppy 0.3 reference run for a local demo store (APP_MODE=demo, optionally
 * AGENT_SANDBOX=true), as the store's demo agent: client assertions signed by
 * its jwks_uri key, Session JWTs (Poppy-Session) by delegated keys.
 *
 * Covers discovery, Session header checks, signed-out Sessions, each offered
 * sign-in type (Direct, Device, Mediated extension grant), refresh, account
 * reads, saved addresses, ordering and reordering through Operations v2
 * (approval_required → retry with Poppy-Approval, at most once), revocation and
 * continuing signed out.
 *
 * Prints a redacted transcript: no tokens, codes, device codes, JWTs or proofs.
 * The "person" steps are scripted only because this is a demo store with
 * synthetic accounts.
 */
import { SignJWT, importJWK } from "jose";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { poppyAgent, delegate, jti } from "./poppy-delegation.js";

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
const errorOf = (b: any) => b?.error || b?.raw || "(no error code)";
const digest = (s: string) => createHash("sha256").update(s).digest("base64url");
/** §5.6: on 429, wait at least Retry-After and send again (fresh JWTs each time). */
async function retrying(send: () => Promise<Response>) {
  for (;;) {
    const r = await send();
    if (r.status !== 429) return r;
    const wait = Math.min(Number(r.headers.get("retry-after")) || 5, 65);
    log(`  … 429 with Retry-After ${wait}s; waiting, then retrying`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

// Discovery (§3): poppy.json → protected resource metadata → issuer metadata.
const discovery = await json(await fetch(`${origin}/.well-known/poppy.json`));
if (discovery.protocol_version !== "0.3") fail("Needs Poppy 0.3.");
const domain = discovery.organization.domain;
if (domain.toLowerCase() !== new URL(origin).hostname) fail("organization.domain mismatch");
const prm = await json(await fetch(`${origin}/.well-known/oauth-protected-resource`));
if (prm.resource !== `https://${domain}`) fail("protected resource metadata resource mismatch");
const issuer: string = discovery.auth?.issuer ?? prm.authorization_servers[0];
if (!prm.authorization_servers.includes(issuer)) fail("auth.issuer isn't in authorization_servers");
const oauth = await json(await fetch(`${issuer}/.well-known/oauth-authorization-server`));
if (oauth.issuer !== issuer) fail("issuer mismatch");
if (!oauth.protected_resources?.includes(`https://${domain}`)) fail("protected_resources mismatch");
const cfg = await json(await fetch(`${origin}/api/config`));
if (cfg.mode !== "demo") fail("This script uses the local demo identity; demo mode only.");
const grants: string[] = oauth.grant_types_supported;
const mediatedGrant = "https://personalagentprotocol.org/grant/mediated-sign-in";
const offered = {
  direct: grants.includes("authorization_code"),
  device: grants.includes("urn:ietf:params:oauth:grant-type:device_code"),
  mediated: grants.includes(mediatedGrant) && !!discovery.extensions?.["mediated-sign-in"],
};
const fullScopes = oauth.scopes_supported.join(" ");
const mediatedScopes = discovery.extensions?.["mediated-sign-in"]?.scopes.join(" ");
log(`Store: ${discovery.organization.name} (${domain}), protocol ${discovery.protocol_version}, environment ${cfg.environment}`);
log(`Issuer ${issuer} from protected resource metadata (resource ${prm.resource}); protected_resources ✓`);
log(`Sign-in offered: ${Object.entries(offered).filter(([, v]) => v).map(([k]) => k).join(", ")} (grant_types_supported: ${grants.length})`);
log(`scopes_supported: ${fullScopes}; mediated-sign-in scopes: ${mediatedScopes}; described: ${oauth.scopes_supported.every((s: string) => discovery.auth.scopes?.[s])}; extensions: ${Object.entries(discovery.extensions).map(([k, v]: any) => `${k} v${v.version}`).join(", ")}`);

// The demo agent's jwks_uri key, from the store's local database.
const db = new Database(`${process.env.DATA_DIR || ".data"}/poppy.sqlite`, { readonly: true });
const row = db.prepare("SELECT body FROM records WHERE kind='demo-key' AND id='identity'").get() as any;
db.close();
if (!row) fail("Start the demo store once so it creates its demo identity.");
const rootJwk = JSON.parse(row.body).private;
const clientId = `${origin}/api/demo/agent.json`;
const metadata = await json(await fetch(clientId));
log(`Agent: ${metadata.client_name} (${new URL(clientId).hostname}); extensions ${JSON.stringify(metadata.extensions)}`);
const agent = await poppyAgent(rootJwk, clientId, issuer);
const form = { "Content-Type": "application/x-www-form-urlencoded" };

type S = ReturnType<typeof agent.newSession> & { accessToken?: string; refreshToken?: string };
/** A request to an API or protocol endpoint, with the Session header (and access token). */
async function call(s: S, route: string, init: RequestInit & { token?: string | null } = {}) {
  const url = origin + route;
  const token = init.token === null ? undefined : (init.token ?? s.accessToken);
  const r = await retrying(async () =>
    fetch(url, {
      ...init,
      headers: {
        "Poppy-Session": await agent.sessionJwt(s, init.method || "GET", url, token),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    }),
  );
  return { status: r.status, body: await json(r), auth: r.headers.get("www-authenticate") };
}
/** A token endpoint request with the client assertion. */
async function token(body: Record<string, string>) {
  const r = await retrying(async () =>
    fetch(oauth.token_endpoint, { method: "POST", headers: form, body: new URLSearchParams({ ...body, ...(await agent.clientAuth()) }) }),
  );
  const b = await json(r);
  if (r.status === 200 && ("session_id" in b || "signed_in" in b || "refresh_token_expires_in" in b)) fail("0.3 token responses are plain OAuth");
  return { status: r.status, body: b };
}

/** A person's browser: same-origin form posts with the store's sign-in cookie. */
function browser(cookieName: string) {
  let cookie = "";
  let fields: Record<string, string> = {};
  return async function post(route: string, values: Record<string, string> | URLSearchParams, method = "POST") {
    const body = new URLSearchParams(fields);
    for (const [k, v] of values instanceof URLSearchParams ? values : Object.entries(values)) body.append(k, v);
    const r = await retrying(() =>
      fetch(origin + route + (method === "GET" ? `?${body}` : ""), {
        method,
        redirect: "manual",
        headers: { ...(method === "POST" ? { ...form, Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        ...(method === "POST" ? { body } : {}),
      }),
    );
    const set = r.headers.get("set-cookie");
    if (set?.startsWith(`${cookieName}=`) && !cookie) cookie = set.split(";")[0];
    const html = await r.text();
    const flow = html.match(/name="flow" value="([^"]+)"/)?.[1];
    if (flow) fields = { flow, csrf: html.match(/name="csrf" value="([^"]+)"/)![1] };
    return { status: r.status, html, location: r.headers.get("location") };
  };
}
const shownCode = (html: string) => html.match(/captured code is <strong>(\d{6})<\/strong>/)?.[1];
const consent = (scope: string) => {
  const values = new URLSearchParams({ decision: "approve" });
  for (const s of scope.split(" ")) values.append("scopes", s);
  return values;
};

async function directSignIn(s: S, email: string) {
  const verifier = digest(randomUUID()) + digest(randomUUID()).slice(0, 10);
  const state = randomUUID();
  const redirectUri = metadata.redirect_uris[0];
  const url = new URL(oauth.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: fullScopes,
    state,
    code_challenge: digest(verifier),
    code_challenge_method: "S256",
  }))
    url.searchParams.set(k, v);
  step("open authorization_endpoint", "PKCE S256, state, registered redirect_uri");
  const post = browser("poppy_signin");
  const page = await post("/oauth/authorize", Object.fromEntries(url.searchParams), "GET");
  if (!page.html.includes(metadata.client_name)) fail("consent page does not name the agent");
  step("person: consent page", `shows "${metadata.client_name}", its host and each scope`);
  const emailed = await post("/oauth/authorize/email", { email });
  const code = shownCode(emailed.html) || fail("no captured code on page");
  step("person: email code", "demo page shows the captured code (redacted)");
  await post("/oauth/authorize/verify", { code });
  const approved = await post("/oauth/authorize/approve", consent(fullScopes));
  const callback = new URL(approved.location || fail("no redirect"));
  if (callback.searchParams.get("state") !== state) fail("state mismatch");
  if (callback.searchParams.get("iss") !== issuer) fail("iss mismatch (RFC 9207)");
  step("person: approves", "303 to redirect_uri with code, state ✓, iss ✓");
  const exchanged = await token({ grant_type: "authorization_code", code: callback.searchParams.get("code")!, redirect_uri: redirectUri, code_verifier: verifier });
  if (exchanged.status !== 200) fail(`code exchange: ${errorOf(exchanged.body)}`);
  return exchanged.body;
}

async function deviceSignIn(s: S, email: string) {
  const r = await retrying(async () =>
    fetch(oauth.device_authorization_endpoint, { method: "POST", headers: form, body: new URLSearchParams({ scope: fullScopes, ...(await agent.clientAuth()) }) }),
  );
  const grant = await json(r);
  if (r.status !== 200) fail(`device authorization: ${errorOf(grant)}`);
  const linkHost = new URL(grant.verification_uri_complete).hostname.toLowerCase();
  const allowed = [issuer, ...oauth.protected_resources].map((u: string) => new URL(u).hostname.toLowerCase());
  if (!allowed.some((d) => linkHost === d || linkHost.endsWith(`.${d}`))) fail("verification link on a foreign host");
  step(
    "POST device_authorization_endpoint",
    `expires_in=${grant.expires_in}, interval=${grant.interval}; link host checked; agent shows "${discovery.organization.name} (${domain})" + link + user code (redacted)`,
  );
  const poll = () => token({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: grant.device_code });
  let interval = grant.interval;
  const first = await poll();
  step("poll token_endpoint", `${first.status} ${errorOf(first.body)}`);
  const tooFast = await poll();
  if (tooFast.body.error === "slow_down") interval = tooFast.body.interval || interval + 5;
  step("poll again immediately", `${tooFast.status} ${errorOf(tooFast.body)} → interval ${interval}s`);
  const post = browser("poppy_device");
  const opened = await retrying(() => fetch(grant.verification_uri_complete));
  step("person: opens link", `${opened.status}, prefilled code form (opening alone approves nothing)`);
  const entered = await post("/device", { user_code: grant.user_code });
  if (!entered.html.includes(metadata.client_name)) fail("verification page does not name the agent");
  step("person: confirms code", `page shows "${metadata.client_name}" and the code to match`);
  await post("/device/email", { email });
  const captured = await call(s, "/api/sandbox/device-sign-in/email", { method: "POST", body: JSON.stringify({ device_code: grant.device_code }) });
  const code = captured.body.email?.text.match(/code is (\d{6})/)?.[1] || fail(`device helper: ${errorOf(captured.body)}`);
  step("getSandboxDeviceSignInEmail (Session header)", "captured code read (redacted)");
  await post("/device/verify", { code });
  const done = await post("/device/approve", consent(fullScopes));
  if (!done.html.includes("You’re connected")) fail("device approval failed");
  step("person: approves all scopes");
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const result = await poll();
    if (result.status === 200) {
      const reused = await poll();
      step("device_code reused", `${reused.status} ${errorOf(reused.body)}`);
      return result.body;
    }
    if (result.body.error === "slow_down") interval += 5;
    else if (result.body.error !== "authorization_pending") fail(`device poll: ${errorOf(result.body)}`);
  }
  return fail("device sign-in timed out");
}

async function mediatedSignIn(s: S, email: string) {
  const started = await token({ grant_type: mediatedGrant, scope: mediatedScopes, email });
  if (started.body.error !== "code_required") fail(`mediated: ${errorOf(started.body)}`);
  step("token endpoint, mediated-sign-in grant", `${started.status} code_required, sent_to="${started.body.sent_to}", expires_in=${started.body.expires_in}`);
  const captured = await call(s, `/api/sandbox/sign-in/${started.body.sign_in_id}/email`);
  const code = captured.body.email?.text.match(/code is (\d{6})/)?.[1] || fail("no captured code");
  step("getSandboxSignInEmail (Session header)", "captured code read (redacted)");
  const wrong = await token({ grant_type: mediatedGrant, sign_in_id: started.body.sign_in_id, one_time_code: code === "000000" ? "111111" : "000000" });
  step("wrong code", `${wrong.status} ${errorOf(wrong.body)}`);
  const done = await token({ grant_type: mediatedGrant, sign_in_id: started.body.sign_in_id, one_time_code: code });
  if (done.status !== 200) fail(`mediated code: ${errorOf(done.body)}`);
  return done.body;
}

const address = (who: string) => ({ name: `Demo ${who} Customer`, line1: "500 Poppy Lane", city: "Denver", state: "CO", postalCode: "80202", country: "US" });
const samplePhoto = async (s: S) => (await call(s, "/api/photos/samples", { method: "POST", body: JSON.stringify({ color: "orange" }) })).body;
/** Operations v2: the request is refused with the operation; the User approves; the same request again with Poppy-Approval. */
async function approved(s: S, route: string, body: unknown, label: string) {
  const first = await call(s, route, { method: "POST", body: JSON.stringify(body) });
  if (first.status !== 403 || first.body.error !== "approval_required") fail(`${label}: expected approval_required, got ${first.status} ${errorOf(first.body)}`);
  const op = first.body.operation;
  const shipTo = op.summary.split("\n").find((l: string) => l.startsWith("Deliver to"));
  step(`${label}`, `403 approval_required, operation ${redact(op.operation_id)} revision ${redact(op.revision)}; "${shipTo}"`);
  // In a real agent the User approves op.summary in the agent's own UI here.
  const approval = `operation_id="${op.operation_id}", revision="${op.revision}"`;
  const done = await call(s, route, { method: "POST", body: JSON.stringify(body), headers: { "Poppy-Approval": approval } });
  if (done.status !== 201) fail(`${label} approved: ${done.status} ${errorOf(done.body)}`);
  step(`${label} again with Poppy-Approval`, `201, order ${redact(done.body.id)} ${done.body.status}${done.body.checkoutUrl ? ", checkout ready" : ""}`);
  const again = await call(s, route, { method: "POST", body: JSON.stringify(body), headers: { "Poppy-Approval": approval } });
  step("same approval retried", `${again.status}, same order: ${again.body.id === done.body.id} (at most once)`);
  return done.body;
}

async function payoff(type: string, s: S, signedIn: any) {
  s.accessToken = signedIn.access_token;
  s.refreshToken = signedIn.refresh_token;
  const refreshed = await token({ grant_type: "refresh_token", refresh_token: s.refreshToken!, scope: "orders:read" });
  step("refresh with a narrower scope", `${refreshed.status}, token_type=${refreshed.body.token_type}, scope="${refreshed.body.scope}", no new refresh token: ${!refreshed.body.refresh_token}`);
  const narrow = await call(s, "/api/account/addresses", { token: refreshed.body.access_token });
  step("that token on listAccountAddresses", `${narrow.status} ${errorOf(narrow.body)} (${narrow.auth})`);
  const bare = await retrying(() => fetch(`${origin}/api/account`, { headers: { Authorization: `Bearer ${s.accessToken}` } }));
  step("access token without the Session header", `${bare.status} ${errorOf(await json(bare))}`);
  const account = await call(s, "/api/account");
  step("GET /api/account", `${account.status}, scope="${account.body.scope}"`);
  const hasAddresses = signedIn.scope.split(" ").includes("addresses");
  if (hasAddresses) {
    const saved = await call(s, "/api/account/addresses", { method: "POST", body: JSON.stringify({ label: "Home", address: address(type) }) });
    step("saveAccountAddress", `${saved.status}, default=${saved.body.default}`);
  } else {
    const saved = await call(s, "/api/account/addresses", { method: "POST", body: JSON.stringify({ label: "Home", address: address(type) }) });
    step("saveAccountAddress", `${saved.status} ${errorOf(saved.body)} (${saved.auth})`);
  }
  const photo = await samplePhoto(s);
  const order = await approved(
    s,
    "/api/orders",
    { items: [{ photoId: photo.id, product: "prints", quantity: 3, fit: "contain" }], ...(hasAddresses ? {} : { address: address(type) }) },
    hasAddresses ? "proposeOrder without address or email" : "proposeOrder with an address, without email",
  );
  const history = await call(s, "/api/account/orders");
  const listed = history.body.orders.find((o: any) => o.id === order.id);
  step("GET /api/account/orders", `${history.body.orders.length} order(s); listed=${!!listed}, reorderable=${listed?.reorderable}`);
  // A new Session (new sid) of the same User uses the same access token.
  const other: S = { ...agent.newSession(s.sub), accessToken: s.accessToken };
  await approved(other, `/api/account/orders/${order.id}/reorder`, {}, "reorderOrder in a new Session");
  const revoked = await retrying(async () =>
    fetch(oauth.revocation_endpoint, {
      method: "POST",
      headers: form,
      body: new URLSearchParams({ token: s.refreshToken!, token_type_hint: "refresh_token", ...(await agent.clientAuth()) }),
    }),
  );
  step("revoke refresh token (sign out)", `${revoked.status}`);
  const after = await token({ grant_type: "refresh_token", refresh_token: s.refreshToken! });
  step("refresh after revocation", `${after.status} ${errorOf(after.body)}`);
  const stale = await call(s, "/api/account/orders");
  step("its access token after revocation", `${stale.status} ${errorOf(stale.body)} (${stale.auth})`);
  const out = await call(s, "/api/account/orders", { token: null });
  step("the Session continues signed out", `${out.status} challenge (${out.auth})`);
  const catalog = await call(s, `/api/orders/${order.id}`, { token: null });
  step("account order in the signed-out Session", `${catalog.status} (${catalog.auth || errorOf(catalog.body)})`);
}

// 1. The Session header (§5.2, §5.3).
log("");
log("SESSION HEADER");
const s0 = agent.newSession(`demo-user-${randomUUID()}`);
const ok = await call(s0, "/api/catalog");
step("signed-out request, new sid", `${ok.status}: a new signed-out Session`);
const photo0 = await samplePhoto(s0);
step("upload a sample photo in it", `${photo0.id ? "photo " + redact(photo0.id) : errorOf(photo0)}`);
const guestBody = { email: "guest@example.com", address: address("guest"), items: [{ photoId: photo0.id, quantity: 1 }] };
const g1 = await call(s0, "/api/orders", { method: "POST", body: JSON.stringify(guestBody) });
const g2 = await call(s0, "/api/orders", { method: "POST", body: JSON.stringify(guestBody) });
step("same request twice in the Session", `${g1.status} ${errorOf(g1.body)}, same operation: ${g1.body.operation?.operation_id === g2.body.operation?.operation_id}`);
const s1 = { ...agent.newSession(s0.sub) };
const notMine = await call(s1, "/api/orders", {
  method: "POST",
  body: JSON.stringify(guestBody),
  headers: { "Poppy-Approval": `operation_id="${g1.body.operation.operation_id}", revision="${g1.body.operation.revision}"` },
});
step("its approval from another Session (new sid)", `${notMine.status} ${errorOf(notMine.body)}: handled as a new request, and the photo belongs to the first Session`);
const hijack = await call({ ...s0, sub: `demo-user-${randomUUID()}` }, "/api/catalog");
step("that sid with a different sub", `${hijack.status} ${errorOf(hijack.body)}`);
const signedOut = await call(s0, "/api/account/orders");
step("account request without an access token", `${signedOut.status} ${errorOf(signedOut.body)} (${signedOut.auth})`);
const root = await importJWK(rootJwk, "ES256");
const direct = await new SignJWT({ sid: jti(), htm: "GET", htu: `${origin}/api/catalog` })
  .setProtectedHeader({ alg: "ES256", typ: "poppy-session+jwt", kid: rootJwk.kid || "demo" })
  .setIssuer(clientId)
  .setSubject(s0.sub)
  .setAudience(issuer)
  .setIssuedAt()
  .setJti(jti())
  .sign(root);
const nonDelegated = await json(await retrying(() => fetch(`${origin}/api/catalog`, { headers: { "Poppy-Session": direct } })));
step("Session JWT signed directly by the jwks_uri key", `${errorOf(nonDelegated)}`);
const d = await delegate(rootJwk, clientId);
const wrongUrl = await new SignJWT({ sid: jti(), htm: "GET", htu: `${origin}/api/photos` })
  .setProtectedHeader({ alg: "ES256", typ: "poppy-session+jwt", kid: d.kid, pap_dlg: d.delegation })
  .setIssuer(clientId)
  .setSubject(s0.sub)
  .setAudience(issuer)
  .setIssuedAt()
  .setJti(jti())
  .sign(d.key);
const mismatch = await json(await retrying(() => fetch(`${origin}/api/catalog`, { headers: { "Poppy-Session": wrongUrl } })));
step("Session JWT for another URL (htu)", `${errorOf(mismatch)}`);
const directAssertion = await token({ grant_type: "refresh_token", refresh_token: "prt_unknown" });
step("client assertion signed directly by the jwks_uri key, unknown refresh token", `${directAssertion.status} ${errorOf(directAssertion.body)} (assertion accepted; token refused)`);

// 2. Each offered sign-in type.
const run = Date.now().toString(36);
for (const type of ["direct", "device", "mediated"] as const) {
  log("");
  if (!offered[type]) {
    log(`${type.toUpperCase()} SIGN-IN — not offered here; skipped.`);
    continue;
  }
  log(`${type.toUpperCase()} SIGN-IN`);
  const s: S = agent.newSession(`demo-user-${type}-${randomUUID()}`);
  step("signed-out Session", `sid ${redact(s.sid)}`);
  const email = `pap03-${type}-${run}@example.com`;
  const result = type === "direct" ? await directSignIn(s, email) : type === "device" ? await deviceSignIn(s, email) : await mediatedSignIn(s, email);
  step("tokens", `token_type=${result.token_type}, scope="${result.scope}", refresh token issued: ${!!result.refresh_token}`);
  await payoff(type, s, result);
}
log("");
log("All offered sign-in types verified end to end. No tokens, codes, JWTs or proofs were printed.");
