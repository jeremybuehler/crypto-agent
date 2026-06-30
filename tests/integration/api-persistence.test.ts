/**
 * End-to-end: the operator API over a real (embedded pglite) Postgres. Proves
 * durable state survives across server instances (restart recovery), that
 * worker ingestion is idempotent and concurrency-safe, and that metrics are
 * derived from durable fills rather than process memory.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type AgentConfig } from "@agent/core";
import { InMemoryOpsState } from "@agent/risk";
import { PostgresOperatorRepository } from "@agent/persistence";
import { buildServer } from "../../apps/api/src/server.js";
import { createMigratedPglite, type PgliteExecutor } from "../support/pglite-executor.js";

const OPERATOR_TOKEN = "operator-".padEnd(40, "x");
const INTERNAL_TOKEN = "internal-".padEnd(40, "y");
const ALLOWED_ORIGIN = "https://dash.example";

const opAuth = { authorization: `Bearer ${OPERATOR_TOKEN}` };
const intAuth = { "x-internal-token": INTERNAL_TOKEN };

function testConfig(): AgentConfig {
  return loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    TRADING_MODE: "paper",
    PERSISTENCE_ENABLED: "false",
    OPERATOR_API_TOKEN: OPERATOR_TOKEN,
    INTERNAL_API_TOKEN: INTERNAL_TOKEN,
    ALLOWED_ORIGINS: ALLOWED_ORIGIN
  });
}

let db: PgliteExecutor;

async function buildApp() {
  const app = await buildServer(testConfig(), {
    opsState: new InMemoryOpsState(),
    operatorRepo: new PostgresOperatorRepository(db)
  });
  await app.ready();
  return app;
}

function heartbeat(overrides: Record<string, unknown> = {}) {
  return {
    workerId: "worker-1",
    mode: "paper",
    status: "ok",
    version: 1,
    correlationId: "00000000-0000-4000-8000-000000000001",
    observedAt: "2026-06-29T12:00:00.000Z",
    portfolio: { equityUsd: 1500, cashUsd: 900, dailyPnlPct: 2, totalExposurePct: 8, positions: [] },
    ...overrides
  };
}

async function seedFill(args: {
  side: "BUY" | "SELL";
  price: number;
  baseSize: number;
  feeUsd: number;
  filledAt: string;
}): Promise<void> {
  const intentId = (await db.query("SELECT gen_random_uuid() AS id")).rows[0].id as string;
  await db.query(
    `INSERT INTO trade_intents (id, product_id, side, quote_size_usd, confidence, reason_code, rationale, strategy_version, created_at)
     VALUES ($1, 'BTC-USD', $2, $3, 0.5, 'test', 'test', 'v1', $4)`,
    [intentId, args.side, args.price * args.baseSize, args.filledAt]
  );
  await db.query(
    `INSERT INTO paper_fills (id, trade_intent_id, product_id, side, quote_size_usd, price, base_size, fee_usd, filled_at)
     VALUES (gen_random_uuid(), $1, 'BTC-USD', $2, $3, $4, $5, $6, $7)`,
    [intentId, args.side, args.price * args.baseSize, args.price, args.baseSize, args.feeUsd, args.filledAt]
  );
}

beforeAll(async () => {
  db = await createMigratedPglite();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.truncateAll();
});

describe("API persistence (pglite-backed)", () => {
  it("ingests a heartbeat and serves it from GET /portfolio", async () => {
    const app = await buildApp();
    const ingest = await app.inject({ method: "POST", url: "/internal/heartbeat", headers: intAuth, payload: heartbeat() });
    expect(ingest.statusCode).toBe(200);

    const portfolio = await app.inject({ method: "GET", url: "/portfolio", headers: opAuth });
    expect(portfolio.statusCode).toBe(200);
    expect(portfolio.json().equityUsd).toBeCloseTo(1500, 6);
    await app.close();
  });

  it("derives metrics from durable fills, not BUY count", async () => {
    await seedFill({ side: "BUY", price: 100, baseSize: 1, feeUsd: 0.1, filledAt: "2026-06-29T10:00:00.000Z" });
    await seedFill({ side: "SELL", price: 130, baseSize: 1, feeUsd: 0.1, filledAt: "2026-06-29T11:00:00.000Z" });

    const app = await buildApp();
    const metrics = (await app.inject({ method: "GET", url: "/metrics", headers: opAuth })).json();
    expect(metrics.totalTrades).toBe(2);
    expect(metrics.wins).toBe(1);
    expect(metrics.losses).toBe(0);
    expect(metrics.realizedPnl).toBeCloseTo(29.8, 6);
    await app.close();
  });

  it("lists fills newest-first from GET /trades", async () => {
    await seedFill({ side: "BUY", price: 100, baseSize: 1, feeUsd: 0.1, filledAt: "2026-06-29T10:00:00.000Z" });
    await seedFill({ side: "SELL", price: 130, baseSize: 1, feeUsd: 0.1, filledAt: "2026-06-29T11:00:00.000Z" });

    const app = await buildApp();
    const trades = (await app.inject({ method: "GET", url: "/trades", headers: opAuth })).json();
    expect(trades.trades.length).toBe(2);
    expect(trades.trades[0].side).toBe("SELL");
    await app.close();
  });

  it("records an audit event for operator ops actions", async () => {
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/ops/pause", headers: opAuth });
    const audit = (await app.inject({ method: "GET", url: "/audit", headers: opAuth })).json();
    expect(audit.events.some((e: { type: string }) => e.type === "ops.pause")).toBe(true);
    await app.close();
  });

  it("is idempotent: a retried heartbeat does not duplicate state", async () => {
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/internal/heartbeat", headers: intAuth, payload: heartbeat() });
    await app.inject({ method: "POST", url: "/internal/heartbeat", headers: intAuth, payload: heartbeat() });

    const snaps = (await db.query("SELECT count(*)::int AS c FROM portfolio_snapshots")).rows[0].c;
    expect(snaps).toBe(1);
    await app.close();
  });

  it("handles concurrent ingests and returns the latest snapshot", async () => {
    const app = await buildApp();
    await Promise.all([
      app.inject({
        method: "POST",
        url: "/internal/heartbeat",
        headers: intAuth,
        payload: heartbeat({
          correlationId: "00000000-0000-4000-8000-0000000000a1",
          observedAt: "2026-06-29T12:00:00.000Z",
          portfolio: { equityUsd: 100, cashUsd: 100, dailyPnlPct: 0, totalExposurePct: 0, positions: [] }
        })
      }),
      app.inject({
        method: "POST",
        url: "/internal/heartbeat",
        headers: intAuth,
        payload: heartbeat({
          correlationId: "00000000-0000-4000-8000-0000000000a2",
          observedAt: "2026-06-29T12:05:00.000Z",
          portfolio: { equityUsd: 999, cashUsd: 100, dailyPnlPct: 0, totalExposurePct: 0, positions: [] }
        })
      })
    ]);

    const portfolio = (await app.inject({ method: "GET", url: "/portfolio", headers: opAuth })).json();
    expect(portfolio.equityUsd).toBeCloseTo(999, 6);
    await app.close();
  });

  it("recovers durable state after an API restart", async () => {
    const first = await buildApp();
    await first.inject({ method: "POST", url: "/internal/heartbeat", headers: intAuth, payload: heartbeat() });
    await first.close();

    // A fresh server instance over the same database still serves the data.
    const second = await buildApp();
    const portfolio = (await second.inject({ method: "GET", url: "/portfolio", headers: opAuth })).json();
    expect(portfolio.equityUsd).toBeCloseTo(1500, 6);
    await second.close();
  });
});
