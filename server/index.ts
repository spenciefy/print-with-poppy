import { batchBodyLimit } from "./batch-photos.js";
import { registerRoutes } from "./routes.js";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { ZodError } from "zod";
import { config } from "./config.js";
import { get, HttpError } from "./store.js";
import { paid } from "./commerce.js";
import { stripe, stripeCheckoutComplete } from "./providers.js";
import { tick, housekeeping } from "./worker.js";
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
  message: {
    error: "rate_limited",
    error_description:
      "Too many requests. Retry after the Retry-After interval.",
  },
});
app.use("/api", limiter);
export const oauthLimiter = rateLimit({
  windowMs: 60000,
  limit: 30,
  message: {
    error: "rate_limited",
    error_description:
      "Too many requests. Retry after the Retry-After interval.",
  },
});
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
      if (s.metadata?.order_id && get("order", s.metadata.order_id))
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
await registerRoutes(
  app,
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 },
  }).single("photo"),
  rateLimit({ windowMs: 3600000, limit: 10 }),
  rateLimit({ windowMs: 60000, limit: 30 }),
  express.raw({ type: "multipart/form-data", limit: batchBodyLimit }),
);
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
        [
          "sign_in_required",
          "insufficient_scope",
          "extension_required",
        ].includes(e.code)
      )
        res.set(
          "WWW-Authenticate",
          `DPoP error="${e.code}"${e.extra.scope ? `, scope="${e.extra.scope}"` : ""}${e.extra.extension ? `, extension="${e.extra.extension}"` : ""}`,
        );
      if (e.status === 429) res.set("Retry-After", "3600");
      res.status(e.status).json({
        error: e.code,
        error_description: e.message,
        message: e.message,
        ...e.extra,
      });
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
