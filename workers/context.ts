import { AsyncLocalStorage } from "node:async_hooks";
import { parseConfig } from "../server/config-values.js";
export interface Env {
  ASSETS: Fetcher;
  COMMERCE: DurableObjectNamespace;
  MEDIA: DurableObjectNamespace;
  PROTOCOL: DurableObjectNamespace;
  PHOTOS: R2Bucket;
  JOBS: Queue<{ id: string }>;
  PUBLIC_URL: string;
  APP_SECRET: string;
  APP_MODE: string;
  AGENT_SANDBOX: string;
  ALLOW_COMPAT_AGENT_SESSIONS: string;
  AGENT_CLIENT_IDS: string;
  SANDBOX_EMAIL_DELIVERY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  [key: string]: unknown;
}
export interface Runtime {
  env: Env;
  config: ReturnType<typeof parseConfig>;
  kick: () => Promise<void>;
}
const scope = new AsyncLocalStorage<Runtime>();
export function runtime() {
  const value = scope.getStore();
  if (!value) throw new Error("Missing Workers request context.");
  return value;
}
export function withRuntime<T>(value: Runtime, fn: () => T): T {
  return scope.run(value, fn);
}
export { configuration } from "./configuration.js";
