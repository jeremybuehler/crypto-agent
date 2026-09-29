/**
 * P0 regression (C2): when USE_SAMPLE_MARKET_DATA is false, Coinbase MD failure
 * must fail closed — never fall back to synthetic sine-wave prices.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  TRADING_MODE: "paper",
  PERSISTENCE_ENABLED: "false",
  OPERATOR_API_TOKEN: "operator-".padEnd(40, "x"),
  INTERNAL_API_TOKEN: "internal-".padEnd(40, "y"),
  ALLOWED_ORIGINS: "https://dash.example",
  USE_SAMPLE_MARKET_DATA: "false"
});

vi.mock("@agent/coinbase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent/coinbase")>();
  return {
    ...actual,
    CoinbasePublicMarketData: class {
      async getBestBidAsk() {
        throw new Error("Coinbase public MD unavailable");
      }
      async getCandles() {
        throw new Error("Coinbase public MD unavailable");
      }
    }
  };
});

let loadMarketInputs: typeof import("../apps/worker/src/index.js").loadMarketInputs;
let setOpsStateForTests: typeof import("../apps/worker/src/index.js").setOpsStateForTests;
let resetOpsStateForTests: typeof import("../apps/worker/src/index.js").resetOpsStateForTests;
let runOnce: typeof import("../apps/worker/src/index.js").runOnce;
let resetCircuitBreakerForTests: typeof import("../apps/worker/src/index.js").resetCircuitBreakerForTests;
let InMemoryOpsState: typeof import("@agent/risk").InMemoryOpsState;

beforeAll(async () => {
  ({ InMemoryOpsState } = await import("@agent/risk"));
  const worker = await import("../apps/worker/src/index.js");
  loadMarketInputs = worker.loadMarketInputs;
  setOpsStateForTests = worker.setOpsStateForTests;
  resetOpsStateForTests = worker.resetOpsStateForTests;
  runOnce = worker.runOnce;
  resetCircuitBreakerForTests = worker.resetCircuitBreakerForTests;
});

afterEach(() => {
  resetCircuitBreakerForTests();
  resetOpsStateForTests();
  vi.unstubAllGlobals();
  delete process.env.AGENT_API_URL;
});

describe("worker market-data fail-closed (C2)", () => {
  it("loadMarketInputs throws instead of returning sample candles on MD failure", async () => {
    await expect(loadMarketInputs("BTC-USD")).rejects.toThrow(/Coinbase public MD unavailable/);
  });

  it("runOnce degrades without inventing a trade on MD failure", async () => {
    setOpsStateForTests(new InMemoryOpsState());

    process.env.AGENT_API_URL = "http://api.local";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const portfolio = {
      equityUsd: 1000,
      cashUsd: 1000,
      dailyPnlPct: 0,
      totalExposurePct: 0,
      positions: []
    };

    await expect(runOnce(portfolio)).rejects.toThrow(/Coinbase public MD unavailable/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.local/internal/heartbeat");
    expect(JSON.parse(init.body as string).status).toBe("degraded");
  });
});
