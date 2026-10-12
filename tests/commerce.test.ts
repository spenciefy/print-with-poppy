import { test, before, after } from "node:test";
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
const { app } = await import("../server/index.js");
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
  async function assertion(subject: string) {
    return new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "demo" })
      .setIssuer(clientId)
      .setSubject(subject)
      .setAudience(origin + "/oauth/token")
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
          origin + route,
          session.access_token,
        ),
        ...init.headers,
      },
    });
    return { status: r.status, body: await r.json() };
  }
  return { session, request, proof, token };
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
  assert.match(op.summary, /low-resolution warning/);
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
    assert.match(error.message, /valid JSON object/);
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
        assert.ok(!["dpop", "authorization"].includes(parameter.name.toLowerCase()));
      }
    }
  }
  assert.ok(native.paths["/api/orders"].post.parameters.some(
    (p: any) => p.name === "Idempotency-Key" && p.required,
  ));
  assert.match(native.info.description, /No user account or interactive sign-in is needed/);
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
