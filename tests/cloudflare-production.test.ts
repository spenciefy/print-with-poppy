import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { configuration } from "../workers/configuration.js";
import {
  verifyStripeEvent,
  acceptStripeEvent,
} from "../server/stripe-events.js";
const production = {
  CF_DEPLOYMENT: "production",
  APP_MODE: "live",
  PUBLIC_URL: "https://production.example",
  APP_SECRET: "x".repeat(48),
  AGENT_SANDBOX: "false",
  ALLOW_COMPAT_AGENT_SESSIONS: "false",
  AGENT_CLIENT_IDS: "https://agent.example/client.json",
  LIVE_ORDERS_ENABLED: "false",
  STRIPE_SECRET_KEY: "sk_live_fixture",
  PRODIGI_API_KEY: "fixture",
  STRIPE_WEBHOOK_SECRET: "whsec_fixture",
  RESEND_API_KEY: "fixture",
  EMAIL_FROM: "Print with Poppy <orders@example.com>",
};
test("production is explicit, complete, live-key-only and cannot enable simulation", () => {
  assert.equal(configuration(production).APP_MODE, "live");
  for (const change of [
    { CF_DEPLOYMENT: "sandbox" },
    { APP_MODE: "demo" },
    { STRIPE_SECRET_KEY: "sk_test_fixture" },
    { AGENT_SANDBOX: "true" },
    { SANDBOX_EMAIL_DELIVERY: "true" },
    { SANDBOX_REFERENCE_PUBLIC_JWK: "{}" },
    { LIVE_ORDERS_ENABLED: undefined },
    { APP_SECRET: "short" },
    { STRIPE_WEBHOOK_SECRET: "" },
  ])
    assert.throws(() => configuration({ ...production, ...change }));
  assert.equal(
    configuration({
      APP_SECRET: "x".repeat(48),
      APP_MODE: "demo",
      PUBLIC_URL: "http://localhost:8787",
    }).demo,
    true,
  );
});
test("raw Stripe payloads require current signatures; foreign orders and test events cannot fulfill production", async () => {
  const stripe = new Stripe("sk_test_fixture");
  const secret = "whsec_fixture";
  const payload = JSON.stringify({
    id: "evt_fixture",
    object: "event",
    type: "checkout.session.completed",
    livemode: true,
    data: {
      object: {
        id: "cs_fixture",
        metadata: { order_id: "ord_fixture" },
        amount_total: 1200,
        currency: "usd",
        payment_status: "paid",
        status: "complete",
      },
    },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const event = await verifyStripeEvent(payload, header, secret);
  await assert.rejects(
    () => verifyStripeEvent(payload + " ", header, secret),
    /signature/,
  );
  await assert.rejects(
    () => verifyStripeEvent(payload, header, "wrong"),
    /signature/,
  );
  await assert.rejects(
    () =>
      verifyStripeEvent(
        payload,
        stripe.webhooks.generateTestHeaderString({
          payload,
          secret,
          timestamp: 1,
        }),
        secret,
      ),
    /signature/,
  );
  let calls = 0;
  acceptStripeEvent(
    event,
    true,
    () => false,
    () => {
      calls++;
    },
  );
  assert.equal(calls, 0);
  assert.throws(
    () =>
      acceptStripeEvent(
        { ...event, livemode: false },
        true,
        () => true,
        () => {
          calls++;
        },
      ),
    /different payment environment/,
  );
  acceptStripeEvent(
    event,
    true,
    (id) => id === "ord_fixture",
    (id, payment) => {
      calls++;
      assert.equal(id, "ord_fixture");
      assert.deepEqual(payment, {
        id: "cs_fixture",
        amount: 1200,
        currency: "usd",
        paid: true,
      });
    },
  );
  assert.equal(calls, 1);
});
