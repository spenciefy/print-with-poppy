// Signed-in demo payoff: saved shipping addresses and reordering a past order.
// Both are ordinary OpenAPI operations gated by the store's scopes (addresses, orders:write); a
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
import { approvalFlow, requireOperations } from "./commerce.js";
import { respondApproval } from "./approval-response.js";
import { clonePhoto } from "./photos.js";
import { get, HttpError } from "./store.js";

const reorderInput = z
  .object({
    addressId: z.string().max(100).optional(),
    address: addressSchema.optional(),
    email: z.email().max(254).optional(),
  })
  .strict()
  .refine((b) => !(b.addressId && b.address), "Send address or addressId, not both.");

/**
 * Propose a past account order again (Operations v2): the same items at current
 * prices, to the original address unless overridden. Until the same request
 * comes back with Poppy-Approval it answers 403 approval_required; then it
 * places the order. A reorder never places an order on its own.
 */
export async function reorder(
  session: Session,
  orderId: string,
  body: unknown,
  approval: string | undefined,
) {
  requireOperations(session);
  const accountId = requireAccount(session, "orders:write");
  const input = reorderInput.parse(body ?? {});
  const order = get<Order>("order", orderId);
  if (!order || order.accountId !== accountId)
    throw new HttpError(404, "not_found", "Order not found in this account.");
  return approvalFlow(
    session,
    { method: "POST", path: `/api/account/orders/${orderId}/reorder`, body: input, approval },
    async (previous) => {
      // Copy the order's photos into this Session once; a new revision reuses the copies.
      const reused = previous?.terms.items.every((i) => photoOwned(i.photoId, session.id));
      const copies = new Map<string, string>();
      order.quote.items.forEach((item, index) => {
        if (reused) copies.set(item.photoId, previous!.terms.items[index].photoId);
      });
      for (const item of order.quote.items)
        if (!copies.has(item.photoId))
          copies.set(item.photoId, (await clonePhoto(item.photoId, session.id)).id);
      const proposal: Record<string, unknown> = {
        ...(order.quote.product ? { product: order.quote.product } : {}),
        email: input.email ?? order.quote.email,
        items: order.quote.items.map((item) => ({ ...item, photoId: copies.get(item.photoId) })),
        // Coupons are single-use and are never carried over to a reorder.
      };
      if (input.addressId) proposal.addressId = input.addressId;
      else proposal.address = input.address ?? order.quote.address;
      return proposal;
    },
  );
}

function photoOwned(photoId: string, owner: string) {
  const p = get<any>("photo", photoId);
  return !!p && p.owner === owner && !p.deleted;
}

export function accountFeatureRoutes(app: Express) {
  app.get("/api/account/addresses", async (req, res) => {
    const session = await authenticate(req);
    const accountId = requireAccount(session, "addresses");
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
    const result = await reorder(session, String(req.params.id), req.body, req.get("Poppy-Approval"));
    await respondApproval(res, result);
  });
}
