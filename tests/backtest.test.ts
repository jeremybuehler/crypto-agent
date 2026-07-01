import { describe, expect, it } from "vitest";
import { loadConfig } from "@agent/core";
import type { Candle } from "@agent/market-data";
import { createStrategy } from "@agent/strategy";
import { runBacktest } from "@agent/backtest";

const config = loadConfig({
  TRADING_MODE: "paper",
  ENABLED_PRODUCTS: "BTC-USD",
  MAX_TRADE_NOTIONAL_USD: "25",
  MAX_PRODUCT_EXPOSURE_PCT: "10",
  MAX_TOTAL_EXPOSURE_PCT: "20",
  MAX_DAILY_LOSS_PCT: "1",
  MIN_SECONDS_BETWEEN_TRADES: "0",
  PERSISTENCE_ENABLED: "false"
});

function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    productId: "BTC-USD",
    start: new Date(Date.now() - (closes.length - i) * 60_000),
    open: i === 0 ? close : closes[i - 1]!,
    high: close + 2,
    low: close - 2,
    close,
    volume: 10
  }));
}

// A 60-bar oscillation gives the indicators enough history and produces both
// entries and exits.
const oscillating = makeCandles(Array.from({ length: 60 }, (_, i) => 100 + 5 * Math.sin((i * 2 * Math.PI) / 20)));

describe("backtest runner", () => {
  it("throws when there is not enough history to warm up indicators", async () => {
    await expect(runBacktest(makeCandles([100, 101, 102]), config)).rejects.toThrow("30 candles");
  });

  it("returns a full result including a buy-and-hold baseline", async () => {
    const result = await runBacktest(oscillating, config, createStrategy("mean-reversion"));
    expect(result.strategy).toBe("mean-reversion");
    expect(result.winRate).toBeGreaterThanOrEqual(0);
    expect(result.winRate).toBeLessThanOrEqual(1);
    expect(result.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(result).toHaveProperty("totalReturnPct");
    expect(result).toHaveProperty("buyHoldReturnPct");
    expect(result).toHaveProperty("sharpeRatio");
  });

  it("runs each registered strategy and reports which one ran", async () => {
    for (const name of ["trend", "mean-reversion", "breakout"] as const) {
      const result = await runBacktest(oscillating, config, createStrategy(name));
      expect(result.strategy).toBe(name);
      expect(result.trades).toBeGreaterThanOrEqual(0);
    }
  });
});
