// Device Sign-In in the hosted-style Agent Sandbox (APP_MODE=demo, AGENT_SANDBOX=true).
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { signInHarness } from "./support/signin-harness.js";
const temp = await fs.mkdtemp(`${os.tmpdir()}/poppy-sandbox-signin-`);
delete process.env.STRIPE_SECRET_KEY;
delete process.env.PRODIGI_API_KEY;
delete process.env.RESEND_API_KEY;
process.env.APP_MODE = "demo";
process.env.AGENT_SANDBOX = "true";
process.env.ALLOW_COMPAT_AGENT_SESSIONS = "false";
process.env.DATA_DIR = temp;
process.env.NO_LISTEN = "1";
process.env.PUBLIC_URL = "http://localhost:8794";
const { app, limiter, oauthLimiter } = await import("../server/index.js");
beforeEach(() => {
  limiter.resetKey("127.0.0.1");
  oauthLimiter.resetKey("127.0.0.1");
});
const store = await import("../server/store.js");
let server: any;
before(async () => {
  server = app.listen(8794, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
});
after(async () => {
  await new Promise<void>((resolve) => server.close(resolve));
  store.db.close();
  await fs.rm(temp, { recursive: true, force: true });
});
const origin = "http://localhost:8794";
const h = await signInHarness(origin, store);

test("sandbox advertises device and mediated (not direct); device sign-in completes with the captured-code helper", async () => {
  const d = await (await fetch(origin + "/.well-known/poppy.json")).json();
  assert.equal(d.auth.direct, undefined);
  assert.deepEqual(d.auth.device.scopes, ["poppy:read", "poppy:write"]);
  assert.ok(d.auth.mediated);
  const openapi = await (await fetch(origin + "/openapi.json")).json();
  assert.ok(openapi.paths["/api/sandbox/device-sign-in/email"]);
  assert.ok(openapi.paths["/api/sandbox/orders/{id}/pay"]);
  assert.match(openapi.info.description, /getSandboxDeviceSignInEmail/);

  const a = await h.makeAgent();
  const started = await h.startDevice();
  assert.equal(started.status, 200);
  assert.equal((await a.poll(started.body.device_code)).body.error, "authorization_pending");
  const b = await h.deviceBrowser(started.body.user_code);
  assert.match(b.entered.html, /Demo Personal Agent/);
  // Real-looking addresses are refused in the sandbox, on the page.
  const real = await b.post("/device/email", { email: "someone@gmail.test" });
  assert.equal(real.status, 400);
  assert.match(real.html, /synthetic/);
  const emailed = await b.post("/device/email", { email: `${randomUUID()}@example.org` });
  assert.match(emailed.html, /Agent Sandbox/);
  const helper = await a.request(
    "/api/sandbox/device-sign-in/email",
    h.postJson({ device_code: started.body.device_code }),
  );
  assert.equal(helper.status, 200);
  assert.equal(helper.body.delivered, false);
  const otp = helper.body.email.text.match(/code is (\d{6})/)[1];
  assert.equal(h.code(emailed.html), otp);
  await b.post("/device/verify", { code: otp });
  const form = new URLSearchParams({ decision: "approve" });
  form.append("scopes", "poppy:read");
  form.append("scopes", "poppy:write");
  const done = await b.post("/device/approve", form);
  assert.match(done.html, /You’re connected/);
  const tokens = await a.poll(started.body.device_code);
  assert.equal(tokens.status, 200, JSON.stringify(tokens.body));
  assert.equal(tokens.body.signed_in, true);
  assert.equal(tokens.body.scope, "poppy:read poppy:write");
});
