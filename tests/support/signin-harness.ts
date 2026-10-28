// Shared Personal Agent and browser helpers for the sign-in tests (Poppy 0.3).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { poppyAgent } from "../../scripts/poppy-delegation.js";

export async function signInHarness(origin: string, store: any) {
const clientId = origin + "/api/demo/agent.json";
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code";
const mediatedGrant = "https://personalagentprotocol.org/grant/mediated-sign-in";
const key = store.get("demo-key", "identity");
// The demo agent: its jwks_uri key signs client assertions and delegations;
// delegated keys sign the per-request Session JWTs (Poppy-Session).
const agent = await poppyAgent(key.private, clientId, origin);
const clientAuth = agent.clientAuth;
const assertion = () => agent.clientAssertion();
/** A token endpoint request with the client assertion. */
async function tokenRequest(body: Record<string, string>) {
  const r = await fetch(origin + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, ...(await clientAuth()) }),
  });
  return { status: r.status, headers: r.headers, body: await r.json() };
}
/** Test-only: the store's internal id of the Session a sid names. */
const sessionOf = (sid: string) => store.get("session-sid", store.hash(`${clientId}\n${sid}`))?.sessionId;

/** One Session: a User ID, a sid, and (once signed in) an access token. */
async function makeAgent(user = randomUUID(), agentId?: string) {
  const s: { sid: string; sub: string; agentId?: string; access_token?: string; refresh_token?: string; session_id: string; scope?: string } =
    { ...agent.newSession(user, agentId), session_id: "" };
  async function request(route: string, init: RequestInit & { token?: string | null } = {}) {
    const token = init.token === null ? undefined : (init.token ?? s.access_token);
    const url = origin + new URL(route, origin).pathname;
    const r = await fetch(origin + route, {
      ...init,
      headers: {
        "Poppy-Session": await agent.sessionJwt(s, init.method || "GET", url, token),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    return { status: r.status, headers: r.headers, body: await r.json() };
  }
  const started = await request("/api/catalog");
  assert.equal(started.status, 200, JSON.stringify(started.body));
  s.session_id = sessionOf(s.sid) as string;
  const poll = (deviceCode: string, extra: Record<string, string> = {}) =>
    tokenRequest({ grant_type: deviceGrant, device_code: deviceCode, ...extra });
  return { user, session: s, request, tokenRequest, poll };
}
const postJson = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

async function startDevice(scope = "orders:read orders:write addresses", auth = true) {
  const r = await fetch(origin + "/oauth/device", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ scope, ...(auth ? await clientAuth() : { client_id: clientId }) }),
  });
  return { status: r.status, headers: r.headers, body: await r.json() };
}

/** A person's browser on the verification page. */
async function deviceBrowser(userCode: string) {
  let cookie = "";
  let flow = "",
    csrf = "";
  async function post(route: string, values: Record<string, string> | URLSearchParams, origin_ = origin) {
    const form = new URLSearchParams(flow ? { flow, csrf } : {});
    for (const [k, v] of values instanceof URLSearchParams ? values : Object.entries(values)) form.append(k, v);
    const r = await fetch(origin + route, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: origin_,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: form,
    });
    const set = r.headers.get("set-cookie");
    if (set?.startsWith("poppy_device=") && !set.startsWith("poppy_device=;")) cookie = set.split(";")[0];
    const html = await r.text();
    flow = html.match(/name="flow" value="([^"]+)"/)?.[1] || flow;
    csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1] || csrf;
    return { status: r.status, html, headers: r.headers };
  }
  const entered = await post("/device", { user_code: userCode.toLowerCase().replace("-", " ") });
  return { entered, post, flowId: () => flow };
}
const code = (html: string) => html.match(/captured code is <strong>(\d{6})<\/strong>/)?.[1];

async function approveDevice(userCode: string, email: string, scopes: string[], decision = "approve") {
  const b = await deviceBrowser(userCode);
  assert.equal(b.entered.status, 200, b.entered.html);
  const emailed = await b.post("/device/email", { email });
  assert.equal(emailed.status, 200, emailed.html);
  const verified = await b.post("/device/verify", { code: code(emailed.html)! });
  assert.match(verified.html, /Allow access/);
  const form = new URLSearchParams({ decision });
  for (const s of scopes) form.append("scopes", s);
  const done = await b.post("/device/approve", form);
  return { b, emailed, verified, done };
}

/** A whole Mediated Sign-In (extension grant); its tokens go on the agent's Session. */
async function mediated(a: any, email = `${randomUUID()}@example.com`, scope = "orders:read orders:write") {
  const started = await tokenRequest({ grant_type: mediatedGrant, scope, email });
  assert.equal(started.body.error, "code_required", JSON.stringify(started.body));
  const captured = await a.request(`/api/sandbox/sign-in/${started.body.sign_in_id}/email`);
  assert.equal(captured.status, 200, JSON.stringify(captured.body));
  const otp = captured.body.email.text.match(/code is (\d{6})/)[1];
  const done = await tokenRequest({ grant_type: mediatedGrant, sign_in_id: started.body.sign_in_id, one_time_code: otp });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  Object.assign(a.session, done.body);
  return done.body;
}

/** A whole Device Sign-In for this agent's Session; its tokens replace the agent's. */
async function deviceSignIn(a: any, email = `${randomUUID()}@example.com`, scopes = ["orders:read", "orders:write", "addresses"]) {
  const d = (await startDevice(scopes.join(" "))).body;
  const pending = await a.poll(d.device_code);
  assert.equal(pending.body.error, "authorization_pending", JSON.stringify(pending.body));
  await approveDevice(d.user_code, email, scopes);
  const done = await a.poll(d.device_code);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  Object.assign(a.session, done.body);
  return done.body;
}
/** Operations v2: send the same request again with Poppy-Approval. */
async function approveVia(a: any, route: string, body: unknown, op: { operation_id: string; revision: string }) {
  return a.request(route, postJson(body, { "Poppy-Approval": `operation_id="${op.operation_id}", revision="${op.revision}"` }));
}
return { agent, clientId, deviceGrant, mediatedGrant, assertion, clientAuth, tokenRequest, sessionOf, makeAgent, postJson, startDevice, deviceBrowser, code, approveDevice, mediated, deviceSignIn, approveVia };
}
export type Harness = Awaited<ReturnType<typeof signInHarness>>;
export type Agent = Awaited<ReturnType<Harness["makeAgent"]>>;
