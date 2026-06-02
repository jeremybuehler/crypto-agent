import { describe, expect, it } from "vitest";
import { computeFeatures, type Candle } from "@agent/market-data";
import type { MarketSnapshot } from "@agent/core";

const market: MarketSnapshot = {
  productId: "BTC-USD",
  price: 102,
  bid: 101.9,
  ask: 102.1,
  spreadBps: 20,
  timestamp: new Date()
};

function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    productId: "BTC-USD",
    start: new Date(Date.now() - (closes.length - i) * 60_000),
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 10
  }));
}

describe("computeFeatures", () => {
  it("computes smaFast and smaSlow from the last 3 and 5 closes", () => {
    const candles = makeCandles([98, 99, 100, 101, 102]);
    const features = computeFeatures(candles, market);
    expect(features.smaFast).toBeCloseTo((100 + 101 + 102) / 3, 5);
    expect(features.smaSlow).toBeCloseTo((98 + 99 + 100 + 101 + 102) / 5, 5);
  });

  it("computes positive momentum when price rises over the window", () => {
    const candles = makeCandles([95, 97, 99, 101, 103]);
    const features = computeFeatures(candles, market);
    expect(features.momentumPct).toBeGreaterThan(0);
  });

  it("computes negative momentum when price falls over the window", () => {
    const candles = makeCandles([103, 101, 99, 97, 95]);
    const features = computeFeatures(candles, market);
    expect(features.momentumPct).toBeLessThan(0);
  });

  it("passes spreadBps through from the market snapshot", () => {
    const candles = makeCandles([98, 99, 100, 101, 102]);
    const features = computeFeatures(candles, market);
    expect(features.spreadBps).toBe(20);
  });

  it("throws when fewer than 5 candles are provided", () => {
    expect(() => computeFeatures(makeCandles([100, 101]), market)).toThrow("5 candles");
  });

  it("stamps productId from the market snapshot", () => {
    const candles = makeCandles([98, 99, 100, 101, 102]);
    const features = computeFeatures(candles, market);
    expect(features.productId).toBe("BTC-USD");
  });
});
