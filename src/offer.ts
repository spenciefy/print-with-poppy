/** Shared by the public page, agent instructions and server quotes. USD cents. */
export const offer = {
  includedPrints: 20,
  baseCents: 2000,
  extraPrintCents: 50,
  maxPrints: 100,
  delivery:
    "Estimated delivery: 7–12 business days after payment. This is our estimate, not a guaranteed arrival date.",
} as const;
export function printSubtotal(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > offer.maxPrints)
    throw new RangeError("Choose 1–100 prints.");
  return (
    offer.baseCents +
    Math.max(0, quantity - offer.includedPrints) * offer.extraPrintCents
  );
}
export const priceSummary =
  "Up to 20 prints for $20, US delivery included. Additional prints 50¢ each, up to 100 total. Tax added before approval. Orders with fewer than 20 prints still cost $20; we print only the quantity you approve.";
