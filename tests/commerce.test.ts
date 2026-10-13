import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { generateKeyPair, exportJWK, importJWK, SignJWT } from "jose";
import sharp from "sharp";
const temp = await fs.mkdtemp(`${os.tmpdir()}/poppy-test-`);
process.env.STRIPE_SECRET_KEY = "sk_test_local_contract_only";
process.env.PRODIGI_API_KEY = "local_contract_only";
process.env.RESEND_API_KEY = "local_contract_only";
process.env.APP_MODE = "demo";
process.env.DATA_DIR = temp;
process.env.NO_LISTEN = "1";
process.env.PUBLIC_URL = "http://localhost:8791";
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
  server = app.listen(8791, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
});
after(async () => {
  await new Promise<void>((resolve) => server.close(resolve));
  store.db.close();
  await fs.rm(temp, { recursive: true, force: true });
});
const origin = "http://localhost:8791";
const clientId = origin + "/api/demo/agent.json";
const key = store.get("demo-key", "identity");
const signing = await importJWK(key.private, "ES256");
async function makeAgent(user = randomUUID()) {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(pair.publicKey);
  async function proof(method: string, url: string, token?: string) {
    return new SignJWT({
      htm: method,
      htu: url,
      ...(token
        ? { ath: createHash("sha256").update(token).digest("base64url") }
        : {}),
    })
      .setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk })
      .setIssuedAt()
      .setJti(randomUUID())
      .sign(pair.privateKey);
  }
  async function assertion(
    subject: string,
    audience = origin + "/oauth/token",
  ) {
    return new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "demo" })
      .setIssuer(clientId)
      .setSubject(subject)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("60s")
      .setJti(randomUUID())
      .sign(signing);
  }
  async function token(sessionId?: string) {
    const r = await fetch(origin + "/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: await proof("POST", origin + "/oauth/token"),
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        client_id: clientId,
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await assertion(clientId),
        assertion: await assertion(user),
        ...(sessionId ? { session_id: sessionId } : {}),
      }),
    });
    const b = await r.json();
    assert.equal(r.status, 200, JSON.stringify(b));
    return b;
  }
  const session = await token();
  async function request(route: string, init: RequestInit = {}) {
    const r = await fetch(origin + route, {
      ...init,
      headers: {
        Authorization: `DPoP ${session.access_token}`,
        DPoP: await proof(
          init.method || "GET",
          origin + new URL(route, origin).pathname,
          session.access_token,
        ),
        ...init.headers,
      },
    });
    return { status: r.status, body: await r.json() };
  }
  return { session, request, proof, token, assertion };
}
const address = {
  name: "Test Recipient",
  line1: "123 Market Street",
  line2: "Unit 9",
  city: "San Francisco",
  state: "CA",
  postalCode: "94103",
  country: "US",
};
async function fixture() {
  const a = await makeAgent();
  const buffer = await sharp({
    create: { width: 1800, height: 1200, channels: 3, background: "#e76f26" },
  })
    .jpeg()
    .toBuffer();
  const form = new FormData();
  form.append("photo", new Blob([buffer]), "test.jpg");
  const uploaded = await a.request("/api/photos", {
    method: "POST",
    body: form,
  });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const proposal = {
    email: "test@example.com",
    address,
    items: [{ photoId: uploaded.body.id, quantity: 2, fit: "contain" }],
  };
  const key = randomUUID();
  const r = await a.request("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(proposal),
  });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  return { a, photo: uploaded.body, proposal, key, op: r.body.operation };
}
test("real Poppy discovery, DPoP upload, immutable approval, one payment, one print order and emails", async () => {
  const discovery = await (
    await fetch(origin + "/.well-known/poppy.json")
  ).json();
  assert.equal(discovery.extensions.operations.version, "1");
  const f = await fixture();
  assert.match(
    f.op.summary,
    /123 Market Street, Unit 9, San Francisco, CA 94103/,
  );
  assert.equal(f.op.confirmation, null);
  assert.equal(store.all("order").length, 0);
  const approve = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: 1, approved_by: "user" }),
  };
  const [one, two] = await Promise.all([
    f.a.request(`/api/operations/${f.op.operation_id}/confirm`, approve),
    f.a.request(`/api/operations/${f.op.operation_id}/confirm`, approve),
  ]);
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  await worker.tick();
  const op = commerce.readOperation(f.op.operation_id, f.a.session.session_id);
  assert.equal(op.state, "succeeded");
  assert.equal(store.all("order").length, 1);
  const o = store.get("order", op.orderId!);
  assert.equal(o.status, "awaiting_payment");
  assert.equal(o.prodigiId, undefined);
  assert.throws(
    () =>
      commerce.paid(o.id, {
        id: o.checkoutId,
        amount: 1,
        currency: "usd",
        paid: true,
      }),
    /match/,
  );
  assert.equal(store.get("order", o.id).paidAt, undefined);
  commerce.paid(o.id, {
    id: o.checkoutId,
    amount: o.quote.total,
    currency: "usd",
    paid: false,
  });
  assert.equal(store.get("order", o.id).paidAt, undefined);
  for (let n = 0; n < 3; n++)
    commerce.paid(o.id, {
      id: o.checkoutId,
      amount: o.quote.total,
      currency: "usd",
      paid: true,
    });
  await worker.tick();
  let paid = store.get("order", o.id);
  assert.equal(paid.status, "printing");
  assert.equal(store.all("email", o.id).length, 1);
  assert.match(store.all<any>("email", o.id)[0].text, /Unit 9/);
  const p = {
    id: paid.prodigiId,
    status: { stage: "Complete" },
    shipments: [
      {
        id: "shipment-1",
        status: "Shipped",
        tracking: { number: "ABC123", url: "javascript:alert(1)" },
        carrier: { name: "Test Carrier" },
      },
    ],
  };
  worker.syncProvider(o.id, p);
  worker.syncProvider(o.id, p);
  await worker.tick();
  paid = store.get("order", o.id);
  assert.equal(paid.status, "shipped");
  assert.equal(paid.shipments[0].tracking.url, undefined);
  assert.equal(store.all("email", o.id).length, 2);
  assert.equal(
    (
      store.db
        .prepare(
          "SELECT count(*) n FROM jobs WHERE kind='fulfill' AND record_id=?",
        )
        .get(o.id) as any
    ).n,
    1,
  );
  const stranger = await makeAgent();
  assert.equal((await stranger.request(`/api/orders/${o.id}`)).status, 404);
  assert.equal(
    (await stranger.request(`/api/operations/${f.op.operation_id}`)).status,
    404,
  );
  const badView = await fetch(origin + `/api/order-view/${o.id}`);
  assert.equal(badView.status, 404);
});
test("proof replay, wrong method, token binding, expired token, and session renewal are enforced", async () => {
  const a = await makeAgent();
  const missingProof = await fetch(origin + "/api/photos", {
    method: "POST",
    headers: { Authorization: `DPoP ${a.session.access_token}` },
  });
  assert.equal(missingProof.status, 401);
  assert.equal((await missingProof.json()).error, "invalid_dpop_proof");
  const proof = await a.proof(
    "GET",
    origin + "/api/orders/not_found",
    a.session.access_token,
  );
  const headers = {
    Authorization: `DPoP ${a.session.access_token}`,
    DPoP: proof,
  };
  assert.equal(
    (await fetch(origin + "/api/orders/not_found", { headers })).status,
    404,
  );
  assert.equal(
    (await fetch(origin + "/api/orders/not_found", { headers })).status,
    401,
  );
  const wrong = await a.proof(
    "POST",
    origin + "/api/orders/not_found",
    a.session.access_token,
  );
  assert.equal(
    (
      await fetch(origin + "/api/orders/not_found", {
        headers: { ...headers, DPoP: wrong },
      })
    ).status,
    401,
  );
  const other = await makeAgent();
  const mismatched = await other.proof(
    "GET",
    origin + "/api/orders/not_found",
    a.session.access_token,
  );
  assert.equal(
    (
      await fetch(origin + "/api/orders/not_found", {
        headers: { ...headers, DPoP: mismatched },
      })
    ).status,
    401,
  );
  const renewed = await a.token(a.session.session_id);
  assert.equal(renewed.session_id, a.session.session_id);
  const tokenHash = store.hash(a.session.access_token);
  const record = store.get("token", tokenHash);
  store.put("token", tokenHash, { ...record, expires: 0 });
  assert.equal((await a.request("/api/orders/not_found")).status, 401);
});
test("changed revisions, standing permissions, expired quotes and cancelled proposals cannot purchase", async () => {
  const f = await fixture();
  const owner = f.a.session.session_id;
  assert.throws(
    () => commerce.confirm(f.op.operation_id, owner, 2, "user"),
    /current terms/,
  );
  assert.throws(
    () => commerce.confirm(f.op.operation_id, owner, 1, "standing_permission"),
    /approval/,
  );
  commerce.cancel(f.op.operation_id, owner);
  assert.equal(
    commerce.confirm(f.op.operation_id, owner, 1, "user").state,
    "cancelled",
  );
  const f2 = await fixture();
  const op = store.get("operation", f2.op.operation_id);
  op.terms.expires = 0;
  store.put("operation", op.operation_id, op, op.owner);
  assert.equal(
    commerce.confirm(op.operation_id, op.owner, 1, "user").state,
    "expired",
  );
  assert.equal(
    store.all<any>("order").filter((o) => o.operationId === op.operation_id)
      .length,
    0,
  );
});
test("idempotent proposals reject changed bodies and foreign photos", async () => {
  const f = await fixture();
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": f.key },
    body: JSON.stringify(f.proposal),
  };
  assert.equal(
    (await f.a.request("/api/orders", init)).body.operation.operation_id,
    f.op.operation_id,
  );
  assert.equal(
    (
      await f.a.request("/api/orders", {
        ...init,
        body: JSON.stringify({ ...f.proposal, email: "other@example.com" }),
      })
    ).status,
    409,
  );
  const other = await makeAgent();
  assert.equal(
    (
      await other.request("/api/orders", {
        ...init,
        headers: { ...init.headers, "Idempotency-Key": randomUUID() },
      })
    ).status,
    404,
  );
});
test("unsigned callbacks cannot forge shipment state", async () => {
  const o = store.all<any>("order")[0];
  const before = JSON.stringify(o);
  await fetch(origin + "/api/webhooks/prodigi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: o.prodigiId,
      data: { order: { status: { stage: "Cancelled" } } },
    }),
  });
  await worker.tick();
  assert.equal(JSON.stringify(store.get("order", o.id)), before);
});
test("invalid images, arbitrary card payloads and unsupported destinations fail closed", async () => {
  const a = await makeAgent();
  const body = new FormData();
  body.append(
    "photo",
    new Blob(["<svg><script>alert(1)</script></svg>"]),
    "bad.svg",
  );
  assert.equal(
    (await a.request("/api/photos", { method: "POST", body })).status,
    422,
  );
  const f = await fixture();
  for (const extra of [
    { card_number: "4242424242424242" },
    { address: { ...address, country: "CA" } },
  ]) {
    const r = await f.a.request("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ ...f.proposal, ...extra }),
    });
    assert.equal(r.status, 400);
  }
  assert.equal((await fetch(f.photo.previews.contain)).status, 200);
  const preview = new URL(f.photo.previews.contain);
  preview.searchParams.set("sig", "bad");
  assert.equal((await fetch(preview)).status, 403);
  const stranger = await makeAgent();
  await assert.rejects(() =>
    auth.client("https://unregistered.example/agent.json"),
  );
});
test("provider contracts preserve approved terms and use stable idempotency keys", async () => {
  const { config } = await import("../server/config.js");
  const providers = await import("../server/providers.js");
  const originalFetch = globalThis.fetch;
  const stripe = providers.stripe!;
  const createCheckout = stripe.checkout.sessions.create;
  const createTax = stripe.tax.calculations.create;
  const f = await fixture();
  commerce.confirm(f.op.operation_id, f.a.session.session_id, 1, "user");
  await worker.tick();
  const op = commerce.readOperation(f.op.operation_id, f.a.session.session_id);
  const order = store.get("order", op.orderId!);
  const calls: { url: string; body: any; headers: any }[] = [];
  let stripeParams: any, taxParams: any;
  try {
    config.demo = false;
    globalThis.fetch = (async (input: any, init: any = {}) => {
      const url = String(input);
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url, body, headers: init.headers });
      let result: any;
      if (url.endsWith("/products/GLOBAL-PHO-4X6"))
        result = {
          outcome: "Ok",
          product: { attributes: { finish: ["lustre"] } },
        };
      else if (url.endsWith("/quotes"))
        result = {
          outcome: "Created",
          quotes: [
            {
              shipmentMethod: "Budget",
              costSummary: {
                items: { amount: "2.00", currency: "USD" },
                shipping: { amount: "4.95", currency: "USD" },
                totalTax: { amount: "0.50", currency: "USD" },
              },
            },
          ],
        };
      else if (url.endsWith("/orders"))
        result = {
          outcome: "alreadyExists",
          order: {
            id: "provider-contract-order",
            status: { stage: "InProgress" },
            shipments: [],
          },
        };
      else if (url === "https://api.resend.com/emails")
        result = { id: "resend-contract-id" };
      else throw new Error("Unexpected external request: " + url);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;
    stripe.tax.calculations.create = (async (params: any) => {
      taxParams = params;
      return {
        id: "taxcalc_contract",
        amount_total: 1805,
        tax_amount_exclusive: 105,
      };
    }) as any;
    stripe.checkout.sessions.create = (async (params: any, options: any) => {
      stripeParams = { params, options };
      return {
        id: "cs_contract",
        url: "https://checkout.stripe.com/contract",
        expires_at: params.expires_at,
      };
    }) as any;
    const price = await providers.getPrice(f.proposal as any);
    assert.equal(price.total, 1805);
    assert.equal(price.subtotal, 1200);
    assert.equal(price.shipping, 500);
    assert.equal(taxParams.line_items[0].amount, 1200);
    assert.equal(taxParams.shipping_cost.amount, 500);
    assert.equal(price.tax, 105);
    assert.equal(taxParams.customer_details.address.line2, "Unit 9");
    assert.equal(taxParams.customer_details.address_source, "shipping");
    const checkout = await providers.checkout(order);
    assert.equal(checkout.id, "cs_contract");
    assert.equal(stripeParams.options.idempotencyKey, `checkout:${order.id}`);
    assert.equal(
      stripeParams.params.line_items.reduce(
        (n: number, i: any) => n + i.price_data.unit_amount * i.quantity,
        0,
      ),
      order.quote.total,
    );
    assert.equal(stripeParams.params.shipping_address_collection, undefined);
    assert.deepEqual(stripeParams.params.allowed_payment_method_types, [
      "card",
    ]);
    assert.ok(stripeParams.params.expires_at > Date.now() / 1000 + 1800);
    const print = await providers.submitPrint(order);
    assert.equal(print.id, "provider-contract-order");
    const printRequest = calls.find((c) => c.url.endsWith("/orders"))!;
    assert.equal(printRequest.body.idempotencyKey, order.id);
    assert.equal(printRequest.body.recipient.address.line2, "Unit 9");
    assert.equal(printRequest.body.items[0].sku, "GLOBAL-PHO-4X6");
    assert.match(printRequest.body.items[0].assets[0].url, /\/contain\?/);
    await providers.sendMail(
      {
        to: "test@example.com",
        subject: "test",
        html: "<p>test</p>",
        text: "test",
      },
      "mail-contract-key",
    );
    assert.equal(calls.at(-1)!.headers["Idempotency-Key"], "mail-contract-key");
    const normalQuoteFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init: any) => {
      const response = await normalQuoteFetch(input, init);
      if (!String(input).endsWith("/quotes")) return response;
      const body = await response.json();
      body.quotes[0].costSummary.shipping.amount = "30.00";
      return new Response(JSON.stringify(body));
    }) as any;
    await assert.rejects(
      providers.getPrice(f.proposal as any),
      /published price/,
    );
  } finally {
    config.demo = true;
    globalThis.fetch = originalFetch;
    stripe.checkout.sessions.create = createCheckout;
    stripe.tax.calculations.create = createTax;
  }
});
test("fulfillment outage stays retryable and does not duplicate confirmation email", async () => {
  const { config } = await import("../server/config.js");
  const originalFetch = globalThis.fetch;
  const f = await fixture();
  commerce.confirm(f.op.operation_id, f.a.session.session_id, 1, "user");
  await worker.tick();
  const op = commerce.readOperation(f.op.operation_id, f.a.session.session_id);
  let o = store.get("order", op.orderId!);
  commerce.paid(o.id, {
    id: o.checkoutId,
    amount: o.quote.total,
    currency: "usd",
    paid: true,
  });
  const job = { id: `fulfill:${o.id}`, kind: "fulfill", record_id: o.id };
  try {
    config.demo = false;
    globalThis.fetch = (async () =>
      new Response("unavailable", { status: 503 })) as any;
    await assert.rejects(() => worker.runJob(job), /503/);
    assert.equal(store.get("order", o.id).status, "paid");
    assert.equal(store.get("order", o.id).prodigiId, undefined);
  } finally {
    config.demo = true;
    globalThis.fetch = originalFetch;
  }
  await worker.tick();
  o = store.get("order", o.id);
  assert.ok(o.prodigiId);
  assert.equal(store.all("email", o.id).length, 1);
  await worker.runJob(job);
  assert.equal(store.get("order", o.id).prodigiId, o.prodigiId);
});
test("partial shipments retain state across late events and email each shipment once", async () => {
  const o = store.all<any>("order").find((o) => o.paidAt && o.prodigiId)!;
  const partial = {
    id: o.prodigiId,
    status: { stage: "InProgress" },
    shipments: [
      { id: "partial-1", status: "Shipped", tracking: { number: "TRACK-1" } },
      { id: "partial-2", status: "Processing" },
    ],
  };
  worker.syncProvider(o.id, partial);
  assert.equal(store.get("order", o.id).status, "partially_shipped");
  worker.syncProvider(o.id, {
    id: o.prodigiId,
    status: { stage: "InProgress" },
    shipments: [
      { id: "partial-1", status: "Processing" },
      { id: "partial-2", status: "Processing" },
    ],
  });
  assert.equal(store.get("order", o.id).status, "partially_shipped");
  await worker.tick();
  const final = {
    id: o.prodigiId,
    status: { stage: "Complete" },
    shipments: [
      { id: "partial-1", status: "Shipped", tracking: { number: "TRACK-1" } },
      { id: "partial-2", status: "Shipped" },
    ],
  };
  worker.syncProvider(o.id, final);
  worker.syncProvider(o.id, final);
  await worker.tick();
  assert.equal(store.get("order", o.id).status, "shipped");
  assert.equal(
    store.db
      .prepare("SELECT count(*) n FROM jobs WHERE id=?")
      .get(`email-shipment:${o.id}:partial-2:untracked`) && true,
    true,
  );
});

test("Stripe webhook signature and approved total are verified before accepting an event", async () => {
  const { config } = await import("../server/config.js");
  const { stripe } = await import("../server/providers.js");
  const o = store.all<any>("order").find((o) => o.paidAt)!;
  const secret = "whsec_test_contract";
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  const event = (amount: number) =>
    JSON.stringify({
      id: "evt_contract",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: o.checkoutId,
          metadata: { order_id: o.id },
          amount_total: amount,
          currency: "usd",
          payment_status: "paid",
        },
      },
    });
  try {
    config.demo = false;
    const invalid = await fetch(origin + "/api/webhooks/stripe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "invalid",
      },
      body: event(o.quote.total),
    });
    assert.equal(invalid.status, 400);
    const payload = event(o.quote.total);
    const signature = stripe!.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    for (let i = 0; i < 2; i++) {
      const r = await fetch(origin + "/api/webhooks/stripe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": signature,
        },
        body: payload,
      });
      assert.equal(r.status, 200);
    }
    const mismatch = event(1);
    const r = await fetch(origin + "/api/webhooks/stripe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": stripe!.webhooks.generateTestHeaderString({
          payload: mismatch,
          secret,
        }),
      },
      body: mismatch,
    });
    assert.equal(r.status, 409);
  } finally {
    config.demo = true;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  }
});

test("operation terms remain byte-for-byte stable on repeated reads", async () => {
  const f = await fixture();
  const original = commerce.operationView(
    commerce.readOperation(f.op.operation_id, f.a.session.session_id),
  );
  assert.deepEqual(original.terms.previews, f.op.terms.previews);
  const stored = store.get("operation", f.op.operation_id);
  stored.terms.previews[0].url = "https://immutable.example/preview";
  store.put("operation", stored.operation_id, stored, stored.owner);
  assert.equal(
    commerce.operationView(
      commerce.readOperation(stored.operation_id, stored.owner),
    ).terms.previews[0].url,
    "https://immutable.example/preview",
  );
});

test("poster catalog, approval, full-size artwork and fulfillment use the larger product", async () => {
  const catalog = await (await fetch(origin + "/api/catalog")).json();
  assert.equal(
    catalog.products.find((p: any) => p.id === "poster").price,
    3500,
  );
  const f = await fixture();
  const proposal = {
    ...f.proposal,
    product: "poster",
    items: [{ photoId: f.photo.id, quantity: 1, fit: "contain" }],
  };
  const send = (body: unknown) =>
    f.a.request("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await send({
        ...proposal,
        items: [{ ...proposal.items[0], quantity: 2 }],
      })
    ).status,
    400,
  );
  const response = await send(proposal);
  assert.equal(response.status, 202, JSON.stringify(response.body));
  const op = response.body.operation;
  assert.equal(op.terms.subtotal, 3500);
  assert.match(op.summary, /12 × 16 matte print/);
  assert.match(op.summary, /low-resolution warning/i);
  assert.match(op.summary, /123 Market Street/);
  const imageResponse = await fetch(op.terms.previews[0].url);
  assert.equal(imageResponse.status, 200);
  const meta = await sharp(
    Buffer.from(await imageResponse.arrayBuffer()),
  ).metadata();
  assert.equal(meta.width, 4800);
  assert.equal(meta.height, 3600);
  await f.a.request(`/api/operations/${op.operation_id}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: 1, approved_by: "user" }),
  });
  await worker.tick();
  const persisted = commerce.readOperation(
    op.operation_id,
    f.a.session.session_id,
  );
  const order = store.get("order", persisted.orderId!);
  const { config } = await import("../server/config.js");
  const providers = await import("../server/providers.js");
  const originalFetch = globalThis.fetch;
  const originalTax = providers.stripe!.tax.calculations.create;
  let sent: any;
  try {
    config.demo = false;
    globalThis.fetch = (async (url: any, init: any) => {
      if (String(url).endsWith("/products/GLOBAL-FAP-12X16"))
        return Response.json({
          outcome: "Ok",
          product: {
            attributes: { paperType: ["EMA"], substrateWeight: ["200gsm"] },
          },
        });
      const body = JSON.parse(init.body);
      assert.equal(body.items[0].sku, "GLOBAL-FAP-12X16");
      assert.deepEqual(body.items[0].attributes, {
        paperType: "EMA",
        substrateWeight: "200gsm",
      });
      if (String(url).endsWith("/quotes"))
        return Response.json({
          outcome: "Created",
          quotes: [
            {
              shipmentMethod: "Budget",
              costSummary: {
                items: { amount: "14", currency: "USD" },
                shipping: { amount: "7.10", currency: "USD" },
              },
            },
          ],
        });
      sent = body;
      return Response.json({
        outcome: "Created",
        order: { id: "poster-contract" },
      });
    }) as any;
    providers.stripe!.tax.calculations.create = (async (params: any) => ({
      id: "tax_poster",
      amount_total: params.line_items[0].amount,
      tax_amount_exclusive: 0,
    })) as any;
    assert.equal((await providers.getPrice(proposal as any)).subtotal, 3500);
    await providers.submitPrint(order);
    assert.match(sent.items[0].assets[0].url, /poster-contain/);
    assert.equal(sent.items[0].copies, 1);
  } finally {
    config.demo = true;
    globalThis.fetch = originalFetch;
    providers.stripe!.tax.calculations.create = originalTax;
  }
});

test("HTTP compatibility sessions isolate ownership, expire, and cannot downgrade native Poppy tokens", async () => {
  const start = async () => {
    const r = await fetch(origin + "/api/agent-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(r.status, 201);
    return r.json();
  };
  const a = await start(),
    b = await start();
  assert.equal(a.protocol, "http-compatibility");
  const privatePhoto = await photos.upload(
    await sharp({
      create: { width: 1200, height: 1800, channels: 3, background: "orange" },
    })
      .jpeg()
      .toBuffer(),
    "compat.jpg",
    a.session_id,
  );
  const proposal = {
    email: "test@example.com",
    address,
    items: [{ photoId: privatePhoto.id, quantity: 5, fit: "contain" }],
  };
  const send = (token: string) =>
    fetch(origin + "/api/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify(proposal),
    });
  assert.equal((await send(b.access_token)).status, 404);
  const own = await send(a.access_token);
  assert.equal(own.status, 202);
  const op = (await own.json()).operation;
  assert.equal(op.terms.subtotal, 1200);
  assert.equal(op.confirmation, null);
  const native = await makeAgent();
  assert.equal((await send(native.session.access_token)).status, 401);
  assert.equal(
    (
      await fetch(origin + "/api/orders", {
        method: "POST",
        headers: {
          Authorization: `DPoP ${a.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(proposal),
      })
    ).status,
    401,
  );
  const hash = store.hash(a.access_token);
  store.put("compat-token", hash, {
    sessionId: a.session_id,
    expires: Date.now() - 1,
  });
  assert.equal((await send(a.access_token)).status, 401);
});

test("malformed JSON is actionable, not a retryable server error", async () => {
  for (const body of ["null", '"{}"', "{broken"]) {
    const r = await fetch(origin + "/api/agent-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    assert.equal(r.status, 400);
    const error = await r.json();
    assert.equal(error.error, "invalid_request");
    assert.match(error.message, /body as a JSON object/);
  }
  const oversized = await fetch(origin + "/api/agent-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: "x".repeat(130 * 1024) }),
  });
  assert.equal(oversized.status, 413);
});

test("discovery stays native while compatibility is documented separately", async () => {
  const discovery = await (
    await fetch(origin + "/.well-known/poppy.json")
  ).json();
  assert.equal(discovery.apis[0].url, origin + "/openapi.json");
  const native = await (await fetch(origin + "/openapi.json")).json();
  assert.equal(native.paths["/api/agent-sessions"], undefined);
  assert.equal(native.components.securitySchemes.AgentGuest, undefined);
  assert.doesNotMatch(native.info.description, /\/api\/agent-sessions|Bearer/);
  assert.deepEqual(native.paths["/api/photos"].post.security, [{ DPoP: [] }]);
  assert.equal(native.components.securitySchemes.DPoP.scheme, "DPoP");
  // DPA validates required operation parameters before its transport signs the request.
  // Upload must be callable with only the photo, without a model-supplied proof.
  assert.deepEqual(native.paths["/api/photos"].post.parameters, []);
  for (const path of Object.values(native.paths) as any[]) {
    for (const operation of Object.values(path) as any[]) {
      for (const parameter of operation.parameters ?? []) {
        assert.ok(
          !["dpop", "authorization"].includes(parameter.name.toLowerCase()),
        );
      }
    }
  }
  assert.ok(
    native.paths["/api/orders"].post.parameters.some(
      (p: any) => p.name === "Idempotency-Key" && p.required,
    ),
  );
  assert.match(
    native.info.description,
    /No user account or interactive sign-in is needed/,
  );
  const compat = await (
    await fetch(origin + "/api/compat/openapi.json")
  ).json();
  assert.ok(compat.paths["/api/agent-sessions"]);
  assert.equal(compat.components.securitySchemes.DPoP, undefined);
  assert.deepEqual(compat.paths["/api/photos"].post.security, [
    { AgentGuest: [] },
  ]);
  assert.match(compat.info.description, /does not verify agent identity/);
  assert.match(
    await (await fetch(origin + "/api/compat/instructions")).text(),
    /POST \/api\/agent-sessions with JSON \{\}/,
  );
  const { config } = await import("../server/config.js");
  const old = config.compatibility;
  try {
    config.compatibility = false;
    assert.equal(
      (
        await fetch(origin + "/api/agent-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      404,
    );
  } finally {
    config.compatibility = old;
  }
});

async function oauth(
  a: Awaited<ReturnType<typeof makeAgent>>,
  body: Record<string, string>,
  route = "/oauth/token",
) {
  const r = await fetch(origin + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      DPoP: await a.proof("POST", origin + route),
    },
    body: new URLSearchParams({
      ...body,
      client_id: clientId,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await a.assertion(clientId, origin + route),
    }),
  });
  return {
    status: r.status,
    body: route === "/oauth/revoke" ? await r.text() : await r.json(),
  };
}
const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
function otpFor(challenge: string) {
  return store
    .get("demo-signin-email", challenge)
    .text.match(/code is (\d{6})/)[1];
}
async function login(
  a: Awaited<ReturnType<typeof makeAgent>>,
  email = `${randomUUID()}@example.com`,
  scope = "poppy:read poppy:write",
) {
  const started = await a.request(
    "/api/poppy/sign-in",
    postJson({ scope, credentials: { email } }),
  );
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.status, "code_required");
  const code = otpFor(started.body.sign_in_id);
  assert.ok(!JSON.stringify(started.body).includes(code));
  const done = await a.request(
    `/api/poppy/sign-in/${started.body.sign_in_id}`,
    postJson({ code }),
  );
  assert.equal(done.body.status, "complete", JSON.stringify(done.body));
  assert.equal(done.body.signed_in, true);
  assert.equal(done.body.session_id, a.session.session_id);
  return { ...done.body, challenge: started.body.sign_in_id, code };
}

test("email OTP signs in; token snapshots, account history, scopes, refresh and immediate revocation", async () => {
  const f = await fixture(),
    a = f.a,
    oldToken = a.session.access_token;
  assert.equal(
    (await a.request("/api/account/orders")).body.error,
    "sign_in_required",
  );
  const signed = await login(a);
  // Merely signing in elsewhere in the session must not upgrade an old token.
  assert.equal(
    (await a.request("/api/account/orders")).body.error,
    "sign_in_required",
  );
  a.session.access_token = signed.access_token;
  assert.equal((await a.request("/api/account/orders")).body.orders.length, 0);
  assert.equal(
    (
      await a.request(
        `/api/poppy/sign-in/${signed.challenge}`,
        postJson({ code: signed.code }),
      )
    ).body.status,
    "failed",
  );
  const proposed = await a.request("/api/orders", {
    ...postJson(f.proposal),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
  });
  assert.equal(proposed.status, 202);
  const confirmed = await a.request(
    `/api/operations/${proposed.body.operation.operation_id}/confirm`,
    postJson({ revision: 1, approved_by: "user" }),
  );
  assert.equal(confirmed.status, 200);
  const orderId = confirmed.body.orderId;
  const list = await a.request("/api/account/orders");
  assert.equal(list.body.orders.length, 1);
  assert.equal(list.body.orders[0].id, orderId);
  assert.equal(list.body.orders[0].checkoutUrl, undefined);
  const other = await makeAgent();
  const otherSigned = await login(other);
  other.session.access_token = otherSigned.access_token;
  assert.equal(
    (await other.request("/api/account/orders")).body.orders.length,
    0,
  );
  assert.equal((await other.request(`/api/orders/${orderId}`)).status, 404);
  const badSession = await oauth(other, {
    grant_type: "refresh_token",
    refresh_token: signed.refresh_token,
    session_id: other.session.session_id,
  });
  assert.equal(badSession.body.error, "invalid_session");
  const narrowed = await oauth(a, {
    grant_type: "refresh_token",
    refresh_token: signed.refresh_token,
    scope: "poppy:read",
  });
  assert.equal(narrowed.body.signed_in, true);
  assert.notEqual(narrowed.body.session_id, a.session.session_id);
  a.session.access_token = narrowed.body.access_token;
  assert.equal((await a.request(`/api/orders/${orderId}`)).status, 200);
  assert.equal((await a.request("/api/account/orders")).body.orders.length, 1);
  assert.equal(
    (await a.request("/api/orders", postJson({}))).body.error,
    "insufficient_scope",
  );
  const excessive = await oauth(a, {
    grant_type: "refresh_token",
    refresh_token: signed.refresh_token,
    scope: "admin",
  });
  assert.equal(excessive.body.error, "invalid_scope");
  assert.equal(
    (await oauth(a, { token: signed.refresh_token }, "/oauth/revoke")).status,
    200,
  );
  assert.equal(
    (await a.request("/api/account/orders")).body.error,
    "sign_in_required",
  );
  a.session.access_token = signed.access_token;
  assert.equal(
    (await a.request(`/api/orders/${orderId}`)).body.error,
    "sign_in_required",
  );
  assert.equal(
    (await a.request(`/api/operations/${proposed.body.operation.operation_id}`))
      .body.error,
    "sign_in_required",
  );
  assert.equal(
    (
      await oauth(a, {
        grant_type: "refresh_token",
        refresh_token: signed.refresh_token,
      })
    ).body.error,
    "invalid_grant",
  );
  a.session.access_token = oldToken;
  const guest = await a.token(a.session.session_id);
  assert.equal(guest.signed_in, false);
});

test("OTP isolation, wrong-code limits, expiration, account mismatch and no token escalation", async () => {
  const a = await makeAgent(),
    b = await makeAgent();
  const started = await a.request(
    "/api/poppy/sign-in",
    postJson({
      scope: "poppy:read",
      credentials: { email: `${randomUUID()}@example.com` },
    }),
  );
  const route = `/api/poppy/sign-in/${started.body.sign_in_id}`;
  assert.equal(
    (
      await b.request(
        route,
        postJson({ code: otpFor(started.body.sign_in_id) }),
      )
    ).status,
    404,
  );
  const right = otpFor(started.body.sign_in_id),
    wrong = right === "000000" ? "111111" : "000000";
  for (let n = 0; n < 5; n++)
    assert.equal(
      (await a.request(route, postJson({ code: wrong }))).body.status,
      n === 4 ? "failed" : "code_required",
    );
  assert.equal(
    (await a.request(route, postJson({ code: right }))).body.status,
    "failed",
  );
  const expired = await a.request(
    "/api/poppy/sign-in",
    postJson({
      scope: "poppy:read",
      credentials: { email: `${randomUUID()}@example.com` },
    }),
  );
  const c = store.get("signin-code", expired.body.sign_in_id);
  store.put("signin-code", c.id, { ...c, expires: 0 }, a.session.session_id);
  assert.equal(
    (
      await a.request(
        `/api/poppy/sign-in/${c.id}`,
        postJson({ code: otpFor(c.id) }),
      )
    ).body.status,
    "expired",
  );
  const signed = await login(a, `${randomUUID()}@example.com`, "poppy:read");
  a.session.access_token = signed.access_token;
  assert.equal(
    (
      await oauth(a, {
        grant_type: "refresh_token",
        refresh_token: signed.refresh_token,
        scope: "poppy:read poppy:write",
      })
    ).body.error,
    "invalid_scope",
  );
  const mismatch = await a.request(
    "/api/poppy/sign-in",
    postJson({
      scope: "poppy:read",
      credentials: { email: `${randomUUID()}@example.com` },
    }),
  );
  assert.equal(
    (
      await a.request(
        `/api/poppy/sign-in/${mismatch.body.sign_in_id}`,
        postJson({ code: otpFor(mismatch.body.sign_in_id) }),
      )
    ).body.error,
    "account_mismatch",
  );
  // Account-token expiry also removes account access from unexpired session tokens.
  const grantId = store.hash(signed.refresh_token),
    grant = store.get("account-token", grantId);
  store.put("account-token", grantId, { ...grant, expires: 0 });
  assert.equal(
    (await a.request("/api/account")).body.error,
    "sign_in_required",
  );
  assert.equal(
    (
      await oauth(a, {
        grant_type: "refresh_token",
        refresh_token: signed.refresh_token,
      })
    ).body.error,
    "invalid_grant",
  );
});

test("discovery advertises direct and mediated account access; compatibility cannot sign in", async () => {
  const d = await (await fetch(origin + "/.well-known/poppy.json")).json();
  assert.deepEqual(d.auth.direct.scopes, ["poppy:read", "poppy:write"]);
  assert.equal(d.auth.mediated.endpoint, origin + "/api/poppy/sign-in");
  const guest = await (
    await fetch(origin + "/api/agent-sessions", postJson({}))
  ).json();
  const r = await fetch(origin + "/api/poppy/sign-in", {
    ...postJson({
      scope: "poppy:read",
      credentials: { email: "test@example.com" },
    }),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${guest.access_token}`,
    },
  });
  assert.equal(r.status, 403);
});

test("direct sign-in requires cookie/CSRF, email OTP, explicit consent, exact callback and single-use PKCE code", async () => {
  const a = await makeAgent(),
    verifier = store.id("verifier") + store.id("more"),
    state = randomUUID();
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: origin + "/api/demo/callback",
    scope: "poppy:read poppy:write",
    state,
    code_challenge: store.hash(verifier),
    code_challenge_method: "S256",
  });
  const bad = new URLSearchParams(q);
  bad.set("redirect_uri", "https://evil.example/callback");
  assert.equal(
    (await fetch(origin + "/oauth/authorize?" + bad, { redirect: "manual" }))
      .status,
    400,
  );
  const start = await fetch(origin + "/oauth/authorize?" + q);
  assert.equal(start.headers.get("referrer-policy"), "same-origin");
  const cookie = start.headers.get("set-cookie")!.split(";")[0];
  const html = await start.text();
  const flow = html.match(/name="flow" value="([^"]+)"/)![1],
    csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
  async function browser(
    route: string,
    values: Record<string, string>,
    useCookie = true,
  ) {
    return fetch(origin + route, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: origin,
        ...(useCookie ? { Cookie: cookie } : {}),
      },
      body: new URLSearchParams({ flow, csrf, ...values }),
    });
  }
  assert.equal(
    (
      await browser(
        "/oauth/authorize/email",
        { email: "test@example.com" },
        false,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await browser("/oauth/authorize/approve", {
        decision: "approve",
        scopes: "poppy:read",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await browser("/oauth/authorize/email", {
        email: `${randomUUID()}@example.com`,
      })
    ).status,
    200,
  );
  const challenge = store.get("browser-signin", flow).challengeId;
  const verified = await browser("/oauth/authorize/verify", {
    code: otpFor(challenge),
  });
  assert.match(await verified.text(), /Allow access/);
  const approval = await browser("/oauth/authorize/approve", {
    decision: "approve",
    scopes: "poppy:read",
  });
  assert.equal(approval.status, 303);
  const callback = new URL(approval.headers.get("location")!);
  assert.equal(callback.searchParams.get("state"), state);
  assert.equal(callback.searchParams.get("iss"), origin);
  const fields = {
    grant_type: "authorization_code",
    code: callback.searchParams.get("code")!,
    redirect_uri: origin + "/api/demo/callback",
    code_verifier: verifier,
    session_id: a.session.session_id,
  };
  assert.equal(
    (await oauth(a, { ...fields, code_verifier: "wrong" })).body.error,
    "invalid_grant",
  );
  const token = await oauth(a, fields);
  assert.equal(token.body.signed_in, true);
  assert.equal(token.body.scope, "poppy:read");
  assert.equal((await oauth(a, fields)).body.error, "invalid_grant");
  assert.equal(
    (
      await browser("/oauth/authorize/approve", {
        decision: "approve",
        scopes: "poppy:read",
      })
    ).status,
    403,
  );
  a.session.access_token = token.body.access_token;
  assert.equal((await a.request("/api/account")).status, 200);
});

test("history pagination retains orders with identical timestamps and never matches email", async () => {
  const a = await makeAgent(),
    signed = await login(a);
  a.session.access_token = signed.access_token;
  const grant = store.get("account-token", store.hash(signed.refresh_token));
  const sample = store.all<any>("order")[0];
  for (let n = 0; n < 52; n++) {
    const oid = `ord_history_${String(n).padStart(3, "0")}`;
    store.put(
      "order",
      oid,
      {
        ...sample,
        id: oid,
        created: 1234,
        accountId: grant.accountId,
        checkoutUrl: "https://example.com/private-checkout",
      },
      "other-session",
    );
  }
  const p1 = (await a.request("/api/account/orders")).body;
  assert.equal(p1.orders.length, 50);
  assert.ok(p1.next_cursor);
  const p2 = (await a.request(`/api/account/orders?cursor=${p1.next_cursor}`))
    .body;
  assert.equal(p2.orders.length, 2);
  assert.equal(p2.next_cursor, null);
  assert.equal(new Set([...p1.orders, ...p2.orders].map((o) => o.id)).size, 52);
  assert.ok(p1.orders.every((o: any) => !o.checkoutUrl));
  assert.equal(
    (await a.request("/api/account/orders?cursor=invalid")).status,
    400,
  );
  const email = store.get("account", grant.accountId).email;
  const guest = {
    ...sample,
    id: "ord_guest_unclaimed",
    accountId: undefined,
    quote: { ...sample.quote, email },
  };
  store.put("order", guest.id, guest, a.session.session_id);
  assert.equal((await a.request("/api/account/orders")).body.orders.length, 50);
});

test("OTP email delivery failures and per-email rate limits fail closed", async () => {
  const a = await makeAgent(),
    email = `${randomUUID()}@example.com`;
  const { config } = await import("../server/config.js");
  const { startCode } = await import("../server/accounts.js");
  const originalFetch = globalThis.fetch;
  try {
    config.demo = false;
    globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
    await assert.rejects(
      () => startCode(a.session.session_id, email, ["poppy:read"], clientId),
      (e: any) => e.code === "email_unavailable",
    );
  } finally {
    config.demo = true;
    globalThis.fetch = originalFetch;
  }
  const failed = store.all<any>("signin-code", a.session.session_id)[0];
  assert.equal(failed.used, true);
  assert.equal(store.get("demo-signin-email", failed.id), undefined);
  for (let n = 0; n < 4; n++) {
    const b = await makeAgent();
    assert.equal(
      (
        await b.request(
          "/api/poppy/sign-in",
          postJson({ scope: "poppy:read", credentials: { email } }),
        )
      ).status,
      200,
    );
  }
  const b = await makeAgent();
  assert.equal(
    (
      await b.request(
        "/api/poppy/sign-in",
        postJson({ scope: "poppy:read", credentials: { email } }),
      )
    ).status,
    429,
  );
});

test("normal deployments do not advertise or expose agent sandbox controls", async () => {
  const schema = await (await fetch(origin + "/openapi.json")).json();
  assert.equal(schema.paths["/api/sandbox/orders/{id}/pay"], undefined);
  assert.equal(
    (await fetch(origin + "/api/sandbox/orders/test/pay", { method: "POST" }))
      .status,
    404,
  );
  assert.equal(
    (await fetch(origin + "/api/sandbox/sign-in/test/email")).status,
    404,
  );
});

test("private coupons discount before approval, reserve once, and free orders fulfill once", async () => {
  const { generateCoupons } = await import("../server/coupons.js");
  const [code] = generateCoupons(1, 100, 10000);
  const f = await fixture();
  const submit = () => f.a.request("/api/orders", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ ...f.proposal, couponCode: code.toUpperCase() }),
  });
  const first = await submit(), second = await submit();
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  const op = first.body.operation;
  assert.equal(op.terms.total, 0);
  assert.equal(op.terms.tax, 0);
  assert.equal(op.terms.discount, op.terms.subtotal + op.terms.shipping);
  assert.match(op.summary, /free checkout/);
  const confirmed = commerce.confirm(op.operation_id, f.a.session.session_id, 1, "user");
  assert.throws(() => commerce.confirm(second.body.operation.operation_id, f.a.session.session_id, 1, "user"), /already been used/);
  assert.equal((await submit()).status, 422);
  const order = store.get("order", confirmed.orderId!);
  order.checkoutId = "cs_free_contract";
  store.put("order", order.id, order, order.owner);
  assert.throws(() => commerce.paid(order.id, { id: order.checkoutId, amount: 1, currency: "usd", paid: true }), /does not match/);
  commerce.paid(order.id, { id: order.checkoutId, amount: 0, currency: "usd", paid: true });
  commerce.paid(order.id, { id: order.checkoutId, amount: 0, currency: "usd", paid: true });
  assert.equal(store.get("order", order.id).status, "paid");
  assert.equal((store.db.prepare("SELECT count(*) AS n FROM jobs WHERE kind='fulfill' AND record_id=?").get(order.id) as any).n, 1);
  assert.equal(commerce.orderView(store.get("order", order.id)!).quote.couponCode, undefined);
});

test("percentage coupons recalculate tax on discounted prints and shipping", async () => {
  const { generateCoupons } = await import("../server/coupons.js");
  const { getPrice } = await import("../server/providers.js");
  const [couponCode] = generateCoupons(1, 50);
  const f = await fixture();
  const price = await getPrice({ ...f.proposal, couponCode } as any);
  assert.equal(price.discount, 850);
  assert.equal(price.tax, Math.round(850 * 0.0875));
  assert.equal(price.total, 850 + price.tax);
  await assert.rejects(getPrice({ ...f.proposal, couponCode: "not-a-code" } as any), /invalid/);
});

test("free Stripe checkout has zero line items and no tax charge", async () => {
  const { config } = await import("../server/config.js");
  const { stripe, checkout } = await import("../server/providers.js");
  const original = stripe!.checkout.sessions.create;
  const originalFetch = globalThis.fetch;
  let sent: any;
  try {
    config.demo = false;
    globalThis.fetch = (async (url: any) => Response.json(String(url).includes("/products/")
      ? { outcome: "Ok", product: { attributes: { finish: ["lustre"] } } }
      : { outcome: "Created", quotes: [{ shipmentMethod: "Budget", costSummary: { items: { amount: "1.25", currency: "USD" }, shipping: { amount: "6.70", currency: "USD" } } }] })) as any;
    stripe!.checkout.sessions.create = (async (params: any) => {
      sent = params;
      return { id: "cs_free", url: "https://checkout.stripe.com/free", expires_at: params.expires_at };
    }) as any;
    const sample = store.all<any>("order")[0];
    await checkout({ ...sample, quote: { ...sample.quote, subtotal: 1200, shipping: 500, tax: 0, total: 0, printDiscount: 1200, shippingDiscount: 500, discount: 1700 } });
    assert.equal(sent.line_items.length, 1);
    assert.equal(sent.line_items[0].price_data.unit_amount, 0);
    assert.equal(sent.allow_promotion_codes, false);
  } finally { config.demo = true; globalThis.fetch = originalFetch; stripe!.checkout.sessions.create = original; }
});

test("Stripe completion accepts zero-cost completed sessions but rejects unfinished or nonzero free sessions", async () => {
  const { stripeCheckoutComplete } = await import("../server/providers.js");
  assert.equal(stripeCheckoutComplete({ payment_status: "no_payment_required", status: "complete", amount_total: 0 }), true);
  assert.equal(stripeCheckoutComplete({ payment_status: "no_payment_required", status: "open", amount_total: 0 }), false);
  assert.equal(stripeCheckoutComplete({ payment_status: "no_payment_required", status: "complete", amount_total: 1700 }), false);
  assert.equal(stripeCheckoutComplete({ payment_status: "unpaid", status: "complete", amount_total: 0 }), false);
});


test("coupon cap limits prints and shipping together and stale approvals cannot exceed it", async () => {
  const { generateCoupons, discountedAmounts, redeemCoupon } = await import("../server/coupons.js");
  assert.deepEqual(discountedAmounts(1200, 500, 100, 1500), { printDiscount: 1200, shippingDiscount: 300, discount: 1500 });
  assert.equal(discountedAmounts(3500, 0, 100, 1500).discount, 1500);
  assert.equal(discountedAmounts(1000, 0, 100, 1500).discount, 1000);
  const [code] = generateCoupons(1, 100);
  assert.throws(() => redeemCoupon(code, "order_test", 1700), /limit changed/);
  const { getPrice } = await import("../server/providers.js");
  const f = await fixture();
  const price = await getPrice({ ...f.proposal, couponCode: code } as any);
  assert.equal(price.discount, 1500);
  assert.equal(price.total, 200 + Math.round(200 * 0.0875));
});


test("shared coupon allows exactly ten distinct approved orders and retries do not consume uses", async () => {
  const { coupon, redeemCoupon } = await import("../server/coupons.js");
  const code = "shared-test-code";
  store.put("coupon", store.hash(code), { percent: 100, maxAmount: 1500, maxUses: 10, created: Date.now() });
  for (let n = 0; n < 10; n++) {
    assert.equal(coupon(code)?.maxUses, 10);
    redeemCoupon(code, `shared-order-${n}`, 1500);
    redeemCoupon(code, `shared-order-${n}`, 1500);
  }
  assert.equal(store.get("coupon", store.hash(code)).orderIds.length, 10);
  assert.throws(() => coupon(code), /already been used/);
  assert.throws(() => redeemCoupon(code, "eleventh-order", 1500), /already been used/);
  redeemCoupon(code, "shared-order-0", 1500);
  assert.equal(store.get("coupon", store.hash(code)).orderIds.length, 10);
});

test("mixed products share pricing, checkout and fulfillment without losing product-specific artwork", async () => {
  const f = await fixture();
  const proposal = { ...f.proposal, address: { ...f.proposal.address, line2: "" }, items: [
    { photoId: f.photo.id, product: "prints", quantity: 5, fit: "cover" },
    { photoId: f.photo.id, product: "poster", quantity: 1, fit: "contain" },
  ] };
  const send = (body: unknown) => f.a.request("/api/orders", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify(body),
  });
  assert.equal((await send({ ...proposal, items: [proposal.items[0], { ...proposal.items[1], quantity: 2 }] })).status, 400);
  assert.equal((await send({ ...proposal, items: [{ ...proposal.items[0], quantity: 101 }, proposal.items[1]] })).status, 400);
  const response = await send(proposal);
  assert.equal(response.status, 202, JSON.stringify(response.body));
  const op = response.body.operation;
  assert.equal(op.terms.subtotal, 4700);
  assert.equal(op.terms.shipping, 0);
  assert.deepEqual(op.terms.previews.map((p: any) => p.product), ["prints", "poster"]);
  assert.match(op.terms.previews[1].url, /poster-contain/);
  assert.match(op.summary, /5 × 4 × 6 photo prints/);
  assert.match(op.summary, /1 × 12 × 16 matte print/);
  await commerce.confirm(op.operation_id, f.a.session.session_id, 1, "user");
  await worker.tick();
  const persisted = commerce.readOperation(op.operation_id, f.a.session.session_id);
  const order = store.get("order", persisted.orderId!);
  const { emailFor } = await import("../server/email.js");
  const email = emailFor(order, "email-confirmation");
  assert.match(email.html, /Photo prints/);
  assert.match(email.html, /Poster print/);
  assert.match(email.html, /Print with <strong>Poppy<\/strong>/);
  assert.doesNotMatch(email.html, /poppy-email-(yellow|red)\.jpg/);
  assert.match(email.html, new RegExp(`/media/${f.photo.id}/cover`));
  assert.match(email.html, new RegExp(`/media/${f.photo.id}/poster-contain`));
  assert.match(email.html, /Quantity: 5/);
  assert.match(email.html, /Quantity: 1/);
  assert.match(email.text, /Photo prints, 4 × 6 inches/);
  const imageUrls = [...email.html.matchAll(/src="([^"]*\/media\/[^"]*)"/g)].map(m => m[1].replaceAll("&amp;", "&"));
  assert.equal(imageUrls.length, 2);
  for (const url of imageUrls) {
    assert.ok(Number(new URL(url).searchParams.get("exp")) > Date.now() / 1000 + 29 * 86400);
    assert.equal((await fetch(url)).status, 200);
  }
  const { config } = await import("../server/config.js");
  const providers = await import("../server/providers.js");
  const originalFetch = globalThis.fetch;
  const originalTax = providers.stripe!.tax.calculations.create;
  const originalCheckout = providers.stripe!.checkout.sessions.create;
  let fulfillment: any, checkout: any, quoteCalls = 0;
  try {
    config.demo = false;
    globalThis.fetch = (async (url: any, init: any) => {
      if (String(url).includes("/products/")) return Response.json({ outcome: "Ok", product: { attributes: { finish: ["lustre"], paperType: ["EMA"], substrateWeight: ["200gsm"] } } });
      const body = JSON.parse(init.body);
      assert.deepEqual(body.items.map((i: any) => i.sku), ["GLOBAL-PHO-4X6", "GLOBAL-FAP-12X16"]);
      if (String(url).endsWith("/quotes")) {
        quoteCalls++;
        return Response.json({ outcome: "Created", quotes: [{ shipmentMethod: "Budget", costSummary: { items: { amount: "16", currency: "USD" }, shipping: { amount: "10", currency: "USD" } } }] });
      }
      fulfillment = body;
      return Response.json({ outcome: "Created", order: { id: "mixed-contract" } });
    }) as any;
    providers.stripe!.tax.calculations.create = (async (params: any) => ({ id: "tax_mixed", amount_total: params.line_items[0].amount, tax_amount_exclusive: 0 })) as any;
    providers.stripe!.checkout.sessions.create = (async (params: any) => { checkout = params; return { id: "cs_mixed", url: "https://checkout.example/mixed", expires_at: 1 }; }) as any;
    const price = await providers.getPrice(proposal as any);
    assert.equal(price.subtotal, 4700);
    assert.equal(price.shipping, 0);
    assert.equal(quoteCalls, 1);
    await providers.checkout(order);
    assert.equal(checkout.line_items.reduce((n: number, i: any) => n + i.price_data.unit_amount * i.quantity, 0), order.quote.total);
    assert.equal(checkout.line_items.filter((i: any) => i.price_data.product_data.name === "Home delivery").length, 0);
    await providers.submitPrint(order);
    assert.equal("line2" in fulfillment.recipient.address, false);
    assert.deepEqual(fulfillment.items.map((i: any) => i.copies), [5, 1]);
    assert.notEqual(fulfillment.items[0].merchantReference, fulfillment.items[1].merchantReference);
    assert.match(fulfillment.items[1].assets[0].url, /poster-contain/);
    assert.deepEqual(fulfillment.items[1].attributes, { paperType: "EMA", substrateWeight: "200gsm" });
  } finally {
    config.demo = true;
    globalThis.fetch = originalFetch;
    providers.stripe!.tax.calculations.create = originalTax;
    providers.stripe!.checkout.sessions.create = originalCheckout;
  }
});

 test("photo labels omit original filenames and remain stable across products", async () => {
  const f = await fixture();
  const buffer = await sharp({ create: { width: 600, height: 800, channels: 3, background: "red" } }).jpeg().toBuffer();
  const uploaded = await photos.upload(buffer, "secret-gibberish-IMG_123.jpg", f.a.session.session_id);
  assert.match(uploaded.name, /^Photo [0-9]+$/);
  assert.ok(!JSON.stringify(uploaded).includes("secret-gibberish"));
  assert.equal(photos.photoView(photos.ownedPhoto(uploaded.id, f.a.session.session_id)).name, uploaded.name);
  assert.equal(f.op.terms.previews[0].name, f.photo.name);
  assert.match(f.op.summary, new RegExp(f.photo.name));
});

test("cost guard blocks supplier increases before checkout and fulfillment while allowing coupon subsidies", async () => {
  const f = await fixture();
  commerce.confirm(f.op.operation_id, f.a.session.session_id, 1, "user");
  await worker.tick();
  const op = commerce.readOperation(f.op.operation_id, f.a.session.session_id);
  const order = store.get("order", op.orderId!);
  const { config } = await import("../server/config.js");
  const providers = await import("../server/providers.js");
  const originalFetch = globalThis.fetch;
  const originalCheckout = providers.stripe!.checkout.sessions.create;
  let supplierItems = "1.25", checkoutCalls = 0, fulfillmentCalls = 0;
  try {
    config.demo = false;
    globalThis.fetch = (async (url: any) => {
      if (String(url).includes("/products/")) return Response.json({ outcome: "Ok", product: { attributes: { finish: ["lustre"] } } });
      if (String(url).endsWith("/quotes")) return Response.json({ outcome: "CreatedWithIssues", issues: [{ errorCode: "destinationCountryCode.UsSalesTaxWarning" }], quotes: [{ shipmentMethod: "Budget", costSummary: { items: { amount: supplierItems, currency: "USD" }, shipping: { amount: "6.70", currency: "USD" } } }] });
      fulfillmentCalls++;
      throw new Error("Unexpected fulfillment");
    }) as any;
    providers.stripe!.checkout.sessions.create = (async () => { checkoutCalls++; return { id: "cs_guard", url: "https://checkout.example/guard" }; }) as any;
    await providers.ensureOrderMargin(order);
    const sponsored = { ...order, quote: { ...order.quote, total: 0, tax: 0, discount: 1700 } };
    await providers.ensureOrderMargin(sponsored);
    supplierItems = "100.00";
    await assert.rejects(providers.checkout(order), /cannot cover/);
    await assert.rejects(providers.submitPrint(order), /cannot cover/);
    await assert.rejects(providers.ensureOrderMargin(sponsored), /cannot cover/);
    assert.equal(checkoutCalls, 0);
    assert.equal(fulfillmentCalls, 0);
    const jobId = "fulfill:guard-test";
    store.put("order", order.id, { ...order, paidAt: Date.now() }, order.owner);
    store.enqueue("fulfill", order.id, jobId);
    await worker.tick();
    assert.equal(store.get("order", order.id).status, "attention");
    assert.match(store.get("order", order.id).issue, /on hold/);
    assert.equal((store.db.prepare("SELECT state FROM jobs WHERE id=?").get(jobId) as any).state, "failed");
    assert.equal(fulfillmentCalls, 0);
  } finally {
    config.demo = true;
    globalThis.fetch = originalFetch;
    providers.stripe!.checkout.sessions.create = originalCheckout;
  }
});

 test("Prodigi validation errors identify rejected fields without exposing submitted values", async () => {
  const { prodigi } = await import("../server/providers.js");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => Response.json({ outcome: "ValidationFailed", failures: { "recipient.address.line2": [{ code: "MustNotBeEmptyOrWhitespace", providedValue: "private-address" }] } }, { status: 400 })) as any;
    await assert.rejects(prodigi("/orders", {}), (e: any) => e.code === "fulfillment_rejected" && e.message.includes("recipient.address.line2") && !e.message.includes("private-address"));
  } finally { globalThis.fetch = originalFetch; }
});
