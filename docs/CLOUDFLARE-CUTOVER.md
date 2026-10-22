# Cloudflare migration and cutover

This PR moves application hosting onto Cloudflare while retaining the Node deployment during validation. Merging to main automatically deploys the isolated Cloudflare production Worker after checks pass, provided its GitHub deployment credential is configured. It does not change production DNS or start two dispatchers for the same orders. The isolated Workers deployment has separate data; it is not a mirror of existing production.

## Scope

| Current responsibility | Cloudflare destination | Implementation |
| --- | --- | --- |
| Vercel frontend | Workers static assets | Vite build, `workers/app.ts` |
| Railway Express API | Worker transport and shared commerce handlers | `workers/router.ts`, `server/routes.ts` |
| SQLite application state | SQLite Durable Object | `workers/commerce-state.ts`, `workers/sqlite.ts` |
| Photo files and derivatives | Private R2 | `workers/adapters/media-runtime.ts` |
| Sharp processing | Private Cloudflare Container | `containers/media/` |
| Validated outbound protocol metadata fetch | Private Cloudflare Container | `containers/protocol-fetch/` |
| Background jobs and retries | Durable SQL outbox, Queues, alarms and cron | `workers/commerce-state.ts` |
| Deployment | Wrangler and protected GitHub environments | `wrangler.jsonc`, `.github/workflows/cloudflare.yml` |

Stripe, Prodigi and Resend remain the payment, fulfillment and email providers. Cloudflare replaces application infrastructure, not these services. Both sandbox and isolated live environments are configured. The legacy server remains runnable for regression validation and the transition.

## Required before cutover

- [ ] Complete one explicitly approved real paid PDA order, verify one Stripe payment and one Prodigi order, then confirmation and actual shipment email.
- [ ] Deploy the foreign-order Stripe webhook handling patch to the current Node server before the parallel paid test.
- [ ] Configure scoped GitHub deployment tokens and environment protections for sandbox and production.
- [ ] Complete private operator export/import transport and immutable photo copying with byte counts and SHA-256 verification. The snapshot primitives in `server/migration.ts` alone do not transfer a production store.
- [ ] Rehearse backup/restore with all record kinds, pending jobs, photos, derivatives, coupons and account/session state; verify old private order links and media signatures.
- [ ] Verify worst-case media processing, image output parity, queue retry/lease expiry and crash recovery, retention scans and expected production load.
- [ ] Validate browser sign-in and any intended HTTP compatibility configuration as well as native Poppy 0.2.
- [ ] Prepare the actual production hostname/issuer configuration and DNS/TLS changes. Do not change the main domain to the Workers preview issuer.

## Cutover sequence

1. Record old deployment versions, provider webhook configuration, DNS and a tested recovery procedure. Inventory in-flight payments and fulfillment requests.
2. Stop new order writes and background dispatch on the old service. `LIVE_ORDERS_ENABLED=false` on the preview only pauses proposals: it is **not** a full migration write freeze.
3. Capture a consistent application snapshot and media manifest; preserve the production issuer and signing identity under a controlled migration so existing links and sessions remain valid.
4. Import into a separate, empty cutover destination. Do not overwrite the isolated preview's test records or mix unrelated namespaces. Copy media and verify all checksums, record counts, ownership and job state.
5. Keep the destination dispatcher paused while verifying imported data. Reconcile in-flight provider actions using existing IDs and idempotency keys; never replay every job blindly.
6. Switch the main domain and provider callbacks, then enable exactly one dispatcher. Verify native discovery/authentication, existing private links, checkout, webhook handling and order history through the main domain.
7. Monitor failures, queue age, payments, fulfillment and email delivery before retiring the legacy service. Keep recoverable backups according to the retention policy.

Before new writes, rollback can restore the old deployment and routing. After Cloudflare accepts new orders or provider events, first reconcile or migrate those writes back; DNS rollback alone can lose orders or duplicate fulfillment.

## Current status

The sandbox has passed a hosted native PDA simulation. The isolated live Worker has passed configuration, provider credential and signed-webhook transport checks. Neither is proof of a completed production data migration or a real paid order. See [deployment instructions and recorded validation](CLOUDFLARE.md).
