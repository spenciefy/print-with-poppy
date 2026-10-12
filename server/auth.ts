import {
  createLocalJWKSet,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  calculateJwkThumbprint,
} from "jose";
import type { Request } from "express";
import { config } from "./config.js";
import { get, put, once, id, hash, HttpError } from "./store.js";
import type { Session } from "./types.js";
const cache = new Map<string, { expires: number; metadata: any; keys: any }>();
const bad = (message = "Invalid agent identity.") =>
  new HttpError(401, "invalid_client", message);
async function json(url: string) {
  const r = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw bad();
  const text = await r.text();
  if (text.length > 65536) throw bad();
  return JSON.parse(text);
}
export async function client(clientId: string) {
  if (config.demo && clientId === `${config.origin}/api/demo/agent.json`) {
    const key = get("demo-key", "identity");
    if (key)
      return {
        metadata: { extensions: { operations: { version: "1" } } },
        keys: createLocalJWKSet({ keys: [key.public] }),
      };
  }
  if (!config.allowedClients.includes(clientId))
    throw bad(
      "This agent must register its HTTPS metadata URL before opening a session.",
    );
  const cached = cache.get(clientId);
  if (cached && cached.expires > Date.now()) return cached;
  const u = new URL(clientId);
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    throw bad();
  // Exact operator-managed allowlist, no arbitrary metadata fetches or redirects.
  const metadata = await json(clientId);
  if (
    metadata.client_id !== clientId ||
    metadata.token_endpoint_auth_method !== "private_key_jwt"
  )
    throw bad();
  const keysUrl = new URL(metadata.jwks_uri);
  if (keysUrl.origin !== u.origin || keysUrl.username || keysUrl.password)
    throw bad();
  if (
    (metadata.redirect_uris || []).some(
      (s: string) => new URL(s).origin !== u.origin,
    )
  )
    throw bad();
  const jwks = await json(keysUrl.href);
  if (
    !Array.isArray(jwks.keys) ||
    !jwks.keys.length ||
    jwks.keys.some((k: any) => k.d || k.k)
  )
    throw bad();
  const value = {
    metadata,
    keys: createLocalJWKSet(jwks),
    expires: Date.now() + 300000,
  };
  cache.set(clientId, value);
  return value;
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
    maxTokenAge: "120s",
    clockTolerance: 5,
  });
  if (
    protectedHeader.typ === "poppy-browser+jwt" ||
    payload.aud !== audience ||
    !payload.iat ||
    !payload.exp ||
    payload.exp - payload.iat > 120 ||
    typeof payload.jti !== "string" ||
    payload.jti.length < 16 ||
    (!session && payload.sub !== issuer)
  )
    throw bad();
  return payload;
}
export async function dpop(
  raw: string | undefined,
  method: string,
  url: string,
  token?: string,
) {
  try {
    if (!raw) throw Error();
    const header = decodeProtectedHeader(raw);
    if (
      header.typ !== "dpop+jwt" ||
      !header.jwk ||
      (header.jwk as any).d ||
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
      payload.htu !== url ||
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
      401,
      "invalid_dpop_proof",
      "Missing, expired, reused, or invalid DPoP proof.",
    );
  }
}
export async function issueToken(req: Request) {
  const b = req.body;
  if (b.grant_type !== "urn:ietf:params:oauth:grant-type:jwt-bearer")
    throw new HttpError(
      400,
      "unsupported_grant_type",
      "Only guest JWT bearer sessions are supported.",
    );
  if (
    b.client_assertion_type !==
    "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
  )
    throw bad();
  const c = await client(b.client_id);
  const audience = `${config.origin}/oauth/token`;
  let ca, sa;
  try {
    ca = await verifyAssertion(
      b.client_assertion,
      c.keys,
      b.client_id,
      audience,
    );
    sa = await verifyAssertion(
      b.assertion,
      c.keys,
      b.client_id,
      audience,
      true,
    );
  } catch {
    throw bad();
  }
  const thumb = await dpop(req.get("DPoP"), "POST", audience);
  if (!sa.sub || sa.sub.length > 256) throw bad();
  once(`assertion:${b.client_id}:${ca.jti}`, ca.exp! * 1000);
  once(`assertion:${b.client_id}:${sa.jti}`, sa.exp! * 1000);
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
  const access = id("tok");
  put("token", hash(access), {
    sessionId: session.id,
    thumb,
    expires: Date.now() + 3600000,
  });
  return {
    access_token: access,
    token_type: "DPoP",
    expires_in: 3600,
    scope: "",
    session_id: session.id,
    signed_in: false,
  };
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
  if (config.demo && scheme === "Demo" && token) {
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
    req.get("DPoP"),
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
  return session;
}
