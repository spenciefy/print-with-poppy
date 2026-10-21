import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { parseConfig } from "./config-values.js";
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
export const config = parseConfig({ ...process.env, APP_SECRET: appSecret, DATA_DIR: path.resolve(env.DATA_DIR) });
export const sku = "GLOBAL-PHO-4X6";
export const sandboxEmailEnabled = () => config.agentSandbox && config.sandboxEmailDelivery;
