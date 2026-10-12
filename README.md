# Print with Poppy

An agent-first photo store for **printwithpoppy.com**. See [SPEC.md](SPEC.md) for the product decisions. Built with React/Vite, TypeScript, Express, SQLite, Sharp, JOSE, Stripe, Prodigi and Resend.

## Run locally

Requires Node 22.22+ (or Node 24), npm, and native build support if your platform does not have prebuilt Sharp/SQLite binaries.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open http://localhost:5173. The API runs on 8787 and Vite proxies it. Alternatively, build and serve a single process:

```sh
npm run build
PORT=5173 PUBLIC_URL=http://localhost:5173 npm start
```

`APP_MODE=demo` is fully local: the demo studio uses the same photo, quote, approval, order, worker and email-template code with simulated provider responses. It cannot charge a card, order prints, or send email. The demo UI supports uploads, sample photos, crop/quantity choices, a complete approval summary, payment simulation, shipment simulation and rendered email previews.

## Verify

```sh
npm run check
# With the local server running:
npm run test:e2e
```

The reference client in `scripts/agent.ts` does discovery, issuer verification, signed client/session assertions, DPoP, upload, proposal, approval, demo payment and shipment, and checks both captured emails. Without `--approve-demo`, it stops at the approval summary. Its local identity is deliberately available only in demo mode; real agents publish and manage their own keys.

Automated integration tests exercise the real Express API and temporary SQLite database. Provider-contract tests intercept requests: they validate payloads and error handling but do **not** prove real provider acceptance. Live Stripe, Prodigi and Resend integration remains unverified without accounts/keys.

## Connect accounts (sandbox first)

1. **Prodigi:** create an account and obtain the sandbox API key. Validate `GLOBAL-PHO-4X6`, the exact supported finish value (default `lustre`), and `Standard` shipping through their product/quote APIs. The server checks the finish rather than silently substituting it. Quote 10, 25 and 50 distinct photos together to validate economics.
2. **Stripe:** use test keys and configure Stripe Tax business settings/registrations. The Tax Calculation API uses the **approved shipping address** before user approval. Checkout charges the frozen subtotal, shipping and calculated tax as fixed line items; it does not recollect or change the shipping address, recalculate tax, accept coupons or enable currency conversion. A background job creates the tax transaction after payment. This is a custom Stripe Tax integration, not Checkout automatic tax.
3. Register `https://YOUR_HOST/api/webhooks/stripe` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Supply its signing secret. A server-side reconciliation job also checks unpaid sessions periodically in case callbacks are missed.
4. **Resend:** create an account, verify `printwithpoppy.com` with the requested DNS records, and set `EMAIL_FROM=Print with Poppy <orders@printwithpoppy.com>`. Confirm the support mailbox actually works. Sandbox sends real emails to the supplied recipient: use your own test inbox.
5. Set `PUBLIC_URL` to the public HTTPS origin and `APP_SECRET` to a persistent random secret (at least 32 characters). Set the remaining variables from `.env.example`; never commit secrets.
6. Set `AGENT_CLIENT_IDS` to exact, trusted HTTPS metadata URLs. Review that each points to a public origin (not your internal network). Metadata and JWKS must share an origin; redirects are refused. Add more agents explicitly after testing them.
7. Start with `APP_MODE=sandbox`. Prodigi sandbox never prints; Stripe test mode never charges. The startup checks reject test/live Stripe key mismatches and incomplete provider configuration. Use separate keys and storage for live.
8. Validate one sandbox order, email delivery and the webhook lifecycle. Then switch to live credentials, order a physical sample with explicit purchase authorization, and check print/crop/color quality and delivered price before inviting customers.

Poppy operations v1 is required for ordering. Guest sessions need no customer login. There are no account-token, MCP, company-chatbot or browser-session capabilities advertised. `revocation_endpoint` is present for metadata compliance but this service never issues account tokens. An approved operation succeeds when checkout has been prepared; payment and fulfillment are separate order states.

The card stays at **Stripe-hosted Checkout**. An agent with an authorized card may complete the page. Issuer authentication can require the user. No raw-card or direct-charge endpoint exists.

## Prices, email and delivery

- US/USD only, 4×6 prints, maximum 100 prints per order.
- Item retail price = supplier item cost × `PRICE_MULTIPLIER`, with `MINIMUM_SUBTOTAL_CENTS`. Supplier shipping is passed through. Supplier tax is absorbed in margin; customer sales tax is calculated separately by Stripe Tax.
- Quotes expire in 15 minutes. The approved checkout expires roughly one hour after creation. Changing address/photos/quantities requires a new proposal and fresh approval.
- Payment confirmation email contains the full shipping address, total, order link and available estimate. Every shipped package gets a shipment email; newly available tracking generates an update. All packages remain visible on the order page.
- Prodigi's documented 2–3-day production window is labeled as **printing time**, not a delivery promise. Arrival estimates are omitted by default. Configure `DELIVERY_MIN_BUSINESS_DAYS` / `DELIVERY_MAX_BUSINESS_DAYS` only after measuring the chosen service. Carrier tracking is included only when Prodigi provides it. The app never infers delivery from shipment.

## Hosted example

The public example uses Vercel for the React website and same-origin rewrites to a single Railway service. Railway owns the API, background worker, SQLite database and private images on a persistent `/app/.data` volume. `PUBLIC_URL` is the Vercel custom domain, so discovery, DPoP proofs, checkout returns and signed media URLs all use the same origin.

`vercel.json` contains the example backend's **public URL only**. Forks must replace that URL with their own Railway service. Set provider credentials only on Railway; Vercel needs no provider secrets. Keep one backend replica and mount the persistent volume before deploying. `railway.json` configures Docker builds and health checks. Railway mounts volumes as root: this deployment sets `RAILWAY_RUN_UID=0` so the service can write its private volume.

The hosted example starts in `APP_MODE=demo`: payments, prints and emails are simulated. Provider activation is a separate step; deploying the site does not enable live transactions. Use a separate data directory or volume when switching from demo to live.

## Deployment and operations

Use one long-running Node service with a **persistent disk**, behind HTTPS. `Dockerfile` is provided. Mount `/app/.data` (or set `DATA_DIR`). Do not deploy this implementation onto an ephemeral/serverless filesystem or scale it to multiple replicas: the worker assumes one process. Back up SQLite and private files together; SQLite uses WAL.

```
Frontend + Poppy API → SQLite order/approval + durable jobs
                           ├── Stripe checkout / signed webhook
                           ├── Prodigi order / authenticated reconciliation
                           └── Resend confirmation / shipping emails
```

`GET /api/health` checks database access and reports the configured mode; it is not evidence of provider connectivity. `npm run ops:status` lists pending job IDs, retry counts and errors without customer payloads. Monitor this output and process health in production. A failed fulfillment remains paid/attention and retries with the **same** Prodigi idempotency key; never manually submit a fresh order before checking the existing provider order.

- The worker runs every two seconds and retries with exponential backoff, capped at one hour.
- Prodigi callbacks are untrusted hints. They can enqueue retrieval of an already-known order, never mutate fulfillment directly. The server always reads that order from Prodigi using its own API key. Periodic reconciliation recovers missed callbacks.
- Stripe payment events must match stored checkout ID, amount and currency. Repeated events cannot enqueue duplicate fulfillment. Checkout, print submission and email retries use stable keys.
- Resend's idempotency retention is limited. Ambiguous email retries stop before 24 hours; inspect Resend before manually resending. Checkout creation that remains unresolved for 24 hours needs operator review.
- Provider cancellation is surfaced in the order and an email. Refunds, reprints and post-payment cancellations are operator-managed in v1 (Stripe/Prodigi dashboards). Payment disputes/refunds are not automatically synchronized into this app yet.
- Unused images expire after 24 hours; shipped-order images after 30 days. Unresolved paid-order images are retained. Print asset URLs expire in seven days: don't configure a longer Prodigi hold window without adding asset-link renewal.
- `APP_SECRET` must persist across restarts. Local demo creates a private persistent secret automatically. Resetting the secret invalidates existing image URLs.
- Only image files explicitly uploaded to the service are accepted—no arbitrary URL fetch endpoint. Images are decoded and normalized, stripped of metadata, and capped at 20 MB / 40 megapixels. Private media requires a signed URL; order links carry a separate high-entropy view token in the URL fragment.

## Files

- `server/auth.ts`: Poppy assertions, sessions, DPoP/replay protection.
- `server/commerce.ts`: proposals, exact approval and payment transition.
- `server/providers.ts`: Prodigi, Stripe and Resend adapters.
- `server/worker.ts`: durable fulfillment, email, tax, reconciliation and retention jobs.
- `server/openapi.ts`: discovery-linked API contract and agent instructions.
- `src/`: storefront, agent docs, demo studio and private order view.
- `tests/commerce.test.ts`: protocol, commerce and provider-contract tests.

## Assets and references

Poppy flower supplied by the project owner. Decorative sample photography is from Unsplash: [lake source](https://images.unsplash.com/photo-1470770841072-f978cf4d019e), [landscape source](https://images.unsplash.com/photo-1500530855697-b586d89ba3ee), [mountain source](https://images.unsplash.com/photo-1464822759023-fed622ff2c3b). These are illustrative samples, never customer uploads. Fonts: [Young Serif](https://fonts.google.com/specimen/Young+Serif) and [Hanken Grotesk](https://fonts.google.com/specimen/Hanken+Grotesk), self-hosted with OFL licenses.

[Poppy spec](https://personalagentprotocol.org/docs/spec) · [operations](https://personalagentprotocol.org/docs/extensions/operations) · [Prodigi API](https://www.prodigi.com/print-api/docs/reference/) · [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment)
