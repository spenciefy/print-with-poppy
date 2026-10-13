/** Shared by the public page, agent instructions and server quotes. USD cents. */
export const offer = {
  includedPrints: 5,
  baseCents: 1200,
  extraPrintCents: 50,
  maxPrints: 100,
  shippingCents: 500,
  freeShippingMinimumCents: 2500,
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
export function shippingPrice(subtotal: number) {
  if (!Number.isSafeInteger(subtotal) || subtotal < 0)
    throw new RangeError("Invalid subtotal.");
  return subtotal >= offer.freeShippingMinimumCents ? 0 : offer.shippingCents;
}
export const shippingSummary =
  "$5 US shipping; free on orders of $25 or more before tax.";
export const priceSummary = `Mix 4×4 and 4×6: up to 5 prints together for $12, plus shipping. Additional prints 50¢ each, up to 100 total. ${shippingSummary} Tax added before approval. Orders with fewer than 5 prints still cost $12; we print only the quantity you approve.`;

export const products = {
  prints: {
    name: "4 × 6 photo prints",
    label: "Photo prints",
    dimensions: "4 × 6 inches",
    emailImage: "/photos/poppy-email-yellow.jpg",
    finish: "lustre",
    sku: "GLOBAL-PHO-4X6",
    attributes: { finish: "lustre" },
    shortPixels: 1200,
    longPixels: 1800,
  },
  square: {
    name: "4 × 4 square prints", label: "Square prints", dimensions: "4 × 4 inches",
    emailImage: "/photos/poppy-email-yellow.jpg", finish: "lustre", sku: "GLOBAL-PHO-4X4",
    attributes: { finish: "lustre" }, shortPixels: 1200, longPixels: 1200,
  },
  enlargement: {
    name: "8 × 10 lustre print", label: "Large photo print", dimensions: "8 × 10 inches",
    emailImage: "/photos/poppy-email-yellow.jpg", finish: "lustre", sku: "GLOBAL-PHO-8X10",
    attributes: { finish: "lustre" }, shortPixels: 2400, longPixels: 3000,
  },
  poster: {
    name: "12 × 16 matte print",
    label: "Poster print",
    dimensions: "12 × 16 inches",
    emailImage: "/photos/poppy-email-red.jpg",
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
  product && product !== "prints" ? `${product}-${fit}` : fit;
export const posterPrice = 3500;
export const catalog = [
  { id: "square", name: products.square.name, minimumPrice: 1200, includedQuantity: 5, additionalPrintPrice: 50, maxQuantity: 100, pricingGroup: "small-prints" },
  { id: "enlargement", name: products.enlargement.name, price: 1200, maxQuantity: 100 },
  {
    id: "prints",
    pricingGroup: "small-prints",
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

export type ProductOrder = { product?: Product; items: { product?: Product; quantity: number }[] };
export const itemProduct = (order: { product?: Product }, item: { product?: Product }): Product => item.product ?? order.product ?? "prints";
export function orderProducts(order: ProductOrder) {
  const quantities = Object.fromEntries(Object.keys(products).map(product => [product, order.items.filter(i => itemProduct(order, i) === product).reduce((n, i) => n + i.quantity, 0)])) as Record<Product, number>;
  const smallCount = quantities.prints + quantities.square;
  const smallTotal = smallCount ? printSubtotal(smallCount) : 0;
  const printsTotal = smallCount ? Math.round(smallTotal * quantities.prints / smallCount) : 0;
  return (Object.keys(products) as Product[]).flatMap(product => {
    const quantity = quantities[product];
    const subtotal = product === "prints" ? printsTotal : product === "square" ? smallTotal - printsTotal : product === "enlargement" ? 1200 * quantity : posterPrice * quantity;
    return quantity ? [{ product, quantity, subtotal, ...products[product] }] : [];
  });
}
export const orderLabel = (order: ProductOrder) => orderProducts(order).map(p => `${p.quantity} × ${p.name}`).join(" + ");
