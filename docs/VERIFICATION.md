# Verification — 2026-10-11

- `npm run check`: TypeScript and production Vite build pass; 11 integration/contract tests pass.
- `npm run test:e2e`: reference personal agent completed Poppy discovery, issuer check, signed client/session assertions, DPoP-authenticated upload, full-address approval, demo checkout/payment, fulfillment, shipment and two captured emails against the running server.
- Browser: sample uploads, private crop previews, disabled approval until checked, full address/price summary, checkout, payment, shipment tracking and rendered email preview verified.
- Responsive: 1440px desktop and 390px phone layouts inspected. No horizontal overflow on either; all homepage photos loaded. Viewport override reset afterward.
- Screenshots: `preview.jpg` (homepage), `preview-desktop.jpg` (full page), `preview-mobile.jpg` (full page).
- Local operator queue had no pending jobs after the successful demo.

## Evidence boundary

Demo fulfillment and payment are simulations, and emails are captured locally. Provider-contract tests intercept HTTP/SDK calls. No real Stripe transaction, Prodigi sandbox/live order, external email delivery or delivered print has been verified. These need completed account activation, credentials and the launch steps in README.md.

## Hosted example

- Public source: https://github.com/spenciefy/print-with-poppy; secrets, local databases and account screenshots are ignored.
- Frontend: Vercel, https://printwithpoppy.com; apex and www show Valid Configuration, with www redirecting to the apex.
- Backend: Railway Docker service with a persistent volume mounted at /app/.data, main-branch deploys and /api/health readiness check. Container deployment succeeded and the Vercel proxy returns demo health/config responses.
- Signed reference agent completed discovery, JWT/DPoP authentication, upload, full-address approval, simulated payment, fulfillment, shipment and two captured emails through the public HTTPS domain. Because Railway DNS still cached the domain's earlier NXDOMAIN response, this test process resolved the domain to its configured Vercel IP (216.150.1.1); HTTPS certificate verification remained enabled. This proves the deployed flow, not universal DNS propagation. Chrome also opened the real domain normally.
- Prodigi live API read-only product lookup returned 200/Ok for GLOBAL-PHO-4X6, including lustre finish; no order was placed. Resend domain verified.
- APP_MODE remains demo. Stripe customer-facing support details, payout bank and activation are pending user input. No live provider credentials are installed in this deployment.
