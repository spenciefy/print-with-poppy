# Poppy 0.2 upgrade

This implementation targets the [0.2 draft](https://personalagentprotocol.org/docs/0.2/spec) and [Operations v1](https://personalagentprotocol.org/docs/0.2/extensions/operations), reviewed against upstream commit [`39b35bd`](https://github.com/personal-agent-protocol/personal-agent-protocol/commit/39b35bd) on October 20, 2026. Optional MCP, conversations, browser sessions, device sign-in and feedback are not advertised or implemented by this upgrade.

## What changes and why

| Change | Reason |
| --- | --- |
| Discovery advertises `protocol_version: "0.2"`; reference client checks this version | Pre-1.0 minor versions can break compatibility. An agent must explicitly support this version. |
| Client and Session assertion `aud` equals the exact `auth.issuer`, including revocation | Prevents a hostile company from collecting assertions addressed to another company's endpoint. Endpoint audiences and audience arrays are rejected. DPoP `htu` still identifies the actual endpoint. |
| Assertions accept lifetimes up to five minutes and remember used IDs through expiry plus clock tolerance | Accepts valid 0.2 clients without opening a replay window. Bad client assertions return `401 invalid_client`; bad Session assertions return `400 invalid_grant`. |
| Exactly one DPoP header, asymmetric public-only JWK, normalized URI comparison and endpoint-specific errors | Implements the clarified RFC 9449 rules. Token proof failures return 400; resource proof failures return 401 with a DPoP challenge. ES256 and existing token-hash, key-binding, method, time and replay checks remain. Revocation needs only its client assertion, not DPoP. |
| Agent metadata/JWKS fetched over HTTPS with no redirects, checked DNS results at connection time and bounded response sizes/timeouts | Stops a peer-controlled URL from reaching private infrastructure, including DNS rebinding. Existing exact client allowlisting and same-origin JWKS/callback policy remain. Concurrent fetches share work; failed fetches back off for 30 seconds; successful metadata stays cached for five minutes. Signature failures do not trigger repeated key fetching. |
| Consistent rate-limit JSON, extension authentication challenges and `sign_in_not_found` | Lets agents identify protocol failures reliably. Existing `message` remains for compatibility; OAuth-style `error_description` is also returned. |
| Account-linked operations can be read, confirmed, cancelled and have shirt previews approved from a new session of the same agent/User ID/account | Allows recovery after a session ends without duplicating an order. Every request still checks the effective account and scope. Wrong identities get `operation_not_found`; a signed-out matching identity gets `sign_in_required`. Guest operations remain session-owned. |
| Agent guidance checks the readable summary against structured terms | Avoids approving mismatched order details. Explicit user approval and shirt-preview approval are still required. |

New operations persist the verified agent/User ID privately; old operations use their original stored session to recover those values. The original owner continues to own the photos, order and jobs, so cross-session recovery does not change fulfillment ownership or downstream idempotency keys. No database migration is required.

The application/OpenAPI product version is separate from `protocol_version`; Operations remains version `1`. The HTTP guest API remains separate from Poppy and retains the existing `ALLOW_COMPAT_AGENT_SESSIONS` switch. This upgrade does not enable or disable it in any deployed environment.

## Validation

- `npm run check`: build and 64 tests, including issuer-audience rejection, five-minute assertion limits, replay protection, duplicate/missing DPoP headers, private JWK rejection, URI normalization, protocol errors, account-bound recovery and sign-out isolation.
- Local reference-agent order with `ALLOW_COMPAT_AGENT_SESSIONS=false`: discovery → native session → upload → proposal → approval → simulated payment → printing → shipment → two captured emails; order provenance is `native-poppy`.
- Upstream Company validator, offline discovery check against this server's generated discovery document with an HTTPS example origin: six passed, three network checks skipped. This is not a full hosted conformance test.
- Read-only HTTPS fetches of Poppy Demo Agent's public client document and JWKS succeed through the new network policy.

No real payment, printing or email delivery was triggered. Hosted PDA browser ordering, public HTTPS conformance checks, and sandbox/production deployment are rollout checks, not claimed results of this PR.

## Rollout

1. Deploy this branch to the isolated Agent Sandbox backend first. Keep `ALLOW_COMPAT_AGENT_SESSIONS=false`, the sandbox's distinct `PUBLIC_URL`/issuer and storage, and provider payment/fulfillment secrets absent. A Vercel frontend preview that still rewrites to the old backend is not a 0.2 test environment.
2. Confirm `/.well-known/poppy.json` advertises 0.2. Run the upstream Company validator against that HTTPS host with an explicitly registered test identity and `/api/account` as the authenticated probe.
3. Confirm PDA supports 0.2 and signs both assertions for `auth.issuer`. Test guest ordering, mediated email/OTP sign-in, Account Token refresh into a new session, recovery of an account-linked proposal, approval, simulated payment, status and confirmation email capture. Test direct sign-in/PKCE in a separate non-agent-sandbox staging configuration, since Agent Sandbox deliberately does not advertise direct sign-in.
4. Verify `orderingMethod: "native-poppy"`; do not silently use the HTTP guest API to make a failing native test pass.
5. Coordinate production deployment with native agent maintainers. Old 0.1 clients cannot start or renew sessions using endpoint audiences. Existing opaque tokens are not bulk-revoked by this change, but expire normally; already accepted orders continue through fulfillment. Private order status URLs and HTTP guest clients remain usable according to the existing compatibility flag.

If rolling back, restore code and discovery together to 0.1 and tell agents to use that version's assertion audiences again. Do not advertise one version while accepting the other's authentication rules. Do not clear orders or replay tables as part of a rollback.

Local demos deliberately permit loopback HTTP; hosted origins require HTTPS. The local demo identity is not evidence of public client-metadata verification.
