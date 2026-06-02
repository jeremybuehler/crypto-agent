import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@agent/core";
import { CoinbasePublicMarketData } from "@agent/coinbase";

const config = loadConfig({
  TRADING_MODE: "paper",
  ENABLED_PRODUCTS: "BTC-USD",
  MAX_TRADE_NOTIONAL_USD: "25",
  MAX_PRODUCT_EXPOSURE_PCT: "10",
  MAX_TOTAL_EXPOSURE_PCT: "20",
  MAX_DAILY_LOSS_PCT: "1",
  MIN_SECONDS_BETWEEN_TRADES: "1800",
  ALLOW_SHORTS: "false",
  ALLOW_LEVERAGE: "false",
  REQUIRE_ORDER_PREVIEW: "true",
  PERSISTENCE_ENABLED: "false",
  COINBASE_REST_BASE_URL: "https://api.coinbase.test/api/v3/brokerage"
});

describe("CoinbasePublicMarketData", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps public candle responses into chronological candles", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candles: [
        { start: "120", low: "99", high: "105", open: "100", close: "104", volume: "2" },
        { start: "60", low: "98", high: "102", open: "99", close: "101", volume: "1" }
      ]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const marketData = new CoinbasePublicMarketData(config.coinbase);
    const candles = await marketData.getCandles({
      productId: "BTC-USD",
      granularity: "ONE_MINUTE",
      limit: 2,
      end: new Date(180_000)
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.coinbase.test/api/v3/brokerage/market/products/BTC-USD/candles?start=60&end=180&granularity=ONE_MINUTE&limit=2",
      expect.objectContaining({ method: "GET" })
    );
    expect(candles.map((candle) => candle.close)).toEqual([101, 104]);
  });

  it("maps product book into a market snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      pricebook: {
        product_id: "BTC-USD",
        bids: [{ price: "100", size: "1" }],
        asks: [{ price: "101", size: "1" }],
        time: "2026-05-21T02:00:00.000Z"
      }
    }), { status: 200 })));

    const marketData = new CoinbasePublicMarketData(config.coinbase);
    const snapshot = await marketData.getBestBidAsk("BTC-USD");

    expect(snapshot.price).toBe(100.5);
    expect(snapshot.spreadBps).toBeCloseTo(99.50249, 5);
    expect(snapshot.timestamp.toISOString()).toBe("2026-05-21T02:00:00.000Z");
  });
});
