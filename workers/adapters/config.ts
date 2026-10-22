import { runtime } from "../context.js";
import type { parseConfig } from "../../server/config-values.js";
export const config = new Proxy({} as ReturnType<typeof parseConfig>, {
  get(_target, key) {
    return Reflect.get(runtime().config, key);
  },
});
export const sku = "GLOBAL-PHO-4X6";
export const sandboxEmailEnabled = () =>
  config.agentSandbox && config.sandboxEmailDelivery;
