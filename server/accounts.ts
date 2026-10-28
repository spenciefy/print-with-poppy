import { randomInt } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import {
  db,
  get,
  put,
  all,
  id,
  hash,
  sign,
  equal,
  HttpError,
} from "./store.js";
import { sendMail } from "./providers.js";
import { escapeHtml } from "./email.js";
import type { Session, Order } from "./types.js";

/**
 * The store's own account scopes (Poppy 0.3 §4.4). Every scope is listed in
 * `scopes_supported` and described in `auth.scopes`, with `auth.scope_hints`.
 * Direct and Device Sign-In can grant all of them; Mediated Sign-In, which is
 * transitional, grants only `mediatedScopes`.
 */
export const scopeCatalog = {
  "orders:read": {
    description:
      "See your Print with Poppy account email, order history, order status and delivery details. Read-only.",
    hints: { changes: "none", personal_data: true },
  },
  "orders:write": {
    description:
      "Save new orders to your account and propose reorders of past orders. Each purchase still needs your explicit approval and card payment; approving an order creates a checkout that can't be undone. Doesn't include reading order history (orders:read).",
    hints: { changes: "irreversible", personal_data: true },
  },
  addresses: {
    description:
      "See, save, change and delete the shipping addresses saved to your account, and ship an order to one of them.",
    hints: { changes: "reversible", personal_data: true },
  },
} as const;
export type AccountScope = keyof typeof scopeCatalog;
export const accountScopes = Object.keys(scopeCatalog) as AccountScope[];
export const mediatedScopes: AccountScope[] = ["orders:read", "orders:write"];
export const scopeDescriptions = Object.fromEntries(
  accountScopes.map((scope) => [scope, scopeCatalog[scope].description]),
);
export const scopeHints = Object.fromEntries(
  accountScopes.map((scope) => [scope, scopeCatalog[scope].hints]),
);
/** Synthetic test accounts: the only ones whose captured demo codes are ever shown or returned. */
export const syntheticEmail = (email: unknown) =>
  typeof email === "string" && /@example\.(com|org|net)$/.test(email);
/**
 * Demo/Agent Sandbox only: the captured code of an active challenge for a synthetic
 * account. Demo stores never send email; production never stores raw codes.
 */
export function demoSignInCode(challengeId: string) {
  if (!config.demo) return undefined;
  const c = get("signin-code", challengeId);
  if (!c || c.used || c.expires <= Date.now() || !syntheticEmail(c.email))
    return undefined;
  const message = get("demo-signin-email", challengeId);
  return message?.text?.match(/code is (\d{6})/)?.[1] as string | undefined;
}
export function scopes(value: unknown, allowed: readonly string[] = accountScopes) {
  if (typeof value !== "string" || !value.trim())
    throw new HttpError(
      400,
      "invalid_scope",
      "Choose the account access to request.",
    );
  const requested = [...new Set(value.trim().split(/\s+/))];
  if (requested.some((s) => !allowed.includes(s)))
    throw new HttpError(
      400,
      "invalid_scope",
      "Requested account access is not available.",
    );
  return requested;
}
/** Signed-out requests that need the account get a 401 challenge with no error code (§7). */
export const signInChallenge = "sign_in_challenge";
/**
 * The signed-in account, if the access token has `scope`. Without an access
 * token: 401 with `WWW-Authenticate: Bearer scope="…"` and no error code (§7).
 * With one that lacks the scope: 403 `insufficient_scope`, naming it.
 */
export function requireAccount(session: Session, scope: string | string[] = "orders:read") {
  const needed = Array.isArray(scope) ? scope : [scope];
  if (!session.accountId)
    throw new HttpError(
      401,
      signInChallenge,
      `This needs the user's account. Send an access token that covers ${needed.join(" ")}: refresh one, or sign in requesting it.`,
      { scope: needed.join(" ") },
    );
  if (needed.some((s) => !session.scopes?.includes(s)))
    throw new HttpError(
      403,
      "insufficient_scope",
      `This needs account access the user hasn't approved: ${needed.join(" ")}. Refresh with a token that covers it, or sign in again requesting it.`,
      { scope: needed.join(" ") },
    );
  return session.accountId;
}
/** Any signed-in request, whatever its scopes. */
export function requireSignedIn(session: Session) {
  if (!session.accountId || !session.scopes?.length)
    throw new HttpError(401, signInChallenge, "This needs the user's account. Send an access token.", {
      scope: "orders:read",
    });
  return session.accountId;
}
/** A Session keeps one account; another account's token is refused (§5.4 MAY). */
export function checkAccount(session: Session, accountId: string) {
  if (session.accountBinding && session.accountBinding !== accountId)
    throw new HttpError(
      400,
      "invalid_session",
      "This Session already used a different account. Start a new Session (a new sid) for this one.",
    );
}
/** A refresh token's record ("account-token"), if it's still valid. */
export function activeGrant(grantId?: string) {
  const grant = grantId && get("account-token", grantId);
  return grant && !grant.revoked && grant.expires > Date.now()
    ? grant
    : undefined;
}
export const accessTokenLifetimeSeconds = 3600;
export const refreshTokenLifetimeMs = 30 * 86400000;
/** An access token for a refresh token's grant, with these scopes (all of them by default). */
function accessToken(grantId: string, grant: any, granted: string[]) {
  const access = id("tok");
  put("token", hash(access), {
    clientId: grant.clientId,
    grantId,
    accountId: grant.accountId,
    scopes: granted,
    expires: Date.now() + accessTokenLifetimeSeconds * 1000,
  });
  return access;
}
/**
 * Sign-in (Direct, Device, Mediated): a new refresh token for this client and
 * account, and an access token, in a plain OAuth token response (§4.7).
 */
export function issueTokens(clientId: string, accountId: string, granted: string[]) {
  return db.transaction(() => {
    const refresh = id("prt");
    const grantId = hash(refresh);
    const grant = {
      clientId,
      accountId,
      scopes: granted,
      expires: Date.now() + refreshTokenLifetimeMs,
      created: Date.now(),
    };
    put("account-token", grantId, grant, accountId);
    return {
      access_token: accessToken(grantId, grant, granted),
      token_type: "Bearer",
      expires_in: accessTokenLifetimeSeconds,
      refresh_token: refresh,
      scope: granted.join(" "),
    };
  })();
}
/** grant_type=refresh_token (§4.4): optional narrower `scope`; no new refresh token. */
export function refreshAccount(b: any) {
  const grantId = hash(typeof b.refresh_token === "string" ? b.refresh_token : "");
  const grant = activeGrant(grantId);
  if (!grant || grant.clientId !== b.client_id)
    throw new HttpError(
      400,
      "invalid_grant",
      "The refresh token expired or was revoked. Sign in again.",
    );
  const granted = b.scope === undefined ? grant.scopes : scopes(b.scope, grant.scopes);
  return {
    access_token: accessToken(grantId, grant, granted),
    token_type: "Bearer",
    expires_in: accessTokenLifetimeSeconds,
    scope: granted.join(" "),
  };
}
export function revokeAccount(token: unknown, clientId: string) {
  if (typeof token !== "string") return;
  const grantId = hash(token),
    grant = get("account-token", grantId);
  if (!grant || grant.clientId !== clientId) return;
  revokeGrant(grantId);
}
/** Revoking a refresh token invalidates its access tokens at once (RFC 7009 §2.1). */
export function revokeGrant(grantId: string) {
  const grant = get("account-token", grantId);
  if (!grant) return;
  put("account-token", grantId, { ...grant, revoked: true }, grant.accountId);
}
export function throttle(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const record = get("signin-rate", key);
  const counter =
    record && record.expires > now
      ? record
      : { count: 0, expires: now + windowMs };
  if (counter.count >= limit)
    throw new HttpError(
      429,
      "rate_limited",
      "Too many sign-in attempts. Try again later.",
    );
  counter.count++;
  put("signin-rate", key, counter);
}
export async function startCode(
  owner: string,
  emailInput: unknown,
  requested: string[],
  clientId: string,
) {
  const email = z.email().max(254).parse(emailInput).trim().toLowerCase();
  if (config.agentSandbox && !syntheticEmail(email))
    throw new HttpError(
      400,
      "test_email_required",
      "Agent Sandbox sign-in accepts only synthetic @example.com, @example.org or @example.net accounts. No real email is verified.",
    );
  throttle(`email:${hash(email)}`, 5, 3600000);
  // A Mediated Sign-In's owner is the whole client (every User of that agent).
  throttle(`owner:${owner}`, owner.startsWith("mediated:") ? 100 : 5, 3600000);
  throttle("all", 200, 3600000);
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const challengeId = id("sgn");
  const challenge = {
    id: challengeId,
    owner,
    email,
    requested,
    clientId,
    codeHash: sign(`${challengeId}:${code}`),
    expires: Date.now() + 10 * 60000,
    attempts: 0,
    used: false,
  };
  // No raw code is stored in live mode or returned by an API.
  put("signin-code", challengeId, challenge, owner);
  const access = requested
    .map((scope) =>
      scope === "orders:read"
        ? "view your orders"
        : scope === "orders:write"
          ? "save new orders to your account"
          : "see and change your saved addresses",
    )
    .join(", ");
  const agent = new URL(clientId).hostname;
  const text = `Your Print with Poppy sign-in code is ${code}.\n\n${agent} is requesting permission to ${access}. Only enter this code if you requested this connection. It expires in 10 minutes. This does not approve a purchase.\n\nIf you did not request this, ignore this email.`;
  const message = {
    to: email,
    subject: "Your Print with Poppy sign-in code",
    text,
    html: `<html><body style="background:#faf6ee;color:#30291f;font-family:Arial,sans-serif;padding:32px"><div style="max-width:480px;margin:auto"><img src="${escapeHtml(config.origin)}/photos/poppy-email-logo.png" width="64" height="64" alt="Print with Poppy"><h1 style="font-size:28px">Your sign-in code</h1><p style="font-size:36px;letter-spacing:8px">${code}</p><p>${escapeHtml(agent)} is requesting permission to ${access}.</p><p>Only enter this code if you requested this connection. It expires in 10 minutes. This does not approve a purchase.</p><p>If you did not request this, ignore this email.</p></div></body></html>`,
  };
  try {
    if (config.demo) put("demo-signin-email", challengeId, message, owner);
    else await sendMail(message, `signin-${challengeId}`);
  } catch {
    put("signin-code", challengeId, { ...challenge, used: true }, owner);
    throw new HttpError(
      503,
      "email_unavailable",
      "We could not send your code. Please try again later.",
    );
  }
  return codeRequired(challenge);
}
function codeRequired(c: any) {
  return {
    status: "code_required",
    sign_in_id: c.id,
    code: {
      sent_to: config.agentSandbox
        ? "Sandbox captured email (not delivered)"
        : "The email address you supplied",
    },
    expires_at: new Date(c.expires).toISOString(),
  };
}
export function verifyCode(
  owner: string,
  challengeId: string,
  input: unknown,
): any {
  return db.transaction(() => {
    const c = get("signin-code", challengeId);
    if (!c || c.owner !== owner)
      throw new HttpError(404, "sign_in_not_found", "Sign-in request not found.");
    if (c.used || c.attempts >= 5) return { status: "failed" };
    if (c.expires <= Date.now()) return { status: "expired" };
    c.attempts++;
    const valid =
      typeof input === "string" &&
      /^\d{6}$/.test(input) &&
      equal(c.codeHash, sign(`${c.id}:${input}`));
    if (!valid) {
      put("signin-code", c.id, c, owner);
      return c.attempts >= 5 ? { status: "failed" } : codeRequired(c);
    }
    c.used = true;
    put("signin-code", c.id, c, owner);
    const emailKey = hash(c.email);
    let account = get("account-email", emailKey);
    if (!account) {
      account = { id: id("acct"), email: c.email, created: Date.now() };
      put("account-email", emailKey, account);
      put("account", account.id, account);
    }
    return { status: "verified", accountId: account.id, scopes: c.requested };
  })();
}
export function history(session: Session, cursor?: string) {
  const accountId = requireAccount(session);
  let before = { created: Number.MAX_SAFE_INTEGER, id: "~" };
  if (cursor) {
    try {
      before = z
        .object({
          created: z.number().int().nonnegative(),
          id: z.string().max(100),
        })
        .strict()
        .parse(JSON.parse(Buffer.from(cursor, "base64url").toString()));
    } catch {
      throw new HttpError(
        400,
        "invalid_request",
        "Invalid order history cursor.",
      );
    }
  }
  const rows = db
    .prepare(
      "SELECT body FROM records WHERE kind='order' AND json_extract(body, '$.accountId')=? AND (json_extract(body, '$.created') < ? OR (json_extract(body, '$.created') = ? AND id < ?)) ORDER BY json_extract(body, '$.created') DESC, id DESC LIMIT 51",
    )
    .all(accountId, before.created, before.created, before.id)
    .map((r: any) => JSON.parse(r.body) as Order);
  const last = rows[49];
  return {
    rows: rows.slice(0, 50),
    next:
      rows.length > 50
        ? Buffer.from(
            JSON.stringify({ created: last.created, id: last.id }),
          ).toString("base64url")
        : null,
  };
}
export function cleanupSignIns() {
  db.prepare(
    "DELETE FROM records WHERE kind IN ('signin-code','browser-signin','authorization-code','signin-rate','device-grant','device-user-code','session-sid') AND json_extract(body, '$.expires') < ?",
  ).run(Date.now() - 86400000);
}

export function exchangeCode(b: any) {
  // Errors are returned from the transaction, not thrown, so that marking a reused
  // code's grant revoked is committed rather than rolled back.
  const outcome = db.transaction(() => {
    const codeId = hash(typeof b.code === "string" ? b.code : "");
    const code = get("authorization-code", codeId);
    const invalid = {
      error: new HttpError(
        400,
        "invalid_grant",
        "Authorization code or PKCE verifier is invalid.",
      ),
    };
    if (!code || code.clientId !== b.client_id) return invalid;
    if (code.used) {
      // RFC 6749 §4.1.2: a replayed code revokes what it already issued.
      if (code.grantId) revokeGrant(code.grantId);
      return invalid;
    }
    if (
      code.expires <= Date.now() ||
      code.redirectUri !== b.redirect_uri ||
      typeof b.code_verifier !== "string" ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier) ||
      !equal(hash(b.code_verifier), code.challenge)
    )
      return invalid;
    const result = issueTokens(code.clientId, code.accountId, code.scopes);
    put("authorization-code", codeId, {
      ...code,
      used: true,
      grantId: hash(result.refresh_token),
    });
    return { result };
  })();
  if ("error" in outcome) throw outcome.error;
  return outcome.result;
}
