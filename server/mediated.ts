// Mediated Sign-In extension v1 (Poppy 0.3): an extension grant at the token
// endpoint (RFC 6749 §4.5). The agent sends the User's email with `scope` and
// its client assertion; the store emails a one-time code and answers
// `code_required`; the agent sends `sign_in_id` and `one_time_code` to finish.
import { z } from "zod";
import { config } from "./config.js";
import { HttpError, get } from "./store.js";
import { issueTokens, mediatedScopes, scopes, startCode, verifyCode } from "./accounts.js";

export const mediatedGrantType = "https://personalagentprotocol.org/grant/mediated-sign-in";
export const mediatedExtension = () => ({
  version: "1",
  fields: [{ name: "email", label: "Email", secret: false }],
  scopes: mediatedScopes,
});
const owner = (clientId: string) => `mediated:${clientId}`;
// Parameters a token request may carry besides the extension's fields.
const reserved = new Set([
  "grant_type",
  "scope",
  "resource",
  "client_id",
  "client_assertion",
  "client_assertion_type",
  "sign_in_id",
  "one_time_code",
]);

function codeRequired(challenge: any) {
  return new HttpError(400, "code_required", "Enter the one-time code sent to the user.", {
    sign_in_id: challenge.id,
    sent_to: config.agentSandbox
      ? "Sandbox captured email (not delivered)"
      : "The email address you supplied",
    expires_in: Math.max(0, Math.floor((challenge.expires - Date.now()) / 1000)),
  });
}

export async function mediatedSignIn(b: any, _client: unknown) {
  const clientId: string = b.client_id;
  if (b.sign_in_id !== undefined || b.one_time_code !== undefined) {
    // Second step: only the code, without credentials or scope (extension §4).
    if (typeof b.sign_in_id !== "string" || typeof b.one_time_code !== "string" || b.email !== undefined || b.scope !== undefined)
      throw new HttpError(400, "invalid_request", "Send sign_in_id and one_time_code only, with your client assertion.");
    const challenge = get("signin-code", b.sign_in_id);
    if (!challenge || challenge.owner !== owner(clientId))
      throw new HttpError(400, "invalid_grant", "Unknown sign-in.");
    if (!challenge.used && challenge.attempts < 5 && challenge.expires <= Date.now())
      throw new HttpError(400, "expired_token", "The sign-in took too long. Start again.");
    const result = verifyCode(owner(clientId), b.sign_in_id, b.one_time_code);
    if (result.status === "verified") return issueTokens(clientId, result.accountId, result.scopes);
    if (result.status === "code_required") throw codeRequired(get("signin-code", b.sign_in_id));
    if (result.status === "expired") throw new HttpError(400, "expired_token", "The sign-in took too long. Start again.");
    throw new HttpError(400, "invalid_grant", "Sign-in didn't succeed: too many wrong codes. Start again.");
  }
  const requested = scopes(b.scope, mediatedScopes);
  const extra = Object.keys(b).filter((k) => !reserved.has(k) && k !== "email");
  if (extra.length) throw new HttpError(400, "invalid_request", `Unknown parameter: ${extra[0]}.`);
  const email = z.email().max(254).safeParse(typeof b.email === "string" ? b.email.trim() : b.email);
  if (!email.success) throw new HttpError(400, "invalid_request", "Send the email field as a valid email address.");
  const started = await startCode(owner(clientId), email.data, requested, clientId);
  throw codeRequired(get("signin-code", started.sign_in_id));
}
