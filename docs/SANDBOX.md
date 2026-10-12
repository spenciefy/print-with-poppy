# Agent Sandbox

Use **https://sandbox.printwithpoppy.com** to test a personal-agent implementation without cards, purchases, physical printing, or outbound email. This is a separate deployment and database from the real store.

| Surface | Purpose |
| --- | --- |
| `https://printwithpoppy.com` | Live orders and real payments |
| `https://printwithpoppy.com/demo` | Scripted visual walkthrough; no API calls |
| `https://sandbox.printwithpoppy.com` | Real Poppy API integration with simulated providers |

Before testing, GET `/api/config` on your target. Require `environment: "agent-sandbox"` and `mode: "demo"`. Never switch to the production origin during a sandbox flow. Only use sample images, fictional shipping details, and synthetic email addresses. Test data may be reset; do not store anything you need to keep.

The live `poppy.json` links to sandbox discovery in its API description. This is an informational link, not an automatic protocol redirect: agents must discover the sandbox domain and create a separate session. The sandbox homepage uses the same storefront as production with a persistent sandbox banner and a simulation-specific agent prompt. `/sandbox` contains the testing guide.

## Connect an agent

1. Publish your HTTPS Poppy client metadata and JWKS with your own public signing key, and advertise Operations v1. Keep the private key in your agent.
2. Send the client metadata URL to `hello@printwithpoppy.com` for registration. DPA's `https://personal-agent.adewale-883.workers.dev/poppy/client.json` is preconfigured. Registration on production and sandbox is separate.
3. Discover `/.well-known/poppy.json` and its OAuth metadata on the sandbox origin. Open a native signed-out session with client/session assertions and DPoP; use the issued session token and fresh DPoP proof for every API request. No compatibility-session or unsigned-auth bypass is enabled.
4. Read `/openapi.json` or browse `/docs`. The sandbox-only operations are included in that document. They are ordinary PWP API operations, not additions to the Poppy protocol.

## End-to-end order test

Keep one session for the whole order. These are OpenAPI operation IDs (your agent's generic API tool may name its arguments differently):

1. `getCatalog`: choose `prints` or `poster`.
2. `uploadPhoto`: upload sample JPEG/PNG/WebP files as multipart field `photo`. Obtain user approval to transmit any attachments.
3. `proposeOrder`: send a **JSON object**, not a quoted JSON string. Supply an `Idempotency-Key`, complete synthetic US shipping address, email, and photo items. For example:

```json
{
  "product": "prints",
  "email": "sandbox@example.com",
  "address": {"name": "Sandbox Recipient", "line1": "123 Market Street", "city": "San Francisco", "state": "CA", "postalCode": "94103", "country": "US"},
  "items": [{"photoId": "<uploaded photo ID>", "quantity": 5, "fit": "cover"}]
}
```

4. Show the returned summary, photos/crops, address and illustrative total. Get approval, then confirm that revision through the Operations extension. Poll the operation until `succeeded`; `result.data.order_id` is the order to simulate. Success here means checkout prepared, not payment.
5. `simulatePayment`: POST `/api/sandbox/orders/{id}/pay`, no body or card required. Your client may request approval for this write. Poll `getOrder` until `printing`.
6. `simulateShipment`: POST `/api/sandbox/orders/{id}/ship`. Poll until `shipped`.
7. `getSandboxEmails`: GET `/api/sandbox/orders/{id}/emails` until confirmation and shipment previews are present. `delivered: false` is intentional: these messages never reached an inbox.

Payment and shipment simulation are safe to repeat on the same order. Controls require the originating authenticated session; another session gets 404. Payment requires a prepared, unexpired checkout following approval. Shipping requires simulated payment and fulfillment. Carrier names and tracking numbers are explicitly synthetic. The returned `status_url` and `checkout_url` show the order and a no-charge simulation UI.

A suggested agent prompt:

> Test ordering five sample photo prints using https://sandbox.printwithpoppy.com via Personal Agent Protocol. Verify environment=agent-sandbox first. Ask me for sample photos, use fictional recipient details, show the proposal and ask for approval, then simulate payment and shipment and show the captured emails. Never use the production store or a real card.

## Optional customer-account test

Sandbox advertises **mediated sign-in**. Start it using a native signed-out session, a unique email at `example.com`, `example.org`, or `example.net`, and `poppy:read poppy:write` scopes. Other email domains are rejected. This is a simulation of email ownership, not verification of a real address.

The response contains `sign_in_id`. Call `getSandboxSignInEmail` (GET `/api/sandbox/sign-in/{id}/email`) in that same session, read the captured code, and complete the mediated challenge normally. This endpoint refuses other sessions, consumed challenges and expired challenges. Exchange the returned account token for a signed-in session token, create a new order, and call `listAccountOrders`. Guest orders are not retroactively linked. Do not log or share tokens or OTPs.

Direct browser sign-in is not advertised in the hosted sandbox. Production OTP delivery remains real and never exposes this test-only endpoint.

## Run your own sandbox

```sh
npm ci
APP_MODE=demo AGENT_SANDBOX=true ALLOW_COMPAT_AGENT_SESSIONS=false \
  DATA_DIR=.data-agent-sandbox PUBLIC_URL=https://your-sandbox.example \
  AGENT_CLIENT_IDS=https://your-agent.example/poppy/client.json \
  HOST=0.0.0.0 npm start
```

Use a separate service, volume and origin. Do **not** install Stripe, Prodigi or Resend credentials: startup rejects them in Agent Sandbox. `APP_MODE=demo` supplies simulated providers; `AGENT_SANDBOX=true` exposes native authenticated simulation controls and the sandbox landing page. The older `APP_MODE=sandbox` setting means provider integration tests using Stripe test keys and Prodigi sandbox; it is **not** this no-card Agent Sandbox. Plain `APP_MODE=demo` without the flag is local development and retains local demo helpers.

Local reference test: start the app in ordinary `APP_MODE=demo`, then `npm run test:e2e` using the same `PUBLIC_URL` and `DATA_DIR`.

To test a hosted sandbox with the reference client, first register your public metadata/JWKS, then:

```sh
PUBLIC_URL=https://sandbox.printwithpoppy.com \
  AGENT_CLIENT_ID=https://your-agent.example/poppy/client.json \
  AGENT_PRIVATE_JWK_FILE=/private/path/to/es256-private.jwk \
  npm run test:e2e
```

Add `-- --sandbox-account` to `npm run test:e2e` to exercise captured OTP sign-in and order history too.

The private JWK stays local and should have a `kid` matching its published public JWK. The reference script refuses a non-demo server. Never commit that file. The optional `SANDBOX_REFERENCE_PUBLIC_JWK` deployment setting publishes only a public key at `/api/sandbox/reference-jwks.json`; it is for operator smoke tests and does not give visiting agents a signing key.

## What passing proves

The sandbox exercises actual discovery, JWT/DPoP authentication, image processing, pricing, operation approval, checkout preparation, order state changes, and email rendering. Provider responses are simulated. It does not prove Stripe charging, physical print quality, production tax calculations, carrier delivery, or inbox delivery.
