import Stripe from "stripe";
import { runtime } from "../context.js";
const clients = new WeakMap<object, Stripe>();
export function stripeClient() {
  const env = runtime().env;
  if (typeof env.STRIPE_SECRET_KEY !== "string" || !env.STRIPE_SECRET_KEY)
    throw new Error("Stripe is not configured.");
  let client = clients.get(env);
  if (!client) {
    client = new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      maxNetworkRetries: 2,
      timeout: 15000,
    });
    clients.set(env, client);
  }
  return client;
}
// Resolve per request/DO invocation. Never capture one environment's key at module initialization.
export const stripe = new Proxy({} as Stripe, {
  get(_target, key) {
    const client = stripeClient();
    const value = Reflect.get(client, key);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
