import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
const env = z
  .object({
    APP_MODE: z.enum(["demo", "sandbox", "live"]).default("demo"),
    PORT: z.coerce.number().default(8787),
    PUBLIC_URL: z.url().default("http://localhost:5173"),
    DATA_DIR: z.string().default(".data"),
  })
  .parse(process.env);
const secretPath = path.resolve(env.DATA_DIR, "demo-secret");
let appSecret = process.env.APP_SECRET;
if (!appSecret && env.APP_MODE === "demo") {
  fs.mkdirSync(path.dirname(secretPath), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(secretPath))
    fs.writeFileSync(secretPath, randomBytes(48).toString("hex"), {
      mode: 0o600,
    });
  appSecret = fs.readFileSync(secretPath, "utf8");
}
const publicUrl = new URL(env.PUBLIC_URL);
if (
  publicUrl.pathname !== "/" ||
  publicUrl.search ||
  publicUrl.hash ||
  publicUrl.username ||
  publicUrl.password
)
  throw new Error(
    "PUBLIC_URL must be an origin without a path, query, fragment, or credentials.",
  );
export const config = {
  ...env,
  origin: env.PUBLIC_URL.replace(/\/$/, ""),
  dataDir: path.resolve(env.DATA_DIR),
  secret: appSecret || "",
  demo: env.APP_MODE === "demo",
  prodigiBase:
    env.APP_MODE === "live"
      ? "https://api.prodigi.com/v4.0"
      : "https://api.sandbox.prodigi.com/v4.0",
  finish: process.env.PRODIGI_FINISH || "lustre",
  shipping: process.env.PRODIGI_SHIPPING_METHOD || "Budget",
  compatibility:
    process.env.ALLOW_COMPAT_AGENT_SESSIONS === "true" ||
    env.APP_MODE === "demo",
  allowedClients: (process.env.AGENT_CLIENT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  support: process.env.SUPPORT_EMAIL || "hello@printwithpoppy.com",
};
if (!config.demo) {
  for (const k of [
    "APP_SECRET",
    "PRODIGI_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "RESEND_API_KEY",
    "EMAIL_FROM",
  ])
    if (!process.env[k])
      throw new Error(`Missing ${k}; use APP_MODE=demo for local development.`);
  if (!config.compatibility && !config.allowedClients.length)
    throw new Error(
      "Configure native agent identities or enable guest agent compatibility.",
    );
  if (config.secret.length < 32 || !config.origin.startsWith("https://"))
    throw new Error(
      "External integrations require HTTPS PUBLIC_URL and APP_SECRET of at least 32 characters.",
    );
  if (
    config.APP_MODE === "live" &&
    !process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")
  )
    throw new Error("Live mode requires a live Stripe key.");
  if (
    config.APP_MODE === "sandbox" &&
    !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")
  )
    throw new Error("Sandbox requires a Stripe test key.");
}
export const sku = "GLOBAL-PHO-4X6";
