# Poppy 0.3 (published draft)

This store targets the published draft 0.3 ([spec](https://personalagentprotocol.org/docs/0.3/spec.md), [guides](https://personalagentprotocol.org/docs/0.3/guides.md), [changelog](https://personalagentprotocol.org/docs/changelog.md)), the Operations extension version 2 and the Mediated Sign-In extension version 1. It replaces 0.2 and the earlier delegated-keys draft: agents built for either can't use this store. Sign-in details: [SIGN-IN.md](SIGN-IN.md).

## What the store does

| Area | Behavior |
| --- | --- |
| Discovery (§3) | `poppy.json` has `protocol_version` `"0.3"`, `auth.issuer` (optional in 0.3, kept and equal to the protected resource metadata), `auth.scopes` and `auth.scope_hints`, and `extensions` `operations` `{"version":"2"}` and `mediated-sign-in` `{"version":"1", fields, scopes}`. `/.well-known/oauth-protected-resource` (RFC 9728) has `resource` `https://{hostname}` and `authorization_servers`. The issuer metadata (RFC 8414) lists `token_endpoint`, `revocation_endpoint`, `device_authorization_endpoint`, `grant_types_supported` (`refresh_token`, `authorization_code` when Direct is offered, `device_code`, the Mediated Sign-In grant), `scopes_supported`, `protected_resources` `["https://{hostname}"]` (a loopback demo: `https://localhost`), `private_key_jwt` with `ES256`/`PS384` (plus `RS256`, `EdDSA`), `client_id_metadata_document_supported`, and for Direct `authorization_endpoint`, `code_challenge_methods_supported` `S256` and `authorization_response_iss_parameter_supported`. The hosted Agent Sandbox leaves out Direct: no `authorization_code`, no `authorization_endpoint`, `/oauth/authorize` is 404. |
| Scopes | `orders:read`, `orders:write`, `addresses`, described in `auth.scopes` and the OpenAPI document, with hints (`none`/`irreversible`/`reversible`, all personal). Mediated Sign-In grants only `orders:read orders:write`. A grant never exceeds the request; approving no scope is a decline. |
| Client assertions (§4.1) | RFC 7523, signed directly by a `jwks_uri` key: `iss` = `sub` = `client_id`, `aud` = the issuer as one string, at most 5 minutes, `jti` of at least 16 characters, reuse refused. A delegated key (`pap_dlg`) or a Session JWT `typ` is refused with `invalid_client`. |
| Session header (§5) | `Poppy-Session` on every `/api/*` request, including public reads: a Session JWT (`typ` `poppy-session+jwt`, ES256) signed by a delegated key, with the delegation (`pap-delegation+jwt`, ES256 or PS384, from a `jwks_uri` key, at most 24 h, public P-256 `cnf.jwk`) in `pap_dlg` and `kid` = the delegated key's thumbprint. Claims checked: `iss`, `aud` = issuer, `sid` (ID characters), `sub`, optional `agent_id`, `htm`, `htu` (normalized, no query), `iat` within 60 s and not after the delegation's `exp`, `jti` (used once), and `ath` exactly when an access token is sent. Exactly one header. Verified delegations are cached until they expire. Every failure, a refused `client_id`, an access token without the header, or a missing header: 400 `{"error":"invalid_session"}` with no challenge. |
| Sessions | Keyed by `client_id` + `sid`. An unknown `sid` starts a signed-out Session; a known one must keep its `sub` and `agent_id`. A Session is signed in on requests that carry an access token. The first account used in a Session is kept; another account there gets `invalid_session` (§5.4 MAY). Sessions last 30 days; ended `sid`s are refused for 90 days. |
| Tokens (§4) | Plain OAuth: `{access_token, token_type: "Bearer", expires_in: 3600, refresh_token, scope}`. No DPoP (the Company's choice in 0.3), no `refresh_token_expires_in`, no session fields. `refresh_token` takes an optional narrower `scope` and an optional `resource` (`https://{hostname}` or the origin; others `invalid_target`); refresh tokens last 30 days and aren't rotated. Revoking a refresh token (RFC 7009) invalidates its access tokens at once; the Sessions continue signed out. The JWT-bearer grant, session tokens and Session Keys are gone. |
| Errors (§7) | Signed out at an account endpoint: 401 `WWW-Authenticate: Bearer scope="…"`, no error code. Missing scope: 403 `Bearer error="insufficient_scope", scope="…"`. Bad, expired or revoked access token: 401 `Bearer error="invalid_token"`. `extension_required`: 403 with `Bearer error="extension_required", extension="operations"` (and the JSON body). Rate limits: plain 429 with `Retry-After`, no `rate_limited` code. `account_mismatch` is gone. |
| Operations v2 | Ordering and reordering answer 403 `{"error":"approval_required","operation":{operation_id, revision, summary, terms, expires_at}}` and do nothing else. The same request again returns the same operation (concurrent ones converge). The same request with `Poppy-Approval: operation_id="…", revision="…"` (RFC 9651 Dictionary; malformed or unknown is ignored) from a Session that can approve it, for the current unexpired revision, places the order once and returns it (201); retries return the same order. A revision named for a different request, or an expired one, gets a new revision (same `operation_id` while unperformed). Guest operations belong to their Session; account operations to any Session of the same agent and User signed in to that account; a signed-out Session of that User gets the account challenge. A client that doesn't list `operations` `"2"` gets `extension_required`. The 202/confirm/cancel endpoints and `Idempotency-Key` are gone. Shirt orders still need the store's preview approval (`/api/shirt-preview-approvals/{id}`, string `revision`) before the approval is accepted. |
| Mediated Sign-In v1 | The extension grant `https://personalagentprotocol.org/grant/mediated-sign-in` at `/oauth/token` with the client assertion: `scope` + `email` → 400 `{"error":"code_required", sign_in_id, sent_to, expires_in}`; then `sign_in_id` + `one_time_code` only → tokens. Wrong code: `code_required` until 5 tries, then `invalid_grant`; expired: `expired_token`; unknown or another client's sign-in: `invalid_grant`. `auth.mediated` and `/api/poppy/sign-in` are gone. |
| Device (§4.3) | RFC 8628, bound to the `client_id` only (no key binding). |
| Direct (§4.2) | PKCE S256, `state`, `iss` on every redirect. No `dpop_jkt`. |
| Not offered | Browser join (`web.browser_session_endpoint` left out), DPoP, MCP and Token Exchange, excluded tasks and feedback (optional). |

Saved addresses, reorder and the sandbox modes carry over unchanged, with ordering through Operations v2.

## Agents

The demo agent (`/api/demo/agent.json`) lists `operations` version 2. `scripts/poppy-delegation.ts` (`poppyAgent`) is the reference signer: client assertions with the `jwks_uri` key, Session JWTs with per-User delegated keys. `scripts/agent.ts`, `scripts/signin-e2e.ts` and the tests use it.

## Validation

- `npm test`: 89 tests. `tests/pap-03.test.ts` covers discovery, client assertions, delegation and Session JWT checks, Sessions, tokens and error shapes; the commerce, sandbox and sign-in suites run on the Session header and Operations v2.
- `npm run test:cloudflare` (or `RUNTIME_SKIP_MEDIA=1 npm run test:cloudflare` without Docker): the Workers runtime contracts.
- `npm run test:e2e:signin` against a running demo store prints a redacted transcript of every offered sign-in type, ordering and reordering with approvals, refresh, revocation and continuing signed out.
- The protocol site's kit (`implement-personal-agent-protocol.zip`) validator checks `poppy.json` offline (`--file`); its live checks need an HTTPS deployment.

Spec questions found on the way: [SPEC-FEEDBACK-0.3.md](SPEC-FEEDBACK-0.3.md).

## Review against the published draft (2026-10-28)

Checked against the published [0.3 specification](https://personalagentprotocol.org/docs/0.3/spec.md), [Operations v2](https://personalagentprotocol.org/docs/0.3/extensions/operations.md), and [Mediated Sign-In v1](https://personalagentprotocol.org/docs/0.3/extensions/mediated-sign-in.md). This is an implementation review of the advertised API/sign-in features, not certification of every optional protocol feature or an external agent's interoperability.

| Requirement | Implementation / regression coverage |
| --- | --- |
| Discovery, issuer/resource association, advertised grants and scopes | `server/routes.ts`; discovery checks in `tests/pap-03.test.ts` |
| Directly signed client assertions; exact issuer audience; ES256 and PS384 | `server/auth.ts`; client assertion tests |
| Delegated ES256 Session signatures, delegation expiry, key thumbprints, method/URL and token hash | `server/delegation.ts`, `server/auth.ts`; delegation and Session-header tests |
| Stable client/session/user identity, rotating delegated keys, account binding, ended sessions | `server/sessions.ts`; Session tests use fresh delegated keys across requests |
| OAuth account permissions, refresh narrowing, revocation and error challenges | `server/accounts.ts`, `server/http-errors.ts`; token/error and sign-in tests |
| Direct PKCE/consent, Device polling/consent, Mediated OTP | `server/signin.ts`, `server/device.ts`, `server/mediated.ts`; `tests/signin-types.test.ts` and `tests/pap-03.test.ts` |
| Operations v2 exact-revision approval, ownership, expiry, retries and at-most-once ordering | `server/commerce.ts`; `tests/commerce.test.ts` |
| Structured approval headers, including unknown members and quoted commas | RFC 9651 parser with explicit String-only identifiers; parser and order/retry regression tests |
| Metadata fetch protections | `server/protocol-http.ts`; network/redirect tests; isolated local interop exceptions remain explicit |

DPoP-bound OAuth tokens are optional and intentionally not advertised. Browser join, MCP, conversations, feedback and excluded tasks are not advertised; they are not implemented by this API-only store. Mediated Sign-In remains a transitional compatibility option: the extension recommends retiring it once Direct/Device cover its scopes. Prefer Direct/Device and do not describe mediated sign-in as the preferred long-term flow.

### Release gates

- Deploy verification must expect protocol `0.3` and Operations `2` (not the old `0.2` assertion).
- Run CI and the local Cloudflare runtime/provider-fixture checks on the final commit.
- Run an independent agent against a sandbox before production. On 2026-10-28, `https://poppydemoagent.dev/poppy/client.json` still advertised Operations `1`; that deployment cannot order through this store's Operations `2` contract. Recheck its metadata and perform the actual flow; a version claim alone is insufficient.
- This is a breaking native-protocol upgrade. Existing 0.2 native sessions/tokens do not establish 0.3 access; agents need the new transport and account sign-in. HTTP compatibility is a separate path, not evidence of native interoperability.
