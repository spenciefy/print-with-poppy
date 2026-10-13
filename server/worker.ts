import { shirtMediaVariants } from "../src/offer.js";
import { stripeCheckoutComplete } from "./providers.js";
import fs from "node:fs/promises";
import { config, sandboxEmailEnabled } from "./config.js";
import { db, get, put, all, requireRecord, enqueue } from "./store.js";
import {
  checkout,
  submitPrint,
  prodigi,
  stripe,
  sendMail,
} from "./providers.js";
import { paid } from "./commerce.js";
import { emailFor, safeUrl } from "./email.js";
import type { Order, Operation, Photo, Shipment } from "./types.js";
import { cleanupSignIns } from "./accounts.js";
let running = false;
export function syncProvider(orderId: string, provider: any) {
  db.transaction(() => {
    const o = requireRecord<Order>("order", orderId);
    if (!o.paidAt || provider.id !== o.prodigiId)
      throw new Error("Provider order identity mismatch.");
    const shipments: Shipment[] = (provider.shipments || []).map((s: any) => ({
      id: String(s.id),
      status: String(s.status),
      carrier: s.carrier,
      tracking: s.tracking
        ? { number: s.tracking.number, url: safeUrl(s.tracking.url) }
        : undefined,
      dispatchDate: s.dispatchDate,
    }));
    for (const old of o.shipments) {
      const current = shipments.find((s) => s.id === old.id);
      if (!current) shipments.push(old);
      else if (old.status === "Shipped") {
        current.status = "Shipped";
        current.tracking = { ...old.tracking, ...current.tracking };
      }
    }
    o.providerStage = provider.status?.stage;
    o.lastSync = Date.now();
    o.shipments = shipments;
    const active = shipments.filter((s) => s.status !== "Cancelled");
    const shipped = active.filter((s) => s.status === "Shipped");
    if (o.providerStage === "Cancelled") {
      o.status = "cancelled";
      o.issue =
        "The printer cancelled this order. Contact support for a refund or reprint.";
      enqueue("email-cancelled", o.id);
    } else if (active.length && shipped.length === active.length) {
      o.status = "shipped";
      o.shippedAt ||= Date.now();
    } else if (shipped.length) {
      o.status = "partially_shipped";
    } else if (
      o.providerStage === "InProgress" &&
      !["shipped", "partially_shipped"].includes(o.status)
    ) {
      o.status = "printing";
    }
    if (provider.status?.issues?.length) {
      o.issue = "The print lab reported an issue. We are reviewing your order.";
      if (!shipped.length) o.status = "attention";
    }
    // Preserve already-shipped state across an incomplete provider response.
    for (const s of shipped)
      enqueue(
        "email-shipment",
        o.id,
        `email-shipment:${o.id}:${s.id}:${s.tracking?.number || "untracked"}`,
      );
    put("order", o.id, o, o.owner);
  })();
}
export async function runJob(job: any) {
  let o = requireRecord<Order>("order", job.record_id);
  if (job.kind === "checkout") {
    if (o.checkoutId) return;
    if (Date.now() - o.created > 24 * 3600000) {
      const op = requireRecord<Operation>("operation", o.operationId);
      op.state = "failed";
      op.result = {
        summary:
          "Checkout could not be prepared within 24 hours. No payment was accepted. Request a new quote.",
      };
      put("operation", op.operation_id, op, op.owner);
      throw new Error("Checkout creation needs operator review.");
    }
    const c = await checkout(o);
    db.transaction(() => {
      o = requireRecord<Order>("order", o.id);
      o.checkoutId = c.id;
      o.checkoutUrl = c.url;
      o.checkoutExpires = c.expires;
      put("order", o.id, o, o.owner);
      const op = requireRecord<Operation>("operation", o.operationId);
      op.state = "succeeded";
      op.result = {
        summary:
          o.quote.total === 0 ? "Approved free order prepared. Complete checkout at the checkout URL; no card is required and nothing has been printed yet." : "Approved order prepared. Complete card payment at the checkout URL; nothing has been charged or printed yet.",
        data: {
          order_id: o.id,
          checkout_url: c.url,
          status_url: `${config.origin}/order/${o.id}#${o.viewToken}`,
        },
      };
      put("operation", op.operation_id, op, op.owner);
    })();
  } else if (job.kind === "fulfill") {
    if (!o.paidAt)
      throw new Error("Payment must be confirmed before printing.");
    if (o.prodigiId) return;
    const p = await submitPrint(o);
    o = requireRecord<Order>("order", o.id);
    o.prodigiId = p.id;
    o.status = "submitted";
    o.issue = undefined;
    put("order", o.id, o, o.owner);
    syncProvider(o.id, p);
  } else if (job.kind === "payment-sync") {
    if (config.demo || !o.checkoutId || o.paidAt) return;
    const session = await stripe!.checkout.sessions.retrieve(o.checkoutId);
    if (stripeCheckoutComplete(session)) {
      paid(o.id, {
        id: session.id,
        amount: session.amount_total!,
        currency: session.currency!,
        paid: true,
      });
    } else if (session.status === "expired") {
      o = requireRecord<Order>("order", o.id);
      if (!o.paidAt) {
        o.status = "expired";
        put("order", o.id, o, o.owner);
      }
    }
  } else if (job.kind === "tax") {
    if (o.taxTransactionId) return;
    const result = await stripe!.tax.transactions.createFromCalculation(
      { calculation: o.quote.taxCalculationId!, reference: o.id },
      { idempotencyKey: `tax:${o.id}` },
    );
    o = requireRecord<Order>("order", o.id);
    o.taxTransactionId = result.id;
    put("order", o.id, o, o.owner);
  } else if (job.kind === "sync") {
    if (config.demo || !o.prodigiId) return;
    const p = await prodigi(`/orders/${encodeURIComponent(o.prodigiId)}`);
    syncProvider(o.id, p.order);
  } else if (job.kind.startsWith("email-")) {
    if (!o.paidAt) throw new Error("No transactional email before payment.");
    if (get("email", job.id)?.sent) return;
    const shipment =
      job.kind === "email-shipment"
        ? o.shipments.find((s) =>
            job.id.startsWith(`email-shipment:${o.id}:${s.id}:`),
          )
        : undefined;
    const message = emailFor(o, job.kind, shipment);
    // Resend deduplicates only for 24h; stop uncertain retries before its retention window.
    const previous = get("email", job.id);
    if (
      previous?.firstAttempt &&
      Date.now() - previous.firstAttempt > 23 * 3600000
    )
      throw new Error(
        "Email delivery uncertain; inspect Resend before resending.",
      );
    put(
      "email",
      job.id,
      {
        ...previous,
        ...message,
        orderId: o.id,
        firstAttempt: previous?.firstAttempt || Date.now(),
        sent: false,
      },
      o.id,
    );
    const captureOnly = config.demo && !sandboxEmailEnabled();
    const result = captureOnly
      ? { id: job.id }
      : await sendMail(message, job.id);
    put(
      "email",
      job.id,
      {
        ...message,
        orderId: o.id,
        providerId: captureOnly ? undefined : result.id,
        delivery: captureOnly ? "captured" : "submitted",
        sent: true,
        sentAt: Date.now(),
        demo: config.demo,
      },
      o.id,
    );
  }
}
export async function tick() {
  if (running) return;
  running = true;
  try {
    const jobs = db
      .prepare(
        "SELECT * FROM jobs WHERE state='pending' AND next_at<=? ORDER BY rowid LIMIT 20",
      )
      .all(Date.now());
    for (const job of jobs as any[]) {
      try {
        await runJob(job);
        db.prepare("UPDATE jobs SET state='done',error=NULL WHERE id=?").run(
          job.id,
        );
      } catch (e) {
        if (["pricing_unavailable", "fulfillment_rejected"].includes((e as any)?.code) && ["checkout", "fulfill"].includes(job.kind)) {
          db.prepare("UPDATE jobs SET state='failed',error=? WHERE id=?").run((e as Error).message, job.id);
          const order = get<Order>("order", job.record_id);
          if (order) {
            order.status = "attention";
            order.issue = (e as any)?.code === "fulfillment_rejected"
              ? "Payment received; the print provider rejected our submission. Printing has not started. Contact support to resolve this order."
              : order.paidAt
              ? "Payment received; printing is on hold because fulfillment costs changed. Contact support for review or a refund."
              : "Checkout is on hold because fulfillment costs changed. No payment was taken. Request a new quote or contact support.";
            put("order", order.id, order, order.owner);
            if (job.kind === "checkout") {
              const op = requireRecord<Operation>("operation", order.operationId);
              op.state = "failed";
              op.result = { summary: order.issue };
              put("operation", op.operation_id, op, op.owner);
            }
          }
          continue;
        }
        const attempts = job.attempts + 1;
        db.prepare(
          "UPDATE jobs SET attempts=?,next_at=?,error=? WHERE id=?",
        ).run(
          attempts,
          Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(attempts, 12)),
          e instanceof Error ? e.message : "Provider error",
          job.id,
        );
        if (job.kind === "fulfill" && attempts >= 3) {
          const o = get<Order>("order", job.record_id);
          if (o && !o.prodigiId) {
            o.status = "attention";
            o.issue =
              "Payment received; we have not confirmed acceptance by the print provider. We are retrying the submission.";
            put("order", o.id, o, o.owner);
          }
        }
      }
    }
  } finally {
    running = false;
  }
}
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
        "square-cover", "square-contain", "enlargement-cover", "enlargement-contain",
        "mug-cover", "mug-contain", ...shirtMediaVariants,
        "poster-cover",
        "poster-contain",
      ])
        await fs.rm(`${config.dataDir}/photos/${p.id}-${fit}.${/^tshirt-(contain|cover)$/.test(fit) ? "png" : "jpg"}`, {
          force: true,
        });
      p.deleted = true;
      put("photo", p.id, p, p.owner);
    }
  }
}
