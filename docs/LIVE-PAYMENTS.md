# Accepting real payments

The customer pays Print with Poppy through Stripe Checkout. A verified paid event queues the approved order for Prodigi. Prodigi bills the store's saved payment method for production and shipping; the app does not transfer the customer's Stripe payment to Prodigi. Keep funds available for fulfillment independently of Stripe payout timing.

## Remaining setup

1. Complete Stripe activation: public support details, statement descriptor, payout bank and final review. Configure Stripe Tax business settings and applicable registrations; this implementation calls the Tax Calculation API before approval.
2. Add a payment method to the Prodigi live account. Confirm billing details and the 4×6 lustre product quote for the destination.
3. Configure a live Stripe webhook at `https://printwithpoppy.com/api/webhooks/stripe` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
4. Set Railway secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PRODIGI_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, persistent `APP_SECRET`, and exact trusted `AGENT_CLIENT_IDS`. Keep keys out of Vercel and GitHub. Verify that the support mailbox receives mail.
5. First validate a separate sandbox deployment using Stripe test credentials and Prodigi sandbox credentials. Check paid webhook handling, print submission, status updates and real delivery of the two emails.
6. Deploy with `APP_MODE=live` and separate live storage. With a specified budget and recipient, place one real test order and verify the charge, Prodigi billing, shipment and delivered print before public launch.

## Current behavior and operational work

- The agent must show the full address, photos/crops, email and complete price before requesting approval. Card details go through hosted Stripe Checkout.
- Pricing currently uses twice the quoted Prodigi item cost, with a $5 item subtotal minimum, plus quoted shipping and calculated customer tax. Review profitability including payment fees, supplier tax, refunds and reprints before launch.
- Successful payment queues print submission with stable idempotency keys. Confirmation and shipment emails run through Resend; tracking is included when supplied by Prodigi.
- Failed fulfillment remains retryable. Refunds, reprints and cancellations require operator action in the provider dashboards.
- Before live launch, configure and verify client-IP handling behind Vercel/Railway. The current conservative proxy configuration can share rate limits across visitors.

Sources: [Prodigi payments FAQ](https://www.prodigi.com/faq/all/), [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment).
