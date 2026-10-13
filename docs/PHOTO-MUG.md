# Optional photo mug — product research

Checked 2026-10-12 using Prodigi's public catalog and authenticated live product/quote API. No physical order was submitted.

- [Photo mugs](https://www.prodigi.com/products/home-and-living/drinkware/photo-mugs/): 11oz white ceramic, US fulfillment available, no apparel size selection. API SKU `GLOBAL-MUG-W`, color `white`, size `313ml / 11oz`, artwork 2670 × 1110 px. Best fit for a small extra that can use a customer's existing photo.
- [Photo magnets](https://www.prodigi.com/products/stickers/magnets/): relevant to prints, but the catalog currently lists UK fulfillment, making them a poorer fit for our US-only store.
- [Magic mugs](https://www.prodigi.com/products/home-and-living/drinkware/magic-photo-mugs/): playful heat reveal, but also UK fulfillment. Not enabled.

The live US Budget quote returned $10.00 item cost + $6.45 shipping, and a warning that US sales tax may apply. The selected shipment was US fulfillment. That routing is a quote, not proof of a future carrier or dispatch. Price: $22 including shipping, tax calculated before approval. The existing cost guard rejects quotes that cannot cover configured allowances; it runs again before fulfillment. Do not promise mugs share print shipping costs or a package.

The mug is available through the same native/compatibility proposal, exact approval, Stripe checkout, order status, email, and Prodigi fulfillment paths as prints. Its flattened wrap preview is visibly identified in approval terms. Limit one mug per order; optional mixed orders retain a single customer checkout.

Validation: local native API tests cover mixed pricing, exact image dimensions, signed preview access, item attributes, and aggregate one-mug limit. Hosted sandbox verification simulates payment and fulfillment. Physical mug quality remains untested.
