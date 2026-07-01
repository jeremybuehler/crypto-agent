/**
 * Real, deterministic trading strategies built on standard technical
 * indicators. Each strategy is a pure decision function: given recent candles,
 * the market, and the current position, it returns a signal (or null) with a
 * plain-English rationale so an operator can learn *why* it acted.
 *
 * Constraints (CLAUDE.md): the engine is deterministic TypeScript; the LLM's
 * `aiContext` is only a veto (doNotTrade), never the source of a side/size.
 * SELL only reduces an existing position — no shorting.
 */
import type { AIContext } from "@agent/ai";
import type { AgentConfig, Clock, MarketSnapshot, PortfolioState, TradeIntent } from "@agent/core";
import { SystemClock } from "@agent/core";
import {
  atr,
  bollingerBands,
  donchianChannel,
  ema,
  macd,
  rsi,
  type Candle
} from "@agent/market-data";
import { randomUUID } from "node:crypto";

export interface StrategySignal {
  side: "BUY" | "SELL";
  confidence: number;
  reasonCode: string;
  rationale: string;
  /** Indicator readings behind the decision, for transparency/education. */
  indicators: Record<string, number>;
}

export interface StrategyContext {
  candles: Candle[];
  market: MarketSnapshot;
  portfolio: PortfolioState;
  config: AgentConfig;
  aiContext: AIContext;
}

export interface Strategy {
  name: string;
  version: string;
  describe(): string;
  evaluate(ctx: StrategyContext): StrategySignal | null;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const closesOf = (ctx: StrategyContext) => ctx.candles.map((c) => c.close);
const positionOf = (ctx: StrategyContext) => ctx.portfolio.positions.find((p) => p.productId === ctx.market.productId);
/** Shared guardrails: honor the AI veto and refuse wide/illiquid spreads. */
const blocked = (ctx: StrategyContext) => ctx.aiContext.doNotTrade || ctx.market.spreadBps > 15;
const entryConfidence = (ctx: StrategyContext) => Math.min(0.8, 0.5 + ctx.aiContext.confidence * 0.3);

export const trendStrategy: Strategy = {
  name: "trend",
  version: "trend-ema-macd-v1",
  describe: () =>
    "Trend / momentum: buys when the fast EMA is above the slow EMA and MACD confirms upward momentum; reduces when the trend flips down. Rides sustained moves.",
  evaluate(ctx) {
    if (blocked(ctx)) return null;
    const closes = closesOf(ctx);
    if (closes.length < 26) return null;
    const fast = ema(closes, 12);
    const slow = ema(closes, 26);
    const m = macd(closes);
    const r = rsi(closes, 14);
    const indicators = { emaFast: round(fast), emaSlow: round(slow), macdHistogram: round(m.histogram, 4), rsi: round(r) };
    const position = positionOf(ctx);

    if (fast > slow && m.histogram > 0 && !position) {
      return {
        side: "BUY",
        confidence: entryConfidence(ctx),
        reasonCode: "trend_up_confirmed",
        rationale: `Fast EMA ${round(fast)} is above slow EMA ${round(slow)} and MACD histogram ${round(m.histogram, 4)} is positive — an established uptrend (RSI ${round(r)}).`,
        indicators
      };
    }
    if (fast < slow && m.histogram < 0 && position && position.notionalUsd > 0) {
      return {
        side: "SELL",
        confidence: 0.65,
        reasonCode: "trend_down_reduce",
        rationale: `Fast EMA ${round(fast)} fell below slow EMA ${round(slow)} and MACD histogram ${round(m.histogram, 4)} turned negative — the uptrend broke, so reduce exposure.`,
        indicators
      };
    }
    return null;
  }
};

export const meanReversionStrategy: Strategy = {
  name: "mean-reversion",
  version: "mean-reversion-rsi-bb-v1",
  describe: () =>
    "Mean reversion: buys when RSI is oversold and price sits at/below the lower Bollinger Band, expecting a bounce back to the mean; sells the bounce when overbought.",
  evaluate(ctx) {
    if (blocked(ctx)) return null;
    const closes = closesOf(ctx);
    if (closes.length < 20) return null;
    const r = rsi(closes, 14);
    const bb = bollingerBands(closes, 20, 2);
    const price = ctx.market.price;
    const indicators = { rsi: round(r), bollingerUpper: round(bb.upper), bollingerLower: round(bb.lower), price: round(price) };
    const position = positionOf(ctx);

    if (r < 30 && price <= bb.lower && !position) {
      return {
        side: "BUY",
        confidence: entryConfidence(ctx),
        reasonCode: "mean_reversion_oversold",
        rationale: `RSI ${round(r)} is oversold (below 30) and price ${round(price)} is at/below the lower Bollinger Band ${round(bb.lower)} — stretched low, expecting a bounce.`,
        indicators
      };
    }
    if ((r > 70 || price >= bb.upper) && position && position.notionalUsd > 0) {
      return {
        side: "SELL",
        confidence: 0.65,
        reasonCode: "mean_reversion_overbought",
        rationale: `RSI ${round(r)} is overbought or price ${round(price)} reached the upper Bollinger Band ${round(bb.upper)} — taking the bounce and reducing exposure.`,
        indicators
      };
    }
    return null;
  }
};

export const breakoutStrategy: Strategy = {
  name: "breakout",
  version: "breakout-donchian-atr-v1",
  describe: () =>
    "Breakout: buys when price closes above the highest high of the last 20 bars (a range break) with real volatility (ATR); exits when price breaks below the range.",
  evaluate(ctx) {
    if (blocked(ctx)) return null;
    if (ctx.candles.length < 21) return null;
    // Exclude the current bar so a new high counts as a genuine breakout.
    const prior = ctx.candles.slice(0, -1);
    const channel = donchianChannel(prior, 20);
    const volatility = atr(ctx.candles, 14);
    const price = ctx.market.price;
    const indicators = { donchianUpper: round(channel.upper), donchianLower: round(channel.lower), atr: round(volatility, 4), price: round(price) };
    const position = positionOf(ctx);

    if (price > channel.upper && volatility > 0 && !position) {
      return {
        side: "BUY",
        confidence: entryConfidence(ctx),
        reasonCode: "breakout_up",
        rationale: `Price ${round(price)} broke above the 20-bar high ${round(channel.upper)} with ATR ${round(volatility, 4)} — a volatility-backed breakout.`,
        indicators
      };
    }
    if (price < channel.lower && position && position.notionalUsd > 0) {
      return {
        side: "SELL",
        confidence: 0.65,
        reasonCode: "breakout_down",
        rationale: `Price ${round(price)} broke below the 20-bar low ${round(channel.lower)} — the breakout failed, exiting.`,
        indicators
      };
    }
    return null;
  }
};

export const STRATEGIES: Record<string, Strategy> = {
  trend: trendStrategy,
  "mean-reversion": meanReversionStrategy,
  breakout: breakoutStrategy
};

export function createStrategy(name: string): Strategy {
  const strategy = STRATEGIES[name];
  if (!strategy) {
    throw new Error(`Unknown strategy "${name}". Available: ${Object.keys(STRATEGIES).join(", ")}.`);
  }
  return strategy;
}

/** Run a strategy and convert its signal into a sized, risk-bound TradeIntent. */
export function runStrategy(strategy: Strategy, ctx: StrategyContext, clock: Clock = SystemClock): TradeIntent | null {
  const signal = strategy.evaluate(ctx);
  if (!signal) return null;
  const position = positionOf(ctx);
  const cap = ctx.config.risk.maxTradeNotionalUsd;
  const quoteSizeUsd = signal.side === "BUY" ? cap : Math.min(position?.notionalUsd ?? cap, cap);
  return {
    id: randomUUID(),
    productId: ctx.market.productId,
    side: signal.side,
    quoteSizeUsd,
    confidence: signal.confidence,
    reasonCode: signal.reasonCode,
    rationale: signal.rationale,
    strategyVersion: strategy.version,
    createdAt: clock.now()
  };
}
