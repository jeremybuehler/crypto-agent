/**
 * T5.2 worker alerting: the order-submitted and daily-loss-halt alert shapes,
 * the daily_loss rule detector, and the latched circuit breaker that stops
 * runOnce from trading until the operator restarts the process.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PortfolioState, RiskDecision, TradeIntent } from "@agent/core";

// The worker module reads config from process.env at import time.
Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  TRADING_MODE: "paper",
  PERSISTENCE_ENABLED: "false",
  OPERATOR_API_TOKEN: "operator-".padEnd(40, "x"),
  INTERNAL_API_TOKEN: "internal-".padEnd(40, "y"),
  ALLOWED_ORIGINS: "https://dash.example",
  USE_SAMPLE_MARKET_DATA: "true"
});

const PORTFOLIO: PortfolioState = {
  equityUsd: 980,
  cashUsd: 980,
  dailyPnlPct: -2.4,
  totalExposurePct: 0,
  positions: []
};

const INTENT: TradeIntent = {
  id: "00000000-0000-4000-8000-0000000000aa",
  productId: "BTC-USD" as TradeIntent["productId"],
  side: "BUY",
  quoteSizeUsd: 25,
  confidence: 1,
  reasonCode: "test",
  rationale: "fixture",
  strategyVersion: "",
  createdAt: new Date("2026-07-14T12:00:00Z")
};

function decision(ruleResults: RiskDecision["ruleResults"]): RiskDecision {
  return {
    approved: ruleResults.every((result) => result.passed),
    intent: INTENT,
    checkedAt: new Date("2026-07-14T12:00:00Z"),
    reasons: ruleResults.filter((result) => !result.passed).map((result) => result.message),
    ruleResults
  };
}

let worker: typeof import("../apps/worker/src/index.js");

beforeAll(async () => {
  worker = await import("../apps/worker/src/index.js");
});

afterEach(() => {
  worker.resetCircuitBreakerForTests();
  vi.unstubAllGlobals();
  delete process.env.AGENT_API_URL;
});

describe("dailyLossRuleFailed", () => {
  it("detects a failed daily_loss rule", () => {
    const rejected = decision([
      { rule: "max_trade_notional", passed: true, message: "ok" },
      { rule: "daily_loss", passed: false, message: "Daily PnL -2.4% must be above -1%." }
    ]);
    expect(worker.dailyLossRuleFailed(rejected)).toBe(true);
  });

  it("is false when the rejection is for a different rule", () => {
    const rejected = decision([
      { rule: "daily_loss", passed: true, message: "ok" },
      { rule: "cooldown", passed: false, message: "too soon" }
    ]);
    expect(worker.dailyLossRuleFailed(rejected)).toBe(false);
  });
});

describe("buildDailyLossHaltAlert", () => {
  it("is critical and dedupes by UTC day so repeat breaches page once", () => {
    const morning = worker.buildDailyLossHaltAlert(PORTFOLIO, 1, new Date("2026-07-14T09:00:00Z"));
    const evening = worker.buildDailyLossHaltAlert(PORTFOLIO, 1, new Date("2026-07-14T21:00:00Z"));
    const nextDay = worker.buildDailyLossHaltAlert(PORTFOLIO, 1, new Date("2026-07-15T09:00:00Z"));

    expect(morning.kind).toBe("daily_loss_halt");
    expect(morning.severity).toBe("critical");
    expect(morning.id).toBe("daily_loss_halt:2026-07-14");
    expect(evening.id).toBe(morning.id);
    expect(nextDay.id).toBe("daily_loss_halt:2026-07-15");
    expect(morning.metadata).toMatchObject({ dailyPnlPct: -2.4, maxDailyLossPct: 1 });
  });
});

describe("buildOrderSubmittedAlert", () => {
  const input = {
    proposalId: "00000000-0000-4000-8000-0000000000bb",
    productId: "BTC-USD",
    side: "BUY" as const,
    quoteSizeUsd: 25,
    exchangeOrderId: "cb-order-1"
  };

  it("pages critical for a live order and carries the audit metadata", () => {
    const alert = worker.buildOrderSubmittedAlert({ ...input, mode: "live" }, new Date("2026-07-14T12:00:00Z"));
    expect(alert.kind).toBe("order_submitted");
    expect(alert.severity).toBe("critical");
    expect(alert.id).toBe(`order_submitted:${input.proposalId}`);
    expect(alert.metadata).toMatchObject({ ...input, mode: "live" });
  });

  it("pages warning for a sandbox order (real lifecycle, fake money)", () => {
    const alert = worker.buildOrderSubmittedAlert({ ...input, mode: "sandbox" }, new Date("2026-07-14T12:00:00Z"));
    expect(alert.severity).toBe("warning");
  });
});

describe("circuit breaker", () => {
  it("starts untripped and latches a reason", () => {
    expect(worker.circuitBreakerTripped()).toBeNull();
    worker.tripCircuitBreaker("Daily loss limit breached.");
    expect(worker.circuitBreakerTripped()).toBe("Daily loss limit breached.");
  });

  it("tripped: runOnce refuses to trade and reports a degraded heartbeat", async () => {
    process.env.AGENT_API_URL = "http://api.local";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    worker.tripCircuitBreaker("Daily loss limit breached.");
    const result = await worker.runOnce(PORTFOLIO);

    // Unchanged portfolio and exactly one call: the degraded heartbeat. No
    // market data, proposals, or fills happen behind a tripped breaker.
    expect(result).toBe(PORTFOLIO);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.local/internal/heartbeat");
    expect(JSON.parse(init.body).status).toBe("degraded");
  });
});
