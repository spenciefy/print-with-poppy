// How protocol errors are written (Poppy 0.3 §5.3, §5.6, §7): access-token
// errors in a Bearer challenge, Session errors and others as a JSON body, and
// rate limits as a plain 429 with Retry-After.
import type { HttpError } from "./errors.js";

const quoted = (value: unknown) => `"${String(value).replace(/["\\]/g, "\\$&")}"`;

export function errorResponse(e: HttpError) {
  const headers: Record<string, string> = {};
  let body: Record<string, unknown>;
  if (e.code === "sign_in_challenge") {
    // No error code: the request needs the account and had no access token.
    headers["WWW-Authenticate"] = `Bearer scope=${quoted(e.extra.scope || "orders:read")}`;
    body = { error_description: e.message, message: e.message, scope: e.extra.scope };
  } else if (e.status === 429) {
    headers["Retry-After"] = "60";
    body = { message: e.message };
  } else {
    if (e.code === "invalid_token") headers["WWW-Authenticate"] = `Bearer error="invalid_token"`;
    if (e.code === "insufficient_scope")
      headers["WWW-Authenticate"] = `Bearer error="insufficient_scope", scope=${quoted(e.extra.scope)}`;
    if (e.code === "extension_required")
      headers["WWW-Authenticate"] = `Bearer error="extension_required", extension=${quoted(e.extra.extension)}`;
    body = { error: e.code, error_description: e.message, message: e.message, ...e.extra };
  }
  return { status: e.status, headers, body };
}
