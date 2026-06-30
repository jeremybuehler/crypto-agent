import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PortfolioState } from "@agent/core";

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
  equityUsd: 1000,
  cashUsd: 1000,
  dailyPnlPct: 0,
  totalExposurePct: 0,
  positions: []
};

let postHeartbeat: (p: PortfolioState, s: "ok" | "degraded") => Promise<void>;

beforeAll(async () => {
  ({ postHeartbeat } = await import("../apps/worker/src/index.js"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENT_API_URL;
});

describe("worker heartbeat", () => {
  it("posts to /internal/heartbeat with the internal token", async () => {
    process.env.AGENT_API_URL = "http://api.local";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await postHeartbeat(PORTFOLIO, "ok");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.local/internal/heartbeat");
    expect((init.headers as Record<string, string>)["x-internal-token"]).toBeTruthy();
    expect(JSON.parse(init.body).portfolio.equityUsd).toBe(1000);
  });

  it("retries on a 5xx and then succeeds", async () => {
    process.env.AGENT_API_URL = "http://api.local";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await postHeartbeat(PORTFOLIO, "ok");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry on a 4xx", async () => {
    process.env.AGENT_API_URL = "http://api.local";
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);

    await postHeartbeat(PORTFOLIO, "ok");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips entirely when AGENT_API_URL is not set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await postHeartbeat(PORTFOLIO, "ok");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
