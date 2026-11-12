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

The reference client sends 0.4 headers and Operations v3 approvals; it never uses HTTP compatibility as fallback. A passing local reference run is not a hosted PDA run. PDA is assumed to support 0.4 for rollout, but its hosted UI must still be checked against the deployed sandbox before claiming observed PDA interoperability.

## Rollout

Merge through GitHub, then use the existing Cloudflare deployment workflow. Do not deploy an unmerged worktree. Both production and sandbox must be deployed and their discovery checked independently.

This is a single-version 0.4 upgrade, not simultaneous 0.3 support. Older clients must refresh discovery and start a new Session. Existing stored customer/order records are retained; old Session identities are not carried into the new version. Check sandbox discovery, account connection, sample upload, proposal, approval, simulated payment and order status with a 0.4 agent before a real checkout. Never infer payment or physical fulfillment from proposal acceptance.
