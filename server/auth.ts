import {
  createLocalJWKSet,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  calculateJwkThumbprint,
} from "jose";
import { protocolJson, protocolUrl } from "./protocol-http.js";
import type { Request } from "express";
import { config } from "./config.js";
import { get, put, once, id, hash, HttpError } from "./store.js";
import type { Session } from "./types.js";
import {
  activeGrant,
  sessionToken,
  refreshAccount,
  exchangeCode,
} from "./accounts.js";
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
export async function client(clientId: string) {
  if (config.demo && clientId === `${config.origin}/api/demo/agent.json`) {
    const key = get("demo-key", "identity");
    if (key)
      return {
        metadata: {
          client_name: "Demo Personal Agent",
          redirect_uris: [`${config.origin}/api/demo/callback`],
          extensions: { operations: { version: "1" } },
        },
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
        if (protocolUrl(redirect).origin !== u.origin) throw bad();
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

export async function verifyAssertion(
  raw: string,
  keys: any,
  issuer: string,
  audience: string,
  session = false,
) {
  const { payload, protectedHeader } = await jwtVerify(raw, keys, {
    issuer,
    audience,
    algorithms: ["ES256", "RS256", "EdDSA"],
    requiredClaims: ["iss", "sub", "aud", "iat", "exp", "jti"],
    maxTokenAge: "300s",
    clockTolerance: 5,
  });
  if (
    protectedHeader.typ === "poppy-browser+jwt" ||
    payload.aud !== audience ||
    !payload.iat ||
    !payload.exp ||
    payload.exp - payload.iat > 300 ||
    payload.exp <= payload.iat ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    typeof payload.jti !== "string" ||
    payload.jti.length < 16 ||
    (!session && payload.sub !== issuer)
  )
    throw bad();
  return payload;
}
export function proofHeader(req: Request, tokenEndpoint = false) {
  const count = req.rawHeaders.filter(
    (_, index) =>
      index % 2 === 0 && req.rawHeaders[index].toLowerCase() === "dpop",
  ).length;
  if (count !== 1)
    throw new HttpError(
      tokenEndpoint ? 400 : 401,
      "invalid_dpop_proof",
      "Exactly one DPoP header is required.",
    );
  return req.get("DPoP");
}
function proofUrl(value: unknown) {
  if (typeof value !== "string") throw Error();
  const u = new URL(value);
  if (u.search || u.hash || u.username || u.password) throw Error();
  // RFC 3986 syntax/scheme normalization; query and fragment are excluded by RFC 9449.
  return `${u.protocol}//${u.host}${u.pathname.replace(
    /%[0-9a-f]{2}/gi,
    (encoded) => {
      const character = String.fromCharCode(parseInt(encoded.slice(1), 16));
      return /^[A-Za-z0-9._~-]$/.test(character)
        ? character
        : encoded.toUpperCase();
    },
  )}`;
}
export async function dpop(
  raw: string | undefined,
  method: string,
  url: string,
  token?: string,
  tokenEndpoint = false,
) {
  try {
    if (!raw) throw Error();
    const header = decodeProtectedHeader(raw);
    if (
      header.typ !== "dpop+jwt" ||
      !header.jwk ||
      !publicJwk(header.jwk) ||
      !["ES256", "RS256", "EdDSA"].includes(header.alg || "")
    )
      throw Error();
    const key = await importJWK(header.jwk, header.alg);
    const { payload } = await jwtVerify(raw, key, {
      algorithms: ["ES256", "RS256", "EdDSA"],
      requiredClaims: ["jti", "htm", "htu", "iat"],
    });
    if (
      payload.htm !== method ||
      proofUrl(payload.htu) !== proofUrl(url) ||
      typeof payload.iat !== "number" ||
      Math.abs(Date.now() / 1000 - payload.iat) > 60 ||
      typeof payload.jti !== "string" ||
      payload.jti.length < 16 ||
      (token && payload.ath !== hash(token))
    )
      throw Error();
    const thumb = await calculateJwkThumbprint(header.jwk);
    once(`dpop:${thumb}:${payload.jti}`);
    return thumb;
  } catch {
    throw new HttpError(
      tokenEndpoint ? 400 : 401,
      "invalid_dpop_proof",
      "Missing, expired, reused, or invalid DPoP proof.",
    );
  }
}
export async function issueToken(req: Request) {
  const b = req.body || {};
  if (
    ![
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
      "refresh_token",
      "authorization_code",
    ].includes(b.grant_type)
  )
    throw new HttpError(
      400,
      "unsupported_grant_type",
      "Unsupported token grant.",
    );
  if (
    b.client_assertion_type !==
    "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
  )
    throw bad();
  const c = await client(b.client_id);
  const audience = config.origin;
  let ca, sa;
  try {
    ca = await verifyAssertion(
      b.client_assertion,
      c.keys,
      b.client_id,
      audience,
    );
    once(`assertion:${b.client_id}:${ca.jti}`, ca.exp! * 1000 + 5000);
  } catch {
    throw bad();
  }
  if (b.grant_type === "urn:ietf:params:oauth:grant-type:jwt-bearer") {
    try {
      sa = await verifyAssertion(
        b.assertion,
        c.keys,
        b.client_id,
        audience,
        true,
      );
      once(`assertion:${b.client_id}:${sa.jti}`, sa.exp! * 1000 + 5000);
    } catch {
      throw new HttpError(
        400,
        "invalid_grant",
        "Invalid or reused Session assertion.",
      );
    }
  }
  const thumb = await dpop(
    proofHeader(req, true),
    "POST",
    `${config.origin}/oauth/token`,
    undefined,
    true,
  );
  if (b.resource)
    throw new HttpError(
      400,
      "invalid_target",
      "Resource-specific tokens are not supported.",
    );
  if (b.grant_type === "refresh_token")
    return refreshAccount(b, thumb, c.metadata);
  if (b.grant_type === "authorization_code") return exchangeCode(b, thumb);
  if (b.scope)
    throw new HttpError(
      400,
      "invalid_scope",
      "Account scopes require sign-in.",
    );
  if (!sa?.sub || sa.sub.length > 256)
    throw new HttpError(400, "invalid_grant", "Invalid Session user ID.");
  let session: Session | undefined = b.session_id
    ? get("session", b.session_id)
    : undefined;
  if (
    b.session_id &&
    (!session || session.clientId !== b.client_id || session.userId !== sa.sub)
  )
    throw new HttpError(
      400,
      "invalid_session",
      "Session does not belong to this agent and user.",
    );
  if (!session) {
    session = {
      id: id("ses"),
      clientId: b.client_id,
      userId: sa.sub,
      extensions: c.metadata.extensions?.operations?.version === "1",
      created: Date.now(),
    };
    put("session", session.id, session);
  }
  if (activeGrant(session.grantId))
    throw new HttpError(
      400,
      "invalid_grant",
      "Renew a signed-in session with its Account Token.",
    );
  return sessionToken(session, thumb);
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
export async function authenticate(req: Request): Promise<Session> {
  const [scheme, token] = (req.get("Authorization") || "").split(" ");
  if (config.compatibility && scheme === "Bearer" && token) {
    const record = get("compat-token", hash(token));
    const session =
      record && record.expires > Date.now()
        ? get<Session>("session", record.sessionId)
        : undefined;
    if (session?.compatibility) return session;
    throw new HttpError(
      401,
      "invalid_token",
      "Guest agent session expired or unknown.",
    );
  }
  if (config.demo && !config.agentSandbox && scheme === "Demo" && token) {
    const s = get<Session>("session", token);
    if (s?.demo) return s;
  }
  if (scheme !== "DPoP" || !token)
    throw new HttpError(
      401,
      "invalid_token",
      "A DPoP session token is required.",
    );
  const record = get("token", hash(token));
  if (!record || record.expires < Date.now())
    throw new HttpError(
      401,
      "invalid_token",
      "Session token expired or unknown.",
    );
  const thumb = await dpop(
    proofHeader(req),
    req.method,
    `${config.origin}${new URL(req.originalUrl, config.origin).pathname}`,
    token,
  );
  if (thumb !== record.thumb)
    throw new HttpError(
      401,
      "invalid_dpop_proof",
      "Proof key does not match token.",
    );
  const session = get<Session>("session", record.sessionId);
  if (!session) throw new HttpError(401, "invalid_token", "Session not found.");
  // A signed-out token never inherits a later sign-in. Revocation takes effect now.
  const grant =
    record.grantId === session.grantId
      ? activeGrant(record.grantId)
      : undefined;
  return {
    ...session,
    accountId: grant ? record.accountId : undefined,
    scopes: grant
      ? record.scopes.filter((scope: string) => grant.scopes.includes(scope))
      : [],
    proofThumb: thumb,
  };
}
