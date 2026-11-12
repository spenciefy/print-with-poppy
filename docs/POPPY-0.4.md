# Poppy 0.4 implementation

This upgrade targets the published [0.4 core specification](https://personalagentprotocol.org/docs/0.4/spec) and [Operations v3](https://personalagentprotocol.org/docs/0.4/extensions/operations), frozen in the official specification repository at `ad20217d3cb97f50345d41748a393600d6e8c779`. It does not target the later, in-progress specification.

## What changes from 0.3

| Area | Store behavior in 0.4 |
| --- | --- |
| Version selection | Every native request carrying `Poppy-Session` must include `Poppy-Version: 0.4`. Missing or unsupported versions return JSON `400 version_unsupported`. |
| Extensions | Discovery lists arrays of versions: Operations `3`, Mediated Sign-In `1`. The agent declares `Poppy-Extensions: "operations";v="3"` on each relevant request. Agent metadata no longer enables extensions. Malformed lists declare none; unknown extensions are ignored. |
| Session identity | Sessions are keyed by client identity, Session ID and User ID. Agent ID is recorded once, not compared on each request. Ended Sessions return `session_ended`. |
| Approval | `terms` contains the effects and conditions. `Poppy-Approval` requires `approver="user"` or `approver="agent"`; optional time, input type and reference are recorded. Agent approval requires prior user authorization. |
| Ownership | A guest operation can be approved in a new signed-out Session of the same agent and User, even after the original Session ends. Account operations additionally require the same account and appropriate scope. |
| Changed terms | Failed revision/request checks return revised terms for the same operation; an approval never silently accepts changed terms. Duplicate approvals return the existing order. |
| Declines | Custom shirts require user approval and preview confirmation. Agent approval returns `approval_declined` without creating an order or replacement proposal. |
| Sign-in | Direct Sign-In is available in sandbox as well as production, alongside Device and Mediated Sign-In. Company pages name the connecting agent and warn against unsolicited sign-in links. |

## Customer experience

Browsing and guest ordering remain available. Account connection still uses email verification, with scoped OAuth access and no password given to the personal agent. Signed-in customers retain saved addresses, order history and reordering. Bearer access tokens remain the normal path; 0.4 does not make DPoP mandatory.

The agent presents the order terms, gets approval (or uses an applicable prior user instruction), and retries the exact request. Stripe checkout remains a separate payment step. Shirt mockups still require explicit user confirmation. HTTP compatibility ordering is a separate, configurable store API and is not evidence of native Poppy interoperability.

## Scope

PWP implements the native API interface, signed introductions and delegated Session proofs, OAuth Direct/Device/Mediated Sign-In, and Operations v3. It does not advertise conversations, MCP, UCP, browser joining, browser operation endpoints, or tasks. Their 0.4 changes require no new endpoints in this API-only store. Optional capabilities must not be advertised until implemented.

## Validation

- `npm test`: protocol negotiation, signature/replay checks, Session and account isolation, approval parsing, cross-Session ownership, changed terms, decline policy, duplicate execution, sign-in and existing commerce behavior.
- `npm run test:cloudflare`: builds the actual Worker, runs local Durable Object/R2/queue/container contracts, all three sign-in flows, account history/reorder/revocation, and a reference native agent order with artwork, shirt previews and simulated payment/fulfillment.
- `npm run test:cloudflare:production`: separate production-shaped runtime checks; no real payment is made by the local demo harness.

The reference client sends 0.4 headers and Operations v3 approvals; it never uses HTTP compatibility as fallback. A passing local reference run is not a hosted PDA run. PDA has reported 0.4 interoperability results in issue #35; its hosted UI must still be checked against the deployed sandbox before claiming observed PDA interoperability.

## Rollout

Merge through GitHub, then use the existing Cloudflare deployment workflow. Do not deploy an unmerged worktree. Both production and sandbox must be deployed and their discovery checked independently.

This is a single-version 0.4 upgrade, not simultaneous 0.3 support. Older clients must refresh discovery and start a new Session. Existing stored customer/order records are retained; old Session identities are not carried into the new version. Check sandbox discovery, account connection, sample upload, proposal, approval, simulated payment and order status with a 0.4 agent before a real checkout. Never infer payment or physical fulfillment from proposal acceptance.

## Compliance audit and independent checks (#35)

Issue #35 exposed a real interoperability defect: the server and reference client
both used earlier-draft `pap_dlg` / `pap-delegation+jwt` names. Passing their shared
tests did not establish compatibility. The published wire names are **`poppy_dlg`**
and **`poppy-delegation+jwt`**. Old aliases are deliberately not accepted as 0.4.

This audit covers the Company's obligations for the interfaces PWP advertises,
not every optional feature in the protocol. The specification is authoritative;
the official kit is additional independent evidence, not certification.

| Published requirement | Implementation and verification |
| --- | --- |
| §3 discovery, issuer and resource binding | `server/routes.ts`; HTTPS production discovery, exact issuer/resource metadata, scope descriptions/hints. `official-04.test.ts` validates real discovery responses against unmodified official schemas. `pap-04.test.ts` checks cross-document consistency. |
| §3 URL safety and redirects | `server/protocol-http.ts`, `server/protocol-url.ts`, Cloudflare protocol-fetch service; HTTPS, no metadata redirects, public-address checks. `protocol-http.test.ts`, `interop-network.test.ts`, and Cloudflare runtime checks. Private Docker-grid exceptions remain opt-in and unavailable in normal hosted deployments. |
| §3.4 protocol and extension selection | `server/protocol-version.ts`; requires 0.4 before using Session state, Operations version 3 per request, ignores unknown extensions and treats malformed lists as absent. Covered by `pap-04.test.ts`. |
| §4.1 agent identity and client assertions | `server/auth.ts`; allowlisted HTTPS metadata identity, matching public JWKS, exact issuer audience, root-key assertions, ES256 and recommended PS384, short lifetime and replay rejection. Invalid assertions return `invalid_client`, not 500. `pap-04.test.ts`, `commerce.test.ts`. |
| §4.2 Direct Sign-In | `server/signin.ts`; company-hosted email OTP, explicit scoped consent, agent identity and anti-phishing copy, browser/CSRF binding, exact registered callback (loopback-port exception), S256 PKCE, single-use code, state and issuer response. Unit/integration tests plus `signin-e2e.ts` on Workers. |
| §4.3 Device Sign-In | `server/device.ts`; pending/slow-down/expiry/denial, company verification page, link alone grants nothing, OTP and explicit consent. Tests cover wrong client, reuse and scope escalation. Workers runtime uses the official-kit signer for the account flow. |
| §4.4–4.7 tokens, scopes, revocation | `server/accounts.ts`; Bearer tokens, same-client account grants, no extra scopes, narrowing refresh and immediate revocation, OAuth error/challenge semantics. DPoP token binding is optional and not advertised. Tests cover account history, saved addresses, reorder and sign-out. |
| §5.2 delegated Session proofs | `server/delegation.ts`; published header/type, root signature, public P-256 key, thumbprint, issuer, expiry and ≤24-hour lifetime; rejects malformed times and known prohibited user/company claims. Cache keys hash the full verified delegation. Tests accept official-kit proofs and reject obsolete names, direct root signatures, wrong keys, excessive lifetime and private JWKs. |
| §5.3–5.6 Session verification, identity and ending | `server/auth.ts`, `server/sessions.ts`; exact audience, method/URL binding, freshness/replay checks, access-token hash and client binding, `(client_id, sid, sub)` continuity, Agent ID recorded once, account-switch rejection and ended Sessions. Account tokens never substitute for Session proofs. Reference retries honor Retry-After and rebuild proofs. |
| §7 native APIs and errors | All advertised APIs accept Session headers; private endpoints require them. OAuth challenges are distinct from `400 invalid_session`, `session_ended`, and `version_unsupported`. HTTP compatibility is separate and is never a native fallback in the tests. |
| Operations 3 §§2–7 | `server/commerce.ts`, `server/approval-response.ts`; explicit version negotiation, immutable terms/revision, required approver, optional audit fields, ownership across Sessions, exact request checks, refreshed revision for changed/expired terms, user-only shirt preview policy and `approval_declined`. Stored results and transactions ensure at-most-once order creation on concurrent approvals/retries. `commerce.test.ts` and official-signed Workers tests verify these paths and validate returned operations against the official schema. |
| Mediated Sign-In 1 | `server/mediated.ts`; advertised grant/fields/scopes, email-code continuation, client binding, expiry and one-time use; no unrequested scopes. All three sign-in flows are asserted in the Workers harness. See the recommendation exception below. |
| §§6, 8, 9 and other optional extensions | Browser joining/operations, Company conversations/handoff, MCP/UCP, tasks/skills and feedback endpoints are not advertised or implemented. There is no claim of support for those interfaces. |
| §10 security and privacy | Keys remain outside customer-facing/model responses; metadata fetches are constrained; private media uses expiring signed URLs; user/account isolation and approval are enforced server-side. Production-shaped tests keep sandbox helpers and private-network exceptions unavailable. Agent-side credential custody, unique per-company identities and taking approval through the agent UI remain the Personal Agent's obligations. |

**Recommendation exception:** Mediated Sign-In 1 says Companies SHOULD retire it
once Direct/Device cover its scopes. PWP retains it as an explicit interoperability
demo for existing agents, while recommending Direct Sign-In. This is a documented
SHOULD exception, not a mandatory 0.4 requirement or the preferred login experience.

**Independent fixtures:** `tests/vendor/poppy-0.4` contains unmodified schemas,
validator and signer from upstream commit
`53fcb21a647d841763b1608c959c52ceaa5387b8` (before the kit moved to the 1.0 draft),
with license, provenance and SHA-256 checks. Tests validate our reference-client
output against those schemas. The Workers contract run uses the official signer
for its positive Session/OAuth requests, including uploads, account access,
proposal, approval, concurrent retry and reorder. Local HTTP transport is a test
exception; discovery schema tests use an HTTPS public origin.

**Release evidence:** local checks are distinct from a deployed PDA test. After
merging, deploy production and sandbox separately. Deployment checks wait for
Durable Object propagation and verify the published proof contract as well as the
version. Then rerun PDA's sandbox grid/UI through login, upload, proposal, approval,
simulated payment, history and revocation. Do not describe the hosted PDA flow as
verified until that run succeeds. Simulated fulfillment does not prove a real
Stripe payment, email delivery or physical shipment.
