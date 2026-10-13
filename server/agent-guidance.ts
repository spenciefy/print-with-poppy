export const orderingGuidance = `
Authentication routing:
- Choose one integration based on your actual tools. Native Poppy clients use discovery and the native OpenAPI document; their transport creates assertions and DPoP proofs. Agents without that transport use only the separate HTTP compatibility instructions and schema.
- A failed native request is not permission to downgrade to compatibility. Fix the native session or report the blocker. Never ask a customer for a private signing key, invent a proof, or mix tokens between these paths.
- Native signed-out sessions are still Personal Agent Protocol. Customer sign-in is optional and separate from the integration method. The server records orderingMethod; use it when explaining how an order was placed, rather than inferring from the agent's name.

Customer conversation:
- Start by asking for photos if none were supplied. Use original-resolution uploads when possible; do not substitute thumbnails. If a preview is low resolution, explain it may print softly and offer an original upload before approval.
- Ask for all missing details together in one concise message: product choice, copies, recipient name, complete US shipping address and confirmation email. Reuse details the user has already supplied. Do not invent missing details. Ask about crop exceptions when needed; show the resulting previews before approval.
- If the user wants multiple products for the same recipient/address, create ONE mixed order with items[].product, one approval and one checkout. Split only for different destinations or an explicit user request. Do not promise one physical package.
- Use the store's Photo 1, Photo 2 labels. Present labeled previews together as a gallery when supported. Never expose filenames or substitute a sample image for an ordered photo.
- Present the compact operation.summary once, verbatim with its line breaks, alongside the previews, then ask for approval. Do not surround it with another item-by-item recap. Preserve the full address, email, quantities, crop exceptions, quality warnings, delivery estimate and exact total.
- Keep API endpoints, JSON, session/operation identifiers, authentication mechanics and retry narration out of normal customer chat. Keep credentials private. If blocked, give one plain-language explanation and a next step; provide technical details only if requested, without secrets.
- Share the exact status_url returned by the API as the private order link. Preserve the full URL including its #view_ fragment; never reconstruct a link from an order ID, strip the fragment, or publish it publicly. If the user cannot open it, resend the exact URL.
- A quoted carrier is only planned routing. Do not claim a shipment or tracking exists unless verified by the order response.
- When the order response includes successMessage, say it once verbatim in your successful-order reply, alongside the verified status and exact private status_url. Do not claim success before it appears. Do not infer that an agent lacks native support just because an order used HTTP compatibility. Sandbox success is simulated; preserve that distinction.
- After payment, report the verified order status and the private status-page link. Do not equate checkout creation with payment, or submission retries with a printing delay. Explain any uncertainty honestly.
`;
