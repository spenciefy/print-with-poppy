import express from "express";
import { catalog, offer } from "../src/offer.js";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
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
  readOperation,
  operationView,
  orderView,
  paid,
} from "./commerce.js";
import { stripe, stripeCheckoutComplete } from "./providers.js";
import { tick, housekeeping, syncProvider } from "./worker.js";
import { openapi, agentInstructions } from "./openapi.js";
import type { Session, Order } from "./types.js";
import { sandboxRoutes, sandboxDescription } from "./sandbox.js";
import { accountRoutes } from "./signin.js";
import { accountScopes, requireAccount, revokeAccount } from "./accounts.js";
export const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "blob:", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        scriptSrc: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.origin.startsWith("https:") ? [] : null,
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginEmbedderPolicy: false,
  }),
);
export const limiter = rateLimit({
  windowMs: 60000,
  limit: 180,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
app.use("/api", limiter);
export const oauthLimiter = rateLimit({ windowMs: 60000, limit: 30 });
app.use("/oauth", oauthLimiter);
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    if (config.demo || !stripe)
      throw new HttpError(
        503,
        "not_configured",
        "Stripe is disabled in demo mode.",
      );
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.get("stripe-signature") || "",
        process.env.STRIPE_WEBHOOK_SECRET!,
      );
    } catch {
      throw new HttpError(
        400,
        "invalid_signature",
        "Webhook signature invalid.",
      );
    }
    if (
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ].includes(event.type)
    ) {
      const s = event.data.object as any;
      if (s.metadata?.order_id)
        paid(s.metadata.order_id, {
          id: s.id,
          amount: s.amount_total,
          currency: s.currency,
          paid: stripeCheckoutComplete(s),
        });
    }
    res.json({ received: true });
    void tick();
  },
);
app.use(express.json({ limit: "128kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use((req, res, next) => {
  if (
    req.path.startsWith("/api") ||
    req.path.startsWith("/oauth") ||
    req.path.startsWith("/media")
  )
    res.set("Cache-Control", "no-store");
  next();
});
app.post(
  "/api/agent-sessions",
  rateLimit({ windowMs: 3600000, limit: 10 }),
  (req, res) => {
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
  },
);
app.get("/api/catalog", (_req, res) =>
  res.json({
    products: catalog,
    currency: "USD",
    shippingIncluded: false,
    shipping: {
      flatRate: offer.shippingCents,
      freeAtSubtotal: offer.freeShippingMinimumCents,
      thresholdIncludesTax: false,
    },
    country: "US",
    tax: "Added before approval",
    deliveryEstimate: offer.delivery,
    oneProductPerOrder: false,
    mode: config.APP_MODE,
    environment: config.agentSandbox ? "agent-sandbox" : config.APP_MODE,
    sandboxEmailDelivery: config.agentSandbox && config.sandboxEmailDelivery,
  }),
);
app.get("/api/config", (_req, res) =>
  res.json({
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
    protocol_version: "0.1",
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
          : "Live store: browse the catalog, upload photos, approve home-delivered prints, pay by card and track orders. Agents without native Poppy session support should read /api/compat/instructions for the separate HTTP compatibility API; no private signing key is required.",
      },
    ],
    extensions: {
      operations: { version: "1", endpoint: `${config.origin}/api/operations` },
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
app.get("/api/compat/openapi.json", (_req, res) => res.json(openapi(true)));
app.get("/api/compat/instructions", (_req, res) =>
  res.type("text/plain").send(agentInstructions(true)),
);
app.get("/openapi.json", (_req, res) => res.json(openapi()));
app.get("/agent.txt", (_req, res) =>
  res.type("text/plain").send(agentInstructions()),
);
app.post("/oauth/token", async (req, res) => res.json(await issueToken(req)));
app.post("/oauth/revoke", async (req, res) => {
  if (
    req.body.client_assertion_type !==
    "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
  )
    throw new HttpError(
      401,
      "invalid_client",
      "A signed client assertion is required.",
    );
  const c = await client(req.body.client_id);
  const assertion = await verifyAssertion(
    req.body.client_assertion,
    c.keys,
    req.body.client_id,
    `${config.origin}/oauth/revoke`,
  );
  once(
    `assertion:${req.body.client_id}:${assertion.jti}`,
    assertion.exp! * 1000,
  );
  revokeAccount(req.body.token, req.body.client_id);
  res.sendStatus(200);
});
accountRoutes(app);
app.get("/media/:id/:fit", (req, res) => {
  const photoId = String(req.params.id),
    fit = String(req.params.fit),
    exp = String(req.query.exp),
    sig = String(req.query.sig || "");
  if (
    !/^photo_[A-Za-z0-9_-]+$/.test(photoId) ||
    !["contain", "cover", "poster-contain", "poster-cover"].includes(fit) ||
    !/^\d+$/.test(exp) ||
    Number(exp) < Date.now() / 1000 ||
    !equal(sig, sign(`${photoId}:${fit}:${exp}`))
  )
    throw new HttpError(403, "invalid_link", "Preview link has expired.");
  const file = path.join(config.dataDir, "photos", `${photoId}-${fit}.jpg`);
  if (!fs.existsSync(file))
    throw new HttpError(410, "photo_expired", "This photo has been deleted.");
  res.type("image/jpeg").sendFile(file, { dotfiles: "allow" });
});
app.post(
  "/api/webhooks/prodigi",
  rateLimit({ windowMs: 60000, limit: 30 }),
  (req, res) => {
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
  },
);
app.get("/api/order-view/:id", (req, res) => {
  const o = requireRecord<Order>("order", String(req.params.id));
  if (!equal(req.get("X-Order-Token") || "", o.viewToken))
    throw new HttpError(404, "not_found", "Order not found.");
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
const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 },
});
app.use(
  ["/api/photos", "/api/orders", "/api/operations"],
  async (req, res, next) => {
    res.locals.session = await authenticate(req);
    next();
  },
);
app.post("/api/photos", fileUpload.single("photo"), async (req, res) => {
  if (!req.file) throw new HttpError(400, "photo_required", "Attach a photo.");
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
  const op = readOperation(String(req.params.id), res.locals.session.id);
  if (
    op.terms.accountId &&
    requireAccount(res.locals.session) !== op.terms.accountId
  )
    throw new HttpError(404, "not_found", "Not found.");
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
app.post("/api/operations/:id/confirm", (req, res) => {
  const b = z
    .object({ revision: z.number().int(), approved_by: z.string() })
    .strict()
    .parse(req.body);
  const pending = readOperation(String(req.params.id), res.locals.session.id);
  if (pending.terms.accountId) {
    if (
      requireAccount(res.locals.session, "poppy:write") !==
      pending.terms.accountId
    )
      throw new HttpError(
        403,
        "sign_in_required",
        "Sign in to the account that proposed this order.",
      );
  }
  const op = confirm(
    String(req.params.id),
    res.locals.session.id,
    b.revision,
    b.approved_by,
  );
  if (op.state === "in_progress") res.set("Retry-After", "2");
  res.json(operationView(op));
  void tick();
});
app.post("/api/operations/:id/cancel", (req, res) => {
  const op = readOperation(String(req.params.id), res.locals.session.id);
  if (
    op.terms.accountId &&
    requireAccount(res.locals.session, "poppy:write") !== op.terms.accountId
  )
    throw new HttpError(404, "not_found", "Not found.");
  res.json(operationView(cancel(String(req.params.id), res.locals.session.id)));
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
app.use(["/api", "/oauth", "/media"], (_req, res) =>
  res.status(404).json({ error: "not_found", message: "Endpoint not found." }),
);
const dist = path.resolve("dist");
app.use(express.static(dist));
app.use(express.static(path.resolve("public")));
app.get("/{*path}", (_req, res) => {
  if (fs.existsSync(`${dist}/index.html`)) res.sendFile(`${dist}/index.html`);
  else
    res
      .status(503)
      .send(
        "Frontend is running at http://localhost:5173. Run npm run build to serve it here.",
      );
});
app.use(
  (
    e: any,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (e.type === "entity.parse.failed" || e.type === "entity.too.large") {
      const tooLarge = e.type === "entity.too.large";
      console.warn("Request rejected:", req.method, req.path, e.type);
      res.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? "request_too_large" : "invalid_request",
        message: tooLarge
          ? "Request body exceeds the size limit."
          : "Send the request body as a JSON object with Content-Type: application/json, not as a quoted JSON string. Correct the body before retrying.",
      });
      return;
    }
    if (e instanceof ZodError) {
      res.status(400).json({
        error: "invalid_request",
        message: e.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
      return;
    }
    if (e instanceof multer.MulterError) {
      res.status(413).json({
        error: "upload_limit",
        message: "Upload one photo, up to 20 MB.",
      });
      return;
    }
    if (e instanceof HttpError) {
      if (
        e.status === 401 ||
        ["sign_in_required", "insufficient_scope"].includes(e.code)
      )
        res.set(
          "WWW-Authenticate",
          `DPoP error="${e.code}"${e.extra.scope ? `, scope="${e.extra.scope}"` : ""}`,
        );
      if (e.status === 429) res.set("Retry-After", "3600");
      res
        .status(e.status)
        .json({ error: e.code, message: e.message, ...e.extra });
      return;
    }
    console.error(
      "Request failed:",
      req.method,
      req.path,
      e.name || "Error",
      e.code || "",
    );
    res.status(500).json({
      error: "internal_error",
      message:
        "Something went wrong. Retry the same request; do not create a duplicate order.",
    });
  },
);
if (process.env.NO_LISTEN !== "1") {
  const server = app.listen(
    config.PORT,
    process.env.HOST || (config.demo ? "127.0.0.1" : "0.0.0.0"),
    () =>
      console.log(
        `Print with Poppy: ${config.origin} (${config.APP_MODE}) · API port ${config.PORT}`,
      ),
  );
  const timer = setInterval(() => void tick(), 2000);
  const cleanup = setInterval(
    () =>
      void housekeeping().catch(() =>
        console.error("Housekeeping needs attention"),
      ),
    60000,
  );
  const stop = () => {
    clearInterval(timer);
    clearInterval(cleanup);
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
