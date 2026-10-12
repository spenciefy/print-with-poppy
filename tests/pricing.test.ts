import { test } from "node:test";
import assert from "node:assert/strict";
import { printSubtotal } from "../src/offer.js";
test("published price includes shipping, keeps the minimum and has no bundle cliffs", () => {
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
