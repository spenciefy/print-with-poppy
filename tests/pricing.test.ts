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
test("US shipping is included at every subtotal with no threshold", () => {
  for (const subtotal of [0, 1200, 2499, 2500, 3500, 10000]) assert.equal(shippingPrice(subtotal), 0);
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
  assert.ok(contributionBudget(1700, 100000, 795, 0) < 0);
});

import { orderProducts } from "../src/offer.js";
test("square and standard prints share one minimum and one mixed delivery saving", () => {
  const groups = orderProducts({ items: [{ product: "prints", quantity: 3 }, { product: "square", quantity: 3 }, { product: "enlargement", quantity: 1 }] });
  assert.equal(groups.reduce((n, g) => n + g.subtotal, 0), 1950);
  assert.equal(groups.find(g => g.product === "enlargement")!.subtotal, 1200);
  assert.equal(orderProducts({ items: [{ product: "square", quantity: 5 }] })[0].subtotal, 1200);
  assert.ok(contributionBudget(1700, 204, 870, 0) > 0);
});

import { enlargementSubtotal } from "../src/offer.js";
test("8x10 volume tiers apply across different photos and item splits", () => {
  for (const [n, price] of [[1,1200],[2,1750],[3,2000],[5,2500],[10,3750],[100,26250]]) assert.equal(enlargementSubtotal(n), price);
  for (const n of [0,-1,101,1.5,NaN]) assert.throws(() => enlargementSubtotal(n));
  const split = orderProducts({items:[{product:"enlargement",quantity:1},{product:"enlargement",quantity:1}]});
  assert.equal(split[0].subtotal,1750);
});
test("all supported mixed carts cover the one dollar floor at quoted costs", () => {
  for (let small=0;small<=100;small++) for (let large=0;large<=100-small;large++) for (let poster=0;poster<=1;poster++) {
    if (!small && !large && !poster) continue;
    const items: {product:"prints"|"square"|"enlargement"|"poster";quantity:number}[]=[];
    if(small) items.push({product:"square",quantity:small});
    if(large) items.push({product:"enlargement",quantity:large});
    if(poster) items.push({product:"poster",quantity:poster});
    const groups=orderProducts({items});
    const revenue=groups.reduce((n,g)=>n+g.subtotal,0);
    const cost=25*small+200*large+1400*poster+(small+large?670:0)+(poster?710:0);
    assert.ok(groups.every(g=>Number.isInteger(g.subtotal)&&g.subtotal>=0));
    assert.ok(contributionBudget(revenue,Math.ceil(revenue*.12),cost,0)>=0,JSON.stringify({small,large,poster,revenue,cost}));
  }
});
