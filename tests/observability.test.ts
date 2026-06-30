import { describe, expect, it, vi } from "vitest";
import {
  renderPrometheus,
  AlertDispatcher,
  StdoutAlertSink,
  WebhookAlertSink,
  type Alert,
  type AlertSink,
  type MetricSample
} from "@agent/core";
import { checkReadiness } from "../apps/api/src/routes/health.js";
import { buildMetricSamples } from "../apps/api/src/routes/metrics.js";
import type { WorkerHeartbeat } from "@agent/persistence";

const NOW = new Date("2026-06-30T12:00:00.000Z");

function heartbeat(ageMs: number): WorkerHeartbeat {
  return {
    workerId: "worker-1",
    lastSeenAt: new Date(NOW.getTime() - ageMs),
    mode: "paper",
    status: "ok",
    detail: null
  };
}

function readinessDeps(over: {
  dbOk?: boolean;
  redisOk?: boolean;
  hb?: WorkerHeartbeat | null;
} = {}) {
  return {
    repo: {
      ping: async () => over.dbOk ?? true,
      getWorkerHeartbeat: async () => (over.hb === undefined ? heartbeat(1000) : over.hb)
    },
    opsState: { ping: async () => over.redisOk ?? true },
    tradingMode: "paper" as const,
    workerId: "worker-1",
    heartbeatMaxAgeMs: 60_000,
    now: () => NOW
  };
}

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "kill_switch:2026-06-30",
    kind: "kill_switch",
    severity: "critical",
    summary: "kill switch engaged",
    at: new Date("2026-06-30T12:00:00.000Z"),
    ...overrides
  };
}

describe("renderPrometheus", () => {
  it("emits HELP and TYPE once per metric, then samples", () => {
    const samples: MetricSample[] = [
      { name: "cg_trades_total", help: "Total fills", type: "counter", value: 4 },
      { name: "cg_equity_usd", help: "Equity in USD", type: "gauge", value: 1000 }
    ];
    const out = renderPrometheus(samples);
    expect(out).toContain("# HELP cg_trades_total Total fills");
    expect(out).toContain("# TYPE cg_trades_total counter");
    expect(out).toContain("cg_trades_total 4");
    expect(out).toContain("# TYPE cg_equity_usd gauge");
    expect(out).toContain("cg_equity_usd 1000");
    // Exposition ends with a trailing newline.
    expect(out.endsWith("\n")).toBe(true);
  });

  it("renders labels and groups HELP/TYPE once for repeated names", () => {
    const samples: MetricSample[] = [
      { name: "cg_fills_total", help: "Fills by side", type: "counter", value: 3, labels: { side: "BUY" } },
      { name: "cg_fills_total", help: "Fills by side", type: "counter", value: 1, labels: { side: "SELL" } }
    ];
    const out = renderPrometheus(samples);
    expect(out.match(/# TYPE cg_fills_total counter/g)?.length).toBe(1);
    expect(out).toContain('cg_fills_total{side="BUY"} 3');
    expect(out).toContain('cg_fills_total{side="SELL"} 1');
  });
});

describe("StdoutAlertSink", () => {
  it("writes the alert to the injected writer", async () => {
    const written: string[] = [];
    const sink = new StdoutAlertSink((line) => written.push(line));
    await sink.deliver(alert());
    expect(written.length).toBe(1);
    expect(written[0]).toContain("kill_switch");
    expect(written[0]).toContain("critical");
  });
});

describe("WebhookAlertSink", () => {
  it("posts the alert with the auth header and retries 5xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const sink = new WebhookAlertSink({
      url: "http://alerts.local/hook",
      token: "secret",
      fetchFn: fetchMock,
      sleep: async () => {}
    });

    await sink.deliver(alert());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer secret");
  });

  it("throws after exhausting retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const sink = new WebhookAlertSink({
      url: "http://alerts.local/hook",
      fetchFn: fetchMock,
      maxAttempts: 2,
      sleep: async () => {}
    });
    await expect(sink.deliver(alert())).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("AlertDispatcher", () => {
  it("delivers each alert id only once (idempotent)", async () => {
    const seen: string[] = [];
    const sink: AlertSink = { deliver: async (a) => void seen.push(a.id) };
    const dispatcher = new AlertDispatcher([sink]);

    await dispatcher.dispatch(alert());
    await dispatcher.dispatch(alert());

    expect(seen.length).toBe(1);
  });

  it("a failing sink does not block the others", async () => {
    const delivered: string[] = [];
    const failing: AlertSink = { deliver: async () => { throw new Error("boom"); } };
    const working: AlertSink = { deliver: async (a) => void delivered.push(a.kind) };
    const dispatcher = new AlertDispatcher([failing, working]);

    await expect(dispatcher.dispatch(alert())).resolves.toBeUndefined();
    expect(delivered).toEqual(["kill_switch"]);
  });
});

describe("checkReadiness", () => {
  it("reports ok when all dependencies are healthy and the heartbeat is fresh", async () => {
    const r = await checkReadiness(readinessDeps());
    expect(r.status).toBe("ok");
    expect(r.components.database.status).toBe("ok");
    expect(r.components.redis.status).toBe("ok");
    expect(r.components.worker.status).toBe("ok");
    expect(r.checkedAt).toBe(NOW.toISOString());
  });

  it("is down when the database is unreachable", async () => {
    const r = await checkReadiness(readinessDeps({ dbOk: false }));
    expect(r.components.database.status).toBe("down");
    expect(r.status).toBe("down");
  });

  it("is down when redis is unreachable", async () => {
    const r = await checkReadiness(readinessDeps({ redisOk: false }));
    expect(r.components.redis.status).toBe("down");
    expect(r.status).toBe("down");
  });

  it("is degraded when the worker heartbeat is stale", async () => {
    const r = await checkReadiness(readinessDeps({ hb: heartbeat(120_000) }));
    expect(r.components.worker.status).toBe("degraded");
    expect(r.status).toBe("degraded");
  });

  it("is down when the worker has never reported", async () => {
    const r = await checkReadiness(readinessDeps({ hb: null }));
    expect(r.components.worker.status).toBe("down");
    expect(r.status).toBe("down");
  });
});

describe("buildMetricSamples", () => {
  it("derives Prometheus samples from durable metrics and heartbeat", () => {
    const samples = buildMetricSamples(
      { totalTrades: 4, wins: 1, losses: 0, totalFees: 0.6, realizedPnl: -0.6, equityUsd: 1000 },
      heartbeat(5000),
      NOW
    );
    const out = renderPrometheus(samples);
    expect(out).toContain("cg_up 1");
    expect(out).toContain("cg_trades_total 4");
    expect(out).toContain("cg_realized_pnl_usd -0.6");
    expect(out).toContain("cg_equity_usd 1000");
    expect(out).toContain("cg_worker_heartbeat_age_seconds 5");
  });

  it("omits equity when unknown and heartbeat age when never seen", () => {
    const samples = buildMetricSamples(
      { totalTrades: 0, wins: 0, losses: 0, totalFees: 0, realizedPnl: 0, equityUsd: null },
      null,
      NOW
    );
    const names = samples.map((s) => s.name);
    expect(names).not.toContain("cg_equity_usd");
    expect(names).not.toContain("cg_worker_heartbeat_age_seconds");
    expect(names).toContain("cg_up");
  });
});
