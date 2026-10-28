import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { signInHarness } from "./support/signin-harness.js";
import sharp from "sharp";
const temp = await fs.mkdtemp(`${os.tmpdir()}/poppy-test-`);
delete process.env.STRIPE_SECRET_KEY;
delete process.env.PRODIGI_API_KEY;
delete process.env.RESEND_API_KEY;
process.env.APP_MODE = "demo";
process.env.AGENT_SANDBOX = "true";
process.env.ALLOW_COMPAT_AGENT_SESSIONS = "false";
process.env.DATA_DIR = temp;
process.env.NO_LISTEN = "1";
process.env.PUBLIC_URL = "http://localhost:8797";
const { app, limiter, oauthLimiter } = await import("../server/index.js");
beforeEach(() => {
  limiter.resetKey("127.0.0.1");
  oauthLimiter.resetKey("127.0.0.1");
});
const store = await import("../server/store.js");
const commerce = await import("../server/commerce.js");
const worker = await import("../server/worker.js");
const auth = await import("../server/auth.js");
const photos = await import("../server/photos.js");
let server: any;
before(async () => {
  server = app.listen(8797, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
});
after(async () => {
  await new Promise<void>((resolve) => server.close(resolve));
  store.db.close();
  await fs.rm(temp, { recursive: true, force: true });
});
const origin = "http://localhost:8797";
const clientId = origin + "/api/demo/agent.json";
const h = await signInHarness(origin, store);
const makeAgent = h.makeAgent;

const address = {
  name: "Sandbox Recipient",
  line1: "123 Market Street",
  city: "San Francisco",
  state: "CA",
  postalCode: "94103",
  country: "US",
};
test("sandbox exposes simulation only with native sessions and approval, isolates orders, and captures emails", async () => {
  const cfg = await (await fetch(origin + "/api/config")).json();
  assert.equal(cfg.environment, "agent-sandbox");
  const schema = await (await fetch(origin + "/openapi.json")).json();
  assert.equal(
    schema.paths["/api/sandbox/orders/{id}/pay"].post.operationId,
    "simulatePayment",
  );
  const discovery = await (
    await fetch(origin + "/.well-known/poppy.json")
  ).json();
  assert.match(discovery.organization.name, /Sandbox/);
  assert.equal(discovery.auth.direct, undefined);
  assert.equal(
    (await fetch(origin + "/api/demo/session", { method: "POST" })).status,
    404,
  );
  const a = await makeAgent(),
    b = await makeAgent();
  const photo = await photos.upload(
    await sharp({
      create: { width: 600, height: 900, channels: 3, background: "orange" },
    })
      .jpeg()
      .toBuffer(),
    "sample.jpg",
    a.session.session_id,
  );
  const body = { email: "test@example.com", address, items: [{ photoId: photo.id, quantity: 5, fit: "cover" }] };
  const proposal = await a.request("/api/orders", h.postJson(body));
  assert.equal(proposal.status, 403, JSON.stringify(proposal.body));
  const operation = proposal.body.operation;
  assert.equal(
    (
      await a.request(`/api/sandbox/orders/${operation.operation_id}/pay`, {
        method: "POST",
      })
    ).status,
    404,
  );
  const placed = await h.approveVia(a, "/api/orders", body, operation);
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  await worker.tick();
  const ready = { body: { result: { data: { order_id: placed.body.id } } } };
  const oid = ready.body.result.data.order_id;
  assert.equal(
    (await b.request(`/api/sandbox/orders/${oid}/pay`, { method: "POST" }))
      .status,
    404,
  );
  assert.equal(
    (await fetch(origin + `/api/sandbox/orders/${oid}/pay`, { method: "POST" }))
      .status,
    400,
  );
  assert.equal(
    (await a.request(`/api/sandbox/orders/${oid}/ship`, { method: "POST" }))
      .status,
    409,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await a.request(`/api/sandbox/orders/${oid}/pay`, { method: "POST" }))
        .status,
      200,
    );
  await worker.tick();
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await a.request(`/api/sandbox/orders/${oid}/ship`, { method: "POST" }))
        .status,
      200,
    );
  await worker.tick();
  const emails = await a.request(`/api/sandbox/orders/${oid}/emails`);
  assert.ok(emails.body.emails.every((e: any) => e.delivery === "captured"));
  assert.equal(emails.body.emails.length, 2);
  assert.equal(
    (await b.request(`/api/sandbox/orders/${oid}/emails`)).status,
    404,
  );
  assert.equal((await a.request(`/api/orders/${oid}`)).body.status, "shipped");
});
test("sandbox Mediated Sign-In codes are readable only by the client that started them, for synthetic accounts", async () => {
  const a = await makeAgent();
  const start = (email: string) => h.tokenRequest({ grant_type: h.mediatedGrant, scope: "orders:read orders:write", email });
  assert.equal((await start("somebody@gmail.com")).status, 400);
  const challenge = await start("sandbox@example.com");
  assert.equal(challenge.body.error, "code_required");
  assert.match(challenge.body.sent_to, /Sandbox/);
  const id = challenge.body.sign_in_id;
  const email = await a.request(`/api/sandbox/sign-in/${id}/email`);
  assert.equal(email.status, 200, JSON.stringify(challenge.body));
  // A sign-in started by another client isn't readable.
  const c = store.get("signin-code", id);
  store.put("signin-code", "sgn_other_client", { ...c, id: "sgn_other_client", owner: "mediated:https://other.example/agent.json" }, c.owner);
  store.put("demo-signin-email", "sgn_other_client", store.get("demo-signin-email", id));
  assert.equal((await a.request(`/api/sandbox/sign-in/sgn_other_client/email`)).status, 404);
  const code = email.body.email.text.match(/code is (\d{6})/)[1];
  const verified = await h.tokenRequest({ grant_type: h.mediatedGrant, sign_in_id: id, one_time_code: code });
  assert.equal(verified.status, 200);
  assert.equal((await a.request(`/api/sandbox/sign-in/${id}/email`)).status, 404);
});


test("sandbox order email delivery uses Resend with test labeling and stays captured when disabled", async () => {
  const { config } = await import("../server/config.js");
  const { sendMail } = await import("../server/providers.js");
  const { emailFor } = await import("../server/email.js");
  const order = store.all<any>("order").find(o => o.paidAt);
  const message = emailFor(order, "email-confirmation");
  assert.match(message.subject, /^\[SANDBOX\]/);
  assert.match(message.text, /No money was charged/);
  assert.match(message.html, /sandbox.printwithpoppy.com|localhost:8797/);
  await assert.rejects(sendMail(message, "sandbox-test"), /disabled/);
  const originalFetch = globalThis.fetch;
  const calls: any[] = [];
  config.sandboxEmailDelivery = true;
  globalThis.fetch = (async (url: any, init: any) => {
    assert.equal(url, "https://api.resend.com/emails");
    calls.push(JSON.parse(init.body));
    return Response.json({ id: "resend-test" });
  }) as typeof fetch;
  try {
    const result = await sendMail({ ...message, to: "tester@any-domain.test" }, "sandbox-test");
    assert.equal(result.id, "resend-test");
    assert.equal(calls[0].to, "tester@any-domain.test");
  } finally {
    globalThis.fetch = originalFetch;
    config.sandboxEmailDelivery = false;
  }
});
