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
  // Standard US domestic card pricing; international-card uplifts are not included.
  const paymentFees = Math.ceil((revenue + customerTax) * 0.029) + 30;
  const taxApiFees = 50; // Normal transaction fee includes calculation credits.
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
