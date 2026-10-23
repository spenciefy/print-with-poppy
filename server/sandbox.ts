import { environment } from "./environment.js";
import { orderingGuidance } from "./agent-guidance.js";
import type { Express, Request } from "express";
import { config } from "./config.js";
import { authenticate } from "./auth.js";
import { requireAccount } from "./accounts.js";
import { all, get, requireRecord, HttpError } from "./store.js";
import { paid, orderView } from "./commerce.js";
import { tick, syncProvider } from "./worker.js";
import type { Order } from "./types.js";

export const sandboxDescription =
  "AGENT SANDBOX: real Poppy sessions and approval flow; simulated payments, fulfillment and shipping. No card or physical prints. Order emails may be delivered to the order email address; all other emails are captured only. Use fictional shipping details, sample images and your own email address. This is separate from the /demo visual walkthrough.";
export const sandboxInstructions = () => `# Print with Poppy — Agent Sandbox

${sandboxDescription}

Origin: ${config.origin}. Test guide: ${config.origin}/sandbox. Read /api/config and require environment=agent-sandbox before simulating anything.
1. Register your HTTPS client metadata URL with hello@printwithpoppy.com (DPA is already registered). Discover /.well-known/poppy.json and /openapi.json on this origin. Start a native signed-out Poppy session with client/session assertions and DPoP. Keep the same session for the whole order; do not use compatibility sessions.
2. Read getCatalog. Offer the bundled yellow, orange and red poppies through addSamplePhoto, or upload the user’s JPEG/PNG/WebP images with uploadPhotos (1–10 named file fields photo1 through photo10, 20 MB combined, one approval for the selected batch); use uploadPhoto (multipart field photo) for a single image. Use only synthetic recipient details and US addresses for test quotes.
${orderingGuidance}
3. Call proposeOrder with a JSON object, an Idempotency-Key, email, address, items and optional product. Show the returned summary and obtain explicit approval through your interface. For T-shirts, use separate items for each photo/color/size/fit combination, with quantity for each size (20 shirts maximum). The first shirt is $29 and each additional shirt $17 including US shipping, plus tax. Show every shirt mockup alongside color, size and quantity; explain placement is approximate. Obtain explicit user approval of the previews, then call approveShirtPreviews with revision, approved_by=user and exactly all shirt previewIds before confirmation. Confirm the operation through the Operations extension with the approved revision; poll until succeeded. This means checkout is prepared, not paid.
4. Call simulatePayment with result.data.order_id. No card details, Stripe visit or real payment. Poll getOrder until printing.
5. Call simulateShipment with the same order ID, then poll getOrder and getSandboxEmails until shipped and two captured emails are available. Carrier and tracking are simulated. Order emails reach only the order email address when delivery is enabled; otherwise they are captured only. Payment/shipment simulation is safe to repeat on the same order.
6. Optional account flow: use mediated sign-in with a unique synthetic @example.com, @example.org or @example.net email and requested scopes. Use getSandboxSignInEmail with the returned challenge id to retrieve your session's captured code, complete the challenge, and exchange the account token for a signed-in session token. Place a new order while signed in, then read listAccountOrders. This simulates email ownership, not real identity verification. Browser direct sign-in is not advertised in the sandbox.
The /demo route is a scripted visual walkthrough, not this API test environment. Production at https://printwithpoppy.com is live. Never send sandbox tokens or test calls there. Test data may be reset.
`;
const security = [{ DPoP: [] }];
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
  "/api/sandbox/sign-in/{id}/email": {
    get: action(
      "getSandboxSignInEmail",
      "Read the captured sandbox OTP email for a mediated sign-in challenge created by this exact session. Use only synthetic test accounts; this does not verify ownership of a real email address.",
    ),
  },
};

export function sandboxRoutes(app: Express) {
  if (!config.agentSandbox) return;
  app.use("/api/sandbox", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  async function owned(req: Request, write = false) {
    const session = await authenticate(req);
    const order = requireRecord<Order>("order", String(req.params.id));
    if (order.owner !== session.id)
      throw new HttpError(404, "not_found", "Order not found in this session.");
    if (
      order.accountId &&
      requireAccount(session, write ? "poppy:write" : "poppy:read") !==
        order.accountId
    )
      throw new HttpError(404, "not_found", "Order not found.");
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
  app.get("/api/sandbox/sign-in/:id/email", async (req, res) => {
    const session = await authenticate(req);
    const challenge = get("signin-code", String(req.params.id));
    if (
      !challenge ||
      challenge.owner !== session.id ||
      challenge.used ||
      challenge.expires <= Date.now()
    )
      throw new HttpError(
        404,
        "not_found",
        "Active sign-in challenge not found in this session.",
      );
    const email = get("demo-signin-email", challenge.id);
    res.json({ simulated: true, delivered: false, email });
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
        extensions: { operations: { version: "1" } },
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
        `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Print with Poppy — Agent Sandbox</title><style>body{font:18px/1.6 system-ui;background:#faf6ee;color:#30291f;max-width:780px;margin:64px auto;padding:0 24px}a{color:#b84008}code{font-size:.9em}li{margin:12px 0}</style><h1>Print with Poppy · Agent Sandbox</h1><p>${sandboxDescription}</p><p><a href="/.well-known/poppy.json">poppy.json</a> · <a href="/docs">API reference</a> · <a href="/openapi.json">OpenAPI JSON</a> · <a href="https://github.com/spenciefy/print-with-poppy/blob/main/docs/SANDBOX.md">Testing guide</a></p><ol><li>Register your HTTPS client metadata URL via hello@printwithpoppy.com. DPA is preconfigured.</li><li>Discover this origin and open a signed-out Poppy session using your own signing key and DPoP.</li><li>Upload sample photos, call <code>proposeOrder</code>, show the terms and obtain approval, then confirm through the Operations extension.</li><li>Wait until checkout is ready. Call <code>simulatePayment</code> with the order ID. No card is needed.</li><li>Poll <code>getOrder</code> until printing, call <code>simulateShipment</code>, then read <code>getSandboxEmails</code>.</li><li>Optional account test: use mediated sign-in, read the code through <code>getSandboxSignInEmail</code>, complete sign-in, renew the session token, and read order history. This only simulates email verification.</li></ol><p>Keep the same session throughout. Test records may be reset. The <a href="/demo">visual walkthrough</a> does not call these APIs. The <a href="https://printwithpoppy.com">production store</a> makes real purchases.</p></html>`,
      ),
  );
}
