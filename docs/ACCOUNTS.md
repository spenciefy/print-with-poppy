# Customer accounts

For no-card API integration tests, use the separate [Agent Sandbox](SANDBOX.md). The production `/demo` page is a visual walkthrough only.

Print with Poppy supports optional accounts through Poppy draft 0.3. Guest ordering stays available. Accounts are created after an email is verified with a six-digit, ten-minute code; no password is stored.

## Sign-in paths

Poppy 0.3: Direct and Device Sign-In are offered through the issuer metadata's `grant_types_supported`; Mediated Sign-In through the `mediated-sign-in` extension and its grant type. Every API request carries the agent's Session header (`Poppy-Session`), and token requests carry a client assertion signed by a `jwks_uri` key. Details: [SIGN-IN.md](SIGN-IN.md) and [POPPY-0.3.md](POPPY-0.3.md).

**Direct:** `/oauth/authorize` with `response_type=code`, registered `client_id` and exact `redirect_uri`, `scope`, random `state` and an S256 PKCE challenge. The customer enters an email, verifies its code, then selects permissions and allows or denies. The callback includes `state` and `iss`. Exchange the single-use code at `/oauth/token` with the PKCE verifier and the client assertion.

**Device:** `POST /oauth/device` with `scope` and the client assertion. Show the customer `verification_uri_complete` (or `verification_uri` and `user_code`) with the store's name and domain, after checking the link's host. The customer enters the code at `/device`, verifies an email code and selects permissions or denies. Poll `/oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `device_code` and the client assertion every `interval` seconds.

**Mediated (`orders:read orders:write` only):** explain the requested permissions and obtain the user's agreement before sending the Mediated Sign-In grant with `scope` and `email` to `/oauth/token`. The store emails a code and answers `code_required` with `sign_in_id`, `sent_to` and `expires_in`. Send the same grant with `sign_in_id` and `one_time_code` to get the tokens.

All three paths return a one-hour Bearer access token and a 30-day refresh token. Only the client transport should handle tokens: keep them out of model context, chats, URLs and logs. Authentication does not approve a purchase.

## Access and history

- Any signed-in token: `GET /api/account`.
- `orders:read`: `GET /api/account/orders` and reading account-owned orders. History has up to 50 orders per page; pass `next_cursor` back as `cursor`.
- `orders:write`: order (Operations v2: approval_required, then the same request with `Poppy-Approval`) in a signed-in account and reorder (`POST /api/account/orders/{id}/reorder`, the same flow).
- `addresses`: list, save, delete and set the default shipping address, and use a saved address in a proposal. A signed-in proposal may omit the address (default saved address) or pass `addressId`, and may omit the email (account email); the summary shows the resolved values for approval. A reorder places nothing until the user approves its operation; payment is still required. Request both scopes for a full signed-in order flow. Every purchase still requires explicit operations approval and payment.
- New orders proposed while signed in are linked to that account, even when the delivery/confirmation email differs (for example, a gift).
- Earlier guest orders are **not** claimed by matching their email. They remain accessible through their original session and private order link. No automated guest-order claim feature is offered.
- Photos remain session-owned; signing in does not give another session access to arbitrary uploaded photos. Account history includes order previews, subject to the existing photo-retention policy. History never extends photo retention or exposes reusable checkout links.
- Compatibility Bearer guest sessions cannot sign in. Native signed-out Sessions can still place guest orders.

## Returning customers and disconnecting

Send `grant_type=refresh_token` and the refresh token to `/oauth/token` with the client assertion. Optional `scope` can narrow access, never expand it. Any Session of the agent can use the new access token with its Session header. A Session keeps the first account it was signed in to, even after signing out: start a new Session (new `sid`) for a different account.

Send the refresh token as `token` to `/oauth/revoke`, with the client assertion. Account access disappears immediately from every access token of that sign-in, and the Sessions continue signed out. Expiry has the same effect; refresh does not extend the refresh token's lifetime. Browser sign-in only authorizes the agent; it does not establish a standalone customer dashboard or agent browser session.

## Security and operation

- Production codes, access tokens and refresh tokens are stored only as keyed hashes / hashes; raw values are never returned in history or logs.
- Codes expire after ten minutes, permit five guesses, and are single-use and bound to the initiating agent (Mediated) or browser flow.
- Email sending is limited to five requests per email and initiating flow/session per hour, with a 200/hour service cap. Browser sign-in is also protected by the OAuth route rate limiter, an HttpOnly SameSite cookie, CSRF token and Origin check.
- Redirects must exactly match trusted client metadata; PKCE S256 is required. Authorization codes expire after two minutes and are single-use. Pending/failed sign-ins do not change existing access.
- Every access token keeps its account and scopes and is checked against live grant state on each request.
- Existing Resend credentials and `EMAIL_FROM` send the branded code email; no new provider configuration is needed. Resend failure returns `email_unavailable` and invalidates the attempt.
- The SQLite account-order index is added idempotently at startup. Existing orders and sessions are compatible; UK launch settings are unrelated.
- Expired sign-in records are removed after one day by housekeeping. Account and order records follow the published privacy policy.

## Verification

Run `npm run check`. `tests/pap-03.test.ts` covers the 0.3 rules; `tests/signin-types.test.ts` and `tests/signin-sandbox.test.ts` cover the three sign-in types, saved addresses and reorder. The commerce tests exercise signed-out and signed-in purchase flows with Operations v2, account isolation, stale tokens, refresh, scope reduction, revocation, OTP replay/expiry/attempt limits, browser consent, CSRF, callback validation and PKCE. Provider calls are simulated: passing these tests does not establish real email delivery or Personal Agent UI interoperability.

In `APP_MODE=demo`, code emails are stored privately as `demo-signin-email` records, never sent. For synthetic `@example.com/.org/.net` accounts only, demo and Agent Sandbox stores show the captured code on the Direct and Device pages and return it through the client-scoped `getSandboxSignInEmail` and `getSandboxDeviceSignInEmail` helpers; see [SIGN-IN.md](SIGN-IN.md#demo-and-sandbox-codes). Production always uses Resend and registers none of these.

Spec: https://personalagentprotocol.org/docs/0.3/spec (draft 0.3, sections 4 and 5).

Client assertions use the exact issuer as `aud` and are signed directly by a `jwks_uri` key; Session JWTs are signed by delegated keys and name the request's method and URL. Signed-in operations can be approved from any Session of the same client and opaque User ID signed in to the same account; guest operations stay with their Session. A different agent or User ID cannot approve an operation merely by signing into the same account.
