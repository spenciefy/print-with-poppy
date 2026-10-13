import { test } from "node:test";
import assert from "node:assert/strict";
import { receipt } from "../server/receipt.js";
import { type Proposal } from "../server/types.js";
const proposal: Proposal = { email: "buyer@example.com", address: { name: "Sample Recipient", line1: "123 Market Street", line2: "Unit 9", city: "San Francisco", state: "CA", postalCode: "94103", country: "US" }, items: [1, 2, 3].map(n => ({ photoId: `photo_${n}`, quantity: 2, fit: "cover" })) };
const photos = [1, 2, 3].map(n => ({ name: `Photo ${n}`, width: 600, height: 800 }));
const price = { subtotal: 1250, shipping: 500, discount: 1500, tax: 0, total: 250 };
test("receipt groups repeated settings and warnings while preserving approval terms", () => {
  const s = receipt(proposal, photos, price, false);
  assert.match(s, /Photos 1–3 · 2 copies each · cropped to fill/);
  assert.equal(s.match(/Low-resolution warning/g)?.length, 1);
  for (const value of ["Unit 9", "94103", "buyer@example.com", "$12.50", "$5.00", "$15.00", "$0.00", "Total: $2.50 USD", "7–12", "cancellation"]) assert.ok(s.includes(value), value);
  assert.ok(s.length < 800);
});
test("mixed products and crop exceptions remain distinct; duplicate items aggregate accurately", () => {
  const p: Proposal = { ...proposal, items: [proposal.items[0], proposal.items[0], { ...proposal.items[1], fit: "contain" }, { ...proposal.items[2], product: "poster", quantity: 1 }] };
  const s = receipt(p, [photos[0], photos[0], photos[1], photos[2]], price, false);
  assert.match(s, /Photo 1 · 4 copies each · cropped to fill/);
  assert.match(s, /Photo 2 · 2 copies each · whole image with white margins/);
  assert.match(s, /1 × 12 × 16 matte print/);
  assert.match(s, /Photo 3 · 1 copy each/);
});
