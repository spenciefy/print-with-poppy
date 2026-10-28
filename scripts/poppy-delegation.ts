/**
 * A Poppy 0.3 Personal Agent signer, for the reference agents and tests.
 *
 * - Client assertions (RFC 7523, §4.1) are signed directly by the key from the
 *   agent's jwks_uri, with aud = the Company's issuer.
 * - Session JWTs (§5.2, the Poppy-Session header) are signed per request by a
 *   delegated ES256 key, carrying a `pap-delegation+jwt` delegation from the
 *   jwks_uri key in `pap_dlg`. Each delegated key signs for one User ID only.
 *
 * A real agent keeps the jwks_uri key in its own key custody (or signs
 * blindly, §10.7); these helpers keep everything in memory.
 */
import { SignJWT, calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK } from "jose";
import { createHash, randomBytes } from "node:crypto";

export const jti = () => randomBytes(18).toString("base64url"); // 144 bits.
export const sha256 = (s: string) => createHash("sha256").update(s).digest("base64url");

export async function poppyAgent(
  rootPrivateJwk: any,
  clientId: string,
  issuer: string,
  options: { delegationSeconds?: number } = {},
) {
  const alg = rootPrivateJwk.alg || (rootPrivateJwk.kty === "RSA" ? "PS384" : "ES256");
  const root = await importJWK(rootPrivateJwk, alg);
  const kid = rootPrivateJwk.kid || "demo";
  const lifetime = options.delegationSeconds ?? 3600;
  // One delegated key per User ID (§5.2).
  const delegated = new Map<string, { delegation: string; exp: number; kid: string; key: CryptoKey }>();

  /** A client assertion for the token, device or revocation endpoint. */
  async function clientAssertion() {
    return new SignJWT({})
      .setProtectedHeader({ alg, kid, typ: "JWT" })
      .setIssuer(clientId)
      .setSubject(clientId)
      .setAudience(issuer)
      .setIssuedAt()
      .setExpirationTime("60s")
      .setJti(jti())
      .sign(root);
  }
  const clientAuth = async () => ({
    client_id: clientId,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: await clientAssertion(),
  });
  async function delegationFor(userId: string) {
    const now = Math.floor(Date.now() / 1000);
    const current = delegated.get(userId);
    if (current && current.exp - now > 120) return current;
    const pair = await generateKeyPair("ES256", { extractable: true });
    const jwk = await exportJWK(pair.publicKey);
    const delegation = await new SignJWT({ cnf: { jwk } })
      .setProtectedHeader({ alg, typ: "pap-delegation+jwt", kid })
      .setIssuer(clientId)
      .setIssuedAt(now)
      .setExpirationTime(now + lifetime)
      .setJti(jti())
      .sign(root);
    const value = { delegation, exp: now + lifetime, kid: await calculateJwkThumbprint(jwk), key: pair.privateKey };
    delegated.set(userId, value);
    return value;
  }
  /** The Poppy-Session header value for one request. */
  async function sessionJwt(s: { sid: string; sub: string; agentId?: string }, method: string, url: string, accessToken?: string) {
    const d = await delegationFor(s.sub);
    return new SignJWT({
      sid: s.sid,
      ...(s.agentId ? { agent_id: s.agentId } : {}),
      htm: method,
      htu: url.split(/[?#]/)[0],
      ...(accessToken ? { ath: sha256(accessToken) } : {}),
    })
      .setProtectedHeader({ alg: "ES256", typ: "poppy-session+jwt", kid: d.kid, pap_dlg: d.delegation })
      .setIssuer(clientId)
      .setSubject(s.sub)
      .setAudience(issuer)
      .setIssuedAt()
      .setJti(jti())
      .sign(d.key);
  }
  /** A new Session: a random sid for this User ID. */
  const newSession = (sub: string, agentId?: string) => ({ sid: jti(), sub, ...(agentId ? { agentId } : {}) });
  return { clientAssertion, clientAuth, sessionJwt, newSession, delegationFor };
}

/** One delegation for a fresh delegated key, for building custom Session JWTs in tests. */
export async function delegate(
  rootPrivateJwk: any,
  clientId: string,
  claims: { iat?: number; exp?: number; iss?: string; typ?: string; kid?: string; cnf?: unknown; alg?: string } = {},
) {
  const alg = claims.alg ?? "ES256";
  const root = await importJWK(rootPrivateJwk, alg);
  const pair = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(pair.publicKey);
  const iat = claims.iat ?? Math.floor(Date.now() / 1000);
  const exp = claims.exp ?? iat + 3600;
  const delegation = await new SignJWT({ cnf: claims.cnf ?? { jwk } })
    .setProtectedHeader({ alg, typ: claims.typ ?? "pap-delegation+jwt", kid: claims.kid ?? rootPrivateJwk.kid ?? "demo" })
    .setIssuer(claims.iss ?? clientId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(jti())
    .sign(root);
  return { delegation, key: pair.privateKey, jwk, kid: await calculateJwkThumbprint(jwk), exp };
}
