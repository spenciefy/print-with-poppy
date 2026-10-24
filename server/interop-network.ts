// Deliberately narrower than .test: only the isolated interop grid may opt in.
export const interopHost = (hostname: string) =>
  hostname.toLowerCase().endsWith(".interop.test");

export function allowInteropTestHosts(
  values: Record<string, string | undefined>,
) {
  const flag = values.ALLOW_INTEROP_TEST_HOSTS;
  if (flag === undefined || flag === "false") return false;
  if (flag !== "true")
    throw new Error("ALLOW_INTEROP_TEST_HOSTS must be true or false.");
  const origin = new URL(values.PUBLIC_URL || "http://localhost:5173");
  if (
    (values.APP_MODE || "demo") !== "demo" ||
    origin.protocol !== "https:" ||
    !interopHost(origin.hostname) ||
    values.CF_DEPLOYMENT ||
    values.SANDBOX_EMAIL_DELIVERY === "true" ||
    [
      values.STRIPE_SECRET_KEY,
      values.STRIPE_WEBHOOK_SECRET,
      values.PRODIGI_API_KEY,
      values.RESEND_API_KEY,
    ].some(Boolean)
  )
    throw new Error(
      "ALLOW_INTEROP_TEST_HOSTS requires an isolated HTTPS .interop.test demo with no provider credentials or Cloudflare deployment.",
    );
  return true;
}
