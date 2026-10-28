// Signed-in demo payoff: saved shipping addresses and reordering a past order.
// Both are ordinary OpenAPI operations gated by poppy:read / poppy:write; a
// reorder only creates a new proposal, which still needs the user's approval
// through the Operations extension before anything is charged or printed.
import type { Express } from "express";
import { z } from "zod";
import { authenticate } from "./auth.js";
import { requireAccount } from "./accounts.js";
import {
  addressView,
  deleteAddress,
  makeDefault,
  saveAddress,
  savedAddresses,
} from "./addresses.js";
import { addressSchema, type Order, type Session } from "./types.js";
import { authorizedOperation, operationView, propose } from "./commerce.js";
import { clonePhoto } from "./photos.js";
import { get, put, hash, HttpError } from "./store.js";

const reorderInput = z
  .object({
    addressId: z.string().max(100).optional(),
    address: addressSchema.optional(),
    email: z.email().max(254).optional(),
  })
  .strict()
  .refine((b) => !(b.addressId && b.address), "Send address or addressId, not both.");

export async function reorder(
  session: Session,
  orderId: string,
  body: unknown,
  key: string,
) {
  const accountId = requireAccount(session, "poppy:write");
  if (!session.extensions)
    throw new HttpError(
      403,
      "extension_required",
      "This store requires the operations extension.",
      { extension: "operations" },
    );
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key))
    throw new HttpError(
      400,
      "idempotency_key_required",
      "Supply a unique Idempotency-Key of 16–128 letters, digits, underscores or hyphens.",
    );
  const input = reorderInput.parse(body ?? {});
  const order = get<Order>("order", orderId);
  if (!order || order.accountId !== accountId)
    throw new HttpError(404, "not_found", "Order not found in this account.");
  const requestKey = `${session.id}:${key}`;
  const request = JSON.stringify({ orderId, input });
  const previous = get("reorder_key", requestKey);
  if (previous) {
    if (previous.request !== request)
      throw new HttpError(409, "idempotency_conflict", "Use the same request body when retrying.");
    return authorizedOperation(previous.operationId, session, "poppy:write");
  }
  // Copy the order's photos into this session; prices, tax and delivery are quoted fresh.
  const copies = new Map<string, string>();
  for (const item of order.quote.items)
    if (!copies.has(item.photoId))
      copies.set(item.photoId, (await clonePhoto(item.photoId, session.id)).id);
  const proposal: Record<string, unknown> = {
    ...(order.quote.product ? { product: order.quote.product } : {}),
    email: input.email ?? order.quote.email,
    items: order.quote.items.map((item) => ({
      ...item,
      photoId: copies.get(item.photoId),
    })),
    // Coupons are single-use and are never carried over to a reorder.
  };
  if (input.addressId) proposal.addressId = input.addressId;
  else proposal.address = input.address ?? order.quote.address;
  const op = await propose(proposal, session, `reorder_${hash(requestKey).slice(0, 43)}`);
  put("reorder_key", requestKey, { operationId: op.operation_id, request, orderId });
  return op;
}

export function accountFeatureRoutes(app: Express) {
  app.get("/api/account/addresses", async (req, res) => {
    const session = await authenticate(req);
    const accountId = requireAccount(session, "poppy:read");
    res.json({ addresses: savedAddresses(accountId).map(addressView) });
  });
  app.post("/api/account/addresses", async (req, res) => {
    const session = await authenticate(req);
    const result = saveAddress(session, req.body);
    res.status(result.created ? 201 : 200).json(addressView(result.address));
  });
  app.post("/api/account/addresses/:id/default", async (req, res) => {
    const session = await authenticate(req);
    res.json(addressView(makeDefault(session, String(req.params.id))));
  });
  app.delete("/api/account/addresses/:id", async (req, res) => {
    const session = await authenticate(req);
    deleteAddress(session, String(req.params.id));
    res.json({ deleted: true });
  });
  app.post("/api/account/orders/:id/reorder", async (req, res) => {
    const session = await authenticate(req);
    const op = await reorder(
      session,
      String(req.params.id),
      req.body,
      req.get("Idempotency-Key") || "",
    );
    res.status(202).json({ operation: operationView(op), reorder_of: String(req.params.id) });
  });
}
