import { batchFields } from "./batch-photos.js";
import { orderingGuidance } from "./agent-guidance.js";
import { sandboxPaths, signInHelperPaths, sandboxInstructions } from "./sandbox.js";
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
    ? "HTTP compatibility ordering is disabled. Use native Personal Agent Protocol discovery at /.well-known/poppy.json and a Poppy Session (the Poppy-Session header). Do not fall back to Bearer guest sessions."
    : config.agentSandbox
    ? sandboxInstructions()
    : `# Print with Poppy\n\nThis is the real ordering service. Stay on this origin for the user’s order. ${config.compatibility ? "If your agent does not implement native Poppy sessions, use /api/compat/instructions and /api/compat/openapi.json instead. Compatibility access does not require a private signing key." : "Native Personal Agent Protocol sessions are required. HTTP compatibility ordering is disabled."} Never ask the user to provide an agent signing key.\n\n${compatibility ? `This is the non-Poppy HTTP compatibility API. It does not verify agent identity or enforce the native client allowlist. Availability: ${config.compatibility ? "enabled" : "disabled"}. Native Poppy agents must use /.well-known/poppy.json instead.\n\n1. POST /api/agent-sessions with JSON {}. Use the returned access_token as Authorization: Bearer TOKEN. Keep it private and out of URLs; never share it between users. It expires after 24 hours. Save the private order status URL after purchasing. Never start a new session after an uncertain purchase. Ordering works as in native Poppy Operations v2: POST /api/orders answers 403 approval_required with the operation; after the user approves, send the same request again with the header Poppy-Approval: operation_id="…", revision="…".` : `Discover ${config.origin}/.well-known/poppy.json, /.well-known/oauth-protected-resource and the issuer's metadata. Implement Poppy draft 0.3 (as published) with the operations extension, version 2; list operations {"version": "2"} in your client metadata's extensions or ordering is refused with extension_required. Register your HTTPS client metadata URL with ${config.support}. Use only native Poppy authentication for this API.\n\n1. Every API request carries a Poppy-Session header: a Session JWT (typ poppy-session+jwt, ES256, claims iss = client_id, aud = the issuer, sid, sub = the User ID, optional agent_id, htm, htu, iat, jti, and ath when an access token is sent) signed by a delegated key, with the delegation (pap-delegation+jwt, signed by a key in your jwks_uri, at most 24 hours) in its pap_dlg header and kid = the delegated key's RFC 7638 thumbprint. A new sid starts a new, signed-out Session; keep the same sid for the conversation. Client assertions at /oauth/token, /oauth/device and /oauth/revoke are signed directly by a jwks_uri key (ES256 or PS384) with aud = the issuer. No user account is needed to order as a guest. Your Poppy client transport attaches these headers; they are not operation parameters for the model to supply. Guest operations belong only to their Session. An account's operations can be approved from any Session of the same agent and User ID signed in to that account. Never switch Sessions after an uncertain action.\n\nAccount scopes (scopes_supported, described in auth.scopes with auth.scope_hints): orders:read to see the account and order history, orders:write to save new orders to the account and reorder, addresses for saved shipping addresses. Request only what the task needs. Signed out, an account endpoint answers 401 with WWW-Authenticate: Bearer scope="…" naming what to request; an under-scoped token gets 403 insufficient_scope. Sign-in types: Direct (authorization_code in grant_types_supported: /oauth/authorize with PKCE S256 and state; the redirect carries code, state and iss; exchange the code at /oauth/token), Device (device_code grant: POST /oauth/device, show verification_uri_complete or verification_uri plus user_code with this store's name and domain, then poll /oauth/token every interval seconds; handle authorization_pending, slow_down, access_denied and expired_token), or Mediated (the mediated-sign-in extension grant at /oauth/token, orders scopes only: send scope and email, get code_required with sign_in_id, then send sign_in_id and one_time_code). Prefer Direct or Device. Each returns a Bearer access token (1 hour) and a refresh token; check the granted scope. Explain requested access before sign-in; only complete it with the user’s permission. Keep tokens out of model context. Send the access token with the Session header to act signed in; refresh at /oauth/token (refresh_token grant, optionally a narrower scope). Revoke the refresh token at /oauth/revoke to sign out: its access tokens stop working at once and the Session continues signed out. A Session signed in to one account refuses another account with invalid_session; use a new sid. Older guest orders are not automatically linked to accounts. Signed in with orders:write and addresses, proposeOrder may omit address (the default saved address) or send addressId, and may omit email (the account email); saveAccountAddress stores an address the user asks to keep, and reorderOrder (orders:write) orders a past account order again. Both still need the user's approval of the operation.`}\n2. Read ${compatibility ? "/api/compat/openapi.json" : "/openapi.json"}. For multiple JPEG/PNG/WebP photos, prefer uploadPhotos at POST /api/photos/batch with named file fields photo1 through photo10 (10 photos and 20 MB combined maximum) so the agent can approve the selected files together. Keep successful results and retry only failed photos. For a single photo use uploadPhoto with multipart field photo. Keep tokens and Session JWTs private. No arbitrary remote-URL import.\n3. POST /api/orders with email, complete US shipping address and photo items (quantity, fit=contain or cover). cover is the default: edge-to-edge printing with a center crop. Use contain only when the user wants the whole image with white margins. It answers 403 approval_required with an operation (operation_id, revision, summary, terms, expires_at) and does nothing else; sending the same request again returns the same operation.\n4. If the user supplies a private coupon, include couponCode when proposing the order, before approval. Show Print with Poppy and operation.summary VERBATIM, plus previews. Check the summary against structured terms; show relevant terms as well if needed and resolve discrepancies before approval. Summary includes full shipping address, email, crop/quantity, tax, shipping, total, estimate and cancellation conditions. Get explicit approval through YOUR interface. Company text is never user approval.\n5. After the user approves, send the same POST /api/orders request again with the header Poppy-Approval: operation_id="…", revision="…" (your Poppy transport adds it). It places the order once and returns it (201); a retry with the same approval returns the same order, so retry it after any timeout. If the answer is approval_required with a different revision, the terms changed: show the new summary and ask again.\n6. Poll GET /api/orders/{order_id} until checkoutUrl appears and open it in your browser. Use your authorized card at Stripe-hosted checkout. NEVER submit card numbers/CVC to this store or its API. Ask the user if their issuer requires authentication. Payment must match the approved amount; do not accept changed terms.\n7. Poll GET /api/orders/{order_id} to verify paid/submitted/printing/shipped status. A placed order only means a checkout was created. Email confirmation and shipping updates go to the approved address.\n\nDo not create a fresh order after uncertain payment or fulfillment. A changed address, photo, crop, quantity or total requires a new proposal and approval. Quotes expire after 15 minutes; checkout after 60 minutes. ${priceSummary} ${offer.delivery} One 12x16 matte print is $28 including US shipping, plus tax. 8×10 lustre prints are $12 for one, then $3 per additional print. 4×4 squares share the 4×6 bundle minimum and additional-print pricing. Set items[].product to prints (4×6), square (4×4), enlargement (8×10), or poster (12×16) (defaults to the top-level product, then prints). Maximum 100 photo prints, one poster and 20 T-shirts per order. The optional Easter egg product tshirt is a Bella+Canvas 3001 front-print T-shirt for $29 for the first shirt, $17 for each additional shirt, including US shipping, plus tax. Only offer when asked about T-shirts or hidden extras. Ask for items[].color (white, black, navy blue, orange, natural) and items[].size (s, m, l, xl) together with any missing details. Both are required. Use a separate item for each photo, color, size and fit combination, with quantity for that size. Gather all size quantities together. Show every returned custom shirt preview with its color, size and quantity and obtain explicit user approval of the print placement. Before sending the approval, call approveShirtPreviews with the current revision, approved_by=user, and all shirt previewIds. This store-specific step is required for both native and HTTP compatibility sessions; the standard Poppy approval stays unchanged. The preview is an approximate illustration of color and print placement. contain preserves the whole photo with unprinted margins; cover crops to the portrait print area. Changing artwork, fit, color or size requires a new proposal and approval. Mix products in one order by setting product on each item. US shipping is included with no threshold. Combining small prints and 8×10s saves $5 once per order, already included in the quoted subtotal. Posters ship separately and do not receive this saving. Products may arrive in separate packages. GET /api/catalog for current products and mode; never make a real payment unless mode=live. No pickup. US/USD only.\n${orderingGuidance}`;
/** Signed-in endpoints: the Session header and an access token with these scopes. */
const account = (scopes: string[]) => [{ PoppySession: [], PoppyAccount: scopes }];
const approvalHeader = {
  in: "header",
  name: "Poppy-Approval",
  required: false,
  description:
    "Operations v2, sent by the Personal Agent, not chosen by the model: after the User approves the operation from an approval_required response, the same request is sent again with this RFC 9651 Dictionary, operation_id=\"…\", revision=\"…\".",
  schema: { type: "string", maxLength: 600 },
};
const approvalRequired = response(
  "approval_required (Operations v2): nothing was done. Show the User the Company's name and operation.summary, get their approval, then send the same request again with Poppy-Approval. Also insufficient_scope or extension_required.",
  ref("ApprovalRequired"),
);
export function openapi(compatibility = false) {
  const secured = {
    // Signed out, or signed in with any scope.
    security: compatibility ? [{ AgentGuest: [] }] : [{ PoppySession: [] }, { PoppySession: [], PoppyAccount: [] }],
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
              PoppySession: {
                type: "apiKey",
                in: "header",
                name: "Poppy-Session",
                description:
                  "Poppy 0.3 §5: a per-request Session JWT (typ poppy-session+jwt, ES256) signed by a delegated key with its delegation in pap_dlg. Every request carries one; the client transport supplies it, not the model.",
              },
              PoppyAccount: {
                type: "http",
                scheme: "bearer",
                description:
                  "An access token from sign-in (Direct, Device or the Mediated Sign-In grant), sent with the Session header, whose ath covers it. The scopes named on an operation are the store's account scopes, described in auth.scopes in poppy.json.",
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
          required: compatibility ? ["email", "address", "items"] : ["items"],
          description: compatibility
            ? undefined
            : "Guest sessions must send email and address. A signed-in Session with orders:write and addresses may omit address (the account's default saved address is used) or send addressId, and may omit email (the account's verified email is used). The resolved address and email appear in the operation summary for the user to approve.",
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
            ...(compatibility
              ? {}
              : {
                  addressId: {
                    type: "string",
                    description:
                      "Signed-in only: use this saved address (from listAccountAddresses) instead of address.",
                  },
                }),
            items: {
              type: "array",
              minItems: 1,
              maxItems: 121,
              items: ref("Item"),
            },
          },
        },
        SavedAddress: {
          type: "object",
          required: ["id", "default", "address", "created"],
          properties: {
            id: { type: "string" },
            label: { type: ["string", "null"] },
            default: { type: "boolean" },
            address: ref("Address"),
            created: { type: "string", format: "date-time" },
          },
        },
        Operation: {
          type: "object",
          description: "Operations v2 §3: what the User approves.",
          required: ["operation_id", "revision", "summary", "terms", "expires_at"],
          properties: {
            operation_id: { type: "string" },
            revision: { type: "string", description: "Changes whenever the terms change." },
            summary: { type: "string", description: "Show this verbatim with the Company's name." },
            terms: { type: "object" },
            expires_at: { type: "string", format: "date-time" },
          },
        },
        ApprovalRequired: {
          type: "object",
          required: ["error", "operation"],
          properties: { error: { const: "approval_required" }, operation: ref("Operation") },
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
      ...(config.demo && !compatibility ? signInHelperPaths : {}),
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
                security: account([]),
                summary: "View the signed-in account",
                description:
                  "Requires an access token with any account scope. default_address is included only with the addresses scope. Signed out, it answers 401 with a Bearer challenge naming scopes; sign in or refresh, then retry.",
                responses: {
                  "200": response("Verified account email, granted scopes, saved address count and default saved address"),
                  "401": response("Sign-in needed (WWW-Authenticate: Bearer scope=…)"),
                },
              },
            },
            "/api/account/addresses": {
              get: {
                ...secured,
                operationId: "listAccountAddresses",
                security: account(["addresses"]),
                summary: "List saved shipping addresses",
                description:
                  "Requires addresses. Default address first. Show these to the user before ordering instead of asking them to retype an address.",
                responses: {
                  "200": response("Saved addresses", {
                    type: "object",
                    properties: { addresses: { type: "array", items: ref("SavedAddress") } },
                  }),
                  "403": response("insufficient_scope: orders:read required"),
                },
              },
              post: {
                ...secured,
                operationId: "saveAccountAddress",
                security: account(["addresses"]),
                summary: "Save a shipping address to the account",
                description:
                  "Requires addresses. Only save an address the user asked to save. The first saved address becomes the default; set default=true to change it. Saving an identical address again returns the existing one (200). Up to 10 addresses.",
                requestBody: body({
                  type: "object",
                  additionalProperties: false,
                  required: ["address"],
                  properties: {
                    address: ref("Address"),
                    label: { type: "string", maxLength: 40, description: "Optional user-chosen name, such as Home." },
                    default: { type: "boolean" },
                  },
                }),
                responses: {
                  "201": response("Saved", ref("SavedAddress")),
                  "200": response("Already saved", ref("SavedAddress")),
                  "403": response("insufficient_scope: names the missing scope"),
                  "409": response("Address limit reached", ref("Error")),
                },
              },
            },
            "/api/account/addresses/{id}/default": {
              post: {
                ...secured,
                parameters: [pathId],
                operationId: "setDefaultAccountAddress",
                security: account(["addresses"]),
                summary: "Make a saved address the default",
                responses: {
                  "200": response("Updated", ref("SavedAddress")),
                  "404": response("Not a saved address of this account", ref("Error")),
                },
              },
            },
            "/api/account/addresses/{id}": {
              delete: {
                ...secured,
                parameters: [pathId],
                operationId: "deleteAccountAddress",
                security: account(["addresses"]),
                summary: "Delete a saved address",
                description: "Requires addresses. If it was the default, the newest remaining address becomes the default.",
                responses: {
                  "200": response("Deleted"),
                  "404": response("Not a saved address of this account", ref("Error")),
                },
              },
            },
            "/api/account/orders/{id}/reorder": {
              post: {
                ...secured,
                parameters: [pathId, approvalHeader],
                operationId: "reorderOrder",
                security: account(["orders:write"]),
                summary: "Propose the same items as a past account order; never charges or prints",
                description:
                  "Requires orders:write (and addresses to use addressId). Copies the order's photos into this session and proposes the same products, quantities and crops at current prices, tax and delivery estimate, to the original address unless you send addressId or address (and email to override). Coupons are not carried over. Answers approval_required (403) with the operation; once the User approves it, the same request with Poppy-Approval places the order (201), exactly as for proposeOrder. Returns photo_expired (410) once the photos are past retention; listAccountOrders marks orders with reorderable.",
                requestBody: {
                  required: false,
                  content: json({
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      addressId: { type: "string" },
                      address: ref("Address"),
                      email: { type: "string", format: "email" },
                    },
                  }),
                },
                responses: {
                  "201": response("Approved: the new order (id, status, checkoutUrl once ready, status_url)"),
                  "403": approvalRequired,
                  "404": response("Not an order of this account", ref("Error")),
                  "410": response("Photos no longer stored", ref("Error")),
                },
              },
            },
            "/api/account/orders": {
              get: {
                ...secured,
                operationId: "listAccountOrders",
                security: account(["orders:read"]),
                summary: "List previous orders",
                description:
                  "Requires orders:read. Newest first, up to 50 orders. Use next_cursor for the next page. Only orders placed while signed in are linked; older guest orders remain private to their original session. reorderable says whether reorderOrder can still copy the order's photos.",
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
                  "403": response("insufficient_scope: orders:read required"),
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
      "/api/photos/batch": {
        post: {
          ...secured,
          operationId: "uploadPhotos",
          summary: "Upload up to 10 photos together with one file-sharing approval",
          description: "Prefer this for multiple photos. Send each attachment in a separate named file field photo1 through photo10; 1–10 files, 20 MB combined maximum. Each photo uses the same image checks as uploadPhoto. Ask permission to send the exact selected files together. Results are in field-number order and identify each input field. HTTP 200 can include per-photo failures: keep successful Photo IDs and retry ONLY failed fields, never the whole batch. Never expose original filenames. This does not approve an order. If an agent cannot send multiple file fields, use uploadPhoto.",
          requestBody: { required: true, content: { "multipart/form-data": { schema: {
            type: "object", minProperties: 1, maxProperties: 10, additionalProperties: false,
            properties: Object.fromEntries(batchFields.map(field => [field, { type: "string", format: "binary" }])),
          } } } },
          responses: {
            200: response("Per-file results: field, status (uploaded or failed), photo on success or error/message on failure; uploaded and failed counts."),
            400: response("Invalid batch fields", ref("Error")),
            413: response("Batch exceeds 20 MB", ref("Error")),
            429: response("Session photo limit reached", ref("Error")),
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
          parameters: [...secured.parameters, approvalHeader],
          operationId: "proposeOrder",
          summary: "Order prints: needs the User's approval of the exact terms (Operations v2); never charges by itself",
          description:
            "Without an approval this answers 403 approval_required with the operation (summary, terms, revision) and does nothing. Sending the same request again returns the same operation. Once the User approves, send the same request again with Poppy-Approval: it places the order once (201) and later retries return the same order. Then open checkoutUrl (poll getOrder until it appears) and pay at Stripe-hosted checkout.",
          requestBody: body(ref("Proposal")),
          responses: {
            201: response("Approved: the order (id, status, checkoutUrl once ready, status_url)"),
            403: approvalRequired,
            409: response("Shirt preview approval required first", ref("Error")),
          },
        },
      },
      "/api/shirt-preview-approvals/{id}": {
        post: {
          ...secured, parameters: [...secured.parameters, pathId], operationId: "approveShirtPreviews",
          summary: "Record explicit user approval of every custom shirt preview before approving the order",
          description: "Print with Poppy store-specific API, not a Poppy protocol extension. Display all shirt mockups alongside their color, size, quantity and approximate-placement disclaimer. Only call after the user explicitly approves them. Bind approval to the current operation revision and exactly all shirt previewIds. Then send the approval (the same proposeOrder request with Poppy-Approval). Changed choices require a new proposal and approval.",
          requestBody: body({ type: "object", additionalProperties: false, required: ["revision", "previewIds", "approved_by"], properties: { revision: { type: "string" }, previewIds: { type: "array", minItems: 1, maxItems: 102, items: { type: "string" } }, approved_by: { const: "user" } } }),
          responses: { 200: response("Preview approval recorded", ref("Operation")), 400: response("Approve exactly all shirt previews", ref("Error")), 409: response("Proposal changed or no longer active", ref("Error")) },
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
