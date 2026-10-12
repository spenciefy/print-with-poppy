/** Shared by the public page, agent instructions and server quotes. USD cents. */
export const offer = {
  includedPrints: 5,
  baseCents: 1200,
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
  "Up to 5 prints for $12, US delivery included. Additional prints 50¢ each, up to 100 total. Tax added before approval. Orders with fewer than 5 prints still cost $12; we print only the quantity you approve.";

export const products = {
  prints: {
    name: "4 × 6 photo prints",
    finish: "lustre",
    sku: "GLOBAL-PHO-4X6",
    attributes: { finish: "lustre" },
    shortPixels: 1200,
    longPixels: 1800,
  },
  poster: {
    name: "12 × 16 matte print",
    finish: "matte · 200gsm",
    sku: "GLOBAL-FAP-12X16",
    attributes: { paperType: "EMA", substrateWeight: "200gsm" },
    shortPixels: 3600,
    longPixels: 4800,
  },
} as const;
export type Product = keyof typeof products;
export const productOf = (p: { product?: Product }) =>
  products[p.product || "prints"];
export const mediaVariant = (product: Product | undefined, fit: string) =>
  product === "poster" ? `poster-${fit}` : fit;
export const posterPrice = 3500;
export const catalog = [
  {
    id: "prints",
    name: products.prints.name,
    minimumPrice: offer.baseCents,
    includedQuantity: offer.includedPrints,
    additionalPrintPrice: offer.extraPrintCents,
    maxQuantity: 100,
  },
  {
    id: "poster",
    name: products.poster.name,
    price: posterPrice,
    maxQuantity: 1,
  },
];
