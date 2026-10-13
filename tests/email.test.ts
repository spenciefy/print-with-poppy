import { test } from "node:test";
import assert from "node:assert/strict";
import { emailFor } from "../server/email.js";
import type { Order } from "../server/types.js";
export const sampleOrder = (product: "prints" | "poster"): Order => ({
  id: "ord_email_preview", viewToken: "preview-only", quote: {
    product, email: "preview@example.com", items: [{ photoId: "photo_email", fit: "cover", quantity: product === "poster" ? 1 : 5 }],
    previews: [{ photoId: "photo_email", name: 'Beach <sunset>.jpg', url: "https://expired.example/preview", quantity: 1, fit: "cover" }],
    finish: product === "poster" ? "matte · 200gsm" : "lustre",
    subtotal: product === "poster" ? 3500 : 1200, shipping: product === "poster" ? 0 : 500,
    tax: 0, total: product === "poster" ? 3500 : 1700,
    estimate: "Estimated delivery: 7–12 business days after payment.",
    address: { name: "Sample Recipient", line1: "123 Example Street", line2: "", city: "San Francisco", state: "CA", postalCode: "94103", country: "US" },
  },
} as Order);
test("all email kinds use catalog product details and new branding", () => {
  for (const product of ["prints", "poster"] as const) for (const kind of ["email-confirmation", "email-shipment", "email-cancelled"]) {
    const message = emailFor(sampleOrder(product), kind);
    const label = product === "poster" ? "Poster print" : "Photo prints";
    const dimensions = product === "poster" ? "12 × 16 inches" : "4 × 6 inches";
    for (const body of [message.html, message.text]) {
      assert.ok(body.includes(label)); assert.ok(body.includes(dimensions));
      if (product === "poster") assert.ok(!body.includes("4×6"));
    }
    assert.ok(message.html.includes("poppy-email-logo.png"));
    assert.ok(message.html.includes("Print with <strong>Poppy</strong>"));
    assert.ok(message.html.includes("Photo 1"));
    assert.ok(!message.html.includes("Beach"));
    assert.ok(!message.html.includes("expired.example"));
    assert.ok(!message.html.includes("/poppy.png"));
  }
});
test("email escapes recipient details and refuses unsafe tracking links", () => {
  const order = sampleOrder("prints"); order.quote.address.name = '<script>alert(1)</script>';
  const message = emailFor(order, "email-shipment", { id: "test", status: "shipped", tracking: { url: "javascript:alert(1)", number: "<track>" } });
  assert.ok(!message.html.includes("<script>")); assert.ok(!message.html.includes("javascript:"));
  assert.ok(message.html.includes("&lt;track&gt;"));
});
