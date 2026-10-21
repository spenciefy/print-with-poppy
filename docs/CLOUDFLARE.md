# Parallel Cloudflare sandbox

This is an isolated deployment, not a production cutover. The existing Vercel/Railway deployments continue serving their existing domains and data.

**Test URL:** https://pwp-cf-sandbox.spencersyen.workers.dev

Discover `/.well-known/poppy.json` on that origin. Use native Poppy 0.2 with an allowlisted client. HTTP compatibility is disabled. Payment and fulfillment are simulated; confirmation and simulated-shipment emails are really submitted to Resend and clearly marked SANDBOX. Use an inbox you control. Do not use real payment credentials.

The intended `cf-sandbox.printwithpoppy.com` hostname is not configured: the domain's DNS zone is not in this Cloudflare account. Do not change nameservers as part of this parallel test. A hostname change also changes the issuer, client audiences and signed media URLs; validate it as a separate deployment step.

## Architecture

| Component | Responsibility |
| --- | --- |
| Worker + static assets | React site, HTTP transport, streaming private media |
| SQLite Durable Object | Sessions, DPoP replay checks, accounts, proposals, orders, idempotency, job leases and durable outbox |
| Private R2 bucket | Normalized originals, print derivatives and shirt previews; signed access through the Worker |
| Queue + alarms + cron | Recoverable job delivery, retries and periodic reconciliation |
| Private media container | The same Sharp pipeline as Node; no internet access; bounded image size and concurrency |
| Private protocol-fetch container | Existing connection-time DNS validation for protocol metadata/JWKS; no public proxy route |
| Resend | Real, explicitly labeled sandbox email |

The business rules and route handlers are shared with the Node application. Platform adapters replace SQLite/file access, transport and scheduling. Production Stripe/Prodigi credentials are rejected by the Cloudflare configuration. Each environment requires its own secret, object namespace, bucket and queue.

Image bytes travel between the Worker, R2 and media container, not through the commerce object. Upload reservations enforce ownership and quotas; metadata is committed after durable media storage. Immutable objects and per-variant pointers prevent concurrent renders from overwriting unrelated variants. A bounded orphan sweep removes abandoned objects after 24 hours.

Jobs are durable SQL rows. Queue messages are wake-ups, not the source of truth. Leases prevent simultaneous attempts; expired attempts cannot commit database changes. An alarm republishes pending jobs after a lost enqueue/acknowledgment. External requests retain their existing idempotency keys. A lease cannot undo an external side effect, so provider idempotency remains necessary.

## Local validation

Requires Node 22 and a running Docker daemon:

```sh
npm ci
npm run check
npm run test:cloudflare
```

The Workers test uses a disposable local Durable Object/R2 namespace on port 8899. It checks native authentication, DPoP replay, signed media expiry and ownership, concurrent proposal/confirmation idempotency, approval enforcement, a mixed shirt/print order, simulated payment/fulfillment/shipment, captured emails, account history, renewal and revocation. It does not send real email.

For interactive development, build first and install a unique local secret in ignored `.dev.vars`:

```sh
npm run build:cloudflare
npm run dev:cloudflare
```

Do not commit `.dev.vars`, `.cloudflare`, private agent keys, tokens or email credentials.

## Deployment

`wrangler.jsonc` names the isolated sandbox resources. Authenticate with the approved Cloudflare account and verify `wrangler whoami` before provisioning. For a new account/environment, create a private R2 bucket, jobs queue and dead-letter queue and update all bindings together. Durable Objects and containers are provisioned by Wrangler migrations/deployment.

Install secrets through Wrangler secret input/bulk input from a local ignored file:

- `APP_SECRET`: fresh random value, at least 32 characters; never reuse production's value.
- `RESEND_API_KEY`: sending-only key for the verified sender.
- `EMAIL_FROM`: `Print with Poppy <orders@printwithpoppy.com>`.

`SANDBOX_EMAIL_DELIVERY=send` enables actual sandbox emails. Payment and fulfillment stay simulated. `AGENT_CLIENT_IDS` contains only explicitly approved identities. The reference agent's public JWK may be published through sandbox metadata, but its private key belongs only on the tester's machine.

```sh
npm run deploy:cloudflare
```

The GitHub workflow tests pull requests without deployment secrets. Deployment is manual, main-branch-only, through the `cloudflare-sandbox` environment. Its scoped `CLOUDFLARE_API_TOKEN` still needs to be configured; local Wrangler deployment works independently. Do not give forked PR workflows that token.

## Validation recorded on 21 October 2026

- Node regression suite: 65 tests passed.
- Local Workers runtime: native authentication, mixed order and account lifecycle passed.
- Hosted reference client: native Poppy 0.2, DPoP, sign-in, photo upload, shirt-preview approval, mixed-order confirmation, simulated payment and shipment, account history passed.
- Resend returned submission IDs for both confirmation and simulated shipment to the approved test inbox. Submission is not proof of inbox delivery.
- Hosted PDA browser test passed end to end with a mixed five-print/one-shirt order: explicit preview approval, confirmation, simulated payment, printing, simulated shipment and both emails submitted. The order response and page report `native-poppy`. PDA required renewed task authorization after an approval-card continuation; no compatibility fallback was used.
- PDA browser testing found that a store-specific shirt-preview approval under `/api/operations` is blocked by its protocol transport. The description now advertises `/api/shirt-preview-approvals/{id}`; the old route remains for existing clients. All authentication, ownership, revision and explicit-preview approval checks are preserved.

## Before production migration

This implementation deliberately refuses live payment/printing configuration. Do not remove that guard or repoint production DNS based only on sandbox success.

Remaining production gates include worst-case image/load benchmarks, golden image comparisons, crash/fault injection around external side effects and lease expiry, bounded retention scans at production scale, direct browser sign-in parity, compatibility-enabled validation if desired, and a full backup/restore rehearsal. Review terminal job failure presentation against the Node worker before enabling live providers.

`server/migration.ts` provides a versioned logical snapshot primitive, identity validation, dry-run counts and exact-import resumption on an empty target. Its tests use synthetic data. It is **not a complete operator migration command**: asset copying and digest verification, private operator transport, write freeze, provider-webhook coordination and a production-sized rehearsal remain to implement. No production records or photos have been imported.

A later cutover must freeze writes and background dispatch on the old service, export a consistent snapshot plus assets, verify imported counts/checksums, retain the same public issuer and signing secret only for that controlled migration, and switch traffic once. Never run two production dispatchers against the same provider workload. Rollback after accepting new writes needs a reverse-data plan; DNS rollback alone is insufficient.
