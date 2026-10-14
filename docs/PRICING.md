# Pricing, payment and delivery

All prices are USD and **include US shipping**. Sales tax is calculated before approval. There is no shipping minimum or free-shipping threshold.

| Product | Price |
|---|---|
| 4×4 and 4×6 lustre, mixed together | $12 for up to five; 50¢ per additional print |
| 8×10 lustre | $12 for one; $3 per additional print |
| 12×16 matte poster | $28, maximum one per order |

Combine small prints and 8×10s in one order to save **$5 once**, already included in the quoted subtotal. Small sizes share one five-print minimum across all photos. The 8×10 tier also applies across all photos, not separately to each image. Posters do not receive the shared-delivery saving and may ship separately.

Examples before sales tax: ten small prints **$14.50**; five 8×10s **$24**; five small prints + one 8×10 **$19**; five small prints + a poster **$40**. Maximum 100 non-poster prints plus one poster. Orders below five small prints still cost $12; only the approved quantity is printed.

Set `items[].product` to `prints` (4×6), `square` (4×4), `enlargement` (8×10), or `poster` (12×16). The top-level `product` is the default for older clients. `/api/catalog` publishes prices in **integer USD cents**, tier rules, `shippingIncluded: true`, and the mixed-order saving. Native Poppy and HTTP compatibility use the same pricing functions in `src/offer.ts`.

- **Quotes and existing orders:** quotes expire after 15 minutes; checkout expires roughly one hour after order creation. Approved amounts are frozen. Existing orders and Stripe sessions keep their original prices, including any old shipping charge. Changes require a new proposal and approval.
- **Coupons:** applied before approval, capped at the remaining order value. Fully covered orders can complete free checkout. Discounts may intentionally be loss-making; no cash credit remains.
- **Stripe itemization:** one combined prints line, reduced by the coupon, plus tax when applicable. New quotes have no separate shipping charge. This is not a per-photo Stripe itemization. The order page and confirmation email show ordered photos, quantities and saved totals.
- **Receipts:** paid nonzero orders have a private “View Stripe payment” action; unpaid orders link to checkout while valid. Free and simulated orders have no Stripe charge receipt.
- **Costs:** fresh supplier quotes are checked before checkout and fulfillment. The model includes supplier tax (quoted tax or a 10% allowance), standard domestic card fees of 2.9% + 30¢, 50¢ for Stripe Tax, and a $1 contribution floor. This is not guaranteed net profit; international-card fees, overhead and exceptional costs are excluded. See [current margin policy](ORDER-MARGINS.md); [older pricing research](PRICING-RESEARCH.md) is historical.
- **Emails and tracking:** confirmation includes ordered photos, full shipping address, saved total and private order link. Shipment emails are queued when the provider confirms dispatch; tracking is included when available. Empty shipment placeholders are hidden on the order page.
- **Delivery:** the 7–12-business-day arrival window is our planning estimate, not a provider guarantee or measured delivery performance. The app never infers delivery from shipment.

