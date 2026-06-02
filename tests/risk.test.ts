import { describe, expect, it } from "vitest";
import { loadConfig, type PortfolioState, type TradeIntent } from "@agent/core";
import { evaluateRisk } from "@agent/risk";

const config = loadConfig({
  TRADING_MODE: "paper",
  ENABLED_PRODUCTS: "BTC-USD,ETH-USD",
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

const intent: TradeIntent = {
  id: "intent-1",
  productId: "BTC-USD",
  side: "BUY",
  quoteSizeUsd: 25,
  confidence: 0.7,
  reasonCode: "test",
  rationale: "test",
  createdAt: new Date()
};

describe("risk engine", () => {
  it("approves a small allowed paper trade", () => {
    const decision = evaluateRisk({ config, intent, portfolio, killSwitchEnabled: false });
    expect(decision.approved).toBe(true);
  });

  it("rejects trades over max notional", () => {
    const decision = evaluateRisk({
      config,
      intent: { ...intent, quoteSizeUsd: 26 },
      portfolio,
      killSwitchEnabled: false
    });
    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(" ")).toContain("<= 25");
  });

  it("rejects when kill switch is enabled", () => {
    const decision = evaluateRisk({ config, intent, portfolio, killSwitchEnabled: true });
    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(" ")).toContain("kill switch");
  });

  it("rejects uncovered sells when shorting is disabled", () => {
    const decision = evaluateRisk({
      config,
      intent: { ...intent, side: "SELL" },
      portfolio,
      killSwitchEnabled: false
    });
    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(" ")).toContain("shorting is disabled");
  });
});
