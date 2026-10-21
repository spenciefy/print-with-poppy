import { shirtMediaVariants } from "../src/offer.js";
import { media } from "./media-runtime.js";
import { config } from "./config.js";
import { put, all, enqueue } from "./store.js";
import type { Order, Operation, Photo } from "./types.js";
import { cleanupSignIns } from "./accounts.js";
export async function housekeeping() {
  cleanupSignIns();
  for (const o of all<Order>("order")) {
    if (o.checkoutId && !o.paidAt && o.status === "awaiting_payment")
      enqueue(
        "payment-sync",
        o.id,
        `payment-sync:${o.id}:${Math.floor(Date.now() / 900000)}`,
      );
  }
  for (const o of all<Order>("order"))
    if (
      o.prodigiId &&
      o.status !== "cancelled" &&
      (!o.lastSync || o.lastSync < Date.now() - 15 * 60000)
    )
      enqueue("sync", o.id, `sync:${o.id}:${Math.floor(Date.now() / 900000)}`);
  const orders = all<Order>("order");
  const operations = all<Operation>("operation");
  for (const p of all<Photo>("photo")) {
    if (p.deleted) continue;
    const linked = orders.filter((o) =>
      o.quote.items.some((i) => i.photoId === p.id),
    );
    const pendingApproval = operations.some(
      (op) =>
        op.state === "proposed" &&
        op.terms.expires > Date.now() &&
        op.terms.items.some((i) => i.photoId === p.id),
    );
    const retained = linked.some(
      (o) =>
        (o.paidAt && !o.shippedAt) ||
        (o.shippedAt && Date.now() - o.shippedAt < 30 * 86400000) ||
        (o.status === "awaiting_payment" &&
          (!config.demo || Date.now() - o.created < 86400000)),
    );
    if (!pendingApproval && !retained && Date.now() - p.created > 86400000) {
      for (const fit of [
        "cover",
        "contain",
        "original",
        "square-cover",
        "square-contain",
        "enlargement-cover",
        "enlargement-contain",
        "mug-cover",
        "mug-contain",
        ...shirtMediaVariants,
        "poster-cover",
        "poster-contain",
      ])
        await media.remove(
          p.id,
          `${fit}.${/^tshirt-(contain|cover)$/.test(fit) ? "png" : "jpg"}`,
        );
      p.deleted = true;
      put("photo", p.id, p, p.owner);
    }
  }
}
