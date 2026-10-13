# Private one-use codes

The customer gives their code to their personal agent. The agent includes `couponCode` in `POST /api/orders` **before approval**. The proposal shows the discount, recalculated tax and final total. Confirming it reserves the code for that one checkout. The customer then completes Stripe Checkout; a $0 order requires no card and is fulfilled only after Stripe confirms completion.

These are store codes, not Stripe promotion codes: do not type them into Stripe. Applying discounts before approval keeps the approved amount, tax, checkout, receipt and order page consistent. There is no public code list or storefront promotion. Codes include a peak name and random suffix to prevent guessing.

## Generate

Run on the desired service with its persistent database and environment:

```sh
npx tsx scripts/coupons.ts 10 100 1500
```

Arguments are count (1–10, with a different peak for each code in the batch) percentage (1–100), and maximum discount in cents (default `1500`, or $15). `100` discounts prints and shipping up to that combined cap. Customers pay the remainder plus recalculated tax. Orders below the cap can be free. Other percentages discount both prints and shipping before Stripe calculates tax. Printing and fulfillment still cost the merchant money. The existing product quantity limits apply.

Output is private: save it securely, never commit it or publish it in the catalog. The coupon registry stores hashes. Codes are redeemed atomically at approval, so competing proposals cannot spend a code twice. Retries of the approved operation reuse the same order. If a checkout is abandoned or expires, issue a replacement code only after verifying that checkout can no longer complete; codes are not automatically released while payment status might be uncertain.

Sandbox and production have separate databases; generate sandbox codes separately. No live provider keys or generated codes belong in this repository.
