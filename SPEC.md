# Print with Poppy — v1

Printwithpoppy.com turns photos shared with a personal agent into physical 4×6 prints or one 12×16 matte print, delivered to the user's home. The store demonstrates the Personal Agent Protocol (Poppy draft 0.1). No retail pickup, accounts or manual shopping flow in v1.

## Experience and brand

- Agent-first homepage: “Print out your memories.” Copyable agent instructions, physical photo imagery, how it works, agent documentation. Attached Poppy flower logo, poppy orange, warm paper background, tactile and playful typography.
- Agent discovers `/.well-known/poppy.json`, authenticates, uploads photos, chooses quantity and crop/fit per image, and supplies the recipient's full postal address and confirmation email.
- Service returns immutable, expiring terms and print previews. The agent shows the user the company, photos and quantities, crop choices, full shipping address, email, item/shipping/tax/total amounts, delivery estimate and cancellation terms. Explicit approval of that revision is required.
- Agent is assumed to have a card. After approval it opens Stripe-hosted Checkout and uses its card there; human payment is an equivalent fallback. Card numbers never enter the store's API or database. Issuer authentication may still require the user. Poppy itself does not standardize payments.
- Confirmed payment triggers fulfillment exactly once. Confirmation email includes order reference, address, total, status link and available estimate. Shipment emails include carrier tracking when Prodigi supplies it. Untracked shipments say so; production estimates are not presented as guaranteed arrival dates.

## Fulfillment and scope

- Prodigi `GLOBAL-PHO-4X6`, one validated finish, shipped to home. US/USD first (configurable expansion later); maximum 100 prints per order. Separate sandbox/live credentials.
- Quote actual supplier cost and shipping, add configurable margin, calculate customer sales tax through Stripe Tax before approval, and freeze totals. Do not confuse supplier tax with customer tax. Demo prices are explicitly illustrative.
- Store normalized print-ready JPEGs privately; use signed, expiring asset links for Prodigi and previews. Validate image format, decoded size, dimensions, orientation and crop. Preserve the full image with white borders by default; optional center crop to 3:2. Flag low resolution. Delete abandoned photos after 24 hours and fulfilled-order photos 30 days after shipping.

## Protocol and API

- Poppy discovery, OAuth metadata, signed-out guest sessions, HTTPS client metadata/JWKS verification, private_key_jwt assertions, DPoP request proofs and replay protection. Production agents initially register through an exact client-ID allowlist.
- OpenAPI documents uploads, quotes/order proposals, operations confirm/cancel/read and order status. Operations extension v1 ties approval to immutable revision terms. Signed-out operations remain scoped to their originating session.
- Approval creates an order and checkout link; a succeeded operation means checkout was prepared, not that payment or printing succeeded. Track those states on the order separately. Retry the same operation/order; never duplicate purchases.

## Reliability and integrations

- Stripe-signed webhooks confirm paid totals/currency and order identity. Durable outbox retries fulfillment and emails. Stable provider idempotency keys prevent duplicate charges, orders and mail across retries.
- Prodigi callbacks are wake-up hints only: authenticated server-side order retrieval is the source of truth. Periodic reconciliation recovers missed callbacks. Preserve separate paid, submitted, printing, shipped, cancelled and attention states; don't invent delivered status.
- Resend sends transactional confirmation and shipment updates. Local demo mode captures email previews without sending mail or ordering prints.
- Single Node service with React/Vite frontend, SQLite and private files on a persistent volume. One service instance in v1; no ephemeral/serverless filesystem deployment. Environment-based secrets, health/readiness checks, rate and upload limits.

## Acceptance

A reference agent completes discovery → signed session → photo upload → quote → explicit approval → card checkout → verified payment → one Prodigi order → confirmation → shipment update. Tests cover ownership, replay, expired/revised approval, duplicate and reordered events, provider outages, amount mismatches and privacy. Local demo and mocked contract tests are separate from Stripe test-mode, Prodigi sandbox and a real delivered sample.

## Launch prerequisites

Prodigi API key and verified finish/shipping quote; Stripe test/live keys, webhook signing secret and Tax configuration; verified Resend sender; public HTTPS domain and persistent storage. Validate a physical sample and delivered economics before public live ordering.

References: https://personalagentprotocol.org/docs/spec · https://personalagentprotocol.org/docs/extensions/operations · https://www.prodigi.com/print-api/docs/reference/ · https://docs.stripe.com/checkout/fulfillment

## Pricing and brand update

Two public offers: one 12×16 matte print for $35, or $12 for 1–5 4×6 lustre prints, US Budget delivery included, then $0.50 per additional print up to 100. Customer tax is added before approval; only approved quantities are printed. Shared site/server pricing; reject unexpected supplier costs instead of changing published terms. Arrival is a provisional 7–12-business-day estimate, subject to delivered-sample validation. See docs/PRICING-RESEARCH.md. Supplier names stay in implementation/research, not customer copy. Square poppy-field instant-photo logo replaces the flower-only mark.

## Agent-only storefront

Show both products and prices, a selectable square agent prompt with a copy icon, then a protocol FAQ with links to discovery, OpenAPI and source. No manual upload/cart/checkout entry point. Catalog endpoint exposes product IDs and prices; proposals select one product per order. Poster preparation uses the normalized original at 3600×4800 pixels, with crop preview and size-specific resolution warning before approval. Larger prints are not prepared from the 4×6 derivative. Non-live modes display Ordering opens soon; only live mode claims accepting orders.

## Agent compatibility

Native Poppy remains signed and allowlisted. A separately identified HTTP compatibility path creates a private, hashed-at-rest 24-hour Bearer session via POST /api/agent-sessions, throttled to 10/hour per apparent IP. It uses the same upload, proposal, approval and payment APIs without claiming a verified agent identity. No manual web cart. Agent brand compatibility remains unverified until actual product tests.
