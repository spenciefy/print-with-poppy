import { generateCoupons } from "../server/coupons.js";
import { db } from "../server/store.js";
// Run on the target service's persistent database, never against an exported copy.
try {
  const [count = "10", percent = "100"] = process.argv.slice(2);
  console.log(JSON.stringify({ percent: Number(percent), codes: generateCoupons(Number(count), Number(percent)) }, null, 2));
} finally { db.close(); }
