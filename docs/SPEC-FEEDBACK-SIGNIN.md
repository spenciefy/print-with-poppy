# Spec feedback candidates from implementing the Company side of 0.2 sign-in

Found while adding Device Sign-In and auditing Direct and Mediated Sign-In in this local copy (draft 0.2, 2026-10-19). Cross-references are to adewale/pda `docs/spec-issues.md`.

| # | Section | Issue | What this store does |
| --- | --- | --- | --- |
| 1 | 4.6 | The device authorization request carries no `session_id` (and no DPoP), so the sign-in can't be bound to the requesting Session until the first poll. A device code can be redeemed into any Session of the same agent, including another User's (N2). | Binds the device code to the first Session that polls it; later polls from another Session get `invalid_grant`. Proposal: allow or require `session_id` on the device authorization request. |
| 2 | 4.5, 4.6 | The error for a missing `session_id` at the code exchange or device poll isn't defined. A new Session can't be created there: there's no Session assertion with a User ID. | `invalid_session`. |
| 3 | 4.4, 4.6 | `account_mismatch` "issues no tokens", but the spec doesn't say whether the code or device code is spent. | Spent; the person signs in again in a new Session. |
| 4 | 4.6 | Approving zero scopes isn't covered (S16). | The page requires at least one scope, or Deny (`access_denied`). |
| 5 | 4.6 | No guidance on `slow_down` tolerance or whether it applies once the person has decided. | +5 s per RFC 8628 with 1 s grace for jitter; the new `interval` is returned in the error body (non-standard). Approved, denied and expired answers are returned regardless of pacing. |
| 6 | 4.6 | Nothing about rate-limiting user-code entry on the verification page (RFC 8628 §5.1 covers it), or about showing the code on the page to compare with the agent's. | Global cap on code entries per hour plus the per-IP OAuth limiter; the page shows the code to match. |
| 7 | 4.5 | Only `access_denied` is named for error redirects; other RFC 6749 §4.1.2.1 errors, and `iss` on them, aren't mentioned (N32). | Redirects `invalid_scope`, `invalid_request` and `unsupported_response_type` with `state` and `iss` once `client_id` and `redirect_uri` are verified. |
| 8 | 4.5 | Code replay: RFC 6749 says the server SHOULD revoke tokens issued from a replayed code. Interacts with N45 (lost exchange response): a retry then revokes the orphaned grant instead of leaving it live. | Revokes. Worth stating either way. |
| 9 | 4.5 | Consent pages load `logo_uri` from any HTTPS host, which tells the agent's host that the person opened the page, and the page CSP must allow that origin. Browsers also apply CSP `form-action` to the redirect after the consent form, so a strict `form-action 'self'` blocks the return to the agent. | Allows only the logo origin in `img-src` (with `referrerpolicy=no-referrer`) and the registered callback origin in `form-action`. Guides could mention both. |
| 10 | 4.7 | When the Session is already bound to another account, which Mediated step returns `account_mismatch`? | Refuses at the start, before sending a code, when the email isn't the bound account. Leaks to that Session whether the email is the bound account, nothing more. |
| 11 | 4.4 | The discovery example puts saved addresses under a custom `addresses` scope; nothing says whether broad `poppy:read`/`poppy:write` should cover them. | Broad scopes, as asked for this demo. |
| 12 | 4.3, 4.6 | Device authorization needs no proof; nothing says a Company must ignore one if sent (N1). | Ignores it. |
| 13 | — | No notion of test stores: in a sandbox, a person can't receive the emailed code during Direct or Device Sign-In. | Demo/sandbox pages show the captured code for synthetic accounts only; session-bound helpers return it to test agents. |
