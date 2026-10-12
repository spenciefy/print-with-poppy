# Chat demo

`/demo` is a scripted, browser-only walkthrough linked from the homepage. It uses public poppy artwork and fictional recipient details. It never creates sessions, uploads private files, confirms operations, opens Stripe Checkout, submits print orders, or sends email.

Play/pause/next/restart controls move through sharing photos, discovery, product selection, crops/address/price approval, simulated payment, order status and email previews. Product selection and approval are explicit gates. Prices use the shared catalog calculation; $0 tax is labeled as an example. Print and poster paths both work. Reduced-motion preferences disable animated entrances and scrolling.

Order and email panels are illustrative previews, not live records or delivered email. Native Poppy and guest HTTP integration are distinguished in the explanatory panel. Live integration testing remains separate.

Verification: production build and 22 tests pass; desktop photo-print path and mobile poster path exercised through confirmation/email, including selection and approval gates, playback and 390px overflow check. Real order subtitle mapping separately tested for shipped, partial, cancelled, expired, payment-pending and printing states.
