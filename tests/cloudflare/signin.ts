import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

const origin = process.env.PUBLIC_URL!;
assert(
  origin && ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
  "Sign-in tests are local-only.",
);
const config = await (await fetch(origin + "/api/config")).json();
assert.equal(config.mode, "demo");
assert.equal(
  config.sandboxEmailDelivery,
  false,
  "Tests must never send email.",
);
const clientId = origin + "/api/demo/agent.json";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

// Exercise the outer Worker as well as the shared sign-in handlers. Node's
// fetch does not apply Referrer-Policy, so check the browser-facing header too.
const authorization = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: origin + "/api/demo/callback",
  scope: "poppy:read",
  state: randomUUID(),
  code_challenge: digest(randomUUID()),
  code_challenge_method: "S256",
});
const start = await fetch(origin + "/oauth/authorize?" + authorization);
assert.equal(start.status, 200);
assert.equal(start.headers.get("Referrer-Policy"), "same-origin");
assert.equal(start.headers.get("Cache-Control"), "no-store");
assert.equal(
  (await fetch(origin + "/api/config")).headers.get("Referrer-Policy"),
  "no-referrer",
);
const cookie = start.headers.get("Set-Cookie")!.split(";")[0];
const html = await start.text();
const flow = html.match(/name="flow" value="([^"]+)"/)![1],
  csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
const email = `signin-${randomUUID()}@example.com`;
const submitEmail = (
  headers: Record<string, string>,
  fields: Record<string, string> = {},
) =>
  fetch(origin + "/oauth/authorize/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: origin,
      Cookie: cookie,
      ...headers,
    },
    body: new URLSearchParams({ flow, csrf, email, ...fields }),
  });
for (const [headers, fields] of [
  [{ Origin: "null" }, {}],
  [{ Origin: "https://other.example" }, {}],
  [{ Origin: "" }, {}],
  [{ Cookie: "" }, {}],
  [{ Cookie: "poppy_signin=wrong-browser" }, {}],
  [{}, { csrf: "wrong-csrf" }],
  [{}, { flow: "unknown-flow" }],
] satisfies [Record<string, string>, Record<string, string>][]) {
  const refused = await submitEmail(headers, fields);
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, "invalid_request");
}
// Failed CSRF checks must leave the flow usable by its initiating browser.
// Demo mode captures this email locally; it never calls an email provider.
const emailed = await submitEmail({});
assert.equal(emailed.status, 200);
assert.equal(emailed.headers.get("Referrer-Policy"), "same-origin");
assert.match(await emailed.text(), /Check your email/);
assert.equal((await submitEmail({})).status, 409);
console.log(
  "Workers direct sign-in passed: same-origin policy, email form, CSRF refusals and unchanged no-referrer default.",
);
