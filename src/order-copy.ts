export function orderSubtitle(status: string) {
  switch (status) {
    case "awaiting_payment":
      return "Complete payment to send your prints to the lab.";
    case "expired":
      return "This checkout is closed. Ask your agent for a new quote.";
    case "paid":
    case "submitted":
    case "printing":
      return "We’ll email you when your prints ship.";
    case "partially_shipped":
      return "Part of your order has shipped. See each package below.";
    case "shipped":
      return "Your prints have shipped. Tracking is shown below when available.";
    case "cancelled":
      return "Your order was cancelled. Contact us about a refund or reprint.";
    case "attention":
      return "There’s an issue with your order. Contact us for help.";
    default:
      return "Check below for the latest order status.";
  }
}
