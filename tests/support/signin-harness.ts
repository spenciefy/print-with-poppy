// Shared signed-agent and browser helpers for the sign-in tests.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { generateKeyPair, exportJWK, importJWK, SignJWT } from "jose";

export async function signInHarness(origin: string, store: any) {
const clientId = origin + "/api/demo/agent.json";
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code";
const key = store.get("demo-key", "identity");
const signing = await importJWK(key.private, "ES256");
const sha = (s: string) => createHash("sha256").update(s).digest("base64url");

async function assertion(subject: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: "demo" })
    .setIssuer(clientId)
    .setSubject(subject)
    .setAudience(origin)
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(randomUUID())
    .sign(signing);
}
const clientAuth = async () => ({
  client_id: clientId,
  client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
  client_assertion: await assertion(clientId),
});

async function makeAgent(user = randomUUID()) {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(pair.publicKey);
  async function proof(method: string, url: string, token?: string) {
    return new SignJWT({ htm: method, htu: url, ...(token ? { ath: sha(token) } : {}) })
      .setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk })
      .setIssuedAt()
      .setJti(randomUUID())
      .sign(pair.privateKey);
  }
  async function tokenRequest(body: Record<string, string>) {
    const r = await fetch(origin + "/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: await proof("POST", origin + "/oauth/token"),
      },
      body: new URLSearchParams({ ...body, ...(await clientAuth()) }),
    });
    return { status: r.status, headers: r.headers, body: await r.json() };
  }
  const started = await tokenRequest({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: await assertion(user),
  });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const session = started.body;
  async function request(route: string, init: RequestInit = {}) {
    const r = await fetch(origin + route, {
      ...init,
      headers: {
        Authorization: `DPoP ${session.access_token}`,
        DPoP: await proof(init.method || "GET", origin + new URL(route, origin).pathname, session.access_token),
        ...init.headers,
      },
    });
    return { status: r.status, headers: r.headers, body: await r.json() };
  }
  const poll = (deviceCode: string, extra: Record<string, string> = {}) =>
    tokenRequest({
      grant_type: deviceGrant,
      device_code: deviceCode,
      session_id: session.session_id,
      ...extra,
    });
  return { session, request, proof, tokenRequest, poll };
}
const postJson = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

async function startDevice(scope = "poppy:read poppy:write", auth = true) {
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

async function mediated(a: any, email = `${randomUUID()}@example.com`, scope = "poppy:read poppy:write") {
  const started = await a.request("/api/poppy/sign-in", postJson({ scope, credentials: { email } }));
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const captured = await a.request(`/api/sandbox/sign-in/${started.body.sign_in_id}/email`);
  assert.equal(captured.status, 200);
  const otp = captured.body.email.text.match(/code is (\d{6})/)[1];
  const done = await a.request(`/api/poppy/sign-in/${started.body.sign_in_id}`, postJson({ code: otp }));
  assert.equal(done.body.status, "complete", JSON.stringify(done.body));
  Object.assign(a.session, done.body);
  return done.body;
}


return { clientId, deviceGrant, assertion, clientAuth, makeAgent, postJson, startDevice, deviceBrowser, code, approveDevice, mediated };
}
export type Harness = Awaited<ReturnType<typeof signInHarness>>;
export type Agent = Awaited<ReturnType<Harness["makeAgent"]>>;
