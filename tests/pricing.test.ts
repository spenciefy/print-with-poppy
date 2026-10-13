import { test } from "node:test";
import assert from "node:assert/strict";
import { printSubtotal, shippingPrice } from "../src/offer.js";
test("product pricing keeps the minimum and additional-print rate", () => {
  for (const [quantity, cents] of [
    [1, 1200],
    [5, 1200],
    [6, 1250],
    [10, 1450],
    [20, 1950],
    [100, 5950],
  ])
    assert.equal(printSubtotal(quantity), cents);
  for (const quantity of [0, -1, 1.5, 101, NaN])
    assert.throws(() => printSubtotal(quantity));
});

import { contributionBudget } from "../server/pricing.js";
test("shipping threshold uses merchandise subtotal, inclusive at $25", () => {
  for (const [subtotal, shipping] of [
    [1200, 500],
    [2499, 500],
    [2500, 0],
    [3500, 0],
  ])
    assert.equal(shippingPrice(subtotal), shipping);
  assert.equal(shippingPrice(printSubtotal(30)), 500);
  assert.equal(shippingPrice(printSubtotal(31)), 0);
});
test("all supported quantities cover conservative quoted costs on both sides of free shipping", () => {
  for (let n = 1; n <= 100; n++) {
    const revenue = printSubtotal(n) + shippingPrice(printSubtotal(n));
    assert.ok(
      contributionBudget(revenue, Math.ceil(revenue * 0.12), 25 * n + 670, 0) >
        0,
      `quantity ${n}`,
    );
  }
  assert.ok(contributionBudget(3500, 420, 2110, 0) > 0);
  assert.ok(contributionBudget(1700, 204, 3000, 0) < 0);
  assert.ok(contributionBudget(1700, 204, 795, 1000) < 0);
  assert.ok(contributionBudget(1700, 10000, 795, 0) < 0);
});

import { orderProducts } from "../src/offer.js";
test("square and standard prints share one minimum while 8x10 prints cost $12 each", () => {
  const groups = orderProducts({ items: [{ product: "prints", quantity: 3 }, { product: "square", quantity: 3 }, { product: "enlargement", quantity: 1 }] });
  assert.equal(groups.reduce((n, g) => n + g.subtotal, 0), 2450);
  assert.equal(groups.find(g => g.product === "enlargement")!.subtotal, 1200);
  assert.equal(orderProducts({ items: [{ product: "square", quantity: 5 }] })[0].subtotal, 1200);
  assert.ok(contributionBudget(1700, 204, 870, 0) > 0);
});
