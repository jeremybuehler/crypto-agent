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
  strategyVersion: "test-v1",
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

  it("rejects when daily PnL breach exceeds max loss", () => {
    const decision = evaluateRisk({
      config,
      intent,
      portfolio: { ...portfolio, dailyPnlPct: -1.5 },
      killSwitchEnabled: false
    });
    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(" ")).toContain("Daily PnL");
  });

  it("rejects when total exposure would exceed max", () => {
    const decision = evaluateRisk({
      config,
      intent,
      portfolio: { ...portfolio, totalExposurePct: 21 },
      killSwitchEnabled: false
    });
    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(" ")).toContain("Total exposure");
  });

  it("rejects when product exposure would exceed max", () => {
    const decision = evaluateRisk({
      config,
      intent: { ...intent, quoteSizeUsd: 25 },
      portfolio: {
        ...portfolio,
        equityUsd: 100,
        positions: [{ productId: "BTC-USD", baseSize: 0.05, notionalUsd: 8, exposurePct: 8, averageEntryPrice: 100 }]
      },
      killSwitchEnabled: false
    });
    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(" ")).toContain("product exposure");
  });

  it("includes a ruleResults row for every rule even when all pass", () => {
    const decision = evaluateRisk({ config, intent, portfolio, killSwitchEnabled: false });
    expect(decision.ruleResults.length).toBeGreaterThanOrEqual(6);
    const ruleNames = decision.ruleResults.map((r) => r.rule);
    expect(ruleNames).toContain("kill_switch");
    expect(ruleNames).toContain("product_allowlist");
    expect(ruleNames).toContain("max_trade_notional");
    expect(ruleNames).toContain("daily_loss");
    expect(ruleNames).toContain("total_exposure");
    expect(ruleNames).toContain("product_exposure");
  });

  it("rejects a disallowed product", () => {
    const decision = evaluateRisk({
      config,
      intent: { ...intent, productId: "DOGE-USD" },
      portfolio,
      killSwitchEnabled: false
    });
    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(" ")).toContain("not enabled");
  });
});
