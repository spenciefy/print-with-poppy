import { itemProduct, orderProducts, productOf, merchandiseLabel } from "../src/offer.js";
import { addressText, money, type Proposal, type Photo, type Quote } from "./types.js";

function photoList(names: string[]) {
  const numbers = [...new Set(names.map(name => Number(name.replace(/^Photo /, ""))))].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    const start = numbers[i];
    let end = start;
    while (numbers[i + 1] === end + 1) end = numbers[++i];
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }
  return `${numbers.length === 1 ? "Photo" : "Photos"} ${ranges.join(", ")}`;
}

/** Exact approval terms, grouped for chat readability without dropping exceptions. */
export function receipt(p: Proposal, photos: Pick<Photo, "name" | "width" | "height">[], price: Pick<Quote, "subtotal" | "shipping" | "discount" | "tax" | "total">, demo: boolean) {
  const lines = ["Print with Poppy"];
  for (const group of orderProducts(p)) {
    if (group.product === "tshirt") lines.push("Front print; shirt preview is approximate. May ship separately.");
    if (group.product === "mug") lines.push("Mug preview: flat horizontal wrap artwork; may ship separately.");
    lines.push(`${group.quantity} × ${group.name} · ${group.finish}`);
    const settings = new Map<string, { names: string[]; quantity: number; fit: string }>();
    const soft: string[] = [];
    const entries = new Map<string, { photo: typeof photos[number]; quantity: number; fit: string }>();
    p.items.forEach((item, index) => {
      if (itemProduct(p, item) !== group.product) return;
      const photo = photos[index];
      const key = `${photo.name}:${item.fit}`;
      const existing = entries.get(key);
      entries.set(key, { photo, fit: item.fit, quantity: (existing?.quantity || 0) + item.quantity });
    });
    entries.forEach(item => {
      const photo = item.photo;
      const key = `${item.quantity}:${item.fit}`;
      const row = settings.get(key) || { names: [], quantity: item.quantity, fit: item.fit };
      row.names.push(photo.name);
      settings.set(key, row);
      const spec = productOf({ product: group.product });
      if (Math.min(photo.width, photo.height) < spec.shortPixels || Math.max(photo.width, photo.height) < spec.longPixels) soft.push(photo.name);
    });
    for (const row of settings.values()) lines.push(`${photoList(row.names)} · ${row.quantity} ${row.quantity === 1 ? "copy" : "copies"} each · ${row.fit === "contain" ? group.product === "tshirt" ? "whole photo on front; unprinted margins" : "whole image with white margins" : "cropped to fill"}`);
    if (soft.length) lines.push(`Low-resolution warning: ${photoList(soft)} may look soft at this size.`);
  }
  lines.push("", `Deliver to: ${addressText(p.address)}`, `Email: ${p.email}`, "Delivery: estimated 7–12 business days after payment; not guaranteed.", "", `${merchandiseLabel(p)} ${money(price.subtotal)} ${price.shipping ? `+ shipping ${money(price.shipping)}` : "· US shipping included"}${price.discount ? ` − discount ${money(price.discount)}` : ""} + tax ${money(price.tax)}`, `Total: ${money(price.total)} USD`, "", price.total === 0 ? "Approve to continue to free checkout; no card required." : "Approve to continue to payment.", "Completing checkout starts printing; cancellation is not guaranteed afterward.");
  if (demo) lines.push("SANDBOX: simulated payment and fulfillment. No prints will be shipped.");
  return lines.join("\n");
}
