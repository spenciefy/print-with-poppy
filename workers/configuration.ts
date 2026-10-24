import { parseConfig } from "../server/config-values.js";
export function configuration(input: Record<string, unknown>) {
  if (input.ALLOW_INTEROP_TEST_HOSTS !== undefined && input.ALLOW_INTEROP_TEST_HOSTS !== "false")
    throw new Error("Private interop networks are supported only by the local Node server, never Cloudflare.");
  const values = Object.fromEntries(
    Object.entries(input).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  if (!values.APP_SECRET || values.APP_SECRET.length < 32)
    throw new Error("Install a unique APP_SECRET of at least 32 characters.");
  if (values.CF_DEPLOYMENT === "production") {
    if (
      values.APP_MODE !== "live" ||
      values.AGENT_SANDBOX !== "false" ||
      values.SANDBOX_EMAIL_DELIVERY === "true" ||
      values.SANDBOX_REFERENCE_PUBLIC_JWK
    )
      throw new Error(
        "Production requires live mode without sandbox identities or simulation.",
      );
    if (!["true", "false"].includes(values.LIVE_ORDERS_ENABLED))
      throw new Error("Explicitly configure LIVE_ORDERS_ENABLED.");
  } else if (
    values.APP_MODE !== "demo" ||
    values.STRIPE_SECRET_KEY ||
    values.PRODIGI_API_KEY ||
    values.STRIPE_WEBHOOK_SECRET
  ) {
    throw new Error(
      "Cloudflare sandbox requires simulated providers without payment/printing credentials.",
    );
  }
  return parseConfig(values);
}
