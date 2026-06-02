import { describe, expect, it } from "vitest";
import {
  buildAIContextInsert,
  buildMarketSnapshotInsert,
  buildPaperFillInsert,
  buildRiskDecisionInsert,
  buildTradeIntentInsert
} from "@agent/persistence";
import type { AIContext } from "@agent/ai";
import type { MarketSnapshot, RiskDecision, TradeIntent } from "@agent/core";
import type { SimulatedFill } from "@agent/execution";

describe("persistence query builders", () => {
  it("builds market snapshot inserts", () => {
    const snapshot: MarketSnapshot = {
      productId: "BTC-USD",
      price: 100,
      bid: 99,
      ask: 101,
      spreadBps: 200,
      timestamp: new Date("2026-05-25T13:00:00.000Z")
    };

    const query = buildMarketSnapshotInsert(snapshot);

    expect(query.text).toContain("INSERT INTO market_snapshots");
    expect(query.values).toEqual(["BTC-USD", 100, 99, 101, 200, snapshot.timestamp]);
  });

  it("builds AI context inserts", () => {
    const output: AIContext = {
      marketRegime: "trend",
      summary: "trend",
      riskNotes: [],
      bullishFactors: ["momentum"],
      bearishFactors: [],
      doNotTrade: false,
      doNotTradeReasons: [],
      confidence: 0.6
    };

    const query = buildAIContextInsert({
      productId: "BTC-USD",
      timeframe: "1m",
      input: {
        productId: "BTC-USD",
        timeframe: "1m",
        features: { momentumPct: 1 },
        portfolioState: { dailyPnlPct: 0 },
        riskPolicy: { maxTradeNotionalUsd: 25 }
      },
      output
    });

    expect(query.text).toContain("INSERT INTO ai_contexts");
    expect(query.values[0]).toBe("BTC-USD");
    expect(query.values[4]).toBe("trend");
    expect(query.values[5]).toBe(0.6);
    expect(query.values[6]).toBe(false);
  });

  it("builds trade intent and risk decision inserts", () => {
    const intent: TradeIntent = {
      id: "00000000-0000-4000-8000-000000000001",
      productId: "BTC-USD",
      side: "BUY",
      quoteSizeUsd: 25,
      confidence: 0.7,
      reasonCode: "test",
      rationale: "test",
      createdAt: new Date("2026-05-25T13:00:00.000Z")
    };
    const decision: RiskDecision = {
      approved: true,
      intent,
      checkedAt: new Date("2026-05-25T13:00:01.000Z"),
      reasons: [],
      ruleResults: [{ rule: "max_trade_notional", passed: true, message: "ok" }]
    };

    const intentQuery = buildTradeIntentInsert(intent);
    const decisionQuery = buildRiskDecisionInsert(decision);

    expect(intentQuery.text).toContain("INSERT INTO trade_intents");
    expect(intentQuery.values[0]).toBe(intent.id);
    expect(decisionQuery.text).toContain("INSERT INTO risk_decisions");
    expect(decisionQuery.values[0]).toBe(intent.id);
    expect(decisionQuery.values[1]).toBe(true);
  });

  it("builds paper fill inserts", () => {
    const fill: SimulatedFill = {
      fillId: "00000000-0000-4000-8000-000000000002",
      productId: "BTC-USD",
      side: "BUY",
      quoteSizeUsd: 25,
      price: 100,
      baseSize: 0.25,
      feeUsd: 0.15,
      filledAt: new Date("2026-05-25T13:00:02.000Z")
    };

    const query = buildPaperFillInsert({
      tradeIntentId: "00000000-0000-4000-8000-000000000001",
      fill
    });

    expect(query.text).toContain("INSERT INTO paper_fills");
    expect(query.values).toEqual([
      fill.fillId,
      "00000000-0000-4000-8000-000000000001",
      "BTC-USD",
      "BUY",
      25,
      100,
      0.25,
      0.15,
      fill.filledAt
    ]);
  });
});
