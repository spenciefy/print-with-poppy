import { orderingMethodLabel } from "../src/ordering-method.js";
import { quoteOrderingMethod } from "./ordering-method.js";
import { merchandiseLabel, orderProducts, itemProduct, productOf, mediaVariant, previewVariant } from "../src/offer.js";
import { photoLabel } from "./photos.js";
import { mediaUrl } from "./store.js";
import { config } from "./config.js";
import { addressText, money, type Order, type Shipment } from "./types.js";
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function safeUrl(s?: string) {
  try {
    const u = new URL(s!);
    return u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}
export function emailFor(o: Order, kind: string, shipment?: Shipment) {
  const shipping = kind === "email-shipment";
  const cancelled = kind === "email-cancelled";
  const subject = config.agentSandbox
    ? `[SANDBOX] ${cancelled ? "Order cancelled" : shipping ? "Simulated shipment update" : "Your test print order is confirmed"}`
    : cancelled
    ? "Your Print with Poppy order was cancelled"
    : shipping
      ? "Your Print with Poppy order has shipped"
      : "Your Print with Poppy order is confirmed";
  const statusUrl = `${config.origin}/order/${o.id}#${o.viewToken}`;
  const tracking = safeUrl(shipment?.tracking?.url);
  const intro = config.agentSandbox
    ? "This is a sandbox order. Payment and fulfillment are simulated. No money was charged and no prints will be produced or shipped."
    : cancelled
    ? "The printer has cancelled this order. Please contact us to arrange a refund or reprint."
    : shipping
      ? "Your print shipment has left the lab."
      : o.quote.total === 0 ? "Your free order is confirmed. Your photos are queued for printing." : "We received your payment. Your photos are queued for printing.";
  const trackingText = shipping
    ? shipment?.tracking?.number
      ? `Tracking: ${shipment.tracking.number}${tracking ? ` — ${tracking}` : ""}`
      : "This shipment has no tracking number available."
    : "";
  const estimate = config.agentSandbox ? "Delivery dates and tracking are simulated; no package is coming." : cancelled
    ? "We will help arrange the next step."
    : shipping
      ? tracking
        ? "The carrier tracking page has the latest delivery estimate."
        : "An arrival estimate is not available for this shipment yet."
      : o.quote.estimate;
  const groups = orderProducts(o.quote);
  const orderedPhotos = o.quote.items.map((item, index) => {
    const product = itemProduct(o.quote, item);
    return {
      ...item,
      name: photoLabel(item.photoId, index),
      details: { ...productOf({ product }), dimensions: product === "tshirt" ? `${item.color} · ${item.size?.toUpperCase()} · approximate front mockup` : productOf({ product }).dimensions },
      // Renew at send time; proposal preview URLs expire after one hour.
      url: mediaUrl(item.photoId, previewVariant(product, item.fit, item.color), 30 * 86400),
    };
  });
  const productLine = groups.map(g => `${g.quantity} × ${g.label} · ${g.dimensions} · ${g.finish}`).join("; ");
  const text = [
    "Print with Poppy",
    config.demo ? "TEST ORDER — no real payment, printing or shipment." : "",
    subject,
    intro,
    `Order ${o.id}`,
    orderingMethodLabel(quoteOrderingMethod(o.quote)),
    productLine,
    ...orderedPhotos.map(p => `${p.name} — ${p.quantity} × ${p.details.label}, ${p.details.dimensions}, ${p.fit === "contain" ? p.product === "tshirt" ? "whole photo on front; unprinted margins" : "whole image with white margins" : "cropped to fill"}`),
    `${merchandiseLabel(o.quote)}: ${money(o.quote.subtotal)} · Shipping: ${o.quote.shipping ? money(o.quote.shipping) : "Included"} · Tax: ${money(o.quote.tax)}`,
    o.quote.discount ? `Discount: -${money(o.quote.discount)}` : "",
    addressText(o.quote.address),
    `${config.demo ? "Simulated total" : "Total paid"}: ${money(o.quote.total)}`,
    estimate,
    trackingText,
    `View order: ${statusUrl}`,
    `Questions? ${config.support}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const heading = config.agentSandbox ? subject : cancelled ? "Your order was cancelled." : shipping ? "Your prints have shipped." : "Your order is confirmed.";
  const origin = escapeHtml(config.origin);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#faf6ee;color:#30291f;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf6ee"><tr><td align="center" style="padding:32px 20px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px"><tr><td>
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td><img src="${origin}/photos/poppy-email-logo.png" width="64" height="64" alt="Orange, red and yellow poppy photo stack" style="display:block;border:0"></td><td style="padding-left:12px;font-size:20px;letter-spacing:-0.5px">Print with <strong>Poppy</strong></td></tr></table>
${config.demo ? '<p style="font-size:12px">TEST ORDER — no real payment, printing or shipment</p>' : ''}
${quoteOrderingMethod(o.quote) ? `<p style="font-size:12px;color:#6e6155">${escapeHtml(orderingMethodLabel(quoteOrderingMethod(o.quote)))}</p>` : ""}
<h1 style="font-size:26px;line-height:1.25;letter-spacing:-0.5px;margin:28px 0 12px">${heading}</h1><p style="font-size:16px;line-height:1.6;color:#6e6155">${intro}</p>
${groups.map(g => `<h2 style="font-size:20px;margin:24px 0 8px">${g.label} · ${g.quantity}</h2><p style="font-size:14px;color:#6e6155">${g.dimensions} · ${g.finish}</p>`).join("")}
${orderedPhotos.map(p => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0"><tr><td width="144" valign="top"><img src="${escapeHtml(p.url)}" width="128" alt="${escapeHtml(p.name)}" style="display:block;width:128px;max-width:100%;height:auto;border:0"></td><td valign="top" style="font-size:14px;line-height:1.6;padding-left:12px;overflow-wrap:anywhere"><strong>${escapeHtml(p.name)}</strong><br>${p.details.label} · ${p.details.dimensions}<br>Quantity: ${p.quantity}<br>${p.fit === "contain" ? p.product === "tshirt" ? "Whole photo on front; unprinted margins" : "Whole image with white margins" : "Cropped to fill"}</td></tr></table>`).join("")}

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;line-height:1.9;border-top:1px solid #dfd5c7;padding-top:20px;margin-top:24px"><tr><td>${merchandiseLabel(o.quote)}</td><td align="right">${money(o.quote.subtotal)}</td></tr><tr><td>Shipping</td><td align="right">${o.quote.shipping ? money(o.quote.shipping) : 'Included'}</td></tr>${o.quote.discount ? `<tr><td>Discount</td><td align="right">−${money(o.quote.discount)}</td></tr>` : ""}<tr><td>Tax</td><td align="right">${money(o.quote.tax)}</td></tr><tr><td style="padding-top:8px;font-weight:bold">${config.demo ? "Simulated total" : "Total paid"} · USD</td><td align="right" style="padding-top:8px;font-weight:bold">${money(o.quote.total)}</td></tr></table>
<h2 style="font-size:16px;margin:28px 0 8px">Delivering to</h2><p style="font-size:14px;line-height:1.6;margin:0">${escapeHtml(addressText(o.quote.address))}</p><p style="font-size:14px;line-height:1.6;color:#6e6155">${escapeHtml(estimate)}</p>${shipping ? `<p style="font-size:14px;line-height:1.6">${escapeHtml(trackingText)}</p>` : ''}
${tracking ? `<p><a style="color:#af3e06" href="${escapeHtml(tracking)}">Track your shipment →</a></p>` : ''}<p style="margin:28px 0"><a style="background:#b74608;color:#ffffff;text-decoration:none;padding:14px 20px;display:inline-block;border-radius:6px" href="${escapeHtml(statusUrl)}">View your order</a></p><p style="font-size:12px;line-height:1.7;color:#6e6155">${escapeHtml(o.id)}<br>Questions? <a style="color:#af3e06" href="mailto:${escapeHtml(config.support)}">${escapeHtml(config.support)}</a></p>
</td></tr></table></td></tr></table></body></html>`;
  return { to: o.quote.email, subject, html, text };
}
