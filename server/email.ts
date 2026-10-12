import { productOf } from "../src/offer.js";
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
  const subject = cancelled
    ? "An update on your Poppy prints"
    : shipping
      ? "Your memories are on their way"
      : "Your Poppy prints are ordered";
  const statusUrl = `${config.origin}/order/${o.id}#${o.viewToken}`;
  const tracking = safeUrl(shipment?.tracking?.url);
  const intro = cancelled
    ? "The printer has cancelled this order. Please contact us to arrange a refund or reprint."
    : shipping
      ? "Your print shipment has left the lab."
      : "We received your payment. Your photos are queued for printing.";
  const trackingText = shipping
    ? shipment?.tracking?.number
      ? `Tracking: ${shipment.tracking.number}${tracking ? ` — ${tracking}` : ""}`
      : "This shipment has no tracking number available."
    : "";
  const estimate = cancelled
    ? "We will help arrange the next step."
    : shipping
      ? tracking
        ? "The carrier tracking page has the latest delivery estimate."
        : "An arrival estimate is not available for this shipment yet."
      : o.quote.estimate;
  const product = productOf(o.quote);
  const quantity = o.quote.items.reduce((sum, item) => sum + item.quantity, 0);
  const productLine = `${quantity} × ${product.label} · ${product.dimensions} · ${o.quote.finish}`;
  const text = [
    "Print with Poppy",
    config.demo ? "DEMO EMAIL — nothing was charged, printed, or sent." : "",
    subject,
    intro,
    `Order ${o.id}`,
    productLine,
    `Prints: ${money(o.quote.subtotal)} · Shipping: ${money(o.quote.shipping)} · Tax: ${money(o.quote.tax)}`,
    addressText(o.quote.address),
    `Total paid: ${money(o.quote.total)}`,
    estimate,
    trackingText,
    `View order: ${statusUrl}`,
    `Questions? ${config.support}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const origin = escapeHtml(config.origin);
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#faf6ee;color:#30291f;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf6ee"><tr><td align="center" style="padding:32px 20px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px"><tr><td>
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td><img src="${origin}/photos/poppy-email-logo.png" width="64" height="64" alt="Orange, red and yellow poppy photo stack" style="display:block;border:0"></td><td style="padding-left:12px;font-size:20px;letter-spacing:-0.5px">print with <strong>poppy</strong></td></tr></table>
${config.demo ? '<p style="font-size:12px">DEMO EMAIL — no real purchase or email delivery</p>' : ''}
<h1 style="font-size:30px;line-height:1.15;letter-spacing:-1px;margin:32px 0 16px">${subject}</h1><p style="font-size:16px;line-height:1.6;color:#6e6155">${intro}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:28px 0;border-top:1px solid #ded6c7;border-bottom:1px solid #ded6c7"><tr><td width="88" style="padding:24px 16px 24px 0;vertical-align:middle"><img src="${origin}${product.emailImage}" width="72" alt="${product.label} — sample poppy artwork" style="display:block;border:6px solid #ffffff;width:72px;height:auto"></td><td style="padding:24px 0"><h2 style="font-size:20px;margin:0 0 8px">${product.label}</h2><p style="font-size:14px;line-height:1.6;color:#6e6155;margin:0">${product.dimensions} · ${escapeHtml(o.quote.finish)}<br>Quantity: ${quantity}</p></td></tr></table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;line-height:1.9"><tr><td>Prints</td><td align="right">${money(o.quote.subtotal)}</td></tr><tr><td>Shipping</td><td align="right">${o.quote.shipping ? money(o.quote.shipping) : 'Included'}</td></tr><tr><td>Tax</td><td align="right">${money(o.quote.tax)}</td></tr><tr><td style="padding-top:8px;font-weight:bold">Total paid · USD</td><td align="right" style="padding-top:8px;font-weight:bold">${money(o.quote.total)}</td></tr></table>
<h2 style="font-size:16px;margin:28px 0 8px">Delivering to</h2><p style="font-size:14px;line-height:1.6;margin:0">${escapeHtml(addressText(o.quote.address))}</p><p style="font-size:14px;line-height:1.6;color:#6e6155">${escapeHtml(estimate)}</p>${shipping ? `<p style="font-size:14px;line-height:1.6">${escapeHtml(trackingText)}</p>` : ''}
${tracking ? `<p><a style="color:#af3e06" href="${escapeHtml(tracking)}">Track your shipment →</a></p>` : ''}<p style="margin:28px 0"><a style="background:#30291f;color:#ffffff;text-decoration:none;padding:14px 20px;display:inline-block;border-radius:6px" href="${escapeHtml(statusUrl)}">View your order</a></p><p style="font-size:12px;line-height:1.7;color:#6e6155">${escapeHtml(o.id)}<br>Questions? <a style="color:#af3e06" href="mailto:${escapeHtml(config.support)}">${escapeHtml(config.support)}</a></p>
</td></tr></table></td></tr></table></body></html>`;
  return { to: o.quote.email, subject, html, text };
}
