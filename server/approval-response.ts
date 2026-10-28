import type { Response } from "express";
import { performedView, type approvalFlow } from "./commerce.js";
import { tick } from "./worker.js";

/** Send an Operations v2 result; a just-placed order gets a chance to prepare its checkout. */
export async function respondApproval(res: Response, result: Awaited<ReturnType<typeof approvalFlow>>) {
  let body = result.body;
  if (result.performedNow) {
    await tick();
    body = performedView(result.op);
  }
  if (result.status === 201 && !body.checkoutUrl && body.status === "awaiting_payment") res.set("Retry-After", "2");
  res.status(result.status).json(body);
}
