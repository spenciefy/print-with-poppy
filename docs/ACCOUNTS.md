# Customer accounts

For no-card API integration tests, use the separate [Agent Sandbox](SANDBOX.md). The production `/demo` page is a visual walkthrough only.

Print with Poppy supports optional accounts through Poppy draft 0.1. Guest ordering stays available. Accounts are created after an email is verified with a six-digit, ten-minute code; no password is stored.

## Sign-in paths

**Direct:** discover `auth.direct` and the OAuth `authorization_endpoint`. Open `/oauth/authorize` with `response_type=code`, registered `client_id` and exact `redirect_uri`, requested `scope`, random `state`, and an S256 PKCE challenge. The customer enters an email, verifies its code, then explicitly selects permissions and allows or declines. The callback includes `state` and `iss`. Exchange the single-use code at `/oauth/token` with PKCE verifier, client assertion, DPoP and the existing `session_id`.

**Mediated:** discover `auth.mediated`; explain the requested permissions and obtain the user's agreement before sending `{scope, credentials: {email}}` to `/api/poppy/sign-in` with a native Session Token and DPoP. The store emails a code and returns `code_required`, `sign_in_id`, `code.sent_to` and `expires_at`. Submit `{code}` to `/api/poppy/sign-in/{sign_in_id}` in that same session. A correct code returns `complete` plus Account and Session Tokens. The code email identifies the requesting agent and permissions. The agent must protect the code and never log it.

Both paths return a one-hour DPoP Session Token and a 30-day Account Token (`refresh_token`). Only the client transport should handle tokens: keep them out of model context, chats, URLs and logs. Authentication does not approve a purchase.

## Access and history

- `poppy:read`: `GET /api/account`, `GET /api/account/orders`, and reading account-owned orders/operations. History has up to 50 orders per page; pass `next_cursor` back as `cursor`.
- `poppy:write`: propose/confirm/cancel orders in a signed-in account. Request both scopes for a full signed-in order flow. Every purchase still requires explicit operations approval and payment.
- New orders proposed while signed in are linked to that account, even when the delivery/confirmation email differs (for example, a gift).
- Earlier guest orders are **not** claimed by matching their email. They remain accessible through their original session and private order link. No automated guest-order claim feature is offered.
- Photos remain session-owned; signing in does not give another session access to arbitrary uploaded photos. Account history includes order previews, subject to the existing photo-retention policy. History never extends photo retention or exposes reusable checkout links.
- Compatibility Bearer sessions cannot sign in. Native signed-out sessions can still place guest orders.

## Returning customers and disconnecting

Send `grant_type=refresh_token` and the Account Token to `/oauth/token`, authenticated by `private_key_jwt` and a fresh DPoP proof. Omit `session_id` for a new signed-in session, or provide a session belonging to the same agent and opaque User ID. Optional `scope` can narrow access, never expand it. Sessions cannot switch accounts, even after signing out: start a new session for a different account.

Send the Account Token as `token` to `/oauth/revoke`, with the client's assertion targeted to that endpoint. Account access disappears immediately from every Session Token associated with the grant. Those sessions can renew as signed out. Expiry has the same access effect; refresh does not extend the Account Token's lifetime. Browser sign-in only authorizes the agent; it does not establish a standalone customer dashboard or agent browser session.

## Security and operation

- Production codes and Account Tokens are stored only as keyed hashes / hashes; raw values are never returned in history or logs.
- Codes expire after ten minutes, permit five guesses, and are single-use and bound to the initiating session or browser flow.
- Email sending is limited to five requests per email and initiating flow/session per hour, with a 200/hour service cap. Browser sign-in is also protected by the OAuth route rate limiter, an HttpOnly SameSite cookie, CSRF token and Origin check.
- Redirects must exactly match trusted client metadata; PKCE S256 is required. Authorization codes expire after two minutes and are single-use. Pending/failed sign-ins do not change existing access.
- Every Session Token retains its original account/scopes snapshot and is checked against live grant state. A signed-out token cannot inherit a later sign-in.
- Existing Resend credentials and `EMAIL_FROM` send the branded code email; no new provider configuration is needed. Resend failure returns `email_unavailable` and invalidates the attempt.
- The SQLite account-order index is added idempotently at startup. Existing orders and sessions are compatible; UK launch settings are unrelated.
- Expired sign-in records are removed after one day by housekeeping. Account and order records follow the published privacy policy.

## Verification

Run `npm run check`. The commerce tests exercise signed-out and signed-in purchase flows, account isolation, stale tokens, refresh, scope reduction, revocation, OTP replay/expiry/attempt limits, browser consent, CSRF, callback validation and PKCE. Provider calls are simulated: passing these tests does not establish real email delivery or DPA UI interoperability.

In `APP_MODE=demo`, code emails are stored privately as `demo-signin-email` records for local verification, never sent. Plain local demo mode has no public code-retrieval endpoint. Hosted Agent Sandbox exposes a session-owned captured-code endpoint for synthetic accounts only; see [SANDBOX.md](SANDBOX.md). Production always uses Resend.

Spec: https://personalagentprotocol.org/docs/spec (sections 4.4–4.9).
