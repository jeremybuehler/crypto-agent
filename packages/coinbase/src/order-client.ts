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
  quoteSizeUsd: number;
}

export class CoinbaseOrderClient {
  constructor(private readonly request: CoinbaseRequestFn) {}

  private orderConfiguration(order: OrderRequest) {
    // Market order by quote size (spot only). Coinbase expects string amounts.
    return {
      client_order_id: order.clientOrderId,
      product_id: order.productId,
      side: order.side,
      order_configuration: { market_market_ioc: { quote_size: order.quoteSizeUsd.toString() } }
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
    const raw = await this.call("createOrder", { method: "POST", path: "/orders", body: this.orderConfiguration(order) });
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

  async getFills(): Promise<CoinbaseFill[]> {
    const raw = await this.call("getFills", { method: "GET", path: "/orders/historical/fills" });
    return ListFillsResponseSchema.parse(raw).fills;
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
