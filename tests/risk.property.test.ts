import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
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

const f32 = Math.fround;

const portfolioArb = fc.record<PortfolioState>({
  equityUsd: fc.float({ min: f32(100), max: f32(100_000), noNaN: true }),
  cashUsd: fc.float({ min: f32(0), max: f32(100_000), noNaN: true }),
  dailyPnlPct: fc.float({ min: f32(-100), max: f32(100), noNaN: true }),
  totalExposurePct: fc.float({ min: f32(0), max: f32(100), noNaN: true }),
  positions: fc.constant([])
});

const intentArb = fc.record<TradeIntent>({
  id: fc.uuid(),
  productId: fc.constantFrom("BTC-USD", "ETH-USD"),
  side: fc.constantFrom("BUY" as const, "SELL" as const),
  quoteSizeUsd: fc.float({ min: f32(0.01), max: f32(1000), noNaN: true }),
  confidence: fc.float({ min: f32(0), max: f32(1), noNaN: true }),
  reasonCode: fc.string(),
  rationale: fc.string(),
  strategyVersion: fc.constant("ai-assisted-trend-v1"),
  createdAt: fc.date()
});

describe("risk engine property tests", () => {
  it("never approves when kill switch is enabled", () => {
    fc.assert(
      fc.property(intentArb, portfolioArb, (intent, portfolio) => {
        const decision = evaluateRisk({ config, intent, portfolio, killSwitchEnabled: true });
        expect(decision.approved).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it("never approves a notional exceeding the configured limit", () => {
    fc.assert(
      fc.property(
        intentArb.map((i) => ({ ...i, quoteSizeUsd: config.risk.maxTradeNotionalUsd + 0.01 })),
        portfolioArb,
        (intent, portfolio) => {
          const decision = evaluateRisk({ config, intent, portfolio, killSwitchEnabled: false });
          expect(decision.approved).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("never approves when daily PnL exceeds the loss limit", () => {
    fc.assert(
      fc.property(
        intentArb.filter((i) => i.side === "BUY"),
        portfolioArb.map((p) => ({ ...p, dailyPnlPct: -(config.risk.maxDailyLossPct + 0.1) })),
        (intent, portfolio) => {
          const decision = evaluateRisk({ config, intent, portfolio, killSwitchEnabled: false });
          expect(decision.approved).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("never approves when total exposure is already at or above the limit", () => {
    fc.assert(
      fc.property(
        intentArb.filter((i) => i.side === "BUY"),
        portfolioArb.map((p) => ({ ...p, totalExposurePct: config.risk.maxTotalExposurePct + 0.1 })),
        (intent, portfolio) => {
          const decision = evaluateRisk({ config, intent, portfolio, killSwitchEnabled: false });
          expect(decision.approved).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("ruleResults always contains a row for every base rule regardless of outcome", () => {
    const BASE_RULES = ["kill_switch", "product_allowlist", "max_trade_notional", "daily_loss", "total_exposure", "product_exposure"];
    fc.assert(
      fc.property(intentArb, portfolioArb, fc.boolean(), (intent, portfolio, killSwitch) => {
        const decision = evaluateRisk({ config, intent, portfolio, killSwitchEnabled: killSwitch });
        const ruleNames = decision.ruleResults.map((r) => r.rule);
        for (const rule of BASE_RULES) {
          expect(ruleNames).toContain(rule);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("approved is true iff all ruleResults have passed=true", () => {
    fc.assert(
      fc.property(intentArb, portfolioArb, fc.boolean(), (intent, portfolio, killSwitch) => {
        const decision = evaluateRisk({ config, intent, portfolio, killSwitchEnabled: killSwitch });
        const allPass = decision.ruleResults.every((r) => r.passed);
        expect(decision.approved).toBe(allPass);
      }),
      { numRuns: 500 }
    );
  });
});
