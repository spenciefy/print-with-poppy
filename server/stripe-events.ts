import Stripe from "stripe";
import { HttpError } from "./errors.js";
export async function verifyStripeEvent(
  payload: string,
  signature: string,
  secret: string,
) {
  const verifier = new Stripe("sk_test_signature_verification_only");
  try {
    return await verifier.webhooks.constructEventAsync(
      payload,
      signature,
      secret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    throw new HttpError(400, "invalid_signature", "Webhook signature invalid.");
  }
}
export function acceptStripeEvent(
  event: Stripe.Event,
  live: boolean,
  knownOrder: (id: string) => boolean,
  markPaid: (
    id: string,
    payment: { id: string; amount: number; currency: string; paid: boolean },
  ) => void,
) {
  if (event.livemode !== live)
    throw new HttpError(
      400,
      "wrong_environment",
      "Webhook belongs to a different payment environment.",
    );
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ].includes(event.type)
  )
    return;
  const session = event.data.object as Stripe.Checkout.Session;
  const id = session.metadata?.order_id;
  // One Stripe account can deliver events for both deployments. Never replay foreign orders.
  if (!id || !knownOrder(id)) return;
  if (session.amount_total === null || session.currency === null)
    throw new HttpError(400, "invalid_payment", "Payment totals missing.");
  markPaid(id, {
    id: session.id,
    amount: session.amount_total,
    currency: session.currency,
    paid:
      session.payment_status === "paid" ||
      (session.payment_status === "no_payment_required" &&
        session.status === "complete" &&
        session.amount_total === 0),
  });
}
