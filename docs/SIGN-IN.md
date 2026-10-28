# Sign-in types (Poppy 0.2 §4.4–4.8)

Print with Poppy is a Company for all three Poppy 0.2 sign-in types. Every type signs the customer in with a six-digit emailed code (no passwords), ends with an Account Token (`refresh_token`, 30 days, not rotated) plus a signed-in DPoP Session Token (1 hour) for the agent's current Session, and grants `poppy:read` and/or `poppy:write`.

| Type | Discovery | Where the customer signs in | Advertised |
| --- | --- | --- | --- |
| Direct (§4.5) | `auth.direct.scopes`, `authorization_endpoint` | Store page in their browser, then a redirect to the agent | Live, plain demo. Not in the hosted Agent Sandbox (unchanged upstream choice). |
| Device (§4.6) | `auth.device.scopes`, `device_authorization_endpoint` | Store page at `/device` on any device, from a link and code the agent shows | Live, plain demo, Agent Sandbox |
| Mediated (§4.7) | `auth.mediated` (`endpoint`, `fields: [email]`) | Agent's own secure UI: email, then the emailed code | Live, plain demo, Agent Sandbox |

See [ACCOUNTS.md](ACCOUNTS.md) for account behavior and [SANDBOX.md](SANDBOX.md) for the hosted sandbox.

## Device Sign-In

1. **Start:** `POST /oauth/device` (form-encoded) with `scope` and `private_key_jwt` client authentication (`client_assertion` with `aud` = `auth.issuer`). No DPoP proof and no Session Token. Returns `device_code`, `user_code` (`XXXX-XXXX` from the RFC 8628 §6.1 alphabet), `verification_uri` (`{origin}/device`), `verification_uri_complete`, `expires_in` (600) and `interval` (5). Errors: `invalid_client` (401), `invalid_scope`, `rate_limited` (429 + `Retry-After`; 30 starts per agent per 10 minutes).
2. **Show:** the agent checks that the link's host is the issuer's host or a `poppy_domains` entry (or a subdomain), and shows the link and user code with the store's `organization.name` and domain. It keeps `device_code` private.
3. **Person:** opening the link only shows a prefilled code form. Submitting it shows the agent's `client_name`, `logo_uri` and `client_id` host, and the code to compare with the agent's. They sign in with an emailed code, then choose some or all requested scopes, or deny.
4. **Poll:** `POST /oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `device_code`, `session_id`, client authentication and a DPoP proof, every `interval` seconds.

| Poll answer | When |
| --- | --- |
| `authorization_pending` (400) | Waiting for the person |
| `slow_down` (400) | Polled faster than `interval` (1 s grace); `interval` grows by 5 s and is returned in the body |
| `access_denied` (400) | The person denied; repeated on later polls |
| `expired_token` (400) | Past `expires_in`; repeated on later polls |
| `invalid_grant` (400) | Unknown code, another agent's code, a code bound to another Session, or a code already redeemed |
| `invalid_session` (400) | Missing `session_id`, or a Session of another agent |
| `account_mismatch` (400) | The Session is or was signed in to another account; no tokens, and the code is spent |
| 200 | Account Token + signed-in Session Token for `session_id`, with the approved `scope` |

The first Session to poll a device code owns it; only that Session can redeem it. A code is redeemed once. Raw user codes, device codes and email codes are never stored (keyed hashes only) or logged.

## Direct Sign-In

`GET /oauth/authorize` with `response_type=code`, a registered `client_id`, a `redirect_uri` that exactly matches its metadata `redirect_uris`, `scope`, a random `state`, and an S256 `code_challenge`. Until `client_id` and `redirect_uri` check out, errors are shown on the page. After that, errors (`invalid_scope`, `invalid_request` for a missing state or PKCE, `unsupported_response_type`) redirect back with `error`, `state` and `iss`. Success redirects with `code`, `state` and `iss` (RFC 9207). The agent exchanges the two-minute single-use code with `code_verifier`, `redirect_uri` and `session_id`. Replaying a code fails and revokes the Account Token it issued.

## Mediated Sign-In

`POST /api/poppy/sign-in` with a native Session Token: `{scope, credentials: {email}}` returns `code_required` with `sign_in_id`, a generic `sent_to` and `expires_at`. `POST /api/poppy/sign-in/{sign_in_id}` with `{code}` from the same Session returns `complete` with tokens, `code_required` after a wrong code, then `failed` after five. Missing or unknown scopes return `invalid_scope`. If the Session was already signed in to a different account, the start returns `account_mismatch` before any email is sent.

## Signed-in payoff

| Operation | Scope | What it does |
| --- | --- | --- |
| `listAccountAddresses` `GET /api/account/addresses` | `poppy:read` | Saved addresses, default first |
| `saveAccountAddress` `POST /api/account/addresses` | `poppy:write` | Save `{address, label?, default?}`. The first address becomes the default; a duplicate returns the existing one (200). Up to 10. |
| `setDefaultAccountAddress` `POST /api/account/addresses/{id}/default` | `poppy:write` | Change the default |
| `deleteAccountAddress` `DELETE /api/account/addresses/{id}` | `poppy:write` | Delete; the newest remaining address becomes the default |
| `proposeOrder` `POST /api/orders` | `poppy:write` when signed in | May omit `address` (uses the default) or send `addressId`, and may omit `email` (uses the account email). The resolved values are in the summary the user approves. Guests still send both. |
| `reorderOrder` `POST /api/account/orders/{id}/reorder` | `poppy:write` | Idempotency-Key required. Copies the order's photos into this Session and proposes the same items at current prices to the original address, unless `addressId`/`address`/`email` override it. Coupons aren't carried over. Returns a **proposed** operation (202); it still needs user approval and `confirmOperation`. `photo_expired` (410) once retention removed the photos. |

`GET /api/account` also returns `saved_addresses` and `default_address`; `listAccountOrders` marks each order `reorderable`.

## Demo and sandbox codes

Demo stores (`APP_MODE=demo`, with or without `AGENT_SANDBOX=true`) never send email. For synthetic `@example.com`, `@example.org` or `@example.net` accounts only:

- the Direct and Device pages show the captured code to the person;
- `getSandboxSignInEmail` (`GET /api/sandbox/sign-in/{id}/email`) returns a Mediated challenge's captured email to the Session that started it;
- `getSandboxDeviceSignInEmail` (`POST /api/sandbox/device-sign-in/email` with `{device_code}`) returns the captured email of a pending device sign-in to the agent that started it (and, once polled, only to the polling Session).

Production (`APP_MODE=live`) registers none of these and always emails the code.

## Verification

- `npm test`: device flow (pending → slow_down → approve → tokens; denied; expired; reused; bound Session; account mismatch; rate limit), Direct error redirects, consent CSP and replay revocation, Mediated scope errors, saved addresses and reorder. `tests/signin-sandbox.test.ts` runs Device Sign-In with `AGENT_SANDBOX=true`.
- `npm run test:cloudflare` exercises Device Sign-In, saved addresses, reorder (photo copy in R2) and revocation through the Workers runtime.
- `PUBLIC_URL=… DATA_DIR=… npm run test:e2e:signin` drives all advertised sign-in types against a running demo store with the demo identity, then renews, reads the account and history, orders to the saved address through Operations approval, reorders and revokes. It prints a redacted transcript.
