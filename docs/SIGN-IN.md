# Sign-in types (Poppy 0.3 §4)

Print with Poppy offers all three Poppy sign-in types. Every type signs the customer in with a six-digit emailed code (no passwords) and ends with plain OAuth tokens: a Bearer access token (1 hour) and a refresh token (30 days, not rotated). The agent sends the access token with its Session header (`Poppy-Session`) to act signed in. See [POPPY-0.3.md](POPPY-0.3.md) for the protocol changes and [ACCOUNTS.md](ACCOUNTS.md) for account behavior.

| Type | How an agent finds it | Where the customer signs in | Scopes | Offered |
| --- | --- | --- | --- | --- |
| Direct (§4.2) | `authorization_code` in `grant_types_supported`; `authorization_endpoint` | Store page in their browser, then a redirect to the agent | all of `scopes_supported` | Live, plain demo. Not in the hosted Agent Sandbox. |
| Device (§4.3) | `urn:ietf:params:oauth:grant-type:device_code`; `device_authorization_endpoint` | Store page at `/device` on any device, from a link and code the agent shows | all of `scopes_supported` | Live, plain demo, Agent Sandbox |
| Mediated (extension v1) | `mediated-sign-in` in `poppy.json` `extensions`, and its grant type in `grant_types_supported` | Agent's own secure UI: email, then the emailed code | `orders:read orders:write` | Live, plain demo, Agent Sandbox |

## Scopes

| Scope | Allows | Hints |
| --- | --- | --- |
| `orders:read` | Account email, order history, order status | `changes: none`, personal data |
| `orders:write` | Save new orders to the account, reorder (each still needs approval and payment) | `changes: irreversible`, personal data |
| `addresses` | See, save, change and delete saved shipping addresses; ship to one | `changes: reversible`, personal data |

They're listed in `scopes_supported` and described in `auth.scopes`, `auth.scope_hints` and the OpenAPI document. Signed out, an account endpoint answers 401 `WWW-Authenticate: Bearer scope="…"`; an under-scoped token gets 403 `insufficient_scope` naming the scopes. A grant never includes scopes the agent didn't request.

## Sessions

Every API request carries a Session JWT in `Poppy-Session`, signed by a delegated key (§5.2). The Session is keyed by `client_id` + `sid`: a new `sid` starts a signed-out Session, the same `sid` continues it, and a request with an access token is signed in. Token requests carry only the client assertion, signed directly by a `jwks_uri` key (§4.1). Sign-in doesn't need a Session.

## Device Sign-In

1. **Start:** `POST /oauth/device` (form-encoded) with `scope` and the client assertion. Returns `device_code`, `user_code` (`XXXX-XXXX` from the RFC 8628 §6.1 alphabet), `verification_uri` (`{origin}/device`), `verification_uri_complete`, `expires_in` (600) and `interval` (5). Errors: `invalid_client` (401), `invalid_scope`, a plain 429 with `Retry-After` (30 starts per agent per 10 minutes).
2. **Show:** the agent checks that the link's host is the issuer's host or a `protected_resources` host (or a subdomain), and shows the link and user code with the store's name and domain. It keeps `device_code` private.
3. **Person:** opening the link only shows a prefilled code form. Submitting it shows the agent's `client_name`, `logo_uri` and `client_id` host, and the code to compare with the agent's. They sign in with an emailed code, then choose some or all requested scopes, or deny.
4. **Poll:** `POST /oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `device_code` and the client assertion, every `interval` seconds. The code belongs to the `client_id` that started it.

| Poll answer | When |
| --- | --- |
| `authorization_pending` (400) | Waiting for the person |
| `slow_down` (400) | Polled faster than `interval` (1 s grace); `interval` grows by 5 s and is returned in the body |
| `access_denied` (400) | The person denied; repeated on later polls |
| `expired_token` (400) | Past `expires_in`; repeated on later polls |
| `invalid_grant` (400) | Unknown code, another agent's code, or a code already redeemed |
| 200 | Tokens with the approved `scope` |

Raw user codes, device codes and email codes are never stored (keyed hashes only) or logged.

## Direct Sign-In

`GET /oauth/authorize` with `response_type=code`, a registered `client_id`, a `redirect_uri` that exactly matches its metadata (a loopback entry matches any port), `scope`, a random `state` and an S256 `code_challenge`. Until `client_id` and `redirect_uri` check out, errors are shown on the page; after that they redirect back with `error`, `state` and `iss`. Success redirects with `code`, `state` and `iss`. Exchange the two-minute single-use code with `code_verifier`, `redirect_uri` and the client assertion. Replaying a used code fails and revokes the tokens it issued.

## Mediated Sign-In (extension v1)

At `/oauth/token`, with the client assertion:

1. `grant_type=https://personalagentprotocol.org/grant/mediated-sign-in`, `scope` (from the extension's `scopes`) and `email` → 400 `{"error":"code_required","sign_in_id":…,"sent_to":…,"expires_in":600}`. The email is never echoed. Missing, unknown or non-mediated scopes (`addresses`) get `invalid_scope`; a missing or unknown field gets `invalid_request`.
2. The same grant with only `sign_in_id` and `one_time_code` → the token response. A wrong code gets `code_required` again; after five, `invalid_grant`. An expired sign-in gets `expired_token`; an unknown one, or one another `client_id` started, gets `invalid_grant`.

## Refresh and sign-out

`grant_type=refresh_token` with the client assertion returns a new access token; optional `scope` narrows it (never expands), optional `resource` must be `https://{domain}` (or the origin) or the answer is `invalid_target`. Revoking the refresh token at `/oauth/revoke` (RFC 7009) signs out: its access tokens get `invalid_token` at once and the Sessions continue signed out. A Session already signed in to one account refuses another account's token with `invalid_session`; the agent uses a new `sid`.

## Signed-in payoff

| Operation | Scope | What it does |
| --- | --- | --- |
| `listAccountAddresses` `GET /api/account/addresses` | `addresses` | Saved addresses, default first |
| `saveAccountAddress` `POST /api/account/addresses` | `addresses` | Save `{address, label?, default?}`. The first address becomes the default; a duplicate returns the existing one (200). Up to 10. |
| `setDefaultAccountAddress` `POST /api/account/addresses/{id}/default` | `addresses` | Change the default |
| `deleteAccountAddress` `DELETE /api/account/addresses/{id}` | `addresses` | Delete; the newest remaining address becomes the default |
| `proposeOrder` `POST /api/orders` | `orders:write` when signed in, plus `addresses` to use a saved address | May omit `address` (uses the default) or send `addressId`, and may omit `email` (uses the account email). The resolved values are in the summary the user approves. Guests still send both. |
| `reorderOrder` `POST /api/account/orders/{id}/reorder` | `orders:write` | Answers 403 `approval_required` with an operation for the same items at current prices to the original address, unless `addressId`/`address`/`email` override it. Coupons aren't carried over. The same request with `Poppy-Approval` places the order (201). The order's photos are copied into this Session once per operation. `photo_expired` (410) once retention removed the photos. |

`GET /api/account` needs an access token with any scope and returns `saved_addresses`, and `default_address` with the `addresses` scope. `listAccountOrders` (`orders:read`) marks each order `reorderable`.

## Demo and sandbox codes

Demo stores (`APP_MODE=demo`, with or without `AGENT_SANDBOX=true`) never send email. For synthetic `@example.com`, `@example.org` or `@example.net` accounts only:

- the Direct and Device pages show the captured code to the person;
- `getSandboxSignInEmail` (`GET /api/sandbox/sign-in/{sign_in_id}/email`, with the Session header) returns a Mediated sign-in's captured email to the agent (`client_id`) that started it;
- `getSandboxDeviceSignInEmail` (`POST /api/sandbox/device-sign-in/email` with `{device_code}`) returns the captured email of a pending device sign-in to the agent that started it.

Production (`APP_MODE=live`) registers none of these and always emails the code.
