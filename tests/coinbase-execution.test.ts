import { describe, expect, it, vi } from "vitest";
import { CoinbaseOrderClient, CoinbaseExecutionError } from "@agent/coinbase";

const order = { clientOrderId: "cid-1", productId: "BTC-USD", side: "BUY" as const, quoteSizeUsd: 25 };

const cleanPreview = { order_total: "25", commission_total: "0.15", quote_size: "25", base_size: "0.00041", errs: [], warning: [] };

describe("CoinbaseOrderClient", () => {
  it("parses a preview and rejects one with blocking errs", async () => {
    const ok = new CoinbaseOrderClient(async () => cleanPreview);
    const preview = await ok.previewOrder(order);
    expect(preview.commission_total).toBeCloseTo(0.15, 6);
    expect(preview.base_size).toBeCloseTo(0.00041, 8);

    const blocked = new CoinbaseOrderClient(async () => ({ ...cleanPreview, errs: ["INSUFFICIENT_FUND"] }));
    await expect(blocked.previewOrder(order)).rejects.toBeInstanceOf(CoinbaseExecutionError);
  });

  it("previews before creating and returns the order id", async () => {
    const request = vi.fn(async (opts: { path: string }) => {
      if (opts.path === "/orders/preview") return cleanPreview;
      return { success: true, success_response: { order_id: "ord-123" } };
    });
    const client = new CoinbaseOrderClient(request);
    const result = await client.createOrder(order);
    expect(result.orderId).toBe("ord-123");
    // preview-before-create: preview is hit first, then the order.
    expect(request.mock.calls[0][0].path).toBe("/orders/preview");
    expect(request.mock.calls[1][0].path).toBe("/orders");
  });

  it("sends the client_order_id for idempotency", async () => {
    const request = vi.fn(async (opts: { path: string; body?: unknown }) => {
      if (opts.path === "/orders/preview") return cleanPreview;
      return { success: true, success_response: { order_id: "ord-1" } };
    });
    const client = new CoinbaseOrderClient(request);
    await client.createOrder(order);
    const createBody = request.mock.calls[1][0].body as { client_order_id: string };
    expect(createBody.client_order_id).toBe("cid-1");
  });

  it("throws a redacted error when create fails, never echoing the payload", async () => {
    const client = new CoinbaseOrderClient(async (opts: { path: string }) => {
      if (opts.path === "/orders/preview") return cleanPreview;
      return { success: false, error_response: { error: "SECRET_INTERNAL", message: "leak me" } };
    });
    await expect(client.createOrder(order)).rejects.toMatchObject({ name: "CoinbaseExecutionError" });
    await client.createOrder(order).catch((e: Error) => {
      expect(e.message).not.toContain("leak me");
      expect(e.message).not.toContain("SECRET_INTERNAL");
    });
  });

  it("redacts transport failures", async () => {
    const client = new CoinbaseOrderClient(async () => {
      throw new Error("connect ECONNREFUSED 1.2.3.4:443 token=abc");
    });
    await client.getAccounts().catch((e: Error) => {
      expect(e).toBeInstanceOf(CoinbaseExecutionError);
      expect(e.message).not.toContain("token=abc");
    });
  });

  it("parses fills and cancellations", async () => {
    const client = new CoinbaseOrderClient(async (opts: { path: string }) => {
      if (opts.path.startsWith("/orders/historical/fills")) {
        return { fills: [{ order_id: "o1", product_id: "BTC-USD", price: "100", size: "0.5", commission: "0.1", side: "BUY" }] };
      }
      return { results: [{ success: true, order_id: "o1" }, { success: false, order_id: "o2", failure_reason: "UNKNOWN" }] };
    });
    const fills = await client.getFills();
    expect(fills[0]?.price).toBe(100);
    const cancel = await client.cancelOrders(["o1", "o2"]);
    expect(cancel.cancelled).toEqual(["o1"]);
    expect(cancel.failed).toEqual(["o2"]);
  });
});
