import { z } from "zod";
export function parseConfig(values: Record<string, string | undefined>) {
  const env = z
    .object({
      APP_MODE: z.enum(["demo", "sandbox", "live"]).default("demo"),
      PORT: z.coerce.number().default(8787),
      PUBLIC_URL: z.url().default("http://localhost:5173"),
      DATA_DIR: z.string().default(".data"),
    })
    .parse(values);
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
  const config = {
    ...env,
    origin: env.PUBLIC_URL.replace(/\/$/, ""),
    dataDir: env.DATA_DIR,
    secret: values.APP_SECRET || "",
    demo: env.APP_MODE === "demo",
    sandboxEmailDelivery: values.SANDBOX_EMAIL_DELIVERY === "true",
    agentSandbox: values.AGENT_SANDBOX === "true",
    prodigiBase:
      env.APP_MODE === "live"
        ? "https://api.prodigi.com/v4.0"
        : "https://api.sandbox.prodigi.com/v4.0",
    finish: values.PRODIGI_FINISH || "lustre",
    shipping: values.PRODIGI_SHIPPING_METHOD || "Budget",
    compatibility:
      values.ALLOW_COMPAT_AGENT_SESSIONS === undefined
        ? env.APP_MODE === "demo"
        : values.ALLOW_COMPAT_AGENT_SESSIONS === "true",
    allowedClients: (values.AGENT_CLIENT_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    support: values.SUPPORT_EMAIL || "hello@printwithpoppy.com",
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
      if (!values[k])
        throw new Error(
          `Missing ${k}; use APP_MODE=demo for local development.`,
        );
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
      !values.STRIPE_SECRET_KEY?.startsWith("sk_live_")
    )
      throw new Error("Live mode requires a live Stripe key.");
    if (
      config.APP_MODE === "sandbox" &&
      !values.STRIPE_SECRET_KEY?.startsWith("sk_test_")
    )
      throw new Error("Sandbox requires a Stripe test key.");
  }

  if (config.agentSandbox && (!config.demo || config.compatibility))
    throw new Error(
      "AGENT_SANDBOX requires APP_MODE=demo and ALLOW_COMPAT_AGENT_SESSIONS=false.",
    );

  if (
    config.agentSandbox &&
    [values.STRIPE_SECRET_KEY, values.PRODIGI_API_KEY].some(Boolean)
  )
    throw new Error(
      "Do not install payment or print provider credentials in the Agent Sandbox.",
    );

  if (
    config.sandboxEmailDelivery &&
    (!config.agentSandbox || !values.RESEND_API_KEY || !values.EMAIL_FROM)
  )
    throw new Error(
      "Sandbox email delivery requires Agent Sandbox, Resend credentials, EMAIL_FROM.",
    );

  // Explicit loopback development is the only non-HTTPS protocol deployment.
  if (
    publicUrl.protocol !== "https:" &&
    !(
      config.demo &&
      ["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname)
    )
  )
    throw new Error(
      "PUBLIC_URL must use HTTPS, except for a local loopback demo.",
    );

  return config;
}
