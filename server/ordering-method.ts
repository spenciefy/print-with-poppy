import type { OrderingMethod } from "../src/ordering-method.js";
import type { Order, Quote, Session } from "./types.js";
import { get } from "./store.js";
export function sessionOrderingMethod(session: Session): OrderingMethod {
  return session.compatibility ? "http-compatibility" : session.demo ? "visual-demo" : "native-poppy";
}
/** Legacy orders may use their original session. Missing evidence stays unknown. */
export function quoteOrderingMethod(quote: Quote): OrderingMethod | undefined {
  if (quote.orderingMethod) return quote.orderingMethod;
  const session = get<Session>("session", quote.owner);
  return session ? sessionOrderingMethod(session) : undefined;
}

/** Only celebrate a verified paid order; fulfillment status remains separate. */
export function orderSuccessMessage(order: Order, simulated: boolean): string | undefined {
  if (!order.paidAt || !["paid", "submitted", "printing", "partially_shipped", "shipped"].includes(order.status)) return undefined;
  const method = quoteOrderingMethod(order.quote);
  if (method !== "native-poppy" && method !== "http-compatibility") return undefined;
  const result = method === "native-poppy"
    ? "You successfully used Personal Agent Protocol to order from Print with Poppy!"
    : "You successfully ordered from Print with Poppy using its HTTP API. This order did not use Personal Agent Protocol.";
  return simulated
    ? `Sandbox test successful: ${method === "native-poppy" ? "Personal Agent Protocol" : "HTTP API"} ordering with Print with Poppy. No real payment, printing or shipping took place.`
    : result;
}
