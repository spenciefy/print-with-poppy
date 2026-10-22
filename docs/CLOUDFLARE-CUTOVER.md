# Cloudflare migration and cutover

Production hosting has moved to Cloudflare. Merging to main deploys the production Worker after checks pass using its GitHub deployment credential. Cloudflare production has independent data; it is not a mirror of legacy Railway production. DNS cutover was performed separately and is recorded below.

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

## Production cutover — 22 October 2026

The owner approved a fresh-store cutover without importing legacy Railway orders, accounts, sessions or photos. The existing Cloudflare production store is retained, including the paid native-Poppy acceptance-test order. Main and www now bind to `pwp-cf-production`; `PUBLIC_URL` and the Poppy issuer are `https://printwithpoppy.com`. New sessions must discover this origin.

Cloudflare is authoritative DNS. Namecheap remains the registrar, using `kayleigh.ns.cloudflare.com` and `titan.ns.cloudflare.com`. Resend sending records and the Railway sandbox DNS records were preserved. Cloudflare Email Routing replaces Namecheap forwarding for `hello@printwithpoppy.com`; its verified destination is configured privately. Routing reports ready; inbox delivery has not been tested.

The live Stripe webhook now targets `https://printwithpoppy.com/api/webhooks/stripe`. New Prodigi orders receive the main-domain callback. The workers.dev hostname remains available for existing Cloudflare order links and callbacks. Legacy deployments and their data have not been deleted or replayed. `sandbox.printwithpoppy.com` still points to Railway; the independent Cloudflare sandbox uses its workers.dev hostname.

### Verified

- Main-domain HTTPS, live Cloudflare configuration and native Poppy 0.2 discovery.
- A real PDA order completed native authentication, approval and user-paid Stripe checkout before cutover, with HTTP compatibility disabled during that test. Prodigi accepted the order for printing.
- After cutover, that same private order loads on the main domain and reports `printing` and `native-poppy`.
- Production now also permits HTTP guest ordering for agents that do not implement Poppy. Ordering method remains recorded separately.

Actual shipment and inbox receipt are not verified by these checks. Legacy private links and accounts are not migrated. Load benchmarks and a production-sized backup/restore rehearsal remain operational follow-ups, not completed validations.

### Release and rollback

Merges to main deploy through `.github/workflows/cloudflare.yml`. Keep custom-domain routes and the canonical `PUBLIC_URL` in source control; smoke checks use the main domain and require protocol version 0.2.

Prefer rolling back Worker code while retaining its existing Durable Object and R2 resources. DNS rollback to Railway alone would hide new Cloudflare orders and route callbacks incorrectly. Before reverting hosting, reconcile all new payments, fulfillment and jobs; never copy or replay provider requests blindly. Preserve the legacy service for its own in-flight orders until reconciled.
