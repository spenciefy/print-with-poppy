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

export const accountScopes = ["poppy:read", "poppy:write"];
export function scopes(value: unknown, allowed = accountScopes) {
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
export function requireAccount(session: Session, scope = "poppy:read") {
  if (!session.accountId)
    throw new HttpError(
      403,
      "sign_in_required",
      "Sign in with your email code to access your account.",
    );
  if (!session.scopes?.includes(scope))
    throw new HttpError(
      403,
      "insufficient_scope",
      "Approve the required account access.",
      { scope },
    );
  return session.accountId;
}
export function checkAccount(session: Session, accountId: string) {
  if (session.accountBinding && session.accountBinding !== accountId)
    throw new HttpError(
      400,
      "account_mismatch",
      "Start a new session to use a different account.",
    );
}
export function activeGrant(grantId?: string) {
  const grant = grantId && get("account-token", grantId);
  return grant && !grant.revoked && grant.expires > Date.now()
    ? grant
    : undefined;
}
export function sessionToken(
  session: Session,
  thumb: string,
  grantId?: string,
  requested?: string[],
) {
  const grant = activeGrant(grantId);
  const access = id("tok");
  const granted = grant ? requested || grant.scopes : [];
  put("token", hash(access), {
    sessionId: session.id,
    thumb,
    expires: Date.now() + 3600000,
    ...(grant ? { grantId, accountId: grant.accountId, scopes: granted } : {}),
  });
  return {
    access_token: access,
    token_type: "DPoP",
    expires_in: 3600,
    scope: granted.join(" "),
    session_id: session.id,
    signed_in: !!grant,
  };
}
export function signIn(
  session: Session,
  accountId: string,
  granted: string[],
  thumb: string,
) {
  return db.transaction(() => {
    // Reload after asynchronous email or assertion verification.
    session = get<Session>("session", session.id)!;
    checkAccount(session, accountId);
    const refresh = id("pat"),
      grantId = hash(refresh),
      expires = Date.now() + 30 * 86400000;
    put(
      "account-token",
      grantId,
      {
        clientId: session.clientId,
        userId: session.userId,
        accountId,
        scopes: granted,
        expires,
      },
      accountId,
    );
    session.accountBinding = accountId;
    session.grantId = grantId;
    put("session", session.id, session);
    return {
      ...sessionToken(session, thumb, grantId),
      refresh_token: refresh,
      refresh_token_expires_in: Math.floor((expires - Date.now()) / 1000),
    };
  })();
}
export function refreshAccount(b: any, thumb: string, metadata: any) {
  return db.transaction(() => {
    const grantId = hash(
      typeof b.refresh_token === "string" ? b.refresh_token : "",
    );
    const grant = activeGrant(grantId);
    if (!grant || grant.clientId !== b.client_id)
      throw new HttpError(
        400,
        "invalid_grant",
        "Account access expired or was disconnected. Sign in again.",
      );
    const granted =
      b.scope === undefined ? grant.scopes : scopes(b.scope, grant.scopes);
    let session = b.session_id
      ? get<Session>("session", b.session_id)
      : undefined;
    if (
      b.session_id &&
      (!session ||
        session.clientId !== grant.clientId ||
        session.userId !== grant.userId)
    )
      throw new HttpError(
        400,
        "invalid_session",
        "Session does not belong to this agent and user.",
      );
    if (!session)
      session = {
        id: id("ses"),
        clientId: grant.clientId,
        userId: grant.userId,
        extensions: metadata.extensions?.operations?.version === "1",
        created: Date.now(),
      };
    checkAccount(session, grant.accountId);
    session.accountBinding = grant.accountId;
    session.grantId = grantId;
    put("session", session.id, session);
    return sessionToken(session, thumb, grantId, granted);
  })();
}
export function revokeAccount(token: unknown, clientId: string) {
  if (typeof token !== "string") return;
  const grantId = hash(token),
    grant = get("account-token", grantId);
  if (!grant || grant.clientId !== clientId) return;
  put("account-token", grantId, { ...grant, revoked: true }, grant.accountId);
  for (const session of all<Session>("session")) {
    if (session.grantId === grantId) {
      delete session.grantId;
      put("session", session.id, session);
    }
  }
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
  if (config.agentSandbox && !/@example\.(com|org|net)$/.test(email))
    throw new HttpError(
      400,
      "test_email_required",
      "Agent Sandbox sign-in accepts only synthetic @example.com, @example.org or @example.net accounts. No real email is verified.",
    );
  throttle(`email:${hash(email)}`, 5, 3600000);
  throttle(`owner:${owner}`, 5, 3600000);
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
  const access = requested.includes("poppy:write")
    ? "view your orders and save new orders to your account"
    : "view your orders";
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
      throw new HttpError(404, "not_found", "Sign-in request not found.");
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
    "DELETE FROM records WHERE kind IN ('signin-code','browser-signin','authorization-code','signin-rate') AND json_extract(body, '$.expires') < ?",
  ).run(Date.now() - 86400000);
}

export function exchangeCode(b: any, thumb: string) {
  return db.transaction(() => {
    const codeId = hash(typeof b.code === "string" ? b.code : "");
    const code = get("authorization-code", codeId);
    if (
      !code ||
      code.used ||
      code.expires <= Date.now() ||
      code.clientId !== b.client_id ||
      code.redirectUri !== b.redirect_uri ||
      typeof b.code_verifier !== "string" ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier) ||
      hash(b.code_verifier) !== code.challenge
    )
      throw new HttpError(
        400,
        "invalid_grant",
        "Authorization code or PKCE verifier is invalid.",
      );
    const session =
      typeof b.session_id === "string" && get<Session>("session", b.session_id);
    if (
      !session ||
      session.clientId !== b.client_id ||
      session.compatibility ||
      session.demo
    )
      throw new HttpError(
        400,
        "invalid_session",
        "An existing native Poppy session is required.",
      );
    checkAccount(session, code.accountId);
    put("authorization-code", codeId, { ...code, used: true });
    return signIn(
      session,
      code.accountId,
      b.scope === undefined ? code.scopes : scopes(b.scope, code.scopes),
      thumb,
    );
  })();
}
