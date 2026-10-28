import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { protocolJson, protocolUrl } from "./protocol-http.js";
import type { Request } from "express";
import { config } from "./config.js";
import { get, put, once, id, hash, equal, HttpError } from "./store.js";
import type { Session } from "./types.js";
import { DelegationError, delegatedKey } from "./delegation.js";
import { sessionFor, sessionEnded } from "./sessions.js";
import { activeGrant, refreshAccount, exchangeCode, checkAccount } from "./accounts.js";
import { pollDevice } from "./device.js";
import { mediatedGrantType, mediatedSignIn } from "./mediated.js";
const cache = new Map<string, { expires: number; metadata: any; keys: any }>();
const bad = (message = "Invalid agent identity.") =>
  new HttpError(401, "invalid_client", message);
const failures = new Map<string, number>();
const pending = new Map<string, Promise<any>>();
const privateKeyFields = ["d", "p", "q", "dp", "dq", "qi", "oth", "k", "priv"];
export const publicJwk = (key: any) =>
  key &&
  typeof key === "object" &&
  ["EC", "RSA", "OKP"].includes(key.kty) &&
  !privateKeyFields.some((field) => field in key);
export const deviceGrantType = "urn:ietf:params:oauth:grant-type:device_code";
/** The hosted Agent Sandbox keeps Direct Sign-In off (an upstream choice): no grant, no endpoint. */
export const directSignIn = () => !config.agentSandbox;
/** An RFC 8252 §7.3 loopback redirect URI: http with a loopback IP literal. */
export function loopbackRedirect(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return (
      u.protocol === "http:" &&
      ["127.0.0.1", "[::1]"].includes(u.hostname) &&
      !u.username &&
      !u.password &&
      !u.hash
    );
  } catch {
    return false;
  }
}
/** `redirect_uri` exactly matches a registered entry, except a loopback entry's port (0.3 §4.5). */
export function redirectMatches(registered: unknown, requested: string) {
  if (!Array.isArray(registered)) return false;
  return registered.some((entry) => {
    if (entry === requested) return true;
    if (!loopbackRedirect(entry) || !loopbackRedirect(requested)) return false;
    const a = new URL(entry),
      b = new URL(requested);
    return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  });
}
// The published demo metadata and the metadata the store trusts internally are the same document.
export const demoClientMetadata = () => ({
  client_id: `${config.origin}/api/demo/agent.json`,
  client_name: "Demo Personal Agent",
  logo_uri: `${config.origin}/demo-agent-logo.svg`,
  jwks_uri: `${config.origin}/api/demo/jwks.json`,
  redirect_uris: [`${config.origin}/api/demo/callback`],
  token_endpoint_auth_method: "private_key_jwt",
  extensions: { operations: { version: "2" } },
});
export async function client(clientId: string) {
  if (config.demo && clientId === `${config.origin}/api/demo/agent.json`) {
    const key = get("demo-key", "identity");
    if (key)
      return {
        metadata: demoClientMetadata(),
        keys: createLocalJWKSet({ keys: [key.public] }),
      };
  }
  if (!config.allowedClients.includes(clientId))
    throw bad(
      "This agent must register its HTTPS metadata URL before opening a session.",
    );
  const cached = cache.get(clientId);
  if (cached && cached.expires > Date.now()) return cached;
  if ((failures.get(clientId) || 0) > Date.now()) throw bad();
  if (pending.has(clientId)) return pending.get(clientId);
  const loading = (async () => {
    try {
      const u = protocolUrl(clientId);
      const metadata = await protocolJson(clientId);
      if (
        metadata.client_id !== clientId ||
        metadata.token_endpoint_auth_method !== "private_key_jwt"
      )
        throw bad();
      const keysUrl = protocolUrl(metadata.jwks_uri);
      if (keysUrl.origin !== u.origin) throw bad();
      if (
        metadata.redirect_uris !== undefined &&
        !Array.isArray(metadata.redirect_uris)
      )
        throw bad();
      for (const redirect of metadata.redirect_uris || []) {
        // HTTPS on the client_id's origin, or an RFC 8252 §7.3 loopback URI (0.3 §4.1).
        if (!loopbackRedirect(redirect) && protocolUrl(redirect).origin !== u.origin)
          throw bad();
      }
      for (const field of ["client_uri", "logo_uri", "tos_uri", "policy_uri"])
        if (metadata[field] !== undefined) protocolUrl(metadata[field]);
      const jwks = await protocolJson(keysUrl.href);
      if (
        !Array.isArray(jwks.keys) ||
        !jwks.keys.length ||
        !jwks.keys.every(publicJwk)
      )
        throw bad();
      const value = {
        metadata,
        keys: createLocalJWKSet(jwks),
        expires: Date.now() + 300000,
      };
      cache.set(clientId, value);
      failures.delete(clientId);
      return value;
    } catch {
      // Only allowlisted identities reach here. Bound retries for broken metadata;
      // invalid signatures never invalidate cached keys or trigger refetch loops.
      failures.set(clientId, Date.now() + 30000);
      throw bad();
    }
  })();
  pending.set(clientId, loading);
  try {
    return await loading;
  } finally {
    pending.delete(clientId);
  }
}


/** §4.1: client assertions are signed directly by a jwks_uri key; ES256 and PS384 MUST be accepted. */
export const clientAssertionAlgorithms = ["ES256", "PS384", "RS256", "EdDSA"];

/**
 * RFC 7523 client authentication (Poppy 0.3 §4.1): signed directly by a key in
 * the agent's `jwks_uri`, `iss` = `sub` = `client_id`, `aud` = the issuer as a
 * single string, short-lived, with `iat` and an unguessable `jti` (reuse refused).
 */
export async function verifyClientAssertion(raw: string, keys: any, clientId: string) {
  const header = decodeProtectedHeader(raw);
  if (header.pap_dlg !== undefined || header.typ === "poppy-session+jwt" || header.typ === "pap-delegation+jwt")
    throw bad("Sign client assertions directly with a key from jwks_uri, not a delegated key.");
  const { payload } = await jwtVerify(raw, keys, {
    issuer: clientId,
    subject: clientId,
    audience: config.origin,
    algorithms: clientAssertionAlgorithms,
    requiredClaims: ["iss", "sub", "aud", "iat", "exp", "jti"],
    maxTokenAge: "300s",
    clockTolerance: 5,
  });
  if (
    payload.aud !== config.origin ||
    payload.exp! - payload.iat! > 300 ||
    payload.exp! <= payload.iat! ||
    typeof payload.jti !== "string" ||
    payload.jti.length < 16
  )
    throw bad();
  return payload;
}
/** private_key_jwt client authentication at the token, device and revocation endpoints. */
export async function authenticateClient(b: any, message?: string) {
  if (
    b.client_assertion_type !==
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" ||
    typeof b.client_id !== "string" ||
    typeof b.client_assertion !== "string"
  )
    throw bad(message);
  const c = await client(b.client_id);
  try {
    const ca = await verifyClientAssertion(b.client_assertion, c.keys, b.client_id);
    once(`assertion:${b.client_id}:${ca.jti}`, ca.exp! * 1000 + 5000);
  } catch (error) {
    throw error instanceof HttpError && error.code === "invalid_client" && error.message !== "Invalid agent identity."
      ? error
      : bad(message);
  }
  return c;
}
/** The token endpoint: plain OAuth grants plus the Mediated Sign-In extension grant. */
export async function issueToken(req: Request) {
  const b = req.body || {};
  const grants = [
    "refresh_token",
    deviceGrantType,
    mediatedGrantType,
    ...(directSignIn() ? ["authorization_code"] : []),
  ];
  if (!grants.includes(b.grant_type))
    throw new HttpError(400, "unsupported_grant_type", "Unsupported grant type.");
  const c = await authenticateClient(b);
  // Tokens for one service (§4.5): every API here takes the default token.
  if (b.resource !== undefined && b.resource !== `https://${new URL(config.origin).hostname}` && b.resource !== config.origin)
    throw new HttpError(400, "invalid_target", "This Company has no separate resources; omit resource.");
  if (b.grant_type === "refresh_token") return refreshAccount(b);
  if (b.grant_type === "authorization_code") return exchangeCode(b);
  if (b.grant_type === deviceGrantType) return pollDevice(b);
  return mediatedSignIn(b, c);
}
export function compatibilitySession() {
  const token = id("guest");
  const session: Session = {
    id: id("session"),
    clientId: "unverified-guest-agent",
    userId: id("user"),
    extensions: true,
    compatibility: true,
    created: Date.now(),
  };
  put("session", session.id, session);
  put("compat-token", hash(token), {
    sessionId: session.id,
    expires: Date.now() + 86400000,
  });
  return {
    access_token: token,
    token_type: "Bearer",
    expires_in: 86400,
    session_id: session.id,
    mode: config.APP_MODE,
    protocol: "http-compatibility",
    instructions: `${config.origin}/api/compat/instructions`,
  };
}
/**
 * Authenticate an API or protocol-endpoint request (Poppy 0.3 §5.3): the
 * `Poppy-Session` header names the Session and User, and an access token, if
 * present, signs the request in to its account with its scopes. HTTP
 * compatibility (non-Poppy) and visual-demo sessions keep their own tokens.
 */
export async function authenticate(req: Request): Promise<Session> {
  // One verification per request: a Session JWT's jti can be used once.
  const cached = (req as any).poppySession as Promise<Session> | undefined;
  if (cached) return cached;
  const result = authenticateOnce(req);
  (req as any).poppySession = result;
  return result;
}
async function authenticateOnce(req: Request): Promise<Session> {
  const authorization = req.get("Authorization") || "";
  const [scheme, token] = authorization.split(" ");
  const sessionHeaders = req.rawHeaders.filter(
    (_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === "poppy-session",
  ).length;
  if (!sessionHeaders) {
    if (config.compatibility && scheme === "Bearer" && token) {
      const record = get("compat-token", hash(token));
      const session =
        record && record.expires > Date.now()
          ? get<Session>("session", record.sessionId)
          : undefined;
      if (session?.compatibility) return session;
      if (record) throw new HttpError(401, "invalid_token", "Guest agent session expired or unknown.");
    }
    if (config.demo && !config.agentSandbox && scheme === "Demo" && token) {
      const s = get<Session>("session", token);
      if (s?.demo) return s;
    }
    // An access token issued to a Personal Agent never works without the Session header.
    throw invalidSession(
      token && get("token", hash(token))
        ? "This access token needs the Poppy-Session header."
        : "Send a Poppy-Session header: a Session JWT signed with a delegated key.",
    );
  }
  if (sessionHeaders > 1) throw invalidSession("Send exactly one Poppy-Session header.");
  if (authorization && (!token || !/^Bearer$/i.test(scheme) || authorization.split(" ").length !== 2))
    throw new HttpError(401, "invalid_token", "Send the access token as Authorization: Bearer TOKEN.");
  const verified = await verifySessionHeader(req, req.get("Poppy-Session")!, token);
  return verified;
}

const invalidSession = (message: string) => new HttpError(400, "invalid_session", message);
// The character set of Conversation IDs (§8.2).
const idPattern = /^[A-Za-z0-9_-]{1,256}$/;
const acceptanceWindowSeconds = 60;

/** The URL a request was sent to, normalized as RFC 9449 §4.3 describes for htu. */
function requestUrl(req: Request) {
  return normalizeHtu(`${config.origin}${new URL(req.originalUrl, config.origin).pathname}`);
}
function normalizeHtu(value: unknown) {
  if (typeof value !== "string") throw Error();
  const u = new URL(value);
  if (u.username || u.password) throw Error();
  return `${u.protocol}//${u.host}${u.pathname.replace(/%[0-9a-f]{2}/gi, (encoded) => {
    const character = String.fromCharCode(parseInt(encoded.slice(1), 16));
    return /^[A-Za-z0-9._~-]$/.test(character) ? character : encoded.toUpperCase();
  })}`;
}

async function verifySessionHeader(req: Request, raw: string, accessToken?: string): Promise<Session> {
  // 1. The client metadata (no redirects) and its key set.
  let header: any, unverified: any;
  try {
    header = decodeProtectedHeader(raw);
    unverified = JSON.parse(Buffer.from(raw.split(".")[1], "base64url").toString());
  } catch {
    throw invalidSession("Malformed Session JWT.");
  }
  if (header.typ !== "poppy-session+jwt") throw invalidSession("The Session JWT's typ must be poppy-session+jwt.");
  if (header.alg !== "ES256") throw invalidSession("Session JWTs are signed with ES256.");
  const clientId = unverified?.iss;
  if (typeof clientId !== "string") throw invalidSession("The Session JWT needs iss (the client_id).");
  let c: Awaited<ReturnType<typeof client>>;
  try {
    c = await client(clientId);
  } catch {
    // A refused Personal Agent gets invalid_session at a resource (§4.1).
    throw invalidSession("This Personal Agent isn't accepted here, or its metadata doesn't check out.");
  }
  // 2. The delegation, the signature and the claims.
  let payload: any;
  try {
    const delegated = await delegatedKey(header, c.keys, clientId);
    ({ payload } = await jwtVerify(raw, delegated.key, {
      issuer: clientId,
      audience: config.origin,
      typ: "poppy-session+jwt",
      algorithms: ["ES256"],
      requiredClaims: ["iss", "aud", "sid", "sub", "htm", "htu", "iat", "jti"],
    }));
    if (payload.iat > delegated.exp) throw invalidSession("The Session JWT was signed after its delegation expired.");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw invalidSession(
      error instanceof DelegationError ? error.message : "The Session JWT's signature or claims don't check out.",
    );
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.aud !== config.origin ||
    typeof payload.sid !== "string" ||
    !idPattern.test(payload.sid) ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    payload.sub.length > 256 ||
    (payload.agent_id !== undefined &&
      (typeof payload.agent_id !== "string" || !payload.agent_id || payload.agent_id.length > 256)) ||
    typeof payload.jti !== "string" ||
    payload.jti.length < 16 ||
    typeof payload.iat !== "number" ||
    Math.abs(now - payload.iat) > acceptanceWindowSeconds
  )
    throw invalidSession("The Session JWT's aud, sid, sub, agent_id, iat or jti is invalid or out of the acceptance window.");
  let htuMatches = false;
  try {
    htuMatches = normalizeHtu(payload.htu) === requestUrl(req);
  } catch {
    htuMatches = false;
  }
  if (payload.htm !== req.method || !htuMatches)
    throw invalidSession("The Session JWT's htm and htu must match this request.");
  // 3. The access token, if any: ath, and the same client_id.
  let record: any;
  if (accessToken) {
    if (typeof payload.ath !== "string" || !equal(payload.ath, hash(accessToken)))
      throw invalidSession("The Session JWT's ath must be the SHA-256 of the access token.");
    record = get("token", hash(accessToken));
    if (record && record.clientId !== clientId)
      throw invalidSession("The access token was issued to a different client_id.");
    if (!record || record.expires < Date.now() || !activeGrant(record.grantId))
      throw new HttpError(401, "invalid_token", "The access token is expired, revoked or invalid.");
  } else if (payload.ath !== undefined) throw invalidSession("ath must be absent without an access token.");
  // Optional replay check (§5.3): within the acceptance window.
  try {
    once(`session-jwt:${clientId}:${payload.jti}`, (payload.iat + acceptanceWindowSeconds + 5) * 1000);
  } catch {
    throw invalidSession("This Session JWT was already used.");
  }
  // 4. The Session, by client_id and sid.
  const session = sessionFor(clientId, payload.sid, {
    userId: payload.sub,
    agentId: payload.agent_id,
    extensions: c.metadata.extensions?.operations?.version === "2",
  });
  if (record) {
    // A Session keeps one account (§5.4 MAY): another account is invalid_session.
    checkAccount(session, record.accountId);
    if (!session.accountBinding) {
      session.accountBinding = record.accountId;
      put("session", session.id, { ...session });
    }
  }
  return {
    ...session,
    accountId: record?.accountId,
    scopes: record ? record.scopes : [],
  };
}
