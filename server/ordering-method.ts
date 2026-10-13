import type { OrderingMethod } from "../src/ordering-method.js";
import type { Quote, Session } from "./types.js";
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
