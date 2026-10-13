import { test } from "node:test";
import assert from "node:assert/strict";
import { orderSubtitle, visibleShipment } from "../src/order-copy.js";
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
  assert.match(orderSubtitle("printing"), /printer confirms dispatch/);
});

test("only meaningful shipment updates are visible", () => {
  assert.equal(visibleShipment({status:"Processing"}),false);
  assert.equal(visibleShipment({status:"Processing",tracking:{}}),false);
  assert.equal(visibleShipment({status:"Shipped"}),true);
  assert.equal(visibleShipment({status:"Processing",tracking:{number:"123"}}),true);
  assert.equal(visibleShipment({status:"Cancelled"}),true);
});
