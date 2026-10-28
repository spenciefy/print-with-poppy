// Delegated keys (Poppy 0.3 §5.2). The keys in a Personal Agent's `jwks_uri`
// sign client assertions directly (§4.1) and delegations: short-lived JWTs
// (`typ: pap-delegation+jwt`, ES256 or PS384, at most 24 hours) that vouch for
// one delegated key in `cnf.jwk`. Delegated keys sign only Session JWTs, which
// carry the delegation in their `pap_dlg` header and name the delegated key in
// `kid` by its RFC 7638 thumbprint.
import {
  calculateJwkThumbprint,
  decodeProtectedHeader,
  errors,
  importJWK,
  jwtVerify,
} from "jose";
import { createHash } from "node:crypto";

export const delegationTyp = "pap-delegation+jwt";
/** §5.2: Companies MUST accept both. */
export const delegationAlgorithms = ["ES256", "PS384"];
const maxLifetimeSeconds = 24 * 60 * 60;
const maxCached = 10_000;
const privateKeyFields = ["d", "p", "q", "dp", "dq", "qi", "oth", "k", "priv"];

/** Why a Session JWT was refused; callers answer `invalid_session`. */
export class DelegationError extends Error {}
const fail = (message: string) => new DelegationError(message);

type Verified = { exp: number; jwk: any };
// Verified delegations, keyed by a hash of the whole delegation (guides: never
// by its `jti`, which a forged delegation could copy), until they expire.
const verified = new Map<string, Verified>();
const sha = (value: string) => createHash("sha256").update(value).digest("base64url");

/** A public P-256 key: Session JWTs are always ES256 (§5.2). */
function publicP256(jwk: any) {
  return (
    jwk &&
    typeof jwk === "object" &&
    !Array.isArray(jwk) &&
    !privateKeyFields.some((field) => field in jwk) &&
    jwk.kty === "EC" &&
    jwk.crv === "P-256" &&
    typeof jwk.x === "string" &&
    typeof jwk.y === "string"
  );
}

/**
 * Verify a Session JWT's delegation (steps 1–3 of "Delegated keys") and return
 * the delegated key to verify the Session JWT with, and the delegation's `exp`.
 */
export async function delegatedKey(header: any, jwks: any, clientId: string) {
  if (typeof header.pap_dlg !== "string")
    throw fail(
      "Sign Session JWTs with a delegated key and carry its delegation in the pap_dlg header; keys in jwks_uri sign only client assertions and delegations.",
    );
  const delegation = await verifyDelegation(header.pap_dlg, jwks, clientId);
  if (header.kid !== (await calculateJwkThumbprint(delegation.jwk)))
    throw fail("The Session JWT's kid must be the delegated key's RFC 7638 thumbprint.");
  return { key: await importJWK(delegation.jwk, "ES256"), exp: delegation.exp };
}

async function verifyDelegation(token: string, jwks: any, clientId: string): Promise<Verified> {
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = `${clientId}:${sha(token)}`;
  const cached = verified.get(cacheKey);
  if (cached) {
    if (cached.exp <= now) throw fail("The delegation has expired.");
    return cached;
  }
  let header: any;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw fail("Malformed delegation.");
  }
  if (header.typ !== delegationTyp) throw fail(`The delegation's typ must be ${delegationTyp}.`);
  if (typeof header.kid !== "string") throw fail("The delegation's kid must name a key in jwks_uri.");
  if (!delegationAlgorithms.includes(header.alg)) throw fail("A delegation is signed with ES256 or PS384.");
  let payload: any;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: clientId,
      typ: delegationTyp,
      algorithms: delegationAlgorithms,
      requiredClaims: ["iss", "iat", "exp", "jti", "cnf"],
      clockTolerance: 5,
    }));
  } catch (error) {
    throw fail(
      error instanceof errors.JWTExpired
        ? "The delegation has expired."
        : "The delegation's signature, issuer or claims don't check out against jwks_uri.",
    );
  }
  if (
    typeof payload.jti !== "string" ||
    payload.jti.length < 16 ||
    typeof payload.iat !== "number" ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > maxLifetimeSeconds
  )
    throw fail("A delegation lasts at most 24 hours and has an unguessable jti.");
  if (!publicP256(payload.cnf?.jwk)) throw fail("cnf.jwk must be a public P-256 key: Session JWTs are ES256.");
  const value: Verified = { exp: payload.exp, jwk: payload.cnf.jwk };
  if (verified.size >= maxCached) {
    for (const [key, entry] of verified) if (entry.exp <= now) verified.delete(key);
    if (verified.size >= maxCached) verified.delete(verified.keys().next().value!);
  }
  verified.set(cacheKey, value);
  return value;
}
