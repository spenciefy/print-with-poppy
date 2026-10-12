# Verification — 2026-10-11

- `npm run check`: TypeScript and production Vite build pass; 11 integration/contract tests pass.
- `npm run test:e2e`: reference personal agent completed Poppy discovery, issuer check, signed client/session assertions, DPoP-authenticated upload, full-address approval, demo checkout/payment, fulfillment, shipment and two captured emails against the running server.
- Browser: sample uploads, private crop previews, disabled approval until checked, full address/price summary, checkout, payment, shipment tracking and rendered email preview verified.
- Responsive: 1440px desktop and 390px phone layouts inspected. No horizontal overflow on either; all homepage photos loaded. Viewport override reset afterward.
- Screenshots: `preview.jpg` (homepage), `preview-desktop.jpg` (full page), `preview-mobile.jpg` (full page).
- Local operator queue had no pending jobs after the successful demo.

## Evidence boundary

Demo fulfillment and payment are simulations, and emails are captured locally. Provider-contract tests intercept HTTP/SDK calls. No real Stripe transaction, Prodigi sandbox/live order, external email delivery, deployed domain, container build or delivered print has been verified. These need account credentials and the launch steps in README.md.
