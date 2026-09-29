/**
 * P0 regressions: worker must honor OpsState kill switch / pause within one
 * tick, and must not invent synthetic prices when real market data fails.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PortfolioState } from "@agent/core";
import { InMemoryOpsState } from "@agent/risk";

// The worker module reads config from process.env at import time.
Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  TRADING_MODE: "paper",
  PERSISTENCE_ENABLED: "false",
  OPERATOR_API_TOKEN: "operator-".padEnd(40, "x"),
  INTERNAL_API_TOKEN: "internal-".padEnd(40, "y"),
  ALLOWED_ORIGINS: "https://dash.example",
  USE_SAMPLE_MARKET_DATA: "true",
  // Short cooldown so a clear ops state can still produce a trade intent path
  // without waiting half an hour in tests that assert the happy path still runs.
  MIN_SECONDS_BETWEEN_TRADES: "0"
});

const PORTFOLIO: PortfolioState = {
  equityUsd: 1000,
  cashUsd: 1000,
  dailyPnlPct: 0,
  totalExposurePct: 0,
  positions: []
};

let worker: typeof import("../apps/worker/src/index.js");

beforeAll(async () => {
  worker = await import("../apps/worker/src/index.js");
});

afterEach(() => {
  worker.resetCircuitBreakerForTests();
  worker.resetOpsStateForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.AGENT_API_URL;
});

describe("worker ops kill switch and pause (C1)", () => {
  it("does not propose or trade when the kill switch is enabled", async () => {
    const ops = new InMemoryOpsState();
    await ops.setKillSwitchEnabled(true);
    worker.setOpsStateForTests(ops);

    process.env.AGENT_API_URL = "http://api.local";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await worker.runOnce(PORTFOLIO);

    expect(result).toEqual(PORTFOLIO);
    // Only the degraded heartbeat — no proposal POST, no market-driven fills.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.local/internal/heartbeat");
    expect(JSON.parse(init.body as string).status).toBe("degraded");
  });

  it("does not propose or trade when paused", async () => {
    const ops = new InMemoryOpsState();
    await ops.setPaused(true);
    worker.setOpsStateForTests(ops);

    process.env.AGENT_API_URL = "http://api.local";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await worker.runOnce(PORTFOLIO);

    expect(result).toEqual(PORTFOLIO);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).status).toBe("degraded");
  });

  it("fails closed when ops state is unreachable", async () => {
    worker.setOpsStateForTests({
      getKillSwitchEnabled: async () => {
        throw new Error("redis down");
      },
      setKillSwitchEnabled: async () => {},
      getPaused: async () => false,
      setPaused: async () => {},
      ping: async () => false,
      close: async () => {}
    });

    process.env.AGENT_API_URL = "http://api.local";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await worker.runOnce(PORTFOLIO);

    expect(result).toEqual(PORTFOLIO);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).status).toBe("degraded");
  });

  it("still runs a tick when kill switch and pause are clear", async () => {
    const ops = new InMemoryOpsState();
    worker.setOpsStateForTests(ops);

    process.env.AGENT_API_URL = "http://api.local";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await worker.runOnce(PORTFOLIO);

    // Portfolio may be unchanged (no intent) or updated (paper fill); either way
    // the tick completed with an ok heartbeat — not an ops-halt degraded skip.
    expect(result).toBeDefined();
    expect(fetchMock).toHaveBeenCalled();
    const heartbeatCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/internal/heartbeat")
    );
    expect(heartbeatCalls.length).toBeGreaterThanOrEqual(1);
    const lastHeartbeat = heartbeatCalls[heartbeatCalls.length - 1]!;
    expect(JSON.parse(lastHeartbeat[1].body as string).status).toBe("ok");
  });
});
