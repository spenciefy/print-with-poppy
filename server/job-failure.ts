import { db, get, put, requireRecord } from "./store.js";
import type { Order, Operation } from "./types.js";
export function recordJobFailure(
  job: { id: string; kind: string; record_id: string; attempts: number },
  e: unknown,
) {
  if (
    ["pricing_unavailable", "fulfillment_rejected"].includes(
      (e as any)?.code,
    ) &&
    ["checkout", "fulfill"].includes(job.kind)
  ) {
    db.prepare("UPDATE jobs SET state='failed',error=? WHERE id=?").run(
      (e as Error).message,
      job.id,
    );
    const order = get<Order>("order", job.record_id);
    if (order) {
      order.status = "attention";
      order.issue =
        (e as any)?.code === "fulfillment_rejected"
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
    return;
  }
  const attempts = job.attempts + 1;
  db.prepare("UPDATE jobs SET attempts=?,next_at=?,error=? WHERE id=?").run(
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
