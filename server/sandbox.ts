import { environment } from "./environment.js";
import { orderingGuidance } from "./agent-guidance.js";
import type { Express, Request } from "express";
import { config } from "./config.js";
import { authenticate } from "./auth.js";
import { requireAccount, syntheticEmail } from "./accounts.js";
import { deviceSignInEmail } from "./device.js";
import { all, get, requireRecord, HttpError } from "./store.js";
import { paid, orderView } from "./commerce.js";
import { tick, syncProvider } from "./worker.js";
import type { Order } from "./types.js";

export const sandboxDescription =
  "AGENT SANDBOX: real Poppy sessions and approval flow; simulated payments, fulfillment and shipping. No card or physical prints. Order emails may be delivered to the order email address; all other emails are captured only. Use fictional shipping details, sample images and your own email address. This is separate from the /demo visual walkthrough.";
export const sandboxInstructions = () => `# Print with Poppy — Agent Sandbox

${sandboxDescription}

Origin: ${config.origin}. Test guide: ${config.origin}/sandbox. Read /api/config and require environment=agent-sandbox before simulating anything.
1. Register your HTTPS client metadata URL with hello@printwithpoppy.com (DPA is already registered). Discover /.well-known/poppy.json (protocol 0.3) and /openapi.json on this origin. Send a Poppy-Session header on every request (a Session JWT signed by a delegated key, pap_dlg; a new sid starts a signed-out Session). Keep the same sid for the whole order; do not use compatibility sessions. Client assertions at the token, device and revocation endpoints are signed directly by your jwks_uri key. List operations version 2 in your client metadata.
2. Read getCatalog. Offer the bundled yellow, orange and red poppies through addSamplePhoto, or upload the user’s JPEG/PNG/WebP images with uploadPhotos (1–10 named file fields photo1 through photo10, 20 MB combined, one approval for the selected batch); use uploadPhoto (multipart field photo) for a single image. Use only synthetic recipient details and US addresses for test quotes.
${orderingGuidance}
3. Call proposeOrder with a JSON object: email, address, items and optional product. It answers 403 approval_required with the operation; show its summary and obtain explicit approval through your interface. For T-shirts, use separate items for each photo/color/size/fit combination, with quantity for each size (20 shirts maximum). The first shirt is $29 and each additional shirt $17 including US shipping, plus tax. Show every shirt mockup alongside color, size and quantity; explain placement is approximate. Obtain explicit user approval of the previews, then call approveShirtPreviews with the revision, approved_by=user and exactly all shirt previewIds before approving. Approve through the Operations extension: send the same proposeOrder request again with Poppy-Approval (operation_id and revision); it returns the order (201). This means checkout is being prepared, not paid.
4. Call simulatePayment with the order id. No card details, Stripe visit or real payment. Poll getOrder until printing.
5. Call simulateShipment with the same order ID, then poll getOrder and getSandboxEmails until shipped and two captured emails are available. Carrier and tracking are simulated. Order emails reach only the order email address when delivery is enabled; otherwise they are captured only. Payment/shipment simulation is safe to repeat on the same order.
6. Optional account flow: prefer Device Sign-In (the device_code grant in the issuer metadata): start it at /oauth/device, show the person the verification link and code, and poll /oauth/token with the device_code grant. The Mediated Sign-In extension grant (orders:read and orders:write only) also works with a unique synthetic @example.com, @example.org or @example.net email: its code_required answer carries sign_in_id; getSandboxSignInEmail returns the captured code for sign-ins your agent started. Send the access token with the Session header, place a new order while signed in, then read listAccountOrders; revoke the refresh token to sign out. This simulates email ownership, not real identity verification. The verification page shows the captured code to the person for synthetic accounts; an automated test can read it with getSandboxDeviceSignInEmail. Then use saved addresses (addresses scope: saveAccountAddress, or omit address on proposeOrder to use the default) and reorderOrder, which answers approval_required with a new operation that still needs approval. Direct Sign-In isn't offered in the sandbox.
The /demo route is a scripted visual walkthrough, not this API test environment. Production at https://printwithpoppy.com is live. Never send sandbox tokens or test calls there. Test data may be reset.
`;
const security = [{ PoppySession: [] }, { PoppySession: [], PoppyAccount: [] }];
const parameter = [
  { in: "path", name: "id", required: true, schema: { type: "string" } },
];
const result = {
  description: "Sandbox result",
  content: {
    "application/json": {
      schema: { type: "object", additionalProperties: true },
    },
  },
};
const action = (operationId: string, summary: string) => ({
  security,
  parameters: parameter,
  operationId,
  summary,
  responses: {
    200: result,
    404: { description: "Not owned by this session" },
    409: { description: "Order not ready" },
  },
});
export const sandboxPaths = {
  "/api/sandbox/orders/{id}/pay": {
    post: action(
      "simulatePayment",
      "Sandbox only: simulate payment for an approved order with prepared checkout. No card or charge. Safe to repeat on the same order.",
    ),
  },
  "/api/sandbox/orders/{id}/ship": {
    post: action(
      "simulateShipment",
      "Sandbox only: simulate shipment of a paid, submitted order. No physical shipment. Safe to repeat on the same order.",
    ),
  },
  "/api/sandbox/orders/{id}/emails": {
    get: action(
      "getSandboxEmails",
      "Read captured confirmation and shipment emails for your sandbox order. Delivery is captured-only or submitted to Resend for the order email address; submission does not prove inbox delivery.",
    ),
  },
};
/** Demo and Agent Sandbox only: read captured sign-in codes for synthetic accounts. */
export const signInHelperPaths = {
  "/api/sandbox/sign-in/{id}/email": {
    get: action(
      "getSandboxSignInEmail",
      "Demo/Agent Sandbox only: read the captured one-time-code email for a Mediated Sign-In (the sign_in_id from code_required) started by this Personal Agent. Synthetic @example.com/.org/.net accounts only; this does not verify ownership of a real email address. No email is sent.",
    ),
  },
  "/api/sandbox/device-sign-in/email": {
    post: {
      security,
      operationId: "getSandboxDeviceSignInEmail",
      summary:
        "Demo/Agent Sandbox only: read the captured OTP email for a pending Device Sign-In after the person entered a synthetic email on the verification page. Send the device_code from /oauth/device; only the Personal Agent that started the sign-in can read it. No email is sent. Real stores email the code to the person.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["device_code"],
              properties: { device_code: { type: "string" } },
            },
          },
        },
      },
      responses: {
        200: result,
        404: { description: "No active code for a synthetic account" },
      },
    },
  },
};

function signInHelperRoutes(app: Express) {
  app.get("/api/sandbox/sign-in/:id/email", async (req, res) => {
    const session = await authenticate(req);
    const challenge = get("signin-code", String(req.params.id));
    if (
      !challenge ||
      // Mediated sign-ins belong to the client that started them (extension §4).
      challenge.owner !== `mediated:${session.clientId}` ||
      challenge.used ||
      challenge.expires <= Date.now() ||
      !syntheticEmail(challenge.email)
    )
      throw new HttpError(
        404,
        "not_found",
        "Active Mediated Sign-In for a synthetic account not found for this Personal Agent.",
      );
    const email = get("demo-signin-email", challenge.id);
    res.json({ simulated: true, delivered: false, email });
  });
  app.post("/api/sandbox/device-sign-in/email", async (req, res) => {
    res.json(await deviceSignInEmail(req));
  });
}

export function sandboxRoutes(app: Express) {
  // Demo stores never send email; these read captured codes for synthetic accounts.
  if (config.demo) signInHelperRoutes(app);
  if (!config.agentSandbox) return;
  app.use("/api/sandbox", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  async function owned(req: Request, write = false) {
    const session = await authenticate(req);
    const order = requireRecord<Order>("order", String(req.params.id));
    // Account orders belong to the account; guest orders to their Session.
    if (order.accountId) {
      if (requireAccount(session, write ? "orders:write" : "orders:read") !== order.accountId)
        throw new HttpError(404, "not_found", "Order not found.");
    } else if (order.owner !== session.id)
      throw new HttpError(404, "not_found", "Order not found in this session.");
    return order;
  }
  app.post("/api/sandbox/orders/:id/pay", async (req, res) => {
    const order = await owned(req, true);
    if (
      !order.checkoutId ||
      !order.checkoutExpires ||
      (!order.paidAt && order.checkoutExpires * 1000 < Date.now()) ||
      order.status === "cancelled"
    )
      throw new HttpError(
        409,
        "checkout_not_ready",
        "Approve the proposal and wait for a current checkout before simulating payment.",
      );
    paid(order.id, {
      id: order.checkoutId,
      amount: order.quote.total,
      currency: "usd",
      paid: true,
    });
    await tick();
    res.json({
      simulated: true,
      order: orderView(requireRecord<Order>("order", order.id)),
    });
  });
  app.post("/api/sandbox/orders/:id/ship", async (req, res) => {
    const order = await owned(req, true);
    if (!order.paidAt || !order.prodigiId || order.status === "cancelled")
      throw new HttpError(
        409,
        "not_ready",
        "Simulate payment and wait until the order is submitted or printing first.",
      );
    if (order.status !== "shipped")
      syncProvider(order.id, {
        id: order.prodigiId,
        status: { stage: "Complete" },
        shipments: [
          {
            id: "sandbox_shipment",
            status: "Shipped",
            dispatchDate: new Date().toISOString(),
            carrier: { name: "Simulated carrier" },
            tracking: { number: "SANDBOX-NOT-A-REAL-TRACKING-NUMBER" },
          },
        ],
      });
    await tick();
    res.json({
      simulated: true,
      order: orderView(requireRecord<Order>("order", order.id)),
    });
  });
  app.get("/api/sandbox/orders/:id/emails", async (req, res) => {
    const order = await owned(req);
    res.json({
      simulated: true,
      emails: all<any>("email", order.id).map(({ subject, html, text, delivery, providerId }) => ({
        delivery: delivery || "captured",
        providerId,
        subject,
        html,
        text,
      })),
    });
  });
  const publicKey = environment().SANDBOX_REFERENCE_PUBLIC_JWK;
  if (publicKey) {
    const key = JSON.parse(publicKey);
    if (key.d || key.k)
      throw new Error("Sandbox reference key must be public only.");
    app.get("/api/sandbox/reference-agent.json", (_req, res) =>
      res.json({
        client_id: `${config.origin}/api/sandbox/reference-agent.json`,
        jwks_uri: `${config.origin}/api/sandbox/reference-jwks.json`,
        token_endpoint_auth_method: "private_key_jwt",
        extensions: { operations: { version: "2" } },
      }),
    );
    app.get("/api/sandbox/reference-jwks.json", (_req, res) =>
      res.json({ keys: [key] }),
    );
  }
  app.get("/sandbox", (_req, res) =>
    res
      .type("html")
      .send(
        `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Print with Poppy — Agent Sandbox</title><style>body{font:18px/1.6 system-ui;background:#faf6ee;color:#30291f;max-width:780px;margin:64px auto;padding:0 24px}a{color:#b84008}code{font-size:.9em}li{margin:12px 0}</style><h1>Print with Poppy · Agent Sandbox</h1><p>${sandboxDescription}</p><p><a href="/.well-known/poppy.json">poppy.json</a> · <a href="/docs">API reference</a> · <a href="/openapi.json">OpenAPI JSON</a> · <a href="https://github.com/spenciefy/print-with-poppy/blob/main/docs/SANDBOX.md">Testing guide</a></p><ol><li>Register your HTTPS client metadata URL via hello@printwithpoppy.com. DPA is preconfigured.</li><li>Discover this origin and open a signed-out Poppy Session (Poppy-Session header) using your own signing key and delegated keys.</li><li>Upload sample photos, call <code>proposeOrder</code>, show the terms and obtain approval, then send the same request again with Poppy-Approval (Operations v2).</li><li>Wait until checkout is ready. Call <code>simulatePayment</code> with the order ID. No card is needed.</li><li>Poll <code>getOrder</code> until printing, call <code>simulateShipment</code>, then read <code>getSandboxEmails</code>.</li><li>Optional account test: use mediated sign-in and read the code through <code>getSandboxSignInEmail</code>, or device sign-in (<code>/oauth/device</code>; the verification page shows the captured code for synthetic accounts, and <code>getSandboxDeviceSignInEmail</code> returns it to a test agent). Complete sign-in, refresh the access token, read order history, save an address and reorder. This only simulates email verification.</li></ol><p>Keep the same sid throughout. Test records may be reset. The <a href="/demo">visual walkthrough</a> does not call these APIs. The <a href="https://printwithpoppy.com">production store</a> makes real purchases.</p></html>`,
      ),
  );
}
