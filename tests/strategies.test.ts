import { describe, expect, it } from "vitest";
import { loadConfig, type AgentConfig, type MarketSnapshot, type PortfolioState } from "@agent/core";
import type { AIContext } from "@agent/ai";
import type { Candle } from "@agent/market-data";
import {
  breakoutStrategy,
  createStrategy,
  meanReversionStrategy,
  runStrategy,
  trendStrategy,
  type StrategyContext
} from "@agent/strategy";

const config: AgentConfig = loadConfig({ TRADING_MODE: "paper", PERSISTENCE_ENABLED: "false" });

const okAi: AIContext = {
  marketRegime: "unknown",
  summary: "",
  riskNotes: [],
  bullishFactors: [],
  bearishFactors: [],
  doNotTrade: false,
  doNotTradeReasons: [],
  confidence: 0.5
};

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    productId: "BTC-USD",
    start: new Date(Date.now() - (closes.length - i) * 60_000),
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1
  }));
}

function ctx(closes: number[], opts: { price?: number; position?: boolean; ai?: Partial<AIContext> } = {}): StrategyContext {
  const price = opts.price ?? closes[closes.length - 1]!;
  const market: MarketSnapshot = { productId: "BTC-USD", price, bid: price * 0.999, ask: price * 1.001, spreadBps: 5, timestamp: new Date() };
  const portfolio: PortfolioState = {
    equityUsd: 1000,
    cashUsd: 1000,
    dailyPnlPct: 0,
    totalExposurePct: opts.position ? 2.5 : 0,
    positions: opts.position ? [{ productId: "BTC-USD", baseSize: 0.01, notionalUsd: 25, exposurePct: 2.5, averageEntryPrice: price }] : []
  };
  return { candles: candlesFromCloses(closes), market, portfolio, config, aiContext: { ...okAi, ...opts.ai } };
}

// Accelerating up/down so momentum (MACD histogram) is clearly positive/negative,
// which is what a momentum strategy enters on (a steady linear trend has ~0
// histogram by design).
const accelUp = Array.from({ length: 30 }, (_, i) => 100 + (i * i) / 8);
const accelDown = Array.from({ length: 30 }, (_, i) => 205 - (i * i) / 8);
const uptrend = Array.from({ length: 30 }, (_, i) => 100 + i * 2); // steady, not oversold
const oversold = [...Array(15).fill(100), 99, 98, 96, 93, 89, 84, 78, 71, 63, 54, 44]; // sharp recent drop
const flat = Array.from({ length: 30 }, () => 100);

describe("trendStrategy", () => {
  it("BUYs a confirmed uptrend with no position", () => {
    const s = trendStrategy.evaluate(ctx(accelUp));
    expect(s?.side).toBe("BUY");
    expect(s?.rationale).toMatch(/EMA/);
  });
  it("SELLs (reduces) when the trend flips down and a position is held", () => {
    const s = trendStrategy.evaluate(ctx(accelDown, { position: true }));
    expect(s?.side).toBe("SELL");
  });
  it("does nothing on a flat market", () => {
    expect(trendStrategy.evaluate(ctx(flat))).toBeNull();
  });
  it("respects the AI veto", () => {
    expect(trendStrategy.evaluate(ctx(accelUp, { ai: { doNotTrade: true } }))).toBeNull();
  });
});

describe("meanReversionStrategy", () => {
  it("BUYs when oversold and price is at/below the lower band", () => {
    const s = meanReversionStrategy.evaluate(ctx(oversold));
    expect(s?.side).toBe("BUY");
    expect(s?.rationale).toMatch(/oversold|Bollinger/i);
  });
  it("does not BUY a calm uptrend (not oversold)", () => {
    expect(meanReversionStrategy.evaluate(ctx(uptrend))).toBeNull();
  });
});

describe("breakoutStrategy", () => {
  it("BUYs when price breaks above the recent range", () => {
    // 21 flat bars, then price jumps above the prior 20-bar high.
    const closes = [...Array(21).fill(100)];
    const s = breakoutStrategy.evaluate(ctx(closes, { price: 108 }));
    expect(s?.side).toBe("BUY");
    expect(s?.rationale).toMatch(/broke above/);
  });
  it("does nothing when price stays inside the range", () => {
    expect(breakoutStrategy.evaluate(ctx([...Array(21).fill(100)], { price: 100 }))).toBeNull();
  });
});

describe("registry + runStrategy", () => {
  it("resolves strategies by name and rejects unknown ones", () => {
    expect(createStrategy("mean-reversion").name).toBe("mean-reversion");
    expect(() => createStrategy("nope")).toThrow();
  });
  it("converts a signal into a sized TradeIntent carrying the rationale", () => {
    const intent = runStrategy(trendStrategy, ctx(accelUp));
    expect(intent?.side).toBe("BUY");
    expect(intent?.quoteSizeUsd).toBe(config.risk.maxTradeNotionalUsd);
    expect(intent?.strategyVersion).toBe("trend-ema-macd-v1");
    expect(intent?.rationale).toBeTruthy();
  });
});
