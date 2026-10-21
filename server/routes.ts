import { shirtMediaVariants } from "../src/offer.js";
import { samplePhotos, addSamplePhoto } from "./sample-photos.js";
import type express from "express";
import { media } from "./media-runtime.js";
import { catalog, offer } from "../src/offer.js";
import { ZodError, z } from "zod";
import { generateKeyPair, exportJWK } from "jose";
import { config } from "./config.js";
import {
  db,
  get,
  put,
  all,
  id,
  sign,
  equal,
  requireRecord,
  enqueue,
  once,
  HttpError,
} from "./store.js";
import {
  authenticate,
  issueToken,
  client,
  verifyAssertion,
  compatibilitySession,
} from "./auth.js";
import { upload } from "./photos.js";
import {
  propose,
  confirm,
  cancel,
  authorizedOperation,
  operationView,
  orderView,
  paid,
  approveShirtPreviews,
} from "./commerce.js";
import { stripe, stripeCheckoutComplete, stripeReceipt } from "./providers.js";
import { tick, housekeeping, syncProvider } from "./worker.js";
import { openapi, agentInstructions } from "./openapi.js";
import type { Session, Order } from "./types.js";
import { sandboxRoutes, sandboxDescription } from "./sandbox.js";
import { accountRoutes } from "./signin.js";
import { accountScopes, requireAccount, revokeAccount } from "./accounts.js";
export async function registerRoutes(
  app: express.Express,
  uploadMiddleware: express.RequestHandler,
  compatLimiter: express.RequestHandler,
  webhookLimiter: express.RequestHandler,
) {
  app.post("/api/agent-sessions", compatLimiter, (req, res) => {
    if (!config.compatibility)
      throw new HttpError(
        404,
        "not_available",
        "Guest compatibility is not enabled.",
      );
    z.object({})
      .strict()
      .parse(req.body || {});
    res.status(201).json(compatibilitySession());
  });
  app.get("/api/catalog", (_req, res) =>
    res.json({
      products: catalog,
      httpOrderingEnabled: config.compatibility,
      samplePhotos,
      currency: "USD",
      shippingIncluded: true,
      shipping: {
        flatRate: offer.shippingCents,
        included: true,
      },
      country: "US",
      tax: "Added before approval",
      deliveryEstimate: offer.delivery,
      oneProductPerOrder: false,
      smallPrintBundle: {
        products: ["prints", "square"],
        minimumPrice: 1200,
        includedQuantity: 5,
        additionalPrintPrice: 50,
      },
      mixedPhotoSaving: {
        products: ["small-prints", "enlargement"],
        amount: 500,
        appliesOncePerOrder: true,
        description:
          "Combine small prints and 8×10s to save $5 on shared delivery; already included in the quote subtotal.",
      },
      maxPhotoPrints: 100,
      mode: config.APP_MODE,
      environment: config.agentSandbox ? "agent-sandbox" : config.APP_MODE,
      sandboxEmailDelivery: config.agentSandbox && config.sandboxEmailDelivery,
    }),
  );
  app.get("/api/config", (_req, res) =>
    res.json({
      httpOrderingEnabled: config.compatibility,
      mode: config.APP_MODE,
      environment: config.agentSandbox ? "agent-sandbox" : config.APP_MODE,
      sandboxEmailDelivery: config.agentSandbox && config.sandboxEmailDelivery,
      origin: config.origin,
      support: config.support,
    }),
  );
  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ ok: true, mode: config.APP_MODE });
  });
  app.get("/.well-known/poppy.json", (_req, res) =>
    res.json({
      protocol_version: "0.2",
      organization: {
        name: config.agentSandbox
          ? "Print with Poppy — Agent Sandbox"
          : "Print with Poppy",
        domain: new URL(config.origin).hostname,
      },
      auth: {
        issuer: config.origin,
        ...(config.agentSandbox ? {} : { direct: { scopes: accountScopes } }),
        mediated: {
          endpoint: `${config.origin}/api/poppy/sign-in`,
          fields: [{ name: "email", label: "Email", secret: false }],
          scopes: accountScopes,
        },
      },
      apis: [
        {
          type: "openapi",
          url: `${config.origin}/openapi.json`,
          description: config.agentSandbox
            ? sandboxDescription
            : `Live store: browse the catalog, upload photos, approve home-delivered prints, pay by card and track orders. ${config.compatibility ? "Agents without native Poppy session support should read /api/compat/instructions for the separate HTTP compatibility API; no private signing key is required." : "Native Personal Agent Protocol sessions are required. HTTP compatibility ordering is disabled; do not fall back to Bearer sessions."}`,
        },
      ],
      extensions: {
        operations: {
          version: "1",
          endpoint: `${config.origin}/api/operations`,
        },
      },
    }),
  );
  app.get("/.well-known/oauth-authorization-server", (_req, res) =>
    res.json({
      issuer: config.origin,
      token_endpoint: `${config.origin}/oauth/token`,
      revocation_endpoint: `${config.origin}/oauth/revoke`,
      poppy_domains: [new URL(config.origin).hostname],
      authorization_endpoint: `${config.origin}/oauth/authorize`,
      grant_types_supported: [
        "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "authorization_code",
        "refresh_token",
      ],
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: accountScopes,
      token_endpoint_auth_methods_supported: ["private_key_jwt"],
      dpop_signing_alg_values_supported: ["ES256", "RS256", "EdDSA"],
    }),
  );
  app.get("/api/compat/openapi.json", (_req, res) => {
    if (!config.compatibility)
      throw new HttpError(
        404,
        "compatibility_disabled",
        "HTTP compatibility ordering is disabled. Use /.well-known/poppy.json for native Poppy sessions.",
      );
    res.json(openapi(true));
  });
  app.get("/api/compat/instructions", (_req, res) =>
    res.type("text/plain").send(agentInstructions(true)),
  );
  app.get("/openapi.json", (_req, res) => res.json(openapi()));
  app.get("/agent.txt", (_req, res) =>
    res.type("text/plain").send(agentInstructions()),
  );
  app.post("/oauth/token", async (req, res) => res.json(await issueToken(req)));
  app.post("/oauth/revoke", async (req, res) => {
    const body = req.body || {};
    if (
      body.client_assertion_type !==
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
    )
      throw new HttpError(
        401,
        "invalid_client",
        "A signed client assertion is required.",
      );
    const c = await client(body.client_id);
    let assertion;
    try {
      assertion = await verifyAssertion(
        body.client_assertion,
        c.keys,
        body.client_id,
        config.origin,
      );
      once(
        `assertion:${body.client_id}:${assertion.jti}`,
        assertion.exp! * 1000 + 5000,
      );
    } catch {
      throw new HttpError(
        401,
        "invalid_client",
        "Invalid client assertion for revocation.",
      );
    }
    revokeAccount(body.token, body.client_id);
    res.sendStatus(200);
  });
  accountRoutes(app);
  app.get("/media/:id/:fit", async (req, res) => {
    const photoId = String(req.params.id),
      fit = String(req.params.fit),
      exp = String(req.query.exp),
      sig = String(req.query.sig || "");
    if (
      !/^photo_[A-Za-z0-9_-]+$/.test(photoId) ||
      ![
        ...shirtMediaVariants,
        "contain",
        "cover",
        "poster-contain",
        "poster-cover",
        "square-contain",
        "square-cover",
        "enlargement-contain",
        "enlargement-cover",
        "mug-cover",
        "mug-contain",
      ].includes(fit) ||
      !/^\d+$/.test(exp) ||
      Number(exp) < Date.now() / 1000 ||
      !equal(sig, sign(`${photoId}:${fit}:${exp}`))
    )
      throw new HttpError(403, "invalid_link", "Preview link has expired.");
    const file = await media.read(
      photoId,
      `${fit}.${/^tshirt-(contain|cover)$/.test(fit) ? "png" : "jpg"}`,
    );
    if (!file)
      throw new HttpError(410, "photo_expired", "This photo has been deleted.");
    res
      .type(/^tshirt-(contain|cover)$/.test(fit) ? "image/png" : "image/jpeg")
      .send(file);
  });
  app.post("/api/webhooks/prodigi", webhookLimiter, (req, res) => {
    const providerId =
      req.body?.subject || req.body?.data?.order?.id || req.body?.data?.id;
    if (typeof providerId === "string") {
      const order = all<Order>("order").find((o) => o.prodigiId === providerId);
      if (order)
        enqueue(
          "sync",
          order.id,
          `callback:${order.id}:${Math.floor(Date.now() / 60000)}`,
        );
    }
    // Untrusted callbacks never directly change state; workers retrieve the known order from Prodigi.
    res.sendStatus(202);
    void tick();
  });
  app.get("/api/order-view/:id/receipt", async (req, res) => {
    const o = requireRecord<Order>("order", String(req.params.id));
    if (!equal(req.get("X-Order-Token") || "", o.viewToken))
      throw new HttpError(404, "not_found", "Order not found.");
    res.set("Cache-Control", "no-store");
    res.json({ url: await stripeReceipt(o) });
  });
  app.get("/api/order-view/:id", (req, res) => {
    const o = requireRecord<Order>("order", String(req.params.id));
    if (!equal(req.get("X-Order-Token") || "", o.viewToken))
      throw new HttpError(404, "not_found", "Order not found.");
    if (
      !config.demo &&
      o.checkoutId &&
      !o.paidAt &&
      o.status === "awaiting_payment"
    ) {
      enqueue(
        "payment-sync",
        o.id,
        `payment-sync:${o.id}:${Math.floor(Date.now() / 60000)}:view`,
      );
      void tick();
    }
    res.json({
      ...orderView(o),
      emails: config.demo
        ? all<any>("email", o.id).map((e) => ({
            subject: e.subject,
            html: e.html,
            text: e.text,
          }))
        : undefined,
    });
  });
  if (config.demo) {
    let key = get("demo-key", "identity");
    if (!key) {
      const pair = await generateKeyPair("ES256", { extractable: true });
      key = {
        public: await exportJWK(pair.publicKey),
        private: await exportJWK(pair.privateKey),
      };
      key.public.kid = "demo";
      key.private.kid = "demo";
      put("demo-key", "identity", key);
    }
    app.get("/api/demo/agent.json", (_req, res) =>
      res.json({
        client_id: `${config.origin}/api/demo/agent.json`,
        jwks_uri: `${config.origin}/api/demo/jwks.json`,
        token_endpoint_auth_method: "private_key_jwt",
        extensions: { operations: { version: "1" } },
      }),
    );
    app.get("/api/demo/jwks.json", (_req, res) =>
      res.json({ keys: [key.public] }),
    );
    app.post("/api/demo/session", (_req, res) => {
      if (config.agentSandbox)
        throw new HttpError(
          404,
          "not_found",
          "Use a signed native Poppy session.",
        );
      const s: Session = {
        id: id("ses"),
        clientId: "local-demo",
        userId: id("usr"),
        extensions: true,
        demo: true,
        created: Date.now(),
      };
      put("session", s.id, s);
      res.json({ token: s.id });
    });
    app.post("/api/demo/pay/:id", (req, res) => {
      const o = requireRecord<Order>("order", String(req.params.id));
      if (!equal(req.get("X-Order-Token") || "", o.viewToken))
        throw new HttpError(404, "not_found", "Not found.");
      if (!o.checkoutId)
        throw new HttpError(
          409,
          "checkout_pending",
          "Checkout is still being prepared.",
        );
      if (o.checkoutExpires! * 1000 < Date.now())
        throw new HttpError(
          409,
          "checkout_expired",
          "Checkout expired. Request a new quote.",
        );
      paid(o.id, {
        id: o.checkoutId,
        amount: o.quote.total,
        currency: "usd",
        paid: true,
      });
      res.json({ ok: true });
      void tick();
    });
    app.post("/api/demo/ship/:id", (req, res) => {
      const o = requireRecord<Order>("order", String(req.params.id));
      if (!equal(req.get("X-Order-Token") || "", o.viewToken) || !o.prodigiId)
        throw new HttpError(
          409,
          "not_ready",
          "Demo order must be paid and submitted first.",
        );
      syncProvider(o.id, {
        id: o.prodigiId,
        status: { stage: "Complete" },
        shipments: [
          {
            id: "demo_shipment",
            status: "Shipped",
            dispatchDate: new Date().toISOString(),
            carrier: { name: "Demo carrier" },
            tracking: { number: "DEMO-TRACKING-001" },
          },
        ],
      });
      res.json({ ok: true });
      void tick();
    });
  }
  app.use(
    [
      "/api/photos",
      "/api/orders",
      "/api/operations",
      "/api/shirt-preview-approvals",
    ],
    async (req, res, next) => {
      res.locals.session = await authenticate(req);
      next();
    },
  );
  app.post("/api/photos/samples", async (req, res) => {
    res.status(201).json(await addSamplePhoto(req.body, res.locals.session.id));
  });
  app.post("/api/photos", uploadMiddleware, async (req, res) => {
    if (!req.file)
      throw new HttpError(400, "photo_required", "Attach a photo.");
    res
      .status(201)
      .json(
        await upload(
          req.file.buffer,
          req.file.originalname,
          res.locals.session.id,
        ),
      );
  });
  app.post("/api/orders", async (req, res) =>
    res.status(202).json({
      operation: operationView(
        await propose(
          req.body,
          res.locals.session,
          req.get("Idempotency-Key") || "",
        ),
      ),
    }),
  );
  app.get("/api/operations/:id", (req, res) => {
    const op = authorizedOperation(String(req.params.id), res.locals.session);
    if (op.state === "in_progress") res.set("Retry-After", "2");
    const view = operationView(op);
    if (
      op.terms.accountId &&
      !res.locals.session.scopes?.includes("poppy:write") &&
      view.result?.data
    )
      view.result = {
        ...view.result,
        data: { order_id: view.result.data.order_id },
      };
    res.json(view);
  });
  const approveShirtPreviewRoute: express.RequestHandler = (req, res) => {
    const b = z
      .object({
        revision: z.number().int(),
        previewIds: z.array(z.string()).min(1).max(102),
        approved_by: z.literal("user"),
      })
      .strict()
      .parse(req.body);
    const pending = authorizedOperation(
      String(req.params.id),
      res.locals.session,
      "poppy:write",
    );
    res.json(
      operationView(
        approveShirtPreviews(
          String(req.params.id),
          pending.owner,
          b.revision,
          b.previewIds,
          b.approved_by,
        ),
      ),
    );
  };
  // Keep the old URL for existing clients; advertise outside the reserved protocol namespace.
  app.post("/api/operations/:id/shirt-previews", approveShirtPreviewRoute);
  app.post("/api/shirt-preview-approvals/:id", approveShirtPreviewRoute);
  app.post("/api/operations/:id/confirm", (req, res) => {
    const b = z
      .object({ revision: z.number().int(), approved_by: z.string() })
      .strict()
      .parse(req.body);
    const pending = authorizedOperation(
      String(req.params.id),
      res.locals.session,
      "poppy:write",
    );
    const op = confirm(
      String(req.params.id),
      pending.owner,
      b.revision,
      b.approved_by,
    );
    if (op.state === "in_progress") res.set("Retry-After", "2");
    res.json(operationView(op));
    void tick();
  });
  app.post("/api/operations/:id/cancel", (req, res) => {
    const op = authorizedOperation(
      String(req.params.id),
      res.locals.session,
      "poppy:write",
    );
    res.json(operationView(cancel(String(req.params.id), op.owner)));
  });
  app.get("/api/orders/:id", (req, res) => {
    const session: Session = res.locals.session;
    const order = requireRecord<Order>("order", String(req.params.id));
    if (order.accountId) {
      if (requireAccount(session) !== order.accountId)
        throw new HttpError(404, "not_found", "Not found.");
    } else if (order.owner !== session.id)
      throw new HttpError(404, "not_found", "Not found.");
    const view = orderView(order);
    if (order.accountId && !session.scopes?.includes("poppy:write"))
      view.checkoutUrl = undefined;
    res.json(view);
  });
  sandboxRoutes(app);
}
