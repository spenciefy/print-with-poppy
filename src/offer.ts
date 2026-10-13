/** Shared by the public page, agent instructions and server quotes. USD cents. */
export const offer = {
  includedPrints: 5,
  baseCents: 1200,
  extraPrintCents: 50,
  maxPrints: 100,
  shippingCents: 0,
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
  return 0;
}
export const shippingSummary =
  "US shipping included.";
export const priceSummary = `Mix 4×4 and 4×6: up to 5 prints together for $12, including US shipping. Additional prints 50¢ each, up to 100 total. ${shippingSummary} Tax added before approval. Orders with fewer than 5 prints still cost $12; we print only the quantity you approve.`;

export const shirtColors = { white: "#f7f6f2", black: "#252525", "navy blue": "#27364c", orange: "#e97932", natural: "#e9ddc5" } as const;
export const shirtSizes = ["s", "m", "l", "xl"] as const;
export const shirtPrice = 2900;
export const extraShirtPrice = 1700;
export const maxShirts = 20;
export function shirtSubtotal(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxShirts) throw new RangeError("Choose 1–20 shirts.");
  return shirtPrice + (quantity - 1) * extraShirtPrice;
}
export const shirtPath = "M220 95 L290 65 Q350 115 410 65 L480 95 L595 190 L530 290 L480 260 L480 650 L220 650 L220 260 L170 290 L105 190 Z";
export const products = {
  tshirt: {
    name: "Custom T-shirt", label: "T-shirt", dimensions: "Bella+Canvas 3001 · front print",
    emailImage: "/photos/poppy-email-yellow.jpg", finish: "direct-to-garment", sku: "GLOBAL-TEE-BC-3001",
    attributes: {}, shortPixels: 4680, longPixels: 5790,
  },
  mug: {
    name: "11oz photo mug", label: "Photo mug", dimensions: "11oz · white ceramic",
    emailImage: "/photos/poppy-email-yellow.jpg", finish: "gloss ceramic", sku: "GLOBAL-MUG-W",
    attributes: { color: "white", size: "313ml / 11oz" }, shortPixels: 1110, longPixels: 2670,
  },
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
export const posterPrice = 2800;
export const mixedPhotoSaving = 500;
export function enlargementSubtotal(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > offer.maxPrints)
    throw new RangeError("Choose 1–100 prints.");
  return 1200 + (quantity - 1) * 300;
}
export const catalog = [
  { id: "square", name: products.square.name, minimumPrice: 1200, includedQuantity: 5, additionalPrintPrice: 50, maxQuantity: 100, pricingGroup: "small-prints" },
  { id: "enlargement", name: products.enlargement.name, minimumPrice: 1200, includedQuantity: 1, additionalPrintPrice: 300, additionalPrintPriceAppliesAfter: 1, maxQuantity: 100 },
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
  { id: "tshirt", name: products.tshirt.name, minimumPrice: shirtPrice, includedQuantity: 1, additionalShirtPrice: extraShirtPrice, maxQuantity: maxShirts, easterEgg: true, colors: Object.keys(shirtColors), sizes: shirtSizes, description: "Optional custom front-print T-shirt. First shirt $29, each additional shirt $17. Mix sizes and colors with a separate item and quantity for each combination. Ask for photo, color, size quantities together. Show all returned shirt mockups and record explicit user approval using approveShirtPreviews before confirmOperation; it is an approximate illustration. US shipping included; may ship separately. Only offer when asked about T-shirts or hidden extras." },
];

export type ProductOrder = { product?: Product; items: { product?: Product; quantity: number; color?: string; size?: string }[] };
export const itemProduct = (order: { product?: Product }, item: { product?: Product }): Product => item.product ?? order.product ?? "prints";
export function orderProducts(order: ProductOrder) {
  const quantities = Object.fromEntries(Object.keys(products).map(product => [product, order.items.filter(i => itemProduct(order, i) === product).reduce((n, i) => n + i.quantity, 0)])) as Record<Product, number>;
  const smallCount = quantities.prints + quantities.square;
  const smallTotal = smallCount ? printSubtotal(smallCount) - (quantities.enlargement ? mixedPhotoSaving : 0) : 0;
  const printsTotal = smallCount ? Math.round(smallTotal * quantities.prints / smallCount) : 0;
  return (Object.keys(products) as Product[]).flatMap(product => {
    const quantity = quantities[product];
    if (product === "tshirt" && quantity) {
      const variants = new Map<string, { color?: string; size?: string; quantity: number }>();
      for (const item of order.items.filter(i => itemProduct(order, i) === "tshirt")) {
        const key = `${item.color}:${item.size}`;
        const previous = variants.get(key);
        variants.set(key, { color: item.color, size: item.size, quantity: (previous?.quantity || 0) + item.quantity });
      }
      let allocated = 0;
      return [...variants.values()].map((item, index) => {
        const subtotal = index === variants.size - 1 ? shirtSubtotal(quantity) - allocated : Math.floor(shirtSubtotal(quantity) * item.quantity / quantity);
        allocated += subtotal;
        return { product, ...products[product], quantity: item.quantity, subtotal, attributes: { color: item.color!, size: item.size! }, name: `Custom T-shirt · ${item.color} · ${item.size?.toUpperCase()}` };
      });
    }
    const subtotal = !quantity ? 0 : product === "prints" ? printsTotal : product === "square" ? smallTotal - printsTotal : product === "enlargement" ? enlargementSubtotal(quantity) : product === "tshirt" ? shirtPrice * quantity : product === "mug" ? 2200 * quantity : posterPrice * quantity;
    const shirt = product === "tshirt" ? order.items.find(i => itemProduct(order, i) === "tshirt") : undefined;
    return quantity ? [{ product, quantity, subtotal, ...products[product], ...(shirt ? { attributes: { color: shirt.color!, size: shirt.size! }, name: `Custom T-shirt · ${shirt.color} · ${shirt.size?.toUpperCase()}` } : {}) }] : [];
  });
}
export const orderLabel = (order: ProductOrder) => orderProducts(order).map(p => `${p.quantity} × ${p.name}`).join(" + ");

export const merchandiseLabel = (order: ProductOrder) => orderProducts(order).some(g => ["mug", "tshirt"].includes(g.product)) ? "Items" : "Prints";

export const itemAttributes = (product: Product, item: { color?: string; size?: string }) => product === "tshirt" ? { color: item.color!, size: item.size! } : products[product].attributes;
export const previewVariant = (product: Product | undefined, fit: string, color?: string) => product === "tshirt" ? `tshirt-preview-${color?.replace(/ /g, "-")}-${fit}` : mediaVariant(product, fit);
export const shirtMediaVariants = ["contain", "cover"].flatMap(fit => [`tshirt-${fit}`, ...Object.keys(shirtColors).map(color => previewVariant("tshirt", fit, color))]);
