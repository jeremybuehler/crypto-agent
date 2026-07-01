import { describe, expect, it } from "vitest";
import {
  sma,
  ema,
  rsi,
  macd,
  bollingerBands,
  atr,
  donchianChannel
} from "@agent/market-data";
import type { Candle } from "@agent/market-data";

function candle(over: Partial<Candle> & { close: number }): Candle {
  const c = over.close;
  return {
    productId: "BTC-USD",
    start: new Date("2026-07-01T00:00:00.000Z"),
    open: over.open ?? c,
    high: over.high ?? c,
    low: over.low ?? c,
    close: c,
    volume: over.volume ?? 1
  };
}

const rising = Array.from({ length: 30 }, (_, i) => 100 + i); // strictly increasing
const falling = Array.from({ length: 30 }, (_, i) => 130 - i); // strictly decreasing
const flat = Array.from({ length: 30 }, () => 100);

describe("sma / ema", () => {
  it("sma is the arithmetic mean of the last period", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBeCloseTo(3, 10);
    expect(sma([2, 4, 6], 2)).toBeCloseTo(5, 10);
  });
  it("ema of a constant series equals the constant", () => {
    expect(ema([7, 7, 7, 7, 7], 3)).toBeCloseTo(7, 10);
  });
  it("ema reacts faster than sma to a recent jump", () => {
    // Flat, then a step up: EMA weights the recent higher prices more than SMA.
    const stepped = [...Array(20).fill(100), ...Array(5).fill(110)];
    expect(ema(stepped, 10)).toBeGreaterThan(sma(stepped, 10));
  });
});

describe("rsi (Wilder)", () => {
  it("is 100 for a strictly rising series (all gains)", () => {
    expect(rsi(rising, 14)).toBeCloseTo(100, 6);
  });
  it("is 0 for a strictly falling series (all losses)", () => {
    expect(rsi(falling, 14)).toBeCloseTo(0, 6);
  });
  it("is 50 (neutral) for a flat series", () => {
    expect(rsi(flat, 14)).toBeCloseTo(50, 6);
  });
  it("always stays within [0, 100]", () => {
    const mixed = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    const value = rsi(mixed, 14);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(100);
    expect(value).toBeGreaterThan(50); // more/larger gains than losses
  });
});

describe("macd", () => {
  it("is all zero for a constant series", () => {
    const m = macd(flat);
    expect(m.macd).toBeCloseTo(0, 8);
    expect(m.signal).toBeCloseTo(0, 8);
    expect(m.histogram).toBeCloseTo(0, 8);
  });
  it("has a positive macd line for a sustained uptrend", () => {
    expect(macd(rising).macd).toBeGreaterThan(0);
  });
});

describe("bollingerBands", () => {
  it("collapses to the mean for a constant series", () => {
    const b = bollingerBands(flat, 20, 2);
    expect(b.upper).toBeCloseTo(100, 8);
    expect(b.middle).toBeCloseTo(100, 8);
    expect(b.lower).toBeCloseTo(100, 8);
  });
  it("brackets the mean with upper > middle > lower when there is variance", () => {
    const b = bollingerBands(rising, 20, 2);
    expect(b.upper).toBeGreaterThan(b.middle);
    expect(b.middle).toBeGreaterThan(b.lower);
  });
});

describe("atr", () => {
  it("equals the constant range for candles with a fixed high-low and no gaps", () => {
    const candles = Array.from({ length: 20 }, () => candle({ close: 100, high: 102, low: 98 }));
    expect(atr(candles, 14)).toBeCloseTo(4, 6);
  });
});

describe("donchianChannel", () => {
  it("returns the highest high and lowest low over the period", () => {
    const candles = [90, 110, 95, 105, 100].map((c) => candle({ close: c, high: c + 1, low: c - 1 }));
    const d = donchianChannel(candles, 5);
    expect(d.upper).toBeCloseTo(111, 6); // 110 + 1
    expect(d.lower).toBeCloseTo(89, 6); // 90 - 1
  });
});
