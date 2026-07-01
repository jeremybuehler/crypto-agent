import type { MarketSnapshot, ProductId } from "@agent/core";
export * from "./indicators.js";

export interface Candle {
  productId: ProductId;
  start: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FeatureSnapshot {
  productId: ProductId;
  generatedAt: Date;
  close: number;
  smaFast: number;
  smaSlow: number;
  momentumPct: number;
  volatilityPercentile: number;
  spreadBps: number;
}

export function computeFeatures(candles: Candle[], market: MarketSnapshot): FeatureSnapshot {
  if (candles.length < 5) {
    throw new Error("At least 5 candles are required to compute initial features.");
  }

  const closes = candles.map((candle) => candle.close);
  const smaFast = average(closes.slice(-3));
  const smaSlow = average(closes.slice(-5));
  const first = closes.at(-5);
  const last = closes.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("Unable to compute momentum from empty candles.");
  }

  const returns = closes.slice(1).map((close, index) => Math.abs((close - closes[index]!) / closes[index]!));
  const realizedVol = average(returns) * 100;

  return {
    productId: market.productId,
    generatedAt: new Date(),
    close: last,
    smaFast,
    smaSlow,
    momentumPct: ((last - first) / first) * 100,
    volatilityPercentile: Math.min(100, Math.round(realizedVol * 25)),
    spreadBps: market.spreadBps
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
