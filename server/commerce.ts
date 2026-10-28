import { parseDictionary } from "http-structured-fields";
import { sessionOrderingMethod, quoteOrderingMethod, orderSuccessMessage } from "./ordering-method.js";
import { receipt } from "./receipt.js";
import { redeemCoupon } from "./coupons.js";
import { productOf, mediaVariant, previewVariant, itemProduct, orderProducts, orderLabel } from "../src/offer.js";
import { config } from "./config.js";
import {
  db,
  hash,
  id,
  get,
  put,
  requireRecord,
  enqueue,
  HttpError,
  mediaUrl,
} from "./store.js";
import { ownedPhoto, preparePoster, photoLabel } from "./photos.js";
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
import { resolveAccountDefaults } from "./addresses.js";
/** Operations v2 (§2): used only when the Personal Agent lists `operations` version "2". */
export function requireOperations(session: Session) {
  if (!session.extensions)
    throw new HttpError(
      403,
      "extension_required",
      "Ordering here needs the operations extension, version 2: list it in your client metadata.",
      { extension: "operations" },
    );
}
/** Who can approve an operation (Operations §3): its Session, or for a signed-in one, the account. */
function principalKey(session: Session) {
  return session.accountId
    ? `account:${session.clientId}:${session.userId}:${session.accountId}`
    : `session:${session.id}`;
}
/** JSON with sorted keys, so the same request always has the same fingerprint. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as object)
      .sort()
      .filter((k) => (value as any)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as any)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}
/** A fingerprint of who asked for what: principal, method, path and canonical body. */
export function requestFingerprint(session: Session, method: string, path: string, body: unknown) {
  return hash(`${principalKey(session)}\n${method}\n${path}\n${canonical(body ?? {})}`);
}
/** RFC 9651 Dictionary: `operation_id="…", revision="…"`; anything else is ignored. */
export function parseApproval(header: string | undefined) {
  if (!header) return undefined;
  try {
    const members = parseDictionary(header);
    const operation = members.get("operation_id");
    const revision = members.get("revision");
    // Only RFC Strings count, not Tokens, Display Strings or Inner Lists.
    // Unknown members and parameters are parsed but do not affect approval.
    return operation?.type === "item" && operation.value.type === "string" &&
      revision?.type === "item" && revision.value.type === "string"
      ? { operation_id: operation.value.value, revision: revision.value.value }
      : undefined;
  } catch {
    return undefined; // Unparseable: ignore the field, never approve an action.
  }
}
const newRevision = (expires: number) => `${Math.floor(expires / 1000)}-${id("r").slice(2)}`;

/** Quote a proposal and store it as an operation awaiting approval. */
export async function propose(
  body: unknown,
  session: Session,
  request: string,
  operationId = id("op"),
) {
  const p = proposalSchema.parse(resolveAccountDefaults(body, session));
  const photos = p.items.map((i) => ownedPhoto(i.photoId, session.id));
  const groups = orderProducts(p);
  for (const [n, item] of p.items.entries()) {
    if (itemProduct(p, item) !== "prints") await preparePoster(photos[n], item.fit, itemProduct(p, item), item.color);
  }
  const price = await getPrice(p);
  const created = Date.now();
  const estimate = deliveryEstimate();
  const summary = receipt(p, photos.map((photo, index) => ({ ...photo, name: photoLabel(photo.id, index) })), price, config.demo);
  const q: Quote = {
    ...p,
    ...price,
    id: id("quote"),
    owner: session.id,
    orderingMethod: sessionOrderingMethod(session),
    accountId: session.accountId,
    created,
    expires: created + 15 * 60000,
    currency: "USD",
    estimate,
    finish: groups.length === 1 ? groups[0].finish : groups.map(g => `${g.label}: ${g.finish}`).join("; "),
    shippingMethod: config.shipping,
    summary,
    previews: photos.map((ph, n) => ({
      previewId: id("preview"),
      product: itemProduct(p, p.items[n]),
      photoId: ph.id,
      color: p.items[n].color, size: p.items[n].size,
      url: mediaUrl(ph.id, previewVariant(itemProduct(p, p.items[n]), p.items[n].fit, p.items[n].color)),
      name: photoLabel(ph.id, n),
      quantity: p.items[n].quantity,
      fit: p.items[n].fit,
    })),
  };
  const op: Operation = {
    owner: session.id,
    principal: { clientId: session.clientId, userId: session.userId },
    operation_id: operationId,
    revision: newRevision(q.expires),
    state: "proposed",
    summary,
    terms: q,
    expires_at: new Date(q.expires).toISOString(),
    request,
    confirmation: null,
    result: null,
  };
  return db.transaction(() => {
    // Concurrent identical requests share one operation.
    const ref = get("operation-request", request);
    const current = ref && get<Operation>("operation", ref.operationId);
    if (current && current.operation_id !== operationId && current.state === "proposed" && current.terms.expires > Date.now())
      return current;
    put("operation", op.operation_id, op, session.id);
    put("operation-request", request, { operationId: op.operation_id });
    return op;
  })();
}

/** Can this Session approve the operation (Operations §3, check 1)? */
function canApprove(op: Operation, session: Session) {
  if (!op.terms.accountId) return op.owner === session.id;
  const principal = op.principal || get<Session>("session", op.owner);
  return (
    !!principal &&
    principal.clientId === session.clientId &&
    principal.userId === session.userId &&
    session.accountId === op.terms.accountId &&
    !!session.scopes?.includes("orders:write")
  );
}
const performed = (op: Operation) => ["in_progress", "succeeded", "failed"].includes(op.state);

/**
 * An action that needs the User's approval (Operations v2). Without a valid
 * approval: 403 `approval_required` with the operation, performing nothing.
 * With `Poppy-Approval` naming the current revision of the operation for this
 * exact request: perform it, at most once, and return the order (201).
 */
export async function approvalFlow(
  session: Session,
  request: { method: string; path: string; body: unknown; approval?: string },
  build: (previous?: Operation) => Promise<unknown>,
): Promise<{ status: number; body: any; op: Operation; performedNow?: boolean }> {
  requireOperations(session);
  if (session.accountId) requireAccount(session, "orders:write");
  const fingerprint = requestFingerprint(session, request.method, request.path, request.body);
  const approval = parseApproval(request.approval);
  if (approval) {
    const approved = get<Operation>("operation", approval.operation_id);
    // An account's operation, from a signed-out Session of the same agent and User: a challenge (§3).
    if (approved?.terms.accountId && !session.accountId) {
      const principal = approved.principal || get<Session>("session", approved.owner);
      if (principal?.clientId === session.clientId && principal?.userId === session.userId)
        requireAccount(session, "orders:write");
    }
    if (approved && canApprove(approved, session)) {
      const op = readOperation(approved.operation_id, approved.owner);
      // Already performed: the same answer again, never a second order (§7).
      if (performed(op)) return { status: 201, body: performedView(op), op };
      if (
        op.state === "proposed" &&
        op.revision === approval.revision &&
        op.request === fingerprint
      ) {
        const done = confirm(op.operation_id, op.owner, op.revision, "user");
        return { status: 201, body: performedView(done), op: done, performedNow: true };
      }
    }
  }
  // No valid approval: the current revision for this request, or a new one.
  const ref = get("operation-request", fingerprint);
  let pending = ref ? get<Operation>("operation", ref.operationId) : undefined;
  if (pending) pending = readOperation(pending.operation_id, pending.owner);
  if (pending?.state === "proposed" && approval?.revision !== pending.revision)
    return { status: 403, body: approvalRequired(pending), op: pending };
  const reuse = pending && !performed(pending) ? pending : undefined;
  const op = await propose(await build(reuse), session, fingerprint, reuse?.operation_id);
  return { status: 403, body: approvalRequired(op), op };
}
export const approvalRequired = (op: Operation) => ({
  error: "approval_required",
  error_description:
    "Not done yet. Show the user the Company's name and this summary, get their approval, then send the same request again with Poppy-Approval: operation_id=\"…\", revision=\"…\".",
  operation: operationView(op),
});
/** What an approved order request returns, the first time and on every retry. */
export function performedView(op: Operation) {
  const order = op.orderId ? get<Order>("order", op.orderId) : undefined;
  if (!order) throw new HttpError(503, "in_progress", "The order is being placed. Retry the same request.");
  return { ...orderView(order), operation_id: op.operation_id };
}
// The HTTP layer always passes the authenticated token's effective account/scopes.
// Keep the original owner for photos, persistence and downstream idempotency.
export function authorizedOperation(
  opId: string,
  session: Session,
  scope = "orders:read",
) {
  const op = get<Operation>("operation", opId);
  const notFound = () =>
    new HttpError(404, "operation_not_found", "Operation not found.");
  if (!op) throw notFound();
  if (!op.terms.accountId) {
    if (op.owner !== session.id) throw notFound();
  } else {
    // Legacy records can recover their principal from the original persisted session.
    const principal = op.principal || get<Session>("session", op.owner);
    if (
      !principal ||
      principal.clientId !== session.clientId ||
      principal.userId !== session.userId
    )
      throw notFound();
    if (session.accountId && session.accountId !== op.terms.accountId)
      throw notFound();
    requireAccount(session, scope);
  }
  if (!session.extensions)
    throw new HttpError(
      403,
      "extension_required",
      "This store requires the operations extension.",
      { extension: "operations" },
    );
  return readOperation(opId, op.owner);
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
function displayPhotoLabels(quote: Quote) {
  let summary = quote.summary;
  const previews = quote.previews.map((preview, index) => {
    const name = photoLabel(preview.photoId, index);
    if (preview.name && preview.name !== name) summary = summary.split(preview.name).join(name);
    return { ...preview, previewId: preview.previewId || `${quote.id}:${index}`, name };
  });
  return { ...quote, summary, previews };
}
/** The operation object (Operations v2 §3). */
export function operationView(op: Operation) {
  const labeled = displayPhotoLabels(op.terms);
  return {
    operation_id: op.operation_id,
    revision: op.revision,
    summary: labeled.summary,
    terms: {
      ...labeled,
      owner: undefined,
      accountId: undefined,
      couponCode: undefined,
      taxCalculationId: undefined,
    },
    expires_at: op.expires_at,
  };
}
function requiredShirtPreviews(op: Operation) {
  return op.terms.previews.flatMap((preview, index) => preview.product === "tshirt" ? [preview.previewId || `${op.terms.id}:${index}`] : []);
}
export function approveShirtPreviews(opId: string, owner: string, revision: string, previewIds: string[], approvedBy: string) {
  return db.transaction(() => {
    const op = readOperation(opId, owner);
    if (revision !== op.revision) throw new HttpError(409, "terms_changed", "Show and approve the current proposal and shirt previews.");
    if (approvedBy !== "user") throw new HttpError(403, "user_approval_required", "The user must explicitly approve all shirt previews.");
    if (op.state !== "proposed") throw new HttpError(409, "invalid_state", "Only an active proposal can receive preview approval.");
    const expected = requiredShirtPreviews(op);
    if (!expected.length || previewIds.length !== expected.length || new Set(previewIds).size !== expected.length || expected.some(id => !previewIds.includes(id)))
      throw new HttpError(400, "invalid_preview_approval", "Show every shirt preview with its size, color and quantity, then submit exactly their previewIds after user approval.");
    op.shirtPreviewApproval = { revision, previewIds: expected, approved_by: "user", approved_at: new Date().toISOString() };
    put("operation", opId, op, owner);
    return op;
  })();
}
export function confirm(
  opId: string,
  owner: string,
  revision: string,
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
    const expected = requiredShirtPreviews(op);
    if (expected.length && (op.shirtPreviewApproval?.revision !== revision || expected.some(id => !op.shirtPreviewApproval?.previewIds.includes(id))))
      throw new HttpError(409, "shirt_preview_approval_required", "Show every shirt mockup with its color, size and quantity. Obtain explicit user approval, call approveShirtPreviews with the revision and all shirt previewIds, then send the approval again.", { previewIds: expected, approvalUrl: `/api/shirt-preview-approvals/${opId}` });
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
    redeemCoupon(op.terms.couponCode, order.id, op.terms.discount || 0);
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
    status_url: `${config.origin}/order/${o.id}#${o.viewToken}`,
    id: o.id,
    status: o.status,
    orderingMethod: quoteOrderingMethod(o.quote),
    successMessage: orderSuccessMessage(o, config.demo),
    created: o.created,
    paidAt: o.paidAt,
    quote: {
      ...displayPhotoLabels(o.quote),
      owner: undefined,
      taxCalculationId: undefined,
      accountId: undefined,
      couponCode: undefined,
      previews: o.quote.previews.map((p, index) => ({
        ...p,
        name: photoLabel(p.photoId, index),
        url: mediaUrl(p.photoId, previewVariant(p.product ?? o.quote.product, p.fit, p.color)),
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
