import { randomBytes } from "node:crypto";
import { db, get, put, hash, HttpError } from "./store.js";
export interface Coupon { percent: number; maxAmount?: number; created: number; orderId?: string; maxUses?: number; orderIds?: string[] }
const peaks = ["mountwhitney", "mountshasta", "mountrainier", "mountbaker", "mountadams", "mounthood", "mountelbert", "longspeak", "pikespeak", "mountlangley"];
export function generateCoupons(count: number, percent: number, maxAmount = 1500) {
  if (!Number.isInteger(count) || count < 1 || count > peaks.length || !Number.isInteger(percent) || percent < 1 || percent > 100)
    throw new Error("Use count 1–10 and percent 1–100.");
  if (!Number.isSafeInteger(maxAmount) || maxAmount < 1) throw new Error("Maximum discount must be positive integer cents.");
  return db.transaction(() => Array.from({ length: count }, (_, i) => {
    const code = `${peaks[i]}-${randomBytes(6).toString("hex")}`;
    put("coupon", hash(code), { percent, maxAmount, created: Date.now() } satisfies Coupon);
    return code;
  }))();
}
export function coupon(code?: string): Coupon | undefined {
  if (!code) return;
  const record = get<Coupon>("coupon", hash(code.toLowerCase()));
  if (!record || (record.orderIds?.length ?? (record.orderId ? 1 : 0)) >= (record.maxUses ?? 1)) throw new HttpError(422, "invalid_coupon", "This code is invalid or has already been used.");
  return record;
}
// Reserve inside a transaction so competing approvals cannot exceed maxUses.
// Legacy coupons default to one redemption.
export function redeemCoupon(code: string | undefined, orderId: string, approvedDiscount: number) {
  if (!code) return;
  return db.transaction(() => {
  const existing = get<Coupon>("coupon", hash(code.toLowerCase()));
  if (existing?.orderId === orderId || existing?.orderIds?.includes(orderId)) return;
  const record = coupon(code)!;
  if (record.maxAmount !== undefined && approvedDiscount > record.maxAmount)
    throw new HttpError(409, "terms_changed", "The coupon limit changed. Request a new proposal and approve the updated total.");
  put("coupon", hash(code.toLowerCase()), { ...record, orderIds: [...(record.orderIds ?? (record.orderId ? [record.orderId] : [])), orderId] });
  })();
}
export function discountedAmounts(subtotal: number, shipping: number, percent = 0, maxAmount = Number.MAX_SAFE_INTEGER) {
  const discount = Math.min(Math.round((subtotal + shipping) * percent / 100), maxAmount);
  const printDiscount = Math.min(subtotal, discount);
  const shippingDiscount = discount - printDiscount;
  return { printDiscount, shippingDiscount, discount };
}
