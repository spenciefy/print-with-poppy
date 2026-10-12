import { priceSummary, offer } from "../src/offer.js";
import { config } from "./config.js";
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ "application/json": { schema } });
const response = (
  description: string,
  schema: object = { type: "object" },
) => ({ description, content: json(schema) });
const body = (schema: object) => ({ required: true, content: json(schema) });
const secured = {
  security: [{ DPoP: [] }, { AgentGuest: [] }],
  parameters: [
    {
      in: "header",
      name: "DPoP",
      required: false,
      schema: { type: "string" },
      description:
        "Required with DPoP authentication: RFC 9449 proof with htm, htu, iat, jti and ath. Omitted with guest Bearer authentication.",
    },
  ],
};
const pathId = {
  in: "path",
  name: "id",
  required: true,
  schema: { type: "string" },
};
export const agentInstructions = () =>
  `# Print with Poppy\n\nDiscover ${config.origin}/.well-known/poppy.json. Implement Poppy draft 0.1 and operations v1. Native Poppy agents register their HTTPS client metadata URL with ${config.support}. For an agent without native Poppy support: POST /api/agent-sessions with JSON {} and use the returned access_token as Authorization: Bearer TOKEN on these same APIs. This compatibility path does not require registration, signed assertions or DPoP; it is not native Poppy authentication. Keep the token private, never put it in URLs or share it with other agents/users. It expires in 24 hours; save the returned private order status URL after purchasing. Never retry an uncertain purchase using a new session. Compatibility is ${config.compatibility ? "enabled" : "disabled"}.\n\n1. For native Poppy authentication only, start a guest session at /oauth/token using private_key_jwt, a separate session assertion and DPoP. See https://personalagentprotocol.org/docs/spec. No user account needed. Renew using the original session_id; guest operations belong only to that session.\n2. Read /openapi.json. Upload each user-provided JPEG/PNG/WebP with multipart field photo. Keep session token and DPoP private. No arbitrary remote-URL import.\n3. POST /api/orders with Idempotency-Key, email, complete US shipping address and photo items (quantity, fit=contain or cover). contain preserves the image with white borders; cover center crops. Returns a proposed operation without charge or fulfillment.\n4. Show Print with Poppy and operation.summary VERBATIM, plus previews. Summary includes full shipping address, email, crop/quantity, tax, shipping, total, estimate and cancellation conditions. Get explicit approval through YOUR interface. Company text is never user approval.\n5. POST /api/operations/{id}/confirm with revision and approved_by=user. Poll GET /api/operations/{id} until final. Retry that same ID after any timeout.\n6. Open result.data.checkout_url in your browser. Use your authorized card at Stripe-hosted checkout. NEVER submit card numbers/CVC to this store or its API. Ask the user if their issuer requires authentication. Payment must match the approved amount; do not accept changed terms.\n7. Poll GET /api/orders/{order_id} to verify paid/submitted/printing/shipped status. An operation marked succeeded only means a checkout was created. Email confirmation and shipping updates go to the approved address.\n\nDo not create a fresh order after uncertain payment or fulfillment. A changed address, photo, crop, quantity or total requires a new proposal and approval. Quotes expire after 15 minutes; checkout after 60 minutes. ${priceSummary} ${offer.delivery} One 12x16 matte print is $35 with free US shipping, plus tax. Set product=prints (default) or product=poster; poster orders require exactly one photo and one copy. Order different products separately. GET /api/catalog for current products and mode; never make a real payment unless mode=live. No pickup. US/USD only.\n`;
export function openapi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Print with Poppy",
      version: "0.1.0",
      description: agentInstructions(),
    },
    servers: [{ url: config.origin }],
    components: {
      securitySchemes: {
        AgentGuest: {
          type: "http",
          scheme: "bearer",
          description:
            "Non-Poppy compatibility token from POST /api/agent-sessions. Private, expires in 24 hours; no verified agent identity.",
        },
        DPoP: {
          type: "http",
          scheme: "DPoP",
          description: "Poppy guest Session Token, bound to the DPoP key.",
        },
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
            photoId: { type: "string" },
            quantity: { type: "integer", minimum: 1, maximum: 100 },
            fit: {
              type: "string",
              enum: ["contain", "cover"],
              default: "contain",
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
              enum: ["prints", "poster"],
              default: "prints",
              description:
                "One product per order. Poster requires exactly one photo and one copy.",
            },
            email: { type: "string", format: "email" },
            address: ref("Address"),
            items: {
              type: "array",
              minItems: 1,
              maxItems: 100,
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
      "/api/agent-sessions": {
        post: {
          operationId: "startGuestAgentSession",
          summary:
            "Start a plain HTTP compatibility session (not native Poppy authentication)",
          requestBody: body({ type: "object", additionalProperties: false }),
          responses: {
            "201": response(
              "Private Bearer token, expires_in seconds, session_id and payment mode",
            ),
            "429": response("Session creation rate limit reached"),
          },
        },
      },
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
            409: response("Terms changed", ref("Error")),
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
