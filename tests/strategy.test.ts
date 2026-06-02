import { describe, expect, it } from "vitest";
import { type AIContext } from "@agent/ai";
import { loadConfig, type PortfolioState } from "@agent/core";
import { aiAssistedTrendStrategy } from "@agent/strategy";

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

const portfolio: PortfolioState = {
  equityUsd: 1_000,
  cashUsd: 1_000,
  dailyPnlPct: 0,
  totalExposurePct: 0,
  positions: []
};

const aiContext: AIContext = {
  marketRegime: "trend",
  summary: "trend",
  riskNotes: [],
  bullishFactors: ["momentum"],
  bearishFactors: [],
  doNotTrade: false,
  doNotTradeReasons: [],
  confidence: 0.6
};

describe("ai assisted trend strategy", () => {
  it("creates a buy intent when trend is positive and AI does not block", () => {
    const intent = aiAssistedTrendStrategy({
      config,
      portfolio,
      aiContext,
      features: {
        productId: "BTC-USD",
        generatedAt: new Date(),
        close: 102,
        smaFast: 101,
        smaSlow: 100,
        momentumPct: 2,
        volatilityPercentile: 30,
        spreadBps: 5
      }
    });

    expect(intent?.side).toBe("BUY");
    expect(intent?.quoteSizeUsd).toBe(25);
  });

  it("does not create an intent when AI blocks trading", () => {
    const intent = aiAssistedTrendStrategy({
      config,
      portfolio,
      aiContext: { ...aiContext, doNotTrade: true, doNotTradeReasons: ["blocked"] },
      features: {
        productId: "BTC-USD",
        generatedAt: new Date(),
        close: 102,
        smaFast: 101,
        smaSlow: 100,
        momentumPct: 2,
        volatilityPercentile: 30,
        spreadBps: 5
      }
    });

    expect(intent).toBeNull();
  });
});
