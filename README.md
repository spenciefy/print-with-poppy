<p align="center">
  <a href="https://printwithpoppy.com">
    <img src="public/photos/poppy-logo-transparent.png" alt="Print with Poppy — orange, red and yellow poppy photo stack" width="112" height="112" />
  </a>
</p>

<h1 align="center">Print with Poppy</h1>

<p align="center">Your photos, in print.<br />Ordered by your personal agent. Delivered to your door.</p>

<p align="center">
  <a href="https://printwithpoppy.com">Visit the store</a> ·
  <a href="https://printwithpoppy.com/demo">Play the demo</a> ·
  <a href="https://printwithpoppy.com/docs">API reference</a> ·
  <a href="https://personalagentprotocol.org/docs/spec">Poppy protocol</a>
</p>

[![Print with Poppy homepage showing photo prints, a poster print, and copyable personal-agent instructions](docs/images/homepage.png)](https://printwithpoppy.com)

A real photo-printing store and an open-source example of **[Personal Agent Protocol](https://personalagentprotocol.org/)**. The website presents the products; your personal agent handles the order. There is no human-facing cart or checkout button.

## How it works

1. **Discover.** The agent reads [`poppy.json`](https://printwithpoppy.com/.well-known/poppy.json), authenticates with a signed assertion and DPoP, and follows the OpenAPI reference.
2. **Prepare.** It uploads your photos, selects prints or a poster, and requests an order proposal.
3. **Approve.** You review the photos, crops, delivery address, email and complete price. The agent confirms that exact revision through Poppy Operations.
4. **Print and deliver.** Stripe Checkout handles payment, Prodigi fulfills the order, and Resend sends confirmation and shipping updates when available.

The [interactive demo](https://printwithpoppy.com/demo) walks through the journey with sample poppy artwork and simulated payment. See [SPEC.md](SPEC.md) for the product decisions and [authentication options](#native-poppy-and-compatibility-access) for native and compatibility integrations.

**Built with:** React + Vite · TypeScript · Express · SQLite · Sharp · JOSE · Stripe · Prodigi · Resend

## Test with a personal agent

Use the [Agent Sandbox](https://sandbox.printwithpoppy.com) for real API testing with simulated payment, printing, shipment and captured emails. **No card is needed.** DPA is registered; other agents register their HTTPS metadata URL via hello@printwithpoppy.com. Follow the [sandbox testing guide](docs/SANDBOX.md), including optional account/OTP tests.

The production store at `printwithpoppy.com` accepts real payments. Its `/demo` is only a scripted visual walkthrough. The sandbox is a separate deployment using `APP_MODE=demo` and `AGENT_SANDBOX=true`; it is not the older provider-test `APP_MODE=sandbox` setting.

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

Automated integration tests exercise the real Express API and temporary SQLite database. Provider-contract tests intercept requests: they validate payloads and error handling but do **not** prove real provider acceptance. A passing local test suite does not verify a deployment’s credentials, payment capture, provider acceptance or email delivery. Verify those separately for your own installation.

## Connect accounts (sandbox first)

1. **Prodigi:** create an account and obtain the sandbox API key. Validate `GLOBAL-PHO-4X6`, the exact supported finish value (default `lustre`), and `Budget` shipping through their product/quote APIs. The server checks the finish rather than silently substituting it. Quote 10, 25 and 50 distinct photos together to validate economics.
2. **Stripe:** use test keys and configure Stripe Tax business settings/registrations. The Tax Calculation API uses the **approved shipping address** before user approval. Checkout charges the frozen subtotal, shipping and calculated tax as fixed line items; it does not recollect or change the shipping address, recalculate tax, accept coupons or enable currency conversion. A background job creates the tax transaction after payment. This is a custom Stripe Tax integration, not Checkout automatic tax.
3. Register `https://YOUR_HOST/api/webhooks/stripe` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Supply its signing secret. A server-side reconciliation job also checks unpaid sessions periodically in case callbacks are missed.
4. **Resend:** create an account, verify `printwithpoppy.com` with the requested DNS records, and set `EMAIL_FROM=Print with Poppy <orders@printwithpoppy.com>`. Confirm the support mailbox actually works. Sandbox sends real emails to the supplied recipient: use your own test inbox.
5. Set `PUBLIC_URL` to the public HTTPS origin and `APP_SECRET` to a persistent random secret (at least 32 characters). Set the remaining variables from `.env.example`; never commit secrets.
6. Set `AGENT_CLIENT_IDS` to exact, trusted HTTPS metadata URLs. Review that each points to a public origin (not your internal network). Metadata and JWKS must share an origin; redirects are refused. Add more agents explicitly after testing them.
7. Start with `APP_MODE=sandbox`. Prodigi sandbox never prints; Stripe test mode never charges. The startup checks reject test/live Stripe key mismatches and incomplete provider configuration. Use separate keys and storage for live.
8. Validate one sandbox order, email delivery and the webhook lifecycle. Then switch to live credentials, order a physical sample with explicit purchase authorization, and check print/crop/color quality and delivered price before inviting customers.

Poppy operations v1 is required for ordering. Guest sessions need no customer login. Optional customer accounts support native Poppy direct sign-in (email OTP, consent and PKCE) and mediated sign-in (email, then OTP). Account tokens support refresh and immediate revocation. MCP, company-chatbot and browser-session capabilities are not advertised. See [Customer accounts](docs/ACCOUNTS.md) for the flow and security boundaries. An approved operation succeeds when checkout has been prepared; payment and fulfillment are separate order states.

The card stays at **Stripe-hosted Checkout**. An agent with an authorized card may complete the page. Issuer authentication can require the user. No raw-card or direct-charge endpoint exists.

## Prices, email and delivery

All prices are USD and **include US shipping**. Sales tax is calculated before approval. There is no shipping minimum or free-shipping threshold.

| Product | Price |
|---|---|
| 4×4 and 4×6 lustre, mixed together | $12 for up to five; 50¢ per additional print |
| 8×10 lustre | $12 for one; $17.50 for two; $2.50 per additional print after two |
| 12×16 matte poster | $28, maximum one per order |

Combine small prints and 8×10s in one order to save **$5 once**, already included in the quoted subtotal. Small sizes share one five-print minimum across all photos. The 8×10 tier also applies across all photos, not separately to each image. Posters do not receive the shared-delivery saving and may ship separately.

Examples before sales tax: ten small prints **$14.50**; five 8×10s **$25**; five small prints + one 8×10 **$19**; five small prints + a poster **$40**. Maximum 100 non-poster prints plus one poster. Orders below five small prints still cost $12; only the approved quantity is printed.

Set `items[].product` to `prints` (4×6), `square` (4×4), `enlargement` (8×10), or `poster` (12×16). The top-level `product` is the default for older clients. `/api/catalog` publishes prices in **integer USD cents**, tier rules, `shippingIncluded: true`, and the mixed-order saving. Native Poppy and HTTP compatibility use the same pricing functions in `src/offer.ts`.

- **Quotes and existing orders:** quotes expire after 15 minutes; checkout expires roughly one hour after order creation. Approved amounts are frozen. Existing orders and Stripe sessions keep their original prices, including any old shipping charge. Changes require a new proposal and approval.
- **Coupons:** applied before approval, capped at the remaining order value. Fully covered orders can complete free checkout. Discounts may intentionally be loss-making; no cash credit remains.
- **Stripe itemization:** one combined prints line, reduced by the coupon, plus tax when applicable. New quotes have no separate shipping charge. This is not a per-photo Stripe itemization. The order page and confirmation email show ordered photos, quantities and saved totals.
- **Receipts:** paid nonzero orders have a private “View Stripe payment” action; unpaid orders link to checkout while valid. Free and simulated orders have no Stripe charge receipt.
- **Costs:** fresh supplier quotes are checked before checkout and fulfillment. The model includes supplier tax (quoted tax or a 10% allowance), standard domestic card fees of 2.9% + 30¢, 50¢ for Stripe Tax, and a $1 contribution floor. This is not guaranteed net profit; international-card fees, overhead and exceptional costs are excluded. See [current margin policy](docs/ORDER-MARGINS.md); [older pricing research](docs/PRICING-RESEARCH.md) is historical.
- **Emails and tracking:** confirmation includes ordered photos, full shipping address, saved total and private order link. Shipment emails are queued when the provider confirms dispatch; tracking is included when available. Empty shipment placeholders are hidden on the order page.
- **Delivery:** the 7–12-business-day arrival window is our planning estimate, not a provider guarantee or measured delivery performance. The app never infers delivery from shipment.

## Hosted example

The public example uses Vercel for the React website and same-origin rewrites to a single Railway service. Railway owns the API, background worker, SQLite database and private images on a persistent `/app/.data` volume. `PUBLIC_URL` is the Vercel custom domain, so discovery, DPoP proofs, checkout returns and signed media URLs all use the same origin.

`vercel.json` contains the example backend's **public URL only**. Forks must replace that URL with their own Railway service. Set provider credentials only on Railway; Vercel needs no provider secrets. Keep one backend replica and mount the persistent volume before deploying. In Railway service settings, connect the `main` branch, use the detected Dockerfile, set the health check to `/api/health`, and keep serverless sleeping disabled. New services no longer support Railway config-as-code. Railway mounts volumes as root: this deployment sets `RAILWAY_RUN_UID=0` so the service can write its private volume.

New installations default to `APP_MODE=demo`: payments, prints and emails are simulated. Agent Sandbox can optionally send real, clearly labeled order emails through Resend; see [the sandbox guide](docs/SANDBOX.md#real-sandbox-order-emails). The public store can accept real orders; check `/api/catalog` for its current mode and availability. Deploying a fork does not enable live transactions. Use separate credentials and storage when switching from demo to live.

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

Brand and sample artwork use abstract orange, red and yellow poppies. The homepage screenshot above shows the public storefront; sample artwork is illustrative, never a customer upload. Fonts: [Young Serif](https://fonts.google.com/specimen/Young+Serif) and [Hanken Grotesk](https://fonts.google.com/specimen/Hanken+Grotesk), self-hosted with OFL licenses.

[Poppy spec](https://personalagentprotocol.org/docs/spec) · [operations](https://personalagentprotocol.org/docs/extensions/operations) · [Prodigi API](https://www.prodigi.com/print-api/docs/reference/) · [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment)

## Native Poppy and compatibility access

`/.well-known/poppy.json` discovers `/openapi.json`, which documents native DPoP authentication only. `/agent.txt` also contains native-only instructions. Native client metadata URLs must appear in `AGENT_CLIENT_IDS`. Renew with the original session ID to retain access to pending operations.

For agents without native Poppy support, `/api/compat/instructions` and `/api/compat/openapi.json` document the separate HTTP compatibility path. It uses unverified Bearer sessions and does **not** enforce the native identity allowlist or DPoP binding. `ALLOW_COMPAT_AGENT_SESSIONS=false` disables it in every mode; when unset it defaults on only in demo mode. Existing compatibility tokens remain supported when enabled.

Malformed JSON bodies return `400 invalid_request`; oversized JSON bodies return `413 request_too_large`. Correct the request rather than retrying it unchanged.

## License

Project code is available under the [MIT License](LICENSE). Third-party fonts retain their accompanying licenses.

### Private discounts

Private codes can sponsor part or all of an order. Codes may be single-use or have a shared campaign redemption limit. Agents supply `couponCode` before approval; the quote, checkout and confirmation reflect the discount. See [code generation and redemption](docs/COUPONS.md). Generated codes are private and are never committed.

### Order cost protection

Live orders check current supplier costs at proposal, checkout creation and fulfillment. Coupon discounts are intentional merchant subsidies; ordinary orders must cover conservative costs and reserves. A cost increase after payment holds printing for review/refund. See [margin policy and combined-shipping research](docs/ORDER-MARGINS.md) for assumptions and limits.

### Agent conversation

Approval summaries are compact receipts: photos with matching quantities/crops are grouped, with exceptions and low-resolution warnings retained. Agents should collect missing details together, use a single mixed order for one destination, show numbered previews alongside the receipt, and keep API mechanics out of customer chat. The same guidance is published for native Poppy, HTTP compatibility, and sandbox clients. Explicit approval of the complete terms is still required. Client agents control their own UI and may not follow every presentation instruction.
