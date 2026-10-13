/** Store integration, separate from whether the customer signed into an account. */
export type OrderingMethod = "native-poppy" | "http-compatibility" | "visual-demo";
export function orderingMethodLabel(method?: OrderingMethod) {
  switch (method) {
    case "native-poppy": return "Ordered via Personal Agent Protocol";
    case "http-compatibility": return "Ordered via HTTP compatibility · without Personal Agent Protocol";
    case "visual-demo": return "Visual demo order";
    default: return "";
  }
}
