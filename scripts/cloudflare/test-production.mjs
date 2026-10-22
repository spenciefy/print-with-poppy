// Production transport smoke test with inert fixture credentials, local storage and no provider calls.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import Stripe from "stripe";
const origin = "http://localhost:8898";
const root = await fs.mkdtemp(path.resolve(".cloudflare/production-test-"));
const log = await fs.open(root + "/wrangler.log", "w");
const fixtures = {
  APP_SECRET: "fixture-secret-not-for-deployment-".repeat(2),
  STRIPE_SECRET_KEY: "sk_live_fixture_only",
  STRIPE_WEBHOOK_SECRET: "whsec_fixture_only",
  PRODIGI_API_KEY: "fixture_only",
  RESEND_API_KEY: "fixture_only",
  EMAIL_FROM: "Print with Poppy <orders@example.com>",
};
const child = spawn(
  "npx",
  [
    "wrangler",
    "dev",
    "--local",
    "--env",
    "production",
    "--port",
    "8898",
    "--persist-to",
    root + "/state",
    ...Object.entries(fixtures).flatMap(([key, value]) => [
      "--var",
      `${key}:${value}`,
    ]),
  ],
  { stdio: ["ignore", log.fd, log.fd] },
);
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      ready = (await fetch(origin + "/api/health")).ok;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(ready, `Worker startup failed: ${root}/wrangler.log`);
  const cfg = await (await fetch(origin + "/api/config")).json();
  assert.equal(cfg.mode, "live");
  assert.equal(cfg.restrictedLaunch, false);
  assert.equal(cfg.httpOrderingEnabled, false);
  for (const url of [
    "/api/demo/agent.json",
    "/api/sandbox/reference-agent.json",
    "/api/compat/openapi.json",
  ])
    assert.equal((await fetch(origin + url)).status, 404, url);
  assert.equal(
    (
      await fetch(origin + "/api/sandbox/orders/not-real/pay", {
        method: "POST",
      })
    ).status,
    404,
  );
  const body = JSON.stringify({
    livemode: true,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_foreign",
        metadata: { order_id: "ord_foreign" },
        payment_status: "paid",
        status: "complete",
        amount_total: 1200,
        currency: "usd",
      },
    },
  });
  const stripe = new Stripe("sk_test_fixture");
  const post = (payload, signature) =>
    fetch(origin + "/api/webhooks/stripe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": signature,
      },
      body: payload,
    });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: fixtures.STRIPE_WEBHOOK_SECRET,
  });
  assert.equal(
    (await post(body, signature)).status,
    200,
    "A foreign order must be acknowledged without fulfillment.",
  );
  assert.equal(
    (await post(body, signature)).status,
    200,
    "Duplicate foreign events must be harmless.",
  );
  assert.equal(
    (await post(body + " ", signature)).status,
    400,
    "Raw-body tampering must fail.",
  );
  const testBody = body.replace('"livemode":true', '"livemode":false');
  assert.equal(
    (
      await post(
        testBody,
        stripe.webhooks.generateTestHeaderString({
          payload: testBody,
          secret: fixtures.STRIPE_WEBHOOK_SECRET,
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(origin + "/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "unapproved@example.com" }),
      })
    ).status,
    401,
    "Any recipient is allowed, but native authentication remains required.",
  );
  assert.equal(
    (
      await fetch(origin + "/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "spencersyen@gmail.com" }),
      })
    ).status,
    401,
    "Recipient does not bypass native authentication.",
  );
  console.log(
    "Production Workers transport passed: raw signed webhooks, environment isolation, simulation disabled, unrestricted recipients and native authentication. No provider requests were made.",
  );
} finally {
  child.kill("SIGTERM");
  await log.close();
}
