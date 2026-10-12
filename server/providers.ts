import Stripe from "stripe";
import { config, sku } from "./config.js";
import { HttpError, mediaUrl } from "./store.js";
import type { Proposal, Quote, Order } from "./types.js";
export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      maxNetworkRetries: 2,
      timeout: 15000,
    })
  : null;
export async function prodigi(path: string, body?: unknown) {
  const res = await fetch(`${config.prodigiBase}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "X-API-Key": process.env.PRODIGI_API_KEY || "",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok)
    throw new HttpError(
      502,
      "fulfillment_unavailable",
      `Print provider returned ${res.status}. Please retry this same request.`,
    );
  const result = await res.json();
  if (
    !["ok", "created", "alreadyexists", "onhold", "createdwithissues"].includes(
      String(result.outcome).toLowerCase(),
    )
  )
    throw new HttpError(
      502,
      "fulfillment_unavailable",
      "Print provider could not complete this request.",
    );
  return result;
}
const cents = (m: any) => {
  if (
    m?.currency !== "USD" ||
    !Number.isFinite(Number(m.amount)) ||
    Number(m.amount) < 0
  )
    throw new HttpError(
      502,
      "invalid_quote",
      "Provider did not return a valid USD quote.",
    );
  return Math.round(Number(m.amount) * 100);
};
export async function getPrice(p: Proposal) {
  if (config.demo) {
    const subtotal = Math.max(
      500,
      p.items.reduce((n, i) => n + i.quantity, 0) * 45,
    );
    const shipping = 495;
    const tax = Math.round((subtotal + shipping) * 0.0875);
    return { subtotal, shipping, tax, total: subtotal + shipping + tax };
  }
  // Verify the exact finish is available for the selected SKU/destination, rather than guessing attributes.
  const product = await prodigi(`/products/${sku}`);
  const details = product.product;
  if (!details?.attributes?.finish?.includes(config.finish))
    throw new HttpError(
      503,
      "product_not_configured",
      "The configured finish is not supported by the product.",
    );
  const q = await prodigi("/quotes", {
    shippingMethod: config.shipping,
    destinationCountryCode: p.address.country,
    currencyCode: "USD",
    items: p.items.map((i) => ({
      sku,
      copies: i.quantity,
      attributes: { finish: config.finish },
      assets: [{ printArea: "default" }],
    })),
  });
  const candidate = q.quotes?.find(
    (v: any) => v.shipmentMethod === config.shipping,
  );
  if (!candidate)
    throw new HttpError(
      422,
      "shipping_unavailable",
      "No shipping quote is available for this destination.",
    );
  const subtotal = Math.max(
    config.MINIMUM_SUBTOTAL_CENTS,
    Math.ceil(cents(candidate.costSummary.items) * config.PRICE_MULTIPLIER),
  );
  const shipping = cents(candidate.costSummary.shipping);
  const calculation = await stripe!.tax.calculations.create({
    currency: "usd",
    customer_details: {
      address: {
        line1: p.address.line1,
        line2: p.address.line2,
        city: p.address.city,
        state: p.address.state,
        postal_code: p.address.postalCode,
        country: p.address.country,
      },
      address_source: "shipping",
    },
    line_items: [
      {
        amount: subtotal,
        reference: "photo-prints",
        tax_behavior: "exclusive",
        tax_code: "txcd_99999999",
      },
    ],
    shipping_cost: { amount: shipping, tax_behavior: "exclusive" },
  });
  return {
    subtotal,
    shipping,
    tax: calculation.tax_amount_exclusive,
    total: calculation.amount_total,
    taxCalculationId: calculation.id || undefined,
  };
}
export function deliveryEstimate() {
  const min = Number(process.env.DELIVERY_MIN_BUSINESS_DAYS),
    max = Number(process.env.DELIVERY_MAX_BUSINESS_DAYS);
  if (min > 0 && max >= min)
    return `Estimated arrival in ${min}–${max} business days after payment. This is our estimate, not a guaranteed delivery date.`;
  return "Printing typically takes 2–3 days. An arrival date is not available yet; we will email shipment updates.";
}
export async function checkout(order: Order) {
  if (config.demo)
    return {
      id: `demo_${order.id}`,
      url: `${config.origin}/checkout/${order.id}#${order.viewToken}`,
      expires: Math.floor(order.created / 1000) + 3600,
    };
  const q = order.quote;
  const session = await stripe!.checkout.sessions.create(
    {
      mode: "payment",
      adaptive_pricing: { enabled: false },
      allow_promotion_codes: false,
      automatic_tax: { enabled: false },
      allowed_payment_method_types: ["card"],
      client_reference_id: order.id,
      customer_email: q.email,
      metadata: { order_id: order.id, operation_id: order.operationId },
      payment_intent_data: { metadata: { order_id: order.id } },
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: q.subtotal,
            product_data: {
              name: "4 × 6 photo prints",
              description: `${q.items.reduce((s, i) => s + i.quantity, 0)} prints · ${q.finish} · delivered to ${q.address.name}`,
            },
          },
          quantity: 1,
        },
        ...(q.shipping
          ? [
              {
                price_data: {
                  currency: "usd",
                  unit_amount: q.shipping,
                  product_data: { name: "Home delivery" },
                },
                quantity: 1,
              },
            ]
          : []),
        ...(q.tax
          ? [
              {
                price_data: {
                  currency: "usd",
                  unit_amount: q.tax,
                  product_data: {
                    name: "Sales tax (calculated for approved shipping address)",
                  },
                },
                quantity: 1,
              },
            ]
          : []),
      ],
      expires_at: Math.floor(order.created / 1000) + 3600,
      success_url: `${config.origin}/order/${order.id}#${order.viewToken}`,
      cancel_url: `${config.origin}/order/${order.id}#${order.viewToken}`,
    },
    { idempotencyKey: `checkout:${order.id}` },
  );
  if (!session.url) throw new Error("Stripe returned no checkout URL.");
  return { id: session.id, url: session.url, expires: session.expires_at };
}
export async function submitPrint(order: Order) {
  if (config.demo)
    return {
      id: `demo_prodigi_${order.id}`,
      status: { stage: "InProgress" },
      shipments: [],
    };
  const q = order.quote;
  const result = await prodigi("/orders", {
    merchantReference: order.id,
    idempotencyKey: order.id,
    shippingMethod: q.shippingMethod,
    callbackUrl: `${config.origin}/api/webhooks/prodigi`,
    recipient: {
      name: q.address.name,
      email: q.email,
      address: {
        line1: q.address.line1,
        line2: q.address.line2,
        townOrCity: q.address.city,
        stateOrCounty: q.address.state,
        postalOrZipCode: q.address.postalCode,
        countryCode: q.address.country,
      },
    },
    items: q.items.map((i) => ({
      merchantReference: i.photoId,
      sku,
      copies: i.quantity,
      sizing: "fillPrintArea",
      attributes: { finish: q.finish },
      assets: [
        { printArea: "default", url: mediaUrl(i.photoId, i.fit, 7 * 86400) },
      ],
    })),
  });
  if (!result.order?.id)
    throw new Error("Print provider returned no order ID.");
  return result.order;
}
export async function sendMail(
  message: { to: string; subject: string; html: string; text: string },
  key: string,
) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, ...message }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Email provider returned ${r.status}.`);
  return r.json();
}
