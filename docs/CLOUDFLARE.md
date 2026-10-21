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

The business rules and route handlers are shared with the Node application. Platform adapters replace SQLite/file access, transport and scheduling. Production Stripe/Prodigi credentials are rejected by sandbox configuration; only the explicitly selected production environment permits them. Each environment requires its own secret, object namespace, bucket and queue.

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

The sandbox deliberately refuses live payment/printing configuration. The separate production environment below supports live providers; do not repoint production DNS based only on sandbox success.

Remaining production gates include worst-case image/load benchmarks, golden image comparisons, crash/fault injection around external side effects and lease expiry, bounded retention scans at production scale, direct browser sign-in parity, compatibility-enabled validation if desired, and a full backup/restore rehearsal. Terminal job failure presentation is shared with the Node worker.

`server/migration.ts` provides a versioned logical snapshot primitive, identity validation, dry-run counts and exact-import resumption on an empty target. Its tests use synthetic data. It is **not a complete operator migration command**: asset copying and digest verification, private operator transport, write freeze, provider-webhook coordination and a production-sized rehearsal remain to implement. No production records or photos have been imported.

A later cutover must freeze writes and background dispatch on the old service, export a consistent snapshot plus assets, verify imported counts/checksums, retain the same public issuer and signing secret only for that controlled migration, and switch traffic once. Never run two production dispatchers against the same provider workload. Rollback after accepting new writes needs a reverse-data plan; DNS rollback alone is insufficient.

## Isolated live production environment

`wrangler --env production` deploys **pwp-cf-production** at
https://pwp-cf-production.spencersyen.workers.dev. This is a real-payment environment, not the agent sandbox. It has its own Durable Object namespace, `pwp-cf-production-photos` R2 bucket, `pwp-cf-production-jobs` queue/DLQ and private containers. Production data has not been imported. Existing domains still use their existing deployments.

Production requires `CF_DEPLOYMENT=production`, `APP_MODE=live`, `AGENT_SANDBOX=false`, a unique `APP_SECRET`, live Stripe/Prodigi credentials, a separate Stripe webhook signing secret, and Resend sender credentials. Sandbox credentials/identities cannot enable live mode implicitly. The Stripe adapter uses the Workers Fetch client; raw webhooks use asynchronous Web Crypto signature verification.

Initially:

- Native Poppy only, with `https://poppydemoagent.dev/poppy/client.json` allowlisted.
- `LIVE_ORDERS_ENABLED=true` permits order proposals. Set it to `false` and redeploy to pause new proposals while existing paid orders and webhooks continue processing.
- `ORDER_EMAIL_ALLOWLIST=spencersyen@gmail.com` restricts the parallel launch to the approved test recipient. This is a launch restriction, not proof of email ownership. Normal native authentication and approval remain required. Clear it only when opening the store more broadly.
- No sandbox payment/shipment/OTP capture routes exist. Email sign-in sends real email.
- Stripe Checkout, tax, fulfillment, callbacks and email use real providers. Approving and paying an order will spend real money and send it to print.

Create a **new** Stripe webhook endpoint for `/api/webhooks/stripe` on this origin, selecting `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Save its own signing secret, not the current site's secret. The Cloudflare handler rejects test-mode events and acknowledges events for unknown orders without fulfillment. The Node handler in this PR also ignores foreign orders: deploy that patch to the existing service before live parallel orders, otherwise its old webhook may retry unknown Cloudflare order events. Neither endpoint should fulfill an order absent from its own database.

Prodigi receives this environment's `/api/webhooks/prodigi` as the per-order callback URL. Callbacks only enqueue retrieval of a known provider order; their body never directly changes fulfillment status. Payment polling and periodic reconciliation remain recovery paths. Terminal fulfillment/price failures and repeated retries now use the same customer-visible attention state as Node.

```sh
npm run check
npm run test:cloudflare
npm run test:cloudflare:production
npm run deploy:cloudflare:production
```

The production transport test runs locally using inert fixture credentials: it cannot pay, print or send email. It tests signed raw webhook handling, rejection of wrong-environment events, foreign/duplicate event acknowledgment, simulation disabled, restricted recipients and authentication. Local signing tests do not prove Stripe has delivered an event over the public network.

The GitHub deployment workflow selects `sandbox` or `production` and uses the matching `cloudflare-sandbox` / `cloudflare-production` protected environment. Configure a scoped deployment token in each environment; do not store provider credentials in PR workflows. Wrangler secrets must be installed on the matching Worker first.

### Real-order acceptance test

1. Use PDA against the production Workers hostname and verify discovery says 0.2, config says live, and HTTP compatibility is disabled.
2. Upload chosen photos or select sample poppies. Use the actual recipient/address and approved email; do not pay a quote with a fictional address.
3. Review the exact print previews, products, quantities, shipping address and total. Approve the proposal, then pay the Stripe Checkout link only with explicit authorization for that purchase.
4. Verify signed Stripe delivery or payment reconciliation records the matching paid checkout exactly once. Check Prodigi accepts exactly one matching order, confirmation email is submitted, and the private order page says native Poppy.
5. Verify the actual dispatch callback/poll, tracking and shipment email when the printer dispatches. Simulating a shipment is impossible here.

A prepared live environment is not a completed real-order test. Do not migrate the existing domains/data until this test and the backup/load/recovery gates above pass.

### Production deployment validation — 21 October 2026

The isolated production Worker was deployed as version `3f844766-cf48-4542-8684-8d48463ce8ac`. Public health, live configuration and Poppy 0.2 discovery passed. Compatibility and simulation endpoints returned 404. A signed fixture event for an unknown order was acknowledged; an invalid signature was rejected. The separate live Stripe webhook is enabled, and a read-only live Prodigi product lookup succeeded. These checks did not create an order, charge a card, send production email or request printing.

The updated Node suite passes all 67 tests. Both the local sandbox lifecycle suite and local production transport suite pass. Real Stripe event delivery, fulfillment and email still require the real-order acceptance test above.
