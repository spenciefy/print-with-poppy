import { redeemCoupon } from "./coupons.js";
import { productOf, mediaVariant } from "../src/offer.js";
import { config } from "./config.js";
import {
  db,
  id,
  get,
  put,
  requireRecord,
  enqueue,
  HttpError,
  mediaUrl,
} from "./store.js";
import { ownedPhoto, preparePoster } from "./photos.js";
import { getPrice, deliveryEstimate } from "./providers.js";
import {
  proposalSchema,
  addressText,
  money,
  type Operation,
  type Quote,
  type Session,
  type Order,
} from "./types.js";
import { requireAccount } from "./accounts.js";
export async function propose(body: unknown, session: Session, key: string) {
  if (session.accountId) requireAccount(session, "poppy:write");
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
  const p = proposalSchema.parse(body);
  const requestKey = `${session.id}:${key}`;
  const existing = get("proposal_key", requestKey);
  if (existing) {
    const previous = requireRecord<Operation>(
      "operation",
      existing.operationId,
      session.id,
    );
    if (
      previous.terms.accountId &&
      requireAccount(session, "poppy:write") !== previous.terms.accountId
    )
      throw new HttpError(
        403,
        "sign_in_required",
        "Sign in to the account that proposed this order.",
      );
    if (existing.request !== JSON.stringify(p))
      throw new HttpError(
        409,
        "idempotency_conflict",
        "Use the same request body when retrying.",
      );
    return requireRecord<Operation>(
      "operation",
      existing.operationId,
      session.id,
    );
  }
  const photos = p.items.map((i) => ownedPhoto(i.photoId, session.id));
  const selected = productOf(p);
  if (p.product === "poster") await preparePoster(photos[0], p.items[0].fit);
  const price = await getPrice(p);
  const created = Date.now();
  const estimate = deliveryEstimate();
  const summary = `Prepare checkout for ${p.items.reduce((n, i) => n + i.quantity, 0)} ${selected.name} (${selected.finish}): ${p.items.map((i, n) => `${n + 1}. ${photos[n].name}, ${i.quantity} ${i.quantity === 1 ? "copy" : "copies"}, ${i.fit === "contain" ? "whole image with white borders" : "center-cropped to fill"}${Math.min(photos[n].width, photos[n].height) < selected.shortPixels || Math.max(photos[n].width, photos[n].height) < selected.longPixels ? " — low-resolution warning" : ""}`).join("; ")}. Ship to ${addressText(p.address)}. Confirmation email: ${p.email}. Prints ${money(price.subtotal)} + shipping ${money(price.shipping)}${price.discount ? ` - discount ${money(price.discount)}` : ""} + sales tax ${money(price.tax)} = ${money(price.total)} USD. ${estimate} ${price.total === 0 ? "Complete the free checkout after approval; no card is required." : "Pay by card at the checkout link after approval."} Completing checkout releases the order to production; cancellation is not guaranteed after payment. ${config.demo ? "DEMO ONLY: illustrative prices, no charge or physical fulfillment." : ""}`;
  const q: Quote = {
    ...p,
    ...price,
    id: id("quote"),
    owner: session.id,
    accountId: session.accountId,
    created,
    expires: created + 15 * 60000,
    currency: "USD",
    estimate,
    finish: selected.finish,
    shippingMethod: config.shipping,
    summary,
    previews: photos.map((ph, n) => ({
      photoId: ph.id,
      url: mediaUrl(ph.id, mediaVariant(p.product, p.items[n].fit)),
      name: ph.name,
      quantity: p.items[n].quantity,
      fit: p.items[n].fit,
    })),
  };
  const op: Operation = {
    owner: session.id,
    operation_id: id("op"),
    revision: 1,
    state: "proposed",
    summary,
    terms: q,
    expires_at: new Date(q.expires).toISOString(),
    user_approval_required: true,
    confirmation: null,
    result: null,
  };
  // Recheck after provider I/O so concurrent identical requests share one proposal.
  return db.transaction(() => {
    const concurrent = get("proposal_key", requestKey);
    if (concurrent) {
      if (concurrent.request !== JSON.stringify(p))
        throw new HttpError(
          409,
          "idempotency_conflict",
          "Idempotency key reused with different terms.",
        );
      return requireRecord<Operation>(
        "operation",
        concurrent.operationId,
        session.id,
      );
    }
    put("operation", op.operation_id, op, session.id);
    put("proposal_key", requestKey, {
      operationId: op.operation_id,
      request: JSON.stringify(p),
    });
    return op;
  })();
}
export function readOperation(opId: string, owner: string) {
  const op = requireRecord<Operation>("operation", opId, owner);
  if (op.state === "proposed" && op.terms.expires < Date.now()) {
    op.state = "expired";
    op.result = { summary: "The quote expired. No payment or order was made." };
    put("operation", opId, op, owner);
  }
  return op;
}
export function operationView(op: Operation) {
  const { owner, ...view } = op;
  return {
    ...view,
    terms: {
      ...view.terms,
      owner: undefined,
      accountId: undefined,
      couponCode: undefined,
    },
  };
}
export function confirm(
  opId: string,
  owner: string,
  revision: number,
  approvedBy: string,
) {
  return db.transaction(() => {
    const op = readOperation(opId, owner);
    if (revision !== op.revision)
      throw new HttpError(409, "terms_changed", "Approve the current terms.", {
        operation: operationView(op),
      });
    if (approvedBy !== "user")
      throw new HttpError(
        403,
        "user_approval_required",
        "Show the summary, including full address, and obtain the user’s approval.",
      );
    if (op.state !== "proposed") return op;
    op.terms.items.forEach((i) => ownedPhoto(i.photoId, owner));
    const order: Order = {
      id: id("ord"),
      owner,
      operationId: opId,
      accountId: op.terms.accountId,
      quote: op.terms,
      created: Date.now(),
      status: "awaiting_payment",
      viewToken: id("view"),
      shipments: [],
    };
    redeemCoupon(op.terms.couponCode, order.id);
    op.state = "in_progress";
    op.confirmation = {
      revision,
      approved_by: "user",
      confirmed_at: new Date().toISOString(),
    };
    op.orderId = order.id;
    put("operation", opId, op, owner);
    put("order", order.id, order, owner);
    enqueue("checkout", order.id);
    return op;
  })();
}
export function cancel(opId: string, owner: string) {
  return db.transaction(() => {
    const op = readOperation(opId, owner);
    if (op.state === "proposed") {
      op.state = "cancelled";
      op.result = {
        summary: "Proposal declined. Nothing was charged or sent to print.",
      };
      put("operation", opId, op, owner);
    }
    return op;
  })();
}
export function paid(
  orderId: string,
  payment: { id: string; amount: number; currency: string; paid: boolean },
) {
  return db.transaction(() => {
    const order = requireRecord<Order>("order", orderId);
    if (
      order.checkoutId !== payment.id ||
      order.quote.total !== payment.amount ||
      payment.currency !== "usd"
    )
      throw new HttpError(
        409,
        "payment_mismatch",
        "Payment does not match the approved order.",
      );
    if (!payment.paid) return;
    if (order.paidAt) return;
    if (order.status !== "awaiting_payment")
      throw new HttpError(
        409,
        "invalid_order_state",
        "Order cannot accept payment in this state.",
      );
    order.paidAt = Date.now();
    order.status = "paid";
    put("order", order.id, order, order.owner);
    enqueue("fulfill", order.id);
    enqueue("email-confirmation", order.id);
    if (order.quote.taxCalculationId) enqueue("tax", order.id);
  })();
}
export function orderView(o: Order) {
  return {
    id: o.id,
    status: o.status,
    created: o.created,
    paidAt: o.paidAt,
    quote: {
      ...o.quote,
      owner: undefined,
      taxCalculationId: undefined,
      accountId: undefined,
      couponCode: undefined,
      previews: o.quote.previews.map((p) => ({
        ...p,
        url: mediaUrl(p.photoId, mediaVariant(o.quote.product, p.fit)),
      })),
    },
    checkoutUrl: o.status === "awaiting_payment" ? o.checkoutUrl : undefined,
    checkoutExpired:
      !!o.checkoutExpires && o.checkoutExpires * 1000 < Date.now(),
    shipments: o.shipments,
    issue: o.issue,
    demo: config.demo,
    providerStage: o.providerStage,
  };
}
