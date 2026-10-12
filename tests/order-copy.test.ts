import { test } from "node:test";
import assert from "node:assert/strict";
import { orderSubtitle } from "../src/order-copy.js";
test("terminal order states do not promise a future shipment", () => {
  for (const s of [
    "shipped",
    "partially_shipped",
    "cancelled",
    "expired",
    "attention",
  ])
    assert.ok(!orderSubtitle(s).includes("when your prints ship"));
  assert.match(orderSubtitle("shipped"), /have shipped/);
  assert.match(orderSubtitle("cancelled"), /cancelled/);
  assert.match(orderSubtitle("awaiting_payment"), /Complete payment/);
  assert.match(orderSubtitle("printing"), /when your prints ship/);
});
