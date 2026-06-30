import { describe, expect, it } from "vitest";
import { evaluateLivePreflight, type LivePreflightInput } from "@agent/core";

function input(over: Partial<LivePreflightInput> = {}): LivePreflightInput {
  return {
    tradingMode: "live",
    liveTradingAck: true,
    maxTradeNotionalUsd: 25,
    bootstrapNotionalCeilingUsd: 100,
    hasCoinbaseKey: true,
    hasCoinbasePrivateKey: true,
    operatorToken: "operator-".padEnd(40, "x"),
    internalToken: "internal-".padEnd(40, "y"),
    persistenceEnabled: true,
    hasDatabaseUrl: true,
    hasRedisUrl: true,
    alertsConfigured: true,
    reconciliationOk: true,
    ...over
  };
}

describe("evaluateLivePreflight", () => {
  it("passes only when every check passes", () => {
    const report = evaluateLivePreflight(input());
    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails closed when the acknowledgement is absent", () => {
    const report = evaluateLivePreflight(input({ liveTradingAck: false }));
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "live_ack_present")?.passed).toBe(false);
  });

  it("fails when notional exceeds the bootstrap ceiling", () => {
    expect(evaluateLivePreflight(input({ maxTradeNotionalUsd: 500 })).ok).toBe(false);
  });

  it("fails when Coinbase credentials are missing", () => {
    expect(evaluateLivePreflight(input({ hasCoinbasePrivateKey: false })).ok).toBe(false);
  });

  it("fails when operator and internal tokens are identical", () => {
    const same = "same-token".padEnd(40, "z");
    expect(evaluateLivePreflight(input({ operatorToken: same, internalToken: same })).ok).toBe(false);
  });

  it("fails when reconciliation has not passed", () => {
    expect(evaluateLivePreflight(input({ reconciliationOk: false })).ok).toBe(false);
  });

  it("cannot bypass a failure: a single failed check fails the whole report", () => {
    const report = evaluateLivePreflight(input({ hasRedisUrl: false, alertsConfigured: false }));
    expect(report.ok).toBe(false);
    const failed = report.checks.filter((c) => !c.passed).map((c) => c.name);
    expect(failed).toContain("redis_configured");
    expect(failed).toContain("alerts_configured");
  });

  it("is pure: it reports the acknowledgement state, it does not set it", () => {
    // Given ack=false, no permutation of other inputs flips it to ok.
    expect(evaluateLivePreflight(input({ liveTradingAck: false, reconciliationOk: true })).ok).toBe(false);
    expect(evaluateLivePreflight(input({ liveTradingAck: false, alertsConfigured: true })).ok).toBe(false);
  });
});
