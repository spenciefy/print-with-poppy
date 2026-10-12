import { test } from "node:test";
import assert from "node:assert/strict";
import { printSubtotal } from "../src/offer.js";
test("published price includes shipping, keeps the minimum and has no bundle cliffs", () => {
  for (const [quantity, cents] of [
    [1, 2000],
    [19, 2000],
    [20, 2000],
    [21, 2050],
    [50, 3500],
    [100, 6000],
  ])
    assert.equal(printSubtotal(quantity), cents);
  for (const quantity of [0, -1, 1.5, 101, NaN])
    assert.throws(() => printSubtotal(quantity));
});
