# Pricing and product decisions — 2026-10-11

## Launch offer

**Up to 20 prints for $20, US delivery included. Additional prints 50¢ each. Tax added before approval.**

One size (4×6), one finish (lustre), one delivery service (Budget), one price formula. The $20 minimum covers 1–20 prints. We print only the photos and quantities approved, never pad an order with duplicates. Max 100 prints. Recommend 20 to the agent, but do not force a user to find 20 photos. Default to preserving the whole photo with borders; only ask about cropping when necessary. Keep future products out of the launch homepage.

This is now implemented in the demo and live code paths. The store is still in demo mode; this research did not place an order or charge a card.

## Live quote evidence

Authenticated production API product lookups and non-purchasing `/quotes` calls, US destination, USD, current account (not assuming Pro discounts). Compact responses are in `research/`. Country-level quotes are not address-specific promises. Responses explicitly warn that US supplier sales tax may apply and is excluded.

4×6 lustre (`GLOBAL-PHO-4X6`) costs $0.25/print. Verified separate photo items at 20, 50 and 100; Budget shipping stayed $6.70. Standard shipping is $10.75. Both quote UPS Mail Innovations, but identical carrier naming does not establish identical SLA or tracking. Express is $23.75 and Overnight $33.45 before production; neither is offered to customers.

| Prints | Retail before tax | Print cost | Budget delivery | Card fee* | Contribution* | Contribution % |
|---:|---:|---:|---:|---:|---:|---:|
| 20 | $20.00 | $5.00 | $6.70 | $0.88 | $7.42 | 37.1% |
| 50 | $35.00 | $12.50 | $6.70 | $1.32 | $14.48 | 41.4% |
| 100 | $60.00 | $25.00 | $6.70 | $2.04 | $26.26 | 43.8% |

*Planning model uses Stripe's public US domestic online-card rate of 2.9% + $0.30, rounded to cents. This is contribution before supplier sales tax, processing fees on customer tax, Stripe Tax fees, email/hosting, acquisition, reprints, refunds and support—not net profit. Actual account fees may differ. A 10% supplier-tax allowance plus a 5% retail reserve leaves approximately $5.25 / $10.81 / $20.09 for the three sizes before other costs. No Pro discount or introductory sample rebate is assumed.

Why a bundle minimum: one print still incurs almost the entire delivery cost. Why 50¢ extras: additional production costs 25¢, so the customer gets inexpensive extras without a new package decision. Why not subscribe: subscription cadence, renewals and photo selection add decisions before we know repeat demand.

## Delivery expectation

Display **estimated 7–12 business days after payment**, explicitly a planning estimate and not guaranteed. The C-type product page lists 48–72 hours production. The live quote supplies a carrier/service but no transit SLA or arrival date. UPS describes domestic Mail Innovations timing relative to First Class Mail; its separate international 4–8-day service is not evidence for our domestic route. The 7–12-day range is our conservative launch assumption, not something returned by the API. Validate multiple delivered samples (including different US regions) before enabling live sales; adjust or remove the range if the evidence does not support it. Alaska/Hawaii/remote destinations may take longer; quote availability and cost guard still apply.

## Other products: research, not a live catalog

| Product / fixed offer | Verified supplier costs to US | Possible retail, shipping included* | Decision |
|---|---|---:|---|
| 4×4 lustre prints | $0.25 each + $10.75 Standard shipping in the sampled quote | Same bundle only after Budget/mixed-order validation | Closest extension, but adds an aspect-ratio choice. Keep 4×6 launch default. |
| 4×6 professional paper | $0.50 each + $10.75 Standard | No separate launch tier | Twice the production cost; hard to communicate the upgrade without decisions. |
| 5×7 professional print | $1.00 + $10.75 Standard | Not selected | A size menu provides little benefit to the core flow. |
| One 8×10 professional print, unframed | $4.00 + $6.70 Budget = $10.70 | $25 | Best simple second offer: “Print this one bigger.” One photo, one size, no frame selection; about $13.28 before tax/reserves and other costs. Different lab from 4×6: do not assume combined shipping savings. |
| One black 8×8 stick-on photo tile | $9.00 + $14.00 Budget = $23.00 | $39 | Strong ad: “One photo. On your wall. No nails.” About $14.57 before tax/reserves and other costs. Fixed black frame; sample adhesive/print quality first. |
| Three black 8×8 photo tiles, three distinct photos | $27.00 + $28.00 Budget = $55.00 | $79 | Better visual ad, but higher commitment. About $21.41 before tax/reserves and other costs. Shipping increases—do not multiply the single-item margin. |
| One black 11×14 classic frame | $38.00 + $24.80 Standard = $62.80 | $99 | Gift-oriented future offer; higher damage/reprint exposure. Budget quote not validated. |
| 4×4 magnet | $5.29 + $32.96 Standard = $38.25, ships from UK | Do not launch | Attractive format, poor current US economics. |
| Softcover photo book | Public catalog: 20–300 pages, 96-hour production; selected sample SKU lookup failed | Not priced | Interesting “Turn this trip into a book” ad, but requires PDF pagination, cover/spine work and layout approval. Defer. |

*Alternative retail figures are recommendations, not published offers. All exclude customer tax and require current exact quotes, shipping validation, samples and implementation. Only 4×6 is orderable.

## Advertising with minimal choices

Start with different uses of the same product, not more SKUs: “Print 20 photos from this trip”, “Send the grandparents 20 photos”, “Print this month’s favorites”. Let the agent propose the selection, detect duplicates and poor resolution, and show one approval summary. Never interpret an ad or the agent's own choice as user approval.

Next product recommendation: one 8×10 enlargement at $25 delivered. Consider a $39 stick-on tile afterward. Keep each on its own focused landing page; do not turn the homepage into a catalog or cross-sell before approval.

## Sources

- [Photo paper, sizes and production time](https://www.prodigi.com/products/prints-and-posters/photo-prints/c-types/)
- [Photo tiles](https://www.prodigi.com/products/wall-art/photo-tiles/framed-photo-tiles/)
- [Classic frames](https://www.prodigi.com/products/wall-art/framed-prints/classic-frames/)
- [Magnets](https://www.prodigi.com/products/stickers/magnets/)
- [Softcover books](https://www.prodigi.com/products/books-and-magazines/softcover-photo-book/)
- [Dispatch versus delivery](https://support.prodigi.com/hc/en-us/articles/13168885835292-What-are-your-dispatch-times)
- [UPS Mail Innovations](https://www.ups.com/us/en/supplychain/logistics-solutions/mail-innovations)
- [Stripe standard pricing](https://stripe.com/pricing)

Supplier names are omitted from customer-facing website copy. Privacy copy still discloses sharing with our printing/shipping partner. Internal implementation and research retain actual provider names.

## Smaller minimum and one poster — proposed revision

Fresh authenticated Budget quotes: five distinct 4×6 photos cost $1.25 + $6.70 delivery = $7.95; ten cost $2.50 + $6.70 = $9.20. Supplier sales tax is excluded. Evidence: `research/4x6-budget-5.json` and `research/4x6-budget-10.json`.

Recommend a **$12 minimum covering up to five prints, then 50¢ per extra print**, US delivery included, customer tax extra. This lowers selection effort without introducing packages. Fewer than five photos remain possible at the same minimum; never add duplicates without approval.

| Quantity | Proposed retail | Print + delivery cost | Card fee | Contribution before other costs |
|---:|---:|---:|---:|---:|
| 5 | $12.00 | $7.95 | $0.65 | $3.40 |
| 10 | $14.50 | $9.20 | $0.72 | $4.58 |
| 20 | $19.50 | $11.70 | $0.87 | $6.93 |

Five is a viable entry offer but leaves limited room for paid acquisition or support. A 10% supplier-tax allowance and 5% retail reserve reduce the five-print contribution to about $2.01 before hosting, email, Stripe Tax and other costs. A $14 minimum is the safer alternative if paid advertising is central. Fees use standard US domestic cards, 2.9% + 30¢; actual account fees may differ.

For one larger option, prefer **one unframed 12×16 matte poster for $35 delivered**. `GLOBAL-FAP-12X16`, EMA 200gsm, live US Budget quote: $14 print + $7.10 shipping = $21.10. Card fee $1.32 leaves $12.58 before supplier tax, overhead and reserves. Evidence: `research/12x16-matte-budget.json`. An 8×10 enlargement could instead be $25 delivered (previous $10.70 cost), but offer only one large size to avoid a size menu.

The [official matte catalog](https://www.prodigi.com/products/prints-and-posters/art-prints/enhanced-matte-art/) confirms 12×16, 200gsm paper, 24–72-hour production and rolled shipping for US sizes above A4. The API gives no arrival SLA. Keep delivery labeled an estimate; validate samples before promising a poster arrival window. At 300dpi, the product API requests 3600×4800 pixels; agent should check source resolution and show crop/border approval. Mixed small-print/poster orders require their own combined quote and pricing policy, because fulfillment can split.

These prices and the poster are recommendations only. Current orderable catalog and $20/20-print minimum remain unchanged pending the product decision. The abstract logo replacement is implemented independently.
