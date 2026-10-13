import { generateCoupons } from "../server/coupons.js";
import { db } from "../server/store.js";
// Run on the target service's persistent database, never against an exported copy.
try {
  const [count = "10", percent = "100", maxAmount = "1500"] = process.argv.slice(2);
  console.log(JSON.stringify({ percent: Number(percent), maxAmount: Number(maxAmount), codes: generateCoupons(Number(count), Number(percent), Number(maxAmount)) }, null, 2));
} finally { db.close(); }
