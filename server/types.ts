import { z } from "zod";
const short = z.string().trim().min(1).max(150);
export const addressSchema = z
  .object({
    name: short,
    line1: short,
    line2: z.string().trim().max(150).default(""),
    city: short,
    state: z.string().regex(/^[A-Z]{2}$/),
    postalCode: z.string().regex(/^\d{5}(-\d{4})?$/),
    country: z.literal("US"),
  })
  .strict();
export const proposalSchema = z
  .object({
    email: z.email().max(254),
    address: addressSchema,
    items: z
      .array(
        z
          .object({
            photoId: short,
            quantity: z.number().int().min(1).max(100),
            fit: z.enum(["contain", "cover"]).default("contain"),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (x) => x.items.reduce((s, i) => s + i.quantity, 0) <= 100,
    "Maximum 100 prints per order.",
  );
export type Proposal = z.infer<typeof proposalSchema>;
export interface Session {
  id: string;
  clientId: string;
  userId: string;
  extensions: boolean;
  demo?: boolean;
  created: number;
}
export interface Photo {
  id: string;
  owner: string;
  name: string;
  width: number;
  height: number;
  lowResolution: boolean;
  created: number;
  deleted?: boolean;
}
export interface Quote extends Proposal {
  id: string;
  owner: string;
  created: number;
  expires: number;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  currency: "USD";
  taxCalculationId?: string;
  estimate: string;
  finish: string;
  shippingMethod: string;
  summary: string;
  previews: {
    photoId: string;
    url: string;
    name: string;
    quantity: number;
    fit: string;
  }[];
}
export interface Operation {
  owner: string;
  operation_id: string;
  revision: number;
  state:
    | "proposed"
    | "in_progress"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "expired";
  summary: string;
  terms: Quote;
  expires_at: string;
  user_approval_required: true;
  confirmation: null | {
    revision: number;
    approved_by: "user";
    confirmed_at: string;
  };
  result: null | { summary: string; data?: Record<string, unknown> };
  orderId?: string;
}
export interface Shipment {
  id: string;
  status: string;
  carrier?: { name?: string; service?: string };
  tracking?: { url?: string; number?: string };
  dispatchDate?: string;
}
export interface Order {
  id: string;
  owner: string;
  operationId: string;
  quote: Quote;
  created: number;
  status:
    | "awaiting_payment"
    | "expired"
    | "paid"
    | "submitted"
    | "printing"
    | "partially_shipped"
    | "shipped"
    | "cancelled"
    | "attention";
  viewToken: string;
  checkoutId?: string;
  checkoutUrl?: string;
  checkoutExpires?: number;
  paidAt?: number;
  prodigiId?: string;
  shipments: Shipment[];
  providerStage?: string;
  lastSync?: number;
  shippedAt?: number;
  issue?: string;
  taxTransactionId?: string;
}
export const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
export const addressText = (a: Proposal["address"]) =>
  [a.name, a.line1, a.line2, `${a.city}, ${a.state} ${a.postalCode}`, a.country]
    .filter(Boolean)
    .join(", ");
