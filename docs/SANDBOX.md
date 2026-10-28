# Agent Sandbox

Use **https://sandbox.printwithpoppy.com** to test a personal-agent implementation without cards, purchases, or physical printing. This is a separate deployment and database from the real store.

| Surface | Purpose |
| --- | --- |
| `https://printwithpoppy.com` | Live orders and real payments |
| `https://printwithpoppy.com/demo` | Scripted visual walkthrough; no API calls |
| `https://sandbox.printwithpoppy.com` | Real Poppy API integration with simulated providers |

Before testing, GET `/api/config` on your target. Require `environment: "agent-sandbox"` and `mode: "demo"`. Never switch to the production origin during a sandbox flow. Use sample images and fictional shipping details. Use your own email address for order emails; optional account sign-in still uses test email addresses. Test data may be reset; do not store anything you need to keep.

The live `poppy.json` links to sandbox discovery in its API description. This is an informational link, not an automatic protocol redirect: agents must discover the sandbox domain and create a separate session. The sandbox homepage uses the same storefront as production with a persistent sandbox banner and a simulation-specific agent prompt. `/sandbox` contains the testing guide.

## Connect an agent

1. Publish your HTTPS Poppy client metadata and JWKS with your own public signing key, and list the operations extension, version 2 (`"extensions": {"operations": {"version": "2"}}`). Keep the private key in your agent.
2. Send the client metadata URL to `hello@printwithpoppy.com` for registration. Poppy Demo Agent's `https://poppydemoagent.dev/poppy/client.json`, its interop harness identity `https://poppydemoagent.dev/poppy/interop/client.json`, and Muse's `https://muse.ai/poppy/agent.json` are preconfigured. The forgiving and strict test variants share the interop identity and use the same authentication and approval requirements. Registration on production and sandbox is separate.
3. Discover `/.well-known/poppy.json` and its OAuth metadata on the sandbox origin. Send a `Poppy-Session` header (a Session JWT signed by a delegated key, `pap_dlg`) on every API request; a new `sid` starts a signed-out Session. Client assertions at the OAuth endpoints are signed directly by your `jwks_uri` key. No compatibility-session or unsigned-auth bypass is enabled.
4. Read `/openapi.json` or browse `/docs`. The sandbox-only operations are included in that document. They are ordinary PWP API operations, not additions to the Poppy protocol.

## End-to-end order test

Keep one Session (one `sid`) for the whole order. These are OpenAPI operation IDs (your agent's generic API tool may name its arguments differently):

1. `getCatalog`: choose `prints` or `poster`.
2. Prefer `uploadPhotos` (`POST /api/photos/batch`) for multiple JPEG/PNG/WebP files: attach 1–10 files as `photo1` through `photo10`, up to 20 MB combined. One request lets compatible agents show one approval for the selected files. Read each result: keep successful photo IDs and retry only failed fields. For a single image, `uploadPhoto` still accepts multipart field `photo`. Obtain user approval to transmit attachments.
3. `proposeOrder`: send a **JSON object**, not a quoted JSON string. Supply a complete synthetic US shipping address, email, and photo items. It answers 403 `approval_required` with the operation. For example:

```json
{
  "product": "prints",
  "email": "sandbox@example.com",
  "address": {"name": "Sandbox Recipient", "line1": "123 Market Street", "city": "San Francisco", "state": "CA", "postalCode": "94103", "country": "US"},
  "items": [{"photoId": "<uploaded photo ID>", "quantity": 5, "fit": "cover"}]
}
```

4. Show the operation's summary, photos/crops, address and illustrative total. Get approval, then send the same `proposeOrder` request again with `Poppy-Approval: operation_id="…", revision="…"` (Operations v2). It returns the order (201); its `id` is the order to simulate. Retrying with the same approval returns the same order. Success here means checkout is being prepared, not payment.
5. `simulatePayment`: POST `/api/sandbox/orders/{id}/pay`, no body or card required. Your client may request approval for this write. Poll `getOrder` until `printing`.
6. `simulateShipment`: POST `/api/sandbox/orders/{id}/ship`. Poll until `shipped`.
7. `getSandboxEmails`: GET `/api/sandbox/orders/{id}/emails` until confirmation and shipment previews are present. Each email has `delivery: "captured"` or `"submitted"` and, after Resend acceptance, a `providerId`. Submitted means accepted by Resend, not confirmed inbox delivery.

Payment and shipment simulation are safe to repeat on the same order. Controls require the originating Session (or, for an account order, a Session signed in to that account); others get 404. Payment requires a prepared, unexpired checkout following approval. Shipping requires simulated payment and fulfillment. Carrier names and tracking numbers are explicitly synthetic. The returned `status_url` and `checkout_url` show the order and a no-charge simulation UI.

A suggested agent prompt:

> Test ordering five sample photo prints using https://sandbox.printwithpoppy.com via Personal Agent Protocol. Verify environment=agent-sandbox first. Ask me for sample photos, use fictional recipient details, show the proposal and ask for approval, then simulate payment and shipment and show the order emails. Never use the production store or a real card.

## Optional customer-account test

Sandbox offers **Mediated Sign-In** (the extension grant) and **device sign-in** (the `device_code` grant in the issuer metadata), with the store's scopes `orders:read`, `orders:write` and `addresses` (mediated: the first two). For Mediated, send the grant `https://personalagentprotocol.org/grant/mediated-sign-in` to `/oauth/token` with your client assertion, a unique email at `example.com`, `example.org`, or `example.net`, and `scope=orders:read orders:write`. Other email domains are rejected. This is a simulation of email ownership, not verification of a real address.

The `code_required` answer contains `sign_in_id`. Call `getSandboxSignInEmail` (GET `/api/sandbox/sign-in/{sign_in_id}/email`, with your Session header), read the captured code, and send the same grant with `sign_in_id` and `one_time_code`. The helper refuses other agents, consumed and expired sign-ins. Send the access token with your Session header, create a new order, and call `listAccountOrders`. Guest orders are not retroactively linked. Do not log or share tokens or OTPs.

For **device sign-in**, start it at `/oauth/device`, open the verification link, enter a synthetic email there, and complete it: the page shows the captured code, and a test agent can read it with `getSandboxDeviceSignInEmail` (POST `/api/sandbox/device-sign-in/email` with `{device_code}`; only the agent that started it). Poll `/oauth/token` with the device code grant and your client assertion. Signed in, try saved addresses (omit `address` on `proposeOrder`) and `reorderOrder`; both still need your approval of the operation. See [SIGN-IN.md](SIGN-IN.md).

Direct Sign-In isn't offered in the hosted sandbox (no `authorization_code` grant). Production OTP delivery remains real and never exposes these test-only endpoints.

## Run your own sandbox

```sh
npm ci
APP_MODE=demo AGENT_SANDBOX=true ALLOW_COMPAT_AGENT_SESSIONS=false \
  DATA_DIR=.data-agent-sandbox PUBLIC_URL=https://your-sandbox.example \
  AGENT_CLIENT_IDS=https://your-agent.example/poppy/client.json \
  HOST=0.0.0.0 npm start
```

Use a separate service, volume and origin. Do **not** install Stripe or Prodigi credentials: startup rejects them in Agent Sandbox. Resend is optional. `APP_MODE=demo` supplies simulated providers; `AGENT_SANDBOX=true` exposes native authenticated simulation controls and the sandbox landing page. The older `APP_MODE=sandbox` setting means provider integration tests using Stripe test keys and Prodigi sandbox; it is **not** this no-card Agent Sandbox. Plain `APP_MODE=demo` without the flag is local development and retains local demo helpers.

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

The sandbox exercises actual discovery, client assertions and Session JWTs, image processing, pricing, operation approval, checkout preparation, order state changes, and email rendering. Provider responses are simulated. It does not prove Stripe charging, physical print quality, production tax calculations, carrier delivery, or inbox delivery.

## Real sandbox order emails

Set `SANDBOX_EMAIL_DELIVERY=true`, `RESEND_API_KEY` and `EMAIL_FROM` on the sandbox service to deliver confirmation and simulated-shipment emails through Resend. Any recipient address supplied in the approved order is supported; use the tester's own email. There is no recipient allowlist. Payment and printing remain simulated, and every email has a `[SANDBOX]` subject, clear test wording and a link to the sandbox order page. The same messages remain available as previews. With delivery disabled, messages are captured only. `/api/config` reports `sandboxEmailDelivery`.

OTP sign-in remains captured-only with synthetic accounts. Enabling order email does not expose real OTPs. To run the reference order with inbox delivery, add `SANDBOX_TEST_EMAIL=your@email.example` to the hosted test command. Check Resend events or the recipient inbox separately: API submission alone does not prove delivery.

## DPA acceptance checklist

Use the deployed [DPA](https://poppydemoagent.dev/) with its existing GitHub login. A fresh chat should explicitly request the sandbox and **native Poppy**, without the compatibility instructions. Attach sample poppy artwork and use fictional US recipient details. Complete upload and operation approval through DPA's cards, then simulate payment and shipment. Verify the returned private order link, two captured emails, and `orderingMethod: native-poppy`. Separately test mediated sign-in with a synthetic account and check account history. Do not count a reference-client or local test as a completed DPA UI journey.

For operator reference-client coverage, append `--sandbox-account` to the documented command to exercise captured OTP and order history. Append `--tshirt` to include the custom orange, size M T-shirt in the same order. The script verifies native ordering provenance and two captured emails. It uses sample poppy artwork; it never pays or prints a real order.

## Poppy 0.3

The reference client targets the published draft 0.3 and refuses other advertised versions. Client assertions use the issuer as their audience and are signed directly by the `jwks_uri` key; Session JWTs are signed by per-User delegated keys carrying their `pap_dlg` delegation and name each request's method and URL. See [POPPY-0.3.md](POPPY-0.3.md). Keep `ALLOW_COMPAT_AGENT_SESSIONS=false` for native verification. Follow [the upgrade checklist](POPPY-0.2.md) before deploying the change to production; a successful local reference run is not a hosted PDA browser test.

## Isolated Docker interop grid

The local Node server supports `ALLOW_INTEROP_TEST_HOSTS=true` for PDA's offline grid. It is off by default and is **not supported on Cloudflare or the public sandbox**. Run the container on an internal Docker network with no internet access and no real credentials:

```sh
APP_MODE=demo
PUBLIC_URL=https://pwp.company.interop.test
PORT=8080
AGENT_SANDBOX=true
ALLOW_COMPAT_AGENT_SESSIONS=false
ALLOW_INTEROP_TEST_HOSTS=true
AGENT_CLIENT_IDS=https://pda.agent.interop.test/poppy/client.json
NODE_EXTRA_CA_CERTS=/interop/ca.pem
```

Set `AGENT_CLIENT_IDS` to the exact identities supplied by the grid adapter. The exception permits RFC1918 IPv4 and IPv6 unique-local destinations only when the metadata/JWKS hostname ends in `.interop.test`. IPs may change between runs. Loopback, link-local (including cloud metadata), literal private-IP URLs, other `.test` names, and redirects remain blocked. HTTPS certificate verification, same-origin JWKS, client registration, signed assertions, DPoP, and operation approval are unchanged. Mount the grid's per-run CA before starting Node; never disable TLS verification.

Startup rejects this flag for non-demo modes, non-HTTPS or non-grid origins, Cloudflare deployments, real provider credentials, or sandbox email delivery. Keep the Docker network isolated: the flag itself does not create network isolation. Synthetic account sign-in and the existing sandbox code-reading endpoint can be used in this configuration. Do not configure this flag on `sandbox.printwithpoppy.com` or production.
