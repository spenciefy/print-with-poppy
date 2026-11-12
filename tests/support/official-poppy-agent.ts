/** Adapter around the unmodified official 0.4 signer; never imports our signer. */
import { generateKey, importPrivateJwk, randomId, signDelegation, signSessionJwt, signJwt } from "../vendor/poppy-0.4/jose.js";
export async function officialAgent(privateJwk: any, clientId: string, issuer: string) {
  const root = await importPrivateJwk(privateJwk);
  const keys = new Map<string, { key: Awaited<ReturnType<typeof generateKey>>; delegation: string }>();
  return {
    newSession: (sub: string) => ({ sid: randomId(), sub }),
    async clientAuth() {
      const now = Math.floor(Date.now() / 1000);
      return {
        client_id: clientId,
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await signJwt({ alg: "ES256", kid: root.publicJwk.kid },
          { iss: clientId, sub: clientId, aud: issuer, iat: now, exp: now + 60, jti: randomId() }, root.privateKey),
      };
    },
    async sessionJwt(s: { sid: string; sub: string }, method: string, url: string, accessToken?: string) {
      let pair = keys.get(s.sub);
      if (!pair) {
        const key = await generateKey();
        pair = { key, delegation: await signDelegation({ root, delegated: key.publicJwk, iss: clientId }) };
        keys.set(s.sub, pair);
      }
      return signSessionJwt({ ...pair, iss: clientId, aud: issuer, ...s, method, url, accessToken });
    },
  };
}
