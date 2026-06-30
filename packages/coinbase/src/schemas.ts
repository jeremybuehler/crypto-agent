/**
 * Zod schemas for untrusted Coinbase Advanced Trade responses. Coinbase returns
 * monetary values as strings; we coerce to numbers at the boundary and validate
 * the fields we depend on. Unknown extra fields are stripped (not rejected) so a
 * benign API addition doesn't break parsing, but every field we *use* is typed.
 *
 * Per CLAUDE.md rule 7, no exchange response is trusted without parsing through
 * one of these schemas.
 */
import { z } from "zod";

const NumericString = z.coerce.number();

export const OrderPreviewResponseSchema = z.object({
  order_total: NumericString,
  commission_total: NumericString,
  quote_size: NumericString,
  base_size: NumericString,
  best_bid: NumericString.optional(),
  best_ask: NumericString.optional(),
  // Coinbase surfaces blocking conditions here; a non-empty errs is a refusal.
  errs: z.array(z.string()).default([]),
  warning: z.array(z.string()).default([])
});
export type OrderPreviewResponse = z.infer<typeof OrderPreviewResponseSchema>;

export const CreateOrderResponseSchema = z.object({
  success: z.boolean(),
  success_response: z
    .object({
      order_id: z.string(),
      product_id: z.string().optional(),
      side: z.enum(["BUY", "SELL"]).optional(),
      client_order_id: z.string().optional()
    })
    .optional(),
  error_response: z
    .object({
      error: z.string().optional(),
      message: z.string().optional(),
      error_details: z.string().optional()
    })
    .optional()
});
export type CreateOrderResponse = z.infer<typeof CreateOrderResponseSchema>;

export const FillSchema = z.object({
  entry_id: z.string().optional(),
  trade_id: z.string().optional(),
  order_id: z.string(),
  product_id: z.string(),
  price: NumericString,
  size: NumericString,
  commission: NumericString,
  side: z.enum(["BUY", "SELL"]),
  trade_time: z.string().optional()
});
export type CoinbaseFill = z.infer<typeof FillSchema>;

export const ListFillsResponseSchema = z.object({
  fills: z.array(FillSchema).default([])
});

export const OrderSchema = z.object({
  order_id: z.string(),
  product_id: z.string(),
  status: z.string(),
  side: z.enum(["BUY", "SELL"]).optional()
});
export type CoinbaseOrder = z.infer<typeof OrderSchema>;

export const ListOrdersResponseSchema = z.object({
  orders: z.array(OrderSchema).default([])
});

export const CancelOrdersResponseSchema = z.object({
  results: z
    .array(
      z.object({
        success: z.boolean(),
        order_id: z.string(),
        failure_reason: z.string().optional()
      })
    )
    .default([])
});

export const AccountSchema = z.object({
  uuid: z.string(),
  currency: z.string(),
  available_balance: z.object({ value: NumericString, currency: z.string() })
});

export const ListAccountsResponseSchema = z.object({
  accounts: z.array(AccountSchema).default([])
});
