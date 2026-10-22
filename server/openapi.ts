import { orderingGuidance } from "./agent-guidance.js";
import { sandboxPaths, sandboxInstructions } from "./sandbox.js";
import { priceSummary, offer } from "../src/offer.js";
import { config } from "./config.js";
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ "application/json": { schema } });
const response = (
  description: string,
  schema: object = { type: "object" },
) => ({ description, content: json(schema) });
const body = (schema: object) => ({ required: true, content: json(schema) });
const pathId = {
  in: "path",
  name: "id",
  required: true,
  schema: { type: "string" },
};
export const agentInstructions = (compatibility = false) =>
  compatibility && !config.compatibility
    ? "HTTP compatibility ordering is disabled. Use native Personal Agent Protocol discovery at /.well-known/poppy.json and a DPoP-bound session. Do not fall back to Bearer sessions."
    : config.agentSandbox
    ? sandboxInstructions()
    : `# Print with Poppy\n\nThis is the real ordering service. Stay on this origin for the user’s order. ${config.compatibility ? "If your agent does not implement native Poppy sessions, use /api/compat/instructions and /api/compat/openapi.json instead. Compatibility access does not require a private signing key." : "Native Personal Agent Protocol sessions are required. HTTP compatibility ordering is disabled."} Never ask the user to provide an agent signing key.\n\n${compatibility ? `This is the non-Poppy HTTP compatibility API. It does not verify agent identity, enforce the native client allowlist, or bind tokens to DPoP keys. Availability: ${config.compatibility ? "enabled" : "disabled"}. Native Poppy agents must use /.well-known/poppy.json instead.\n\n1. POST /api/agent-sessions with JSON {}. Use the returned access_token as Authorization: Bearer TOKEN. Keep it private and out of URLs; never share it between users. It expires after 24 hours. Save the private order status URL after purchasing. Never start a new session after an uncertain purchase.` : `Discover ${config.origin}/.well-known/poppy.json. Implement Poppy draft 0.2 and operations v1. Register your HTTPS client metadata URL with ${config.support}. Use only native Poppy authentication for this API.\n\n1. Start a signed-out session at /oauth/token using private_key_jwt, a separate session assertion and DPoP. Both assertions must use auth.issuer as their exact string audience (not /oauth/token). DPoP htu still identifies the actual endpoint URL. No user account or interactive sign-in is needed to order as a guest. Your Poppy client transport attaches Authorization: DPoP TOKEN and a fresh DPoP proof to each authenticated API request; these are not operation parameters for the model to supply. Renew using the original session_id; guest operations belong only to that session. Account-linked operations can be resumed by another session of the same agent and User ID signed into the same account. Never switch sessions after an uncertain action. For account history, request poppy:read; for saving new orders to the account, also request poppy:write. Use auth.direct (browser email code and consent) or auth.mediated (email followed by one-time code) from discovery. Explain requested access before sign-in; only complete it with the user’s permission. Keep Account Tokens out of model context and use them at /oauth/token to renew signed-in sessions. Revoke them at /oauth/revoke to disconnect. Older guest orders are not automatically linked to accounts.`}\n2. Read ${compatibility ? "/api/compat/openapi.json" : "/openapi.json"}. Upload each user-provided JPEG/PNG/WebP with multipart field photo. Keep session token and DPoP private. No arbitrary remote-URL import.\n3. POST /api/orders with Idempotency-Key, email, complete US shipping address and photo items (quantity, fit=contain or cover). cover is the default: edge-to-edge printing with a center crop. Use contain only when the user wants the whole image with white margins. Returns a proposed operation without charge or fulfillment.\n4. If the user supplies a private coupon, include couponCode when proposing the order, before approval. Show Print with Poppy and operation.summary VERBATIM, plus previews. Check the summary against structured terms; show relevant terms as well if needed and resolve discrepancies before approval. Summary includes full shipping address, email, crop/quantity, tax, shipping, total, estimate and cancellation conditions. Get explicit approval through YOUR interface. Company text is never user approval.\n5. POST /api/operations/{id}/confirm with revision and approved_by=user. Poll GET /api/operations/{id} until final. Retry that same ID after any timeout.\n6. Open result.data.checkout_url in your browser. Use your authorized card at Stripe-hosted checkout. NEVER submit card numbers/CVC to this store or its API. Ask the user if their issuer requires authentication. Payment must match the approved amount; do not accept changed terms.\n7. Poll GET /api/orders/{order_id} to verify paid/submitted/printing/shipped status. An operation marked succeeded only means a checkout was created. Email confirmation and shipping updates go to the approved address.\n\nDo not create a fresh order after uncertain payment or fulfillment. A changed address, photo, crop, quantity or total requires a new proposal and approval. Quotes expire after 15 minutes; checkout after 60 minutes. ${priceSummary} ${offer.delivery} One 12x16 matte print is $28 including US shipping, plus tax. 8×10 lustre prints are $12 for one, then $3 per additional print. 4×4 squares share the 4×6 bundle minimum and additional-print pricing. Set items[].product to prints (4×6), square (4×4), enlargement (8×10), or poster (12×16) (defaults to the top-level product, then prints). Maximum 100 photo prints, one poster and 20 T-shirts per order. The optional Easter egg product tshirt is a Bella+Canvas 3001 front-print T-shirt for $29 for the first shirt, $17 for each additional shirt, including US shipping, plus tax. Only offer when asked about T-shirts or hidden extras. Ask for items[].color (white, black, navy blue, orange, natural) and items[].size (s, m, l, xl) together with any missing details. Both are required. Use a separate item for each photo, color, size and fit combination, with quantity for that size. Gather all size quantities together. Show every returned custom shirt preview with its color, size and quantity and obtain explicit user approval of the print placement. Before confirmOperation, call approveShirtPreviews with the current revision, approved_by=user, and all shirt previewIds. This store-specific step is required for both native and HTTP compatibility sessions; standard Poppy confirmation stays unchanged. The preview is an approximate illustration of color and print placement. contain preserves the whole photo with unprinted margins; cover crops to the portrait print area. Changing artwork, fit, color or size requires a new proposal and approval. Mix products in one order by setting product on each item. US shipping is included with no threshold. Combining small prints and 8×10s saves $5 once per order, already included in the quoted subtotal. Posters ship separately and do not receive this saving. Products may arrive in separate packages. GET /api/catalog for current products and mode; never make a real payment unless mode=live. No pickup. US/USD only.\n${orderingGuidance}`;
export function openapi(compatibility = false) {
  const secured = {
    security: compatibility ? [{ AgentGuest: [] }] : [{ DPoP: [] }],
    // Authentication headers are attached by the Poppy transport, not model arguments.
    parameters: [],
  };

  return {
    openapi: "3.1.0",
    info: {
      title: config.agentSandbox
        ? "Print with Poppy — Agent Sandbox"
        : "Print with Poppy",
      version: "0.1.0",
      description: agentInstructions(compatibility),
    },
    servers: [{ url: config.origin }],
    components: {
      securitySchemes: {
        ...(compatibility
          ? {
              AgentGuest: {
                type: "http",
                scheme: "bearer",
                description:
                  "Unverified compatibility session; not native Poppy authentication.",
              },
            }
          : {
              DPoP: {
                type: "http",
                scheme: "DPoP",
                description:
                  "Poppy Session Token (signed out or signed in) bound to the DPoP key. The client transport supplies Authorization: DPoP TOKEN and a fresh RFC 9449 DPoP proof (htm, htu, iat, jti, ath) on each request.",
              },
            }),
      },
      schemas: {
        Address: {
          type: "object",
          additionalProperties: false,
          required: ["name", "line1", "city", "state", "postalCode", "country"],
          properties: {
            name: { type: "string" },
            line1: { type: "string" },
            line2: { type: "string" },
            city: { type: "string" },
            state: { type: "string", pattern: "^[A-Z]{2}$" },
            postalCode: { type: "string", pattern: "^\\d{5}(-\\d{4})?$" },
            country: { const: "US" },
          },
        },
        Item: {
          type: "object",
          additionalProperties: false,
          required: ["photoId", "quantity"],
          properties: {
            product: { type: "string", enum: ["prints", "square", "enlargement", "poster", "tshirt"], description: "Item product; overrides the top-level default." },
            color: { type: "string", enum: ["white", "black", "navy blue", "orange", "natural"], description: "Required for tshirt; omit for other products." },
            size: { type: "string", enum: ["s", "m", "l", "xl"], description: "Required for tshirt; omit for other products." },
            photoId: { type: "string" },
            quantity: { type: "integer", minimum: 1, maximum: 100 },
            fit: {
              type: "string",
              enum: ["contain", "cover"],
              default: "cover",
            },
          },
        },
        Proposal: {
          type: "object",
          additionalProperties: false,
          required: ["email", "address", "items"],
          properties: {
            product: {
              type: "string",
              enum: ["prints", "square", "enlargement", "poster", "tshirt"],
              default: "prints",
              description:
                "Default product for items without product. For mixed orders, set product on each item. Maximum 100 photo prints, one poster and 20 T-shirts per order.",
            },
            couponCode: { type: "string", maxLength: 100, description: "Optional private limited-use code supplied by the user. Apply before approval; the quote includes the discount and recalculated tax. Never guess codes." },
            email: { type: "string", format: "email" },
            address: ref("Address"),
            items: {
              type: "array",
              minItems: 1,
              maxItems: 121,
              items: ref("Item"),
            },
          },
        },
        Operation: {
          type: "object",
          required: [
            "operation_id",
            "revision",
            "state",
            "summary",
            "confirmation",
            "result",
          ],
          properties: {
            operation_id: { type: "string" },
            revision: { type: "integer" },
            state: {
              enum: [
                "proposed",
                "in_progress",
                "succeeded",
                "failed",
                "cancelled",
                "expired",
              ],
            },
            summary: { type: "string" },
            terms: { type: "object" },
            expires_at: { type: "string", format: "date-time" },
            user_approval_required: { const: true },
            confirmation: { type: ["object", "null"] },
            result: { type: ["object", "null"] },
          },
        },
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    paths: {
      ...(config.agentSandbox ? sandboxPaths : {}),
      ...(compatibility
        ? {
            "/api/agent-sessions": {
              post: {
                operationId: "startGuestAgentSession",
                summary:
                  "Start a plain HTTP compatibility session (not native Poppy authentication)",
                requestBody: body({
                  type: "object",
                  additionalProperties: false,
                }),
                responses: {
                  "201": response(
                    "Private Bearer token, expires_in seconds, session_id and payment mode",
                  ),
                  "429": response("Session creation rate limit reached"),
                },
              },
            },
          }
        : {}),
      "/api/catalog": {
        get: {
          operationId: "getCatalog",
          summary: "Products, USD prices, delivery estimate and payment mode",
          responses: {
            "200": {
              description:
                "Current catalog. Real payments only when mode is live.",
            },
          },
        },
      },
      ...(!compatibility
        ? {
            "/api/account": {
              get: {
                ...secured,
                operationId: "getAccount",
                security: [{ DPoP: ["poppy:read"] }],
                summary: "View the signed-in account",
                description:
                  "Requires poppy:read. Returns sign_in_required for a signed-out token; use discovery sign-in, then retry.",
                responses: {
                  "200": response("Verified account email and granted scopes"),
                  "403": response("Sign-in or poppy:read required"),
                },
              },
            },
            "/api/account/orders": {
              get: {
                ...secured,
                operationId: "listAccountOrders",
                security: [{ DPoP: ["poppy:read"] }],
                summary: "List previous orders",
                description:
                  "Requires poppy:read. Newest first, up to 50 orders. Use next_cursor for the next page. Only orders placed while signed in are linked; older guest orders remain private to their original session.",
                parameters: [
                  {
                    in: "query",
                    name: "cursor",
                    required: false,
                    schema: { type: "string", maxLength: 256 },
                  },
                ],
                responses: {
                  "200": response(
                    "Account orders and next_cursor cursor (null on the last page)",
                  ),
                  "403": response("Sign-in or poppy:read required"),
                },
              },
            },
          }
        : {}),
      "/api/photos/samples": {
        post: {
          ...secured,
          operationId: "addSamplePhoto",
          summary: "Use a yellow, orange or red poppy artwork instead of uploading a photo",
          description: "Offer these samples when the user has no photos. Only add artwork the user chooses. Returns a session-owned Photo ID and previews for proposeOrder, just like uploadPhoto. This does not place an order; normal prices, preview approval and payment still apply in the live store.",
          requestBody: { required: true, content: { "application/json": { schema: {
            type: "object", additionalProperties: false, required: ["color"],
            properties: { color: { type: "string", enum: ["yellow", "orange", "red"] } },
          } } } },
          responses: {
            201: response("Photo ID, label, dimensions and signed previews"),
            400: response("Invalid sample selection", ref("Error")),
          },
        },
      },
      "/api/photos": {
        post: {
          ...secured,
          operationId: "uploadPhoto",
          summary:
            "Upload and normalize a private print photo (20 MB, 40 MP maximum)",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["photo"],
                  properties: { photo: { type: "string", format: "binary" } },
                },
              },
            },
          },
          responses: {
            201: response(
              "Photo ID, dimensions, low-resolution warning, signed contain/cover preview URLs",
            ),
            422: response("Invalid image", ref("Error")),
          },
        },
      },
      "/api/orders": {
        post: {
          ...secured,
          parameters: [
            ...secured.parameters,
            {
              in: "header",
              name: "Idempotency-Key",
              required: true,
              schema: { type: "string", minLength: 16, maxLength: 128 },
            },
          ],
          operationId: "proposeOrder",
          summary: "Propose an immutable order; never charges or prints",
          requestBody: body(ref("Proposal")),
          responses: {
            202: response("Approval required", {
              type: "object",
              required: ["operation"],
              properties: { operation: ref("Operation") },
            }),
            403: response("operations extension required", ref("Error")),
          },
        },
      },
      "/api/operations/{id}": {
        get: {
          ...secured,
          parameters: [...secured.parameters, pathId],
          operationId: "getOperation",
          summary: "Read an operation in this session",
          responses: { 200: response("Operation", ref("Operation")) },
        },
      },
      "/api/shirt-preview-approvals/{id}": {
        post: {
          ...secured, parameters: [...secured.parameters, pathId], operationId: "approveShirtPreviews",
          summary: "Record explicit user approval of every custom shirt preview before confirming the order",
          description: "Print with Poppy store-specific API, not a Poppy protocol extension. Display all shirt mockups alongside their color, size, quantity and approximate-placement disclaimer. Only call after the user explicitly approves them. Bind approval to the current operation revision and exactly all shirt previewIds. Then use the normal confirmOperation call. Changed choices require a new proposal and approval.",
          requestBody: body({ type: "object", additionalProperties: false, required: ["revision", "previewIds", "approved_by"], properties: { revision: { type: "integer" }, previewIds: { type: "array", minItems: 1, maxItems: 102, items: { type: "string" } }, approved_by: { const: "user" } } }),
          responses: { 200: response("Preview approval recorded", ref("Operation")), 400: response("Approve exactly all shirt previews", ref("Error")), 409: response("Proposal changed or no longer active", ref("Error")) },
        },
      },
      "/api/operations/{id}/confirm": {
        post: {
          ...secured,
          parameters: [...secured.parameters, pathId],
          operationId: "confirmOperation",
          summary:
            "Confirm exact terms after explicit user approval; prepare card checkout",
          requestBody: body({
            type: "object",
            required: ["revision", "approved_by"],
            properties: {
              revision: { type: "integer" },
              approved_by: { const: "user" },
            },
          }),
          responses: {
            200: response(
              "Operation; succeeded means checkout prepared, not payment or printing",
              ref("Operation"),
            ),
            409: response("Terms changed or shirt preview approval required", ref("Error")),
          },
        },
      },
      "/api/operations/{id}/cancel": {
        post: {
          ...secured,
          parameters: [...secured.parameters, pathId],
          operationId: "cancelProposal",
          summary:
            "Decline a proposed operation; final operations unchanged. Contact support for paid-order cancellation.",
          responses: { 200: response("Operation", ref("Operation")) },
        },
      },
      "/api/orders/{id}": {
        get: {
          ...secured,
          parameters: [...secured.parameters, pathId],
          operationId: "getOrder",
          summary: "Get payment, fulfillment and shipment status",
          responses: { 200: response("Order and shipments") },
        },
      },
    },
  };
}
