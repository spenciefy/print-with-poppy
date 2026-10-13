# Order costs and shipping

Verified October 12, 2026 using the live Prodigi US/Budget quote endpoint. No print orders were created.

## Margin guard

Live proposals, checkout creation, and fulfillment submission check a fresh combined supplier quote. The guard includes products, all shipping charges, branding, quoted supplier tax (or a conservative 10% allowance), standard domestic card fees of 2.9% + $0.30, $0.50 for tax services and a $1 operating reserve. Customer sales tax is excluded from revenue but included in estimated payment fees. Any additional amount in the supplier's quoted total is counted too.

Coupons are explicitly permitted to lose money: approved discounts are added back for this check as an intentional merchant subsidy. An otherwise unprofitable order is still blocked even with a coupon. Sandbox orders are simulated and exempt.

An unfavorable cost change blocks creation of a new checkout. If payment was already taken, it holds fulfillment for operator review/refund, without raising the customer's approved price. The failed job must be reviewed before manually retrying. No automatic refund is attempted.

This is a conservative contribution-margin guard, not a guarantee of accounting profit. Quotes are not locked supplier prices. Later supplier changes, refunds, chargebacks, reprints, actual fees and fixed overhead can create losses. Existing checkout links cannot be retroactively prevented from accepting payment, but fulfillment is checked again.

## Products quoted alongside five 4×6 lustre prints

The five 4×6 prints cost $1.25 to produce. The following values are current quotes, not guaranteed future routing or prices.

| Added item | SKU | Added production | Combined shipping | Combined production + shipping | Labs / shipments |
|---|---|---:|---:|---:|---|
| 4×4 lustre | GLOBAL-PHO-4X4 | $0.25 | $6.70 | $8.20 | us4 / 1 |
| 5×7 lustre | GLOBAL-PHO-5X7 | $0.50 | $6.70 | $8.45 | us4 / 1 |
| 8×10 lustre | GLOBAL-PHO-8X10 | $2.00 | $6.70 | $9.95 | us4 / 1 |
| 8×12 lustre | GLOBAL-PHO-8X12 | $5.00 | $13.15 | $19.40 | us4 + us14 / 2 |
| 5×7 Pro | GLOBAL-PHO-5X7-PRO | $1.00 | $13.40 | $15.65 | us4 + us2 / 2 |
| 8×10 Pro | GLOBAL-PHO-8X10-PRO | $4.00 | $13.40 | $18.65 | us4 + us2 / 2 |
| Current 12×16 matte poster | GLOBAL-FAP-12X16 | $14.00 | $13.80 | $29.05 | us4 + prodigi_us / 2 |

GLOBAL-PHO-12X16 was not found, and GLOBAL-PHO-12X18 did not return a usable quote. Do not advertise either based on this research.

Recommendation: evaluate the 8×10 lustre photo print as the larger option. It is a different size/material from the existing 12×16 matte poster and must not silently replace an approved product. All four sizes are now supported. See `src/offer.ts` for current shipping-inclusive prices.

Sources: https://www.prodigi.com/products/prints-and-posters/photo-prints/c-types/ and https://support.prodigi.com/hc/en-us/articles/13168991692572-How-does-pricing-work-when-shipping-multiple-items . Lab assignments and prices above come from authenticated live API quotes.

Current pricing: $12 for up to five small prints, then 50¢ each; 8×10s $12 for one, $17.50 for two, then $2.50 each; poster $28. US shipping included without a threshold. A $5 combined-delivery saving applies once when small prints and 8×10s are both present, allocated to the small-print subtotal. Posters do not share that shipment. The $1 guard is an estimate with a 10% supplier-tax allowance; international-card uplifts, overhead and exceptional costs are not included. Existing approved quote amounts remain frozen.
