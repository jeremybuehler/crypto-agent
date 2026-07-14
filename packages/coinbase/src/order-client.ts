/**
 * Typed Coinbase Advanced Trade order client. Every response is parsed through a
 * Zod schema (untrusted boundary), errors are redacted before they propagate
 * (no raw exchange payloads in logs), and create-order is idempotent via a
 * caller-supplied client_order_id. The HTTP request function is injected so the
 * client is testable without network or credentials.
 */
import {
  CancelOrdersResponseSchema,
  CreateOrderResponseSchema,
  ListAccountsResponseSchema,
  ListFillsResponseSchema,
  ListOrdersResponseSchema,
  OrderPreviewResponseSchema,
  type CoinbaseFill,
  type CoinbaseOrder,
  type OrderPreviewResponse
} from "./schemas.js";

export interface CoinbaseRequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: `/${string}`;
  body?: unknown;
}

export type CoinbaseRequestFn = (options: CoinbaseRequestOptions) => Promise<unknown>;

/** Carries only a safe, generic message — never the raw exchange payload. */
export class CoinbaseExecutionError extends Error {
  constructor(public readonly operation: string, message: string) {
    super(message);
    this.name = "CoinbaseExecutionError";
  }
}

export interface OrderRequest {
  clientOrderId: string;
  productId: string;
  side: "BUY" | "SELL";
  /** Quote (USD) size — used for BUY market orders. */
  quoteSizeUsd: number;
  /** Base (crypto) size — required for SELL market orders (see below). */
  baseSize?: number;
}

/**
 * Format a decimal amount as a plain string for Coinbase (no scientific
 * notation, no over-precision that trips increment rules). Coinbase applies
 * product-specific increments; these ceilings are conservative defaults —
 * quote in cents, base to 8dp — and the sandbox smoke test validates the exact
 * shape per product.
 */
export function formatAmount(value: number, maxDecimals: number): string {
  if (!Number.isFinite(value)) throw new CoinbaseExecutionError("formatAmount", "Non-finite order amount.");
  const fixed = value.toFixed(maxDecimals);
  // Trim trailing zeros / a dangling decimal point.
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

export class CoinbaseOrderClient {
  constructor(private readonly request: CoinbaseRequestFn) {}

  /**
   * The product/side/size body shared by preview and create. It deliberately
   * omits `client_order_id`: the Coinbase `/orders/preview` endpoint rejects that
   * field ("unknown field client_order_id", HTTP 400). `createOrder` adds it for
   * the `/orders` call, which requires it for idempotency.
   */
  private orderConfiguration(order: OrderRequest) {
    // Market IOC, spot only. Coinbase expects string amounts. A market BUY is
    // specified by quote_size (USD); a market SELL by base_size (crypto), which
    // is the convention Advanced Trade accepts for reducing a position.
    let marketConfig: { quote_size: string } | { base_size: string };
    if (order.side === "SELL") {
      if (order.baseSize === undefined) {
        throw new CoinbaseExecutionError("orderConfiguration", "A market SELL requires baseSize.");
      }
      marketConfig = { base_size: formatAmount(order.baseSize, 8) };
    } else {
      marketConfig = { quote_size: formatAmount(order.quoteSizeUsd, 2) };
    }
    return {
      product_id: order.productId,
      side: order.side,
      order_configuration: { market_market_ioc: marketConfig }
    };
  }

  async previewOrder(order: OrderRequest): Promise<OrderPreviewResponse> {
    const raw = await this.call("previewOrder", { method: "POST", path: "/orders/preview", body: this.orderConfiguration(order) });
    const preview = OrderPreviewResponseSchema.parse(raw);
    if (preview.errs.length > 0) {
      // Do not echo exchange error strings; surface a generic refusal.
      throw new CoinbaseExecutionError("previewOrder", "Coinbase preview returned blocking conditions.");
    }
    return preview;
  }

  /**
   * Preview, then create only if the preview is clean. Idempotent: re-sending the
   * same client_order_id will not place a second order.
   */
  async createOrder(order: OrderRequest): Promise<{ orderId: string }> {
    await this.previewOrder(order);
    const raw = await this.call("createOrder", {
      method: "POST",
      path: "/orders",
      body: { client_order_id: order.clientOrderId, ...this.orderConfiguration(order) }
    });
    const result = CreateOrderResponseSchema.parse(raw);
    if (!result.success || !result.success_response) {
      throw new CoinbaseExecutionError("createOrder", "Coinbase rejected the order.");
    }
    return { orderId: result.success_response.order_id };
  }

  async cancelOrders(orderIds: string[]): Promise<{ cancelled: string[]; failed: string[] }> {
    const raw = await this.call("cancelOrders", { method: "POST", path: "/orders/batch_cancel", body: { order_ids: orderIds } });
    const result = CancelOrdersResponseSchema.parse(raw);
    const cancelled = result.results.filter((r) => r.success).map((r) => r.order_id);
    const failed = result.results.filter((r) => !r.success).map((r) => r.order_id);
    return { cancelled, failed };
  }

  async listOpenOrders(): Promise<CoinbaseOrder[]> {
    const raw = await this.call("listOpenOrders", { method: "GET", path: "/orders/historical/batch?order_status=OPEN" });
    return ListOrdersResponseSchema.parse(raw).orders;
  }

  /**
   * Fetch fills, optionally scoped to one order. IOC market orders settle as one
   * or more fills; callers aggregate them for the executed price/size/fee. The
   * endpoint has no order filter guarantee across API versions, so we also
   * filter client-side by order_id as a backstop.
   */
  async getFills(orderId?: string): Promise<CoinbaseFill[]> {
    const path = orderId
      ? (`/orders/historical/fills?order_id=${encodeURIComponent(orderId)}&limit=100` as const)
      : ("/orders/historical/fills" as const);
    const raw = await this.call("getFills", { method: "GET", path });
    const fills = ListFillsResponseSchema.parse(raw).fills;
    return orderId ? fills.filter((fill) => fill.order_id === orderId) : fills;
  }

  async getAccounts() {
    const raw = await this.call("getAccounts", { method: "GET", path: "/accounts" });
    return ListAccountsResponseSchema.parse(raw).accounts;
  }

  private async call(operation: string, options: CoinbaseRequestOptions): Promise<unknown> {
    try {
      return await this.request(options);
    } catch (error) {
      // Redact: the underlying error may include URLs, tokens, or payloads.
      throw new CoinbaseExecutionError(operation, `Coinbase ${operation} request failed.`);
    }
  }
}
