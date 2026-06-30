import { afterEach, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  computeRealizedMetrics,
  PostgresOperatorRepository,
  type FillRow
} from "@agent/persistence";
import type { PortfolioState } from "@agent/core";
import { createMigratedPglite, type PgliteExecutor } from "./support/pglite-executor.js";

function fill(overrides: Partial<FillRow>): FillRow {
  return {
    fillId: "00000000-0000-4000-8000-000000000000",
    productId: "BTC-USD",
    side: "BUY",
    quoteSizeUsd: 100,
    price: 100,
    baseSize: 1,
    feeUsd: 0,
    filledAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides
  };
}

describe("computeRealizedMetrics (average-cost basis)", () => {
  it("reports zeroes for no fills", () => {
    const m = computeRealizedMetrics([]);
    expect(m).toEqual({ totalTrades: 0, wins: 0, losses: 0, totalFees: 0, realizedPnl: 0 });
  });

  it("a buy alone realizes nothing but still counts as a trade and accrues fees", () => {
    const m = computeRealizedMetrics([fill({ side: "BUY", price: 100, baseSize: 1, feeUsd: 0.5 })]);
    expect(m.totalTrades).toBe(1);
    expect(m.wins).toBe(0);
    expect(m.losses).toBe(0);
    expect(m.totalFees).toBeCloseTo(0.5, 10);
    expect(m.realizedPnl).toBeCloseTo(-0.5, 10);
  });

  it("buy then higher sell is a win (gross gain minus fees)", () => {
    const m = computeRealizedMetrics([
      fill({ side: "BUY", price: 100, baseSize: 1, feeUsd: 0.1 }),
      fill({ side: "SELL", price: 120, baseSize: 1, feeUsd: 0.1 })
    ]);
    expect(m.wins).toBe(1);
    expect(m.losses).toBe(0);
    // gross realized = (120-100)*1 = 20; minus 0.2 fees
    expect(m.realizedPnl).toBeCloseTo(19.8, 10);
    expect(m.totalFees).toBeCloseTo(0.2, 10);
  });

  it("buy then lower sell is a loss", () => {
    const m = computeRealizedMetrics([
      fill({ side: "BUY", price: 100, baseSize: 1 }),
      fill({ side: "SELL", price: 80, baseSize: 1 })
    ]);
    expect(m.wins).toBe(0);
    expect(m.losses).toBe(1);
    expect(m.realizedPnl).toBeCloseTo(-20, 10);
  });

  it("uses average cost across multiple buys before a sell", () => {
    const m = computeRealizedMetrics([
      fill({ side: "BUY", price: 100, baseSize: 1 }),
      fill({ side: "BUY", price: 200, baseSize: 1 }), // avg cost now 150
      fill({ side: "SELL", price: 160, baseSize: 2 }) // (160-150)*2 = 20
    ]);
    expect(m.wins).toBe(1);
    expect(m.realizedPnl).toBeCloseTo(20, 10);
  });

  it("realizes only against held quantity on an oversized sell", () => {
    const m = computeRealizedMetrics([
      fill({ side: "BUY", price: 100, baseSize: 1 }),
      fill({ side: "SELL", price: 150, baseSize: 5 }) // only 1 held -> (150-100)*1 = 50
    ]);
    expect(m.realizedPnl).toBeCloseTo(50, 10);
  });

  it("tracks cost basis independently per product", () => {
    const m = computeRealizedMetrics([
      fill({ productId: "BTC-USD", side: "BUY", price: 100, baseSize: 1 }),
      fill({ productId: "ETH-USD", side: "BUY", price: 10, baseSize: 1 }),
      fill({ productId: "BTC-USD", side: "SELL", price: 110, baseSize: 1 }), // +10
      fill({ productId: "ETH-USD", side: "SELL", price: 8, baseSize: 1 }) // -2
    ]);
    expect(m.wins).toBe(1);
    expect(m.losses).toBe(1);
    expect(m.realizedPnl).toBeCloseTo(8, 10);
  });

  it("property: buy then equal-price sell of the same size realizes exactly minus fees", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1_000_000, noNaN: true }),
        fc.double({ min: 0.0001, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (price, size, fee) => {
          const m = computeRealizedMetrics([
            fill({ side: "BUY", price, baseSize: size, feeUsd: fee }),
            fill({ side: "SELL", price, baseSize: size, feeUsd: fee })
          ]);
          expect(m.realizedPnl).toBeCloseTo(-2 * fee, 6);
        }
      )
    );
  });
});

const PORTFOLIO: PortfolioState = {
  equityUsd: 1234.5,
  cashUsd: 1000,
  dailyPnlPct: 1.5,
  totalExposurePct: 12,
  positions: [
    { productId: "BTC-USD", baseSize: 0.5, notionalUsd: 234.5, exposurePct: 19, averageEntryPrice: 469 }
  ]
};

async function seedFill(
  db: PgliteExecutor,
  args: { side: "BUY" | "SELL"; price: number; baseSize: number; feeUsd: number; filledAt: string }
): Promise<void> {
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

describe("PostgresOperatorRepository (pglite-backed)", () => {
  let db: PgliteExecutor;
  let repo: PostgresOperatorRepository;

  beforeAll(async () => {
    db = await createMigratedPglite();
    repo = new PostgresOperatorRepository(db);
  });

  afterEach(async () => {
    await db.truncateAll();
  });

  it("records every migration version in schema_migrations", async () => {
    const rows = (await db.query("SELECT version FROM schema_migrations ORDER BY version")).rows;
    const versions = rows.map((r) => r.version as string);
    expect(versions).toContain("001_trading_audit");
    expect(versions).toContain("002_operator_state");
  });

  it("ingests a heartbeat: portfolio snapshot, heartbeat row, and audit event", async () => {
    await repo.ingestHeartbeat({
      workerId: "worker-1",
      mode: "paper",
      status: "ok",
      portfolio: PORTFOLIO,
      version: 1,
      correlationId: "00000000-0000-4000-8000-000000000001",
      observedAt: new Date("2026-06-29T12:00:00.000Z")
    });

    const portfolio = await repo.getLatestPortfolio();
    expect(portfolio?.equityUsd).toBeCloseTo(1234.5, 6);
    expect(portfolio?.positions[0]?.productId).toBe("BTC-USD");

    const hb = await repo.getWorkerHeartbeat("worker-1");
    expect(hb?.status).toBe("ok");
    expect(hb?.mode).toBe("paper");

    const audit = await repo.listAuditEvents(10);
    expect(audit.length).toBe(1);
    expect(audit[0]?.actor).toBe("worker");
  });

  it("is idempotent: a retried heartbeat for the same instant is a no-op", async () => {
    const input = {
      workerId: "worker-1",
      mode: "paper" as const,
      status: "ok" as const,
      portfolio: PORTFOLIO,
      version: 1,
      correlationId: "00000000-0000-4000-8000-000000000002",
      observedAt: new Date("2026-06-29T12:00:00.000Z")
    };
    await repo.ingestHeartbeat(input);
    await repo.ingestHeartbeat(input);

    const snaps = (await db.query("SELECT count(*)::int AS c FROM portfolio_snapshots")).rows[0].c;
    const audits = (await db.query("SELECT count(*)::int AS c FROM audit_events")).rows[0].c;
    expect(snaps).toBe(1);
    expect(audits).toBe(1);
  });

  it("returns the most recent snapshot as the latest portfolio", async () => {
    await repo.ingestHeartbeat({
      workerId: "worker-1",
      mode: "paper",
      status: "ok",
      portfolio: { ...PORTFOLIO, equityUsd: 100 },
      version: 1,
      correlationId: "00000000-0000-4000-8000-000000000003",
      observedAt: new Date("2026-06-29T12:00:00.000Z")
    });
    await repo.ingestHeartbeat({
      workerId: "worker-1",
      mode: "paper",
      status: "ok",
      portfolio: { ...PORTFOLIO, equityUsd: 999 },
      version: 2,
      correlationId: "00000000-0000-4000-8000-000000000004",
      observedAt: new Date("2026-06-29T12:05:00.000Z")
    });

    const portfolio = await repo.getLatestPortfolio();
    expect(portfolio?.equityUsd).toBeCloseTo(999, 6);
  });

  it("derives metrics from durable fills, not BUY count", async () => {
    await seedFill(db, { side: "BUY", price: 100, baseSize: 1, feeUsd: 0.1, filledAt: "2026-06-29T10:00:00.000Z" });
    await seedFill(db, { side: "SELL", price: 120, baseSize: 1, feeUsd: 0.1, filledAt: "2026-06-29T11:00:00.000Z" });
    await repo.ingestHeartbeat({
      workerId: "worker-1",
      mode: "paper",
      status: "ok",
      portfolio: PORTFOLIO,
      version: 1,
      correlationId: "00000000-0000-4000-8000-000000000005",
      observedAt: new Date("2026-06-29T12:00:00.000Z")
    });

    const metrics = await repo.getMetrics();
    expect(metrics.totalTrades).toBe(2);
    expect(metrics.wins).toBe(1);
    expect(metrics.losses).toBe(0);
    expect(metrics.realizedPnl).toBeCloseTo(19.8, 6);
    expect(metrics.equityUsd).toBeCloseTo(1234.5, 6);
  });

  it("lists recent fills newest-first", async () => {
    await seedFill(db, { side: "BUY", price: 100, baseSize: 1, feeUsd: 0.1, filledAt: "2026-06-29T10:00:00.000Z" });
    await seedFill(db, { side: "SELL", price: 120, baseSize: 1, feeUsd: 0.1, filledAt: "2026-06-29T11:00:00.000Z" });

    const fills = await repo.listRecentFills(10);
    expect(fills.length).toBe(2);
    expect(fills[0]?.side).toBe("SELL");
    expect(fills[0]?.price).toBeCloseTo(120, 6);
  });

  it("appends idempotent audit events", async () => {
    const event = {
      id: "00000000-0000-4000-8000-0000000000aa",
      type: "ops.pause",
      actor: "operator" as const,
      correlationId: "00000000-0000-4000-8000-0000000000bb",
      occurredAt: new Date("2026-06-29T12:00:00.000Z"),
      summary: "operator paused the loop"
    };
    await repo.recordAuditEvent(event);
    await repo.recordAuditEvent(event);

    const audits = await repo.listAuditEvents(10);
    expect(audits.length).toBe(1);
    expect(audits[0]?.type).toBe("ops.pause");
  });

  it("rolls back the whole ingest if any statement fails", async () => {
    await expect(
      repo.ingestHeartbeat({
        workerId: "worker-1",
        mode: "paper",
        status: "ok",
        portfolio: PORTFOLIO,
        version: 1,
        // invalid uuid -> the audit insert (correlation_id UUID) fails, rolling back the snapshot too
        correlationId: "not-a-uuid",
        observedAt: new Date("2026-06-29T12:00:00.000Z")
      })
    ).rejects.toThrow();

    const snaps = (await db.query("SELECT count(*)::int AS c FROM portfolio_snapshots")).rows[0].c;
    expect(snaps).toBe(0);
  });
});
