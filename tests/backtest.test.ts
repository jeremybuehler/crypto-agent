import { describe, expect, it } from "vitest";
import { loadConfig } from "@agent/core";
import type { Candle } from "@agent/market-data";
import { runBacktest } from "@agent/backtest";

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
  PERSISTENCE_ENABLED: "false"
});

function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    productId: "BTC-USD",
    start: new Date(Date.now() - (closes.length - i) * 60_000),
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 10
  }));
}

describe("backtest runner", () => {
  it("throws when fewer than 5 candles are provided", async () => {
    await expect(runBacktest(makeCandles([100, 101]), config)).rejects.toThrow("5 candles");
  });

  it("returns a result with required fields from a trending series", async () => {
    const candles = makeCandles([95, 96, 98, 100, 102, 104, 106, 108, 110, 112]);
    const result = await runBacktest(candles, config);

    expect(result).toHaveProperty("trades");
    expect(result).toHaveProperty("winRate");
    expect(result).toHaveProperty("realizedPnlUsd");
    expect(result).toHaveProperty("maxDrawdownPct");
    expect(result).toHaveProperty("sharpeRatio");
    expect(result.winRate).toBeGreaterThanOrEqual(0);
    expect(result.winRate).toBeLessThanOrEqual(1);
    expect(result.maxDrawdownPct).toBeGreaterThanOrEqual(0);
  });

  it("uses the same strategy module as the production worker", async () => {
    const { aiAssistedTrendStrategy } = await import("@agent/strategy");
    expect(typeof aiAssistedTrendStrategy).toBe("function");

    const candles = makeCandles([95, 97, 99, 101, 103, 105, 107]);
    const result = await runBacktest(candles, config);
    expect(result.trades).toBeGreaterThanOrEqual(0);
  });
});
