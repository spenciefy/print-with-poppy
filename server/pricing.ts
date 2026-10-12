/** Conservative per-order estimate, not a guarantee against refunds or overhead. All values in cents. */
export function contributionBudget(
  revenue: number,
  customerTax: number,
  supplierBase: number,
  quotedSupplierTax: number,
) {
  const supplierTax = Math.max(
    quotedSupplierTax,
    Math.ceil(supplierBase * 0.1),
  );
  // 6% covers the published domestic rate plus international/FX/manual-entry uplifts.
  const paymentFees = Math.ceil((revenue + customerTax) * 0.06) + 30;
  const taxApiFees = 55; // 50c transaction + one 5c calculation allowance.
  const operatingReserve = 100;
  return (
    revenue -
    supplierBase -
    supplierTax -
    paymentFees -
    taxApiFees -
    operatingReserve
  );
}
