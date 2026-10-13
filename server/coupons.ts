import { randomBytes } from "node:crypto";
import { db, get, put, hash, HttpError } from "./store.js";
export interface Coupon { percent: number; created: number; orderId?: string }
const peaks = ["mountwhitney", "mountshasta", "mountrainier", "mountbaker", "mountadams", "mounthood", "mountelbert", "longspeak", "pikespeak", "mountlangley"];
export function generateCoupons(count: number, percent: number) {
  if (!Number.isInteger(count) || count < 1 || count > 100 || !Number.isInteger(percent) || percent < 1 || percent > 100)
    throw new Error("Use count 1–100 and percent 1–100.");
  return db.transaction(() => Array.from({ length: count }, (_, i) => {
    const code = `${peaks[i % peaks.length]}-${randomBytes(6).toString("hex")}`;
    put("coupon", hash(code), { percent, created: Date.now() } satisfies Coupon);
    return code;
  }))();
}
export function coupon(code?: string): Coupon | undefined {
  if (!code) return;
  const record = get<Coupon>("coupon", hash(code.toLowerCase()));
  if (!record || record.orderId) throw new HttpError(422, "invalid_coupon", "This code is invalid or has already been used.");
  return record;
}
// Called inside confirm's transaction. A code funds only one approved checkout,
// even if competing proposals were prepared before either was confirmed.
export function redeemCoupon(code: string | undefined, orderId: string) {
  if (!code) return;
  const record = coupon(code)!;
  put("coupon", hash(code.toLowerCase()), { ...record, orderId });
}
export function discountedAmounts(subtotal: number, shipping: number, percent = 0) {
  const printDiscount = Math.round(subtotal * percent / 100);
  const shippingDiscount = Math.round(shipping * percent / 100);
  return { printDiscount, shippingDiscount, discount: printDiscount + shippingDiscount };
}
