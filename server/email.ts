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
  const text = [
    config.demo ? "DEMO EMAIL — nothing was charged, printed, or sent." : "",
    subject,
    intro,
    `Order ${o.id}`,
    `${o.quote.items.reduce((s, i) => s + i.quantity, 0)} × 4×6 ${o.quote.finish} prints`,
    addressText(o.quote.address),
    `Total paid: ${money(o.quote.total)}`,
    estimate,
    trackingText,
    `View order: ${statusUrl}`,
    `Questions? ${config.support}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const html = `<!doctype html><html><body style="background:#faf6ee;color:#30291f;font-family:Georgia,serif;padding:32px"><main style="max-width:560px;margin:auto"><p style="color:#c5480a;font-family:sans-serif"><img src="${escapeHtml(config.origin)}/poppy.png" width="32" height="32" alt="" style="vertical-align:middle;margin-right:8px"> PRINT WITH POPPY</p>${config.demo ? "<p>DEMO EMAIL — no real purchase or email delivery</p>" : ""}<h1 style="font-size:34px;font-weight:normal">${subject}</h1><p>${intro}</p><p>${o.quote.items.reduce((s, i) => s + i.quantity, 0)} × 4×6 ${escapeHtml(o.quote.finish)} prints · ${money(o.quote.total)}</p><hr style="border:0;border-top:1px solid #ded6c7"><h3>Delivering to</h3><p>${escapeHtml(addressText(o.quote.address))}</p><p>${escapeHtml(estimate)}</p>${shipping ? `<p>${escapeHtml(trackingText)}</p>` : ""}${tracking ? `<p><a href="${escapeHtml(tracking)}">Track your shipment →</a></p>` : ""}<p><a style="color:#af3e06" href="${escapeHtml(statusUrl)}">View your order →</a></p><p style="font-size:12px">${escapeHtml(o.id)}<br>Questions? ${escapeHtml(config.support)}</p></main></body></html>`;
  return { to: o.quote.email, subject, html, text };
}
