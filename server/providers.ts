import { coupon, discountedAmounts } from "./coupons.js";
import Stripe from "stripe";
import { contributionBudget } from "./pricing.js";
import {
  offer,
  printSubtotal,
  shippingPrice,
  posterPrice,
  productOf,
  itemProduct,
  orderProducts,
  orderLabel,
  mediaVariant,
} from "../src/offer.js";
import { config, sandboxEmailEnabled } from "./config.js";
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
  if (!res.ok && res.status === 400) {
    const details = await res.json().catch(() => ({})) as any;
    const fields = Object.keys(details.failures || {}).filter(key => /^[a-zA-Z0-9_.\[\]]+$/.test(key));
    throw new HttpError(502, "fulfillment_rejected", `Print provider rejected the request${fields.length ? ` (${fields.join(", ")})` : ""}. The order has not been accepted; contact support.`);
  }
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
async function supplierCosts(p: Proposal) {
  // Verify the exact finish is available for the selected SKU/destination, rather than guessing attributes.
  for (const selected of orderProducts(p)) {
    const product = await prodigi(`/products/${selected.sku}`);
    const details = product.product;
    if (
      !Object.entries(selected.attributes).every(([key, value]) =>
        details?.attributes?.[key]?.includes(value),
      )
    )
      throw new HttpError(
        503,
        "product_not_configured",
        "The configured finish is not supported by the product.",
      );
  }
  const q = await prodigi("/quotes", {
    shippingMethod: config.shipping,
    destinationCountryCode: p.address.country,
    currencyCode: "USD",
    items: p.items.map((i) => ({
      sku: productOf({ product: itemProduct(p, i) }).sku,
      copies: i.quantity,
      attributes: productOf({ product: itemProduct(p, i) }).attributes,
      assets: [{ printArea: "default" }],
    })),
  });
  if (String(q.outcome).toLowerCase() === "createdwithissues" &&
      (!Array.isArray(q.issues) || !q.issues.length || q.issues.some((issue: any) => issue.errorCode !== "destinationCountryCode.UsSalesTaxWarning")))
    throw new HttpError(502, "invalid_quote", "The supplier quote has unresolved issues. No order can be prepared until a complete quote is available.");
  const candidate = q.quotes?.find(
    (v: any) => v.shipmentMethod === config.shipping,
  );
  if (!candidate)
    throw new HttpError(
      422,
      "shipping_unavailable",
      "No shipping quote is available for this destination.",
    );
  // Keep the advertised price fixed. Stop quoting instead of passing on an unexpected supplier increase.
  const supplierBase =
    cents(candidate.costSummary.items) +
    cents(candidate.costSummary.shipping) +
    (candidate.costSummary.branding
      ? cents(candidate.costSummary.branding)
      : 0);
  const supplierTax = candidate.costSummary.totalTax
    ? cents(candidate.costSummary.totalTax)
    : 0;
  const quotedTotal = candidate.costSummary.totalCost ? cents(candidate.costSummary.totalCost) : supplierBase + supplierTax;
  return { supplierBase, supplierTax: Math.max(supplierTax, quotedTotal - supplierBase) };
}
function assertMargin(revenue: number, tax: number, costs: { supplierBase: number; supplierTax: number }) {
  if (![revenue, tax, costs.supplierBase, costs.supplierTax].every(v => Number.isSafeInteger(v) && v >= 0) || !(contributionBudget(revenue, tax, costs.supplierBase, costs.supplierTax) >= 0))
    throw new HttpError(422, "pricing_unavailable", "This order cannot cover its printing, shipping and processing costs at the published price. Change the order or contact support before requesting approval.");
}
export async function ensureOrderMargin(order: Order) {
  if (config.demo) return;
  const costs = await supplierCosts(order.quote);
  // Approved coupons are an intentional merchant-funded subsidy.
  assertMargin(order.quote.total - order.quote.tax + (order.quote.discount || 0), order.quote.tax, costs);
}
export async function getPrice(p: Proposal) {
  const groups = orderProducts(p);
  const subtotal = groups.reduce((sum, group) => sum + group.subtotal, 0);
  const shipping = shippingPrice(subtotal);
  const promotion = coupon(p.couponCode);
  const discounts = discountedAmounts(subtotal, shipping, promotion?.percent, promotion?.maxAmount);
  const netSubtotal = subtotal - discounts.printDiscount;
  const netShipping = shipping - discounts.shippingDiscount;
  if (config.demo) {
    const tax = Math.round((netSubtotal + netShipping) * 0.0875);
    return { subtotal, shipping, ...discounts, tax, total: netSubtotal + netShipping + tax };
  }
  const costs = await supplierCosts(p);
  const checkMargin = (tax: number) => assertMargin(subtotal + shipping, tax, costs);
  checkMargin(0);
  // A fully sponsored order has no customer consideration or sales tax to collect.
  if (netSubtotal + netShipping === 0)
    return { subtotal, shipping, ...discounts, tax: 0, total: 0 };
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
        amount: netSubtotal,
        reference: "photo-prints",
        tax_behavior: "exclusive",
        tax_code: "txcd_99999999",
      },
    ],
    shipping_cost: { amount: netShipping, tax_behavior: "exclusive" },
  });
  if (calculation.amount_total > 0 && calculation.amount_total < 50)
    throw new HttpError(422, "discount_total_too_small", "This discount leaves less than the minimum $0.50 card payment. Use a full-order code or change the order.");
  checkMargin(calculation.tax_amount_exclusive);
  return {
    subtotal,
    shipping,
    ...discounts,
    tax: calculation.tax_amount_exclusive,
    total: calculation.amount_total,
    taxCalculationId: calculation.id || undefined,
  };
}
export function deliveryEstimate() {
  return offer.delivery;
}
export async function checkout(order: Order) {
  if (config.demo)
    return {
      id: `demo_${order.id}`,
      url: `${config.origin}/checkout/${order.id}#${order.viewToken}`,
      expires: Math.floor(order.created / 1000) + 3600,
    };
  await ensureOrderMargin(order);
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
            unit_amount: q.subtotal - (q.printDiscount || 0),
            product_data: {
              name: orderLabel(q),
              description: `${q.items.reduce((s, i) => s + i.quantity, 0)} prints · ${q.finish} · delivered to ${q.address.name}`,
            },
          },
          quantity: 1,
        },
        ...(q.shipping - (q.shippingDiscount || 0)
          ? [
              {
                price_data: {
                  currency: "usd",
                  unit_amount: q.shipping - (q.shippingDiscount || 0),
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
  await ensureOrderMargin(order);
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
        ...(q.address.line2?.trim() ? { line2: q.address.line2.trim() } : {}),
        townOrCity: q.address.city,
        stateOrCounty: q.address.state,
        postalOrZipCode: q.address.postalCode,
        countryCode: q.address.country,
      },
    },
    items: q.items.map((i, index) => ({
      merchantReference: `${i.photoId}:${index}`,
      sku: productOf({ product: itemProduct(q, i) }).sku,
      copies: i.quantity,
      sizing: "fillPrintArea",
      attributes: productOf({ product: itemProduct(q, i) }).attributes,
      assets: [
        {
          printArea: "default",
          url: mediaUrl(i.photoId, mediaVariant(itemProduct(q, i), i.fit), 7 * 86400),
        },
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
  if (config.demo && !sandboxEmailEnabled()) throw new Error("Email delivery is disabled in this demo environment.");
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

export function stripeCheckoutComplete(session: Pick<Stripe.Checkout.Session, "payment_status" | "status" | "amount_total">) {
  return session.payment_status === "paid" || (session.payment_status === "no_payment_required" && session.status === "complete" && session.amount_total === 0);
}

/** Retrieve a fresh hosted receipt only for the matching completed, paid checkout. */
export async function stripeReceipt(order: Order) {
  if (config.demo || !order.paidAt || !order.checkoutId || order.quote.total <= 0)
    throw new HttpError(404, "receipt_unavailable", "A Stripe receipt is not available for this order.");
  const session = await stripe!.checkout.sessions.retrieve(order.checkoutId, {
    expand: ["payment_intent.latest_charge"],
  });
  if (session.client_reference_id !== order.id || !stripeCheckoutComplete(session) ||
      session.amount_total !== order.quote.total || session.currency !== "usd")
    throw new HttpError(404, "receipt_unavailable", "A Stripe receipt is not available for this order.");
  const intent = session.payment_intent;
  const charge = intent && typeof intent !== "string" ? intent.latest_charge : undefined;
  const url = charge && typeof charge !== "string" ? charge.receipt_url : undefined;
  if (!url || new URL(url).protocol !== "https:" || new URL(url).hostname !== "pay.stripe.com")
    throw new HttpError(404, "receipt_unavailable", "Your Stripe receipt is not available yet. Please try again later.");
  return url;
}
