/**
 * Durable operator-facing state: portfolio snapshots, worker heartbeats,
 * immutable audit events, and metrics derived from durable fills.
 *
 * Fills themselves are written by the worker as part of the audit chain
 * (see `paper_fills` in 001_trading_audit.sql); this repository only *reads*
 * them to derive metrics. Portfolio snapshots, heartbeats, and audit events
 * are the new state introduced for T6.3.
 *
 * The Postgres implementation talks to the database through the small
 * `SqlExecutor` seam so it can run against a real `pg.Pool` in production and an
 * embedded pglite instance in tests. An in-memory implementation keeps the
 * hermetic API unit/security tests free of any database.
 */
import { randomUUID } from "node:crypto";
import type { SqlExecutor } from "./sql-executor.js";

export type Side = "BUY" | "SELL";
export type ComponentStatus = "ok" | "degraded" | "down";

/**
 * Structural portfolio shape stored as JSONB. Deliberately uses a plain-string
 * `productId` (not core's branded `ProductId`) so persistence does not couple to
 * domain branding — values arrive validated from the API contract boundary.
 */
export interface PortfolioPosition {
  productId: string;
  baseSize: number;
  notionalUsd: number;
  exposurePct: number;
  averageEntryPrice: number;
}

export interface PortfolioSnapshot {
  equityUsd: number;
  cashUsd: number;
  dailyPnlPct: number;
  totalExposurePct: number;
  positions: PortfolioPosition[];
}

/** A single fill, as read back from `paper_fills` for metrics/trade history. */
export interface FillRow {
  fillId: string;
  productId: string;
  side: Side;
  quoteSizeUsd: number;
  price: number;
  baseSize: number;
  feeUsd: number;
  filledAt: Date;
}

export interface RealizedMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  totalFees: number;
  realizedPnl: number;
}

export interface WorkerHeartbeat {
  workerId: string;
  lastSeenAt: Date;
  mode: string;
  status: ComponentStatus;
  detail: Record<string, unknown> | null;
}

export interface AuditEventInput {
  id: string;
  type: string;
  actor: "operator" | "worker" | "system";
  correlationId: string;
  occurredAt: Date;
  summary: string;
  metadata?: Record<string, unknown>;
}

export type AuditEventRow = AuditEventInput;

/** One authenticated worker ingestion: portfolio snapshot + heartbeat + audit. */
export interface IngestHeartbeatInput {
  workerId: string;
  mode: string;
  status: ComponentStatus;
  portfolio: PortfolioSnapshot;
  version: number;
  correlationId: string;
  observedAt: Date;
  detail?: Record<string, unknown>;
}

export interface OperatorRepository {
  /** Cheap connectivity probe for readiness checks. */
  ping(): Promise<boolean>;
  getLatestPortfolio(): Promise<PortfolioSnapshot | null>;
  listRecentFills(limit: number): Promise<FillRow[]>;
  getMetrics(): Promise<RealizedMetrics & { equityUsd: number | null }>;
  getWorkerHeartbeat(workerId: string): Promise<WorkerHeartbeat | null>;
  recordAuditEvent(event: AuditEventInput): Promise<void>;
  listAuditEvents(limit: number): Promise<AuditEventRow[]>;
  ingestHeartbeat(input: IngestHeartbeatInput): Promise<void>;
  close(): Promise<void>;
}

/**
 * Derive realized PnL and win/loss from fills using average-cost-basis spot
 * accounting. Fills MUST be ordered oldest-first. A SELL realizes against the
 * running average entry price of the held base quantity for that product; the
 * closing sell is a win when its realized delta is positive. `realizedPnl` is
 * gross realized minus total fees.
 */
export function computeRealizedMetrics(fills: FillRow[]): RealizedMetrics {
  const books = new Map<string, { baseQty: number; avgCost: number }>();
  let wins = 0;
  let losses = 0;
  let totalFees = 0;
  let grossRealized = 0;

  for (const fill of fills) {
    totalFees += fill.feeUsd;
    const book = books.get(fill.productId) ?? { baseQty: 0, avgCost: 0 };

    if (fill.side === "BUY") {
      const newQty = book.baseQty + fill.baseSize;
      book.avgCost = newQty === 0 ? 0 : (book.avgCost * book.baseQty + fill.price * fill.baseSize) / newQty;
      book.baseQty = newQty;
    } else {
      const closedQty = Math.min(fill.baseSize, book.baseQty);
      const realized = (fill.price - book.avgCost) * closedQty;
      grossRealized += realized;
      book.baseQty = Math.max(0, book.baseQty - fill.baseSize);
      if (realized > 0) wins += 1;
      else losses += 1;
    }

    books.set(fill.productId, book);
  }

  return {
    totalTrades: fills.length,
    wins,
    losses,
    totalFees,
    realizedPnl: grossRealized - totalFees
  };
}

// ---------------------------------------------------------------------------
// Coercion helpers — Postgres/pglite return NUMERIC as strings and TIMESTAMPTZ
// as Date-or-string depending on driver; normalize at the boundary.
// ---------------------------------------------------------------------------

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function date(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function rowToFill(row: Record<string, unknown>): FillRow {
  return {
    fillId: row.id as string,
    productId: row.product_id as string,
    side: row.side as Side,
    quoteSizeUsd: num(row.quote_size_usd),
    price: num(row.price),
    baseSize: num(row.base_size),
    feeUsd: num(row.fee_usd),
    filledAt: date(row.filled_at)
  };
}

// ---------------------------------------------------------------------------
// Postgres implementation (over the SqlExecutor seam)
// ---------------------------------------------------------------------------

export class PostgresOperatorRepository implements OperatorRepository {
  constructor(private readonly executor: SqlExecutor) {}

  async ping(): Promise<boolean> {
    try {
      await this.executor.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async getLatestPortfolio(): Promise<PortfolioSnapshot | null> {
    const result = await this.executor.query(
      `SELECT equity_usd, cash_usd, daily_pnl_pct, total_exposure_pct, positions
         FROM portfolio_snapshots
        ORDER BY observed_at DESC, created_at DESC
        LIMIT 1`
    );
    const row = result.rows[0];
    if (!row) return null;
    const positions = (row.positions ?? []) as PortfolioPosition[];
    return {
      equityUsd: num(row.equity_usd),
      cashUsd: num(row.cash_usd),
      dailyPnlPct: num(row.daily_pnl_pct),
      totalExposurePct: num(row.total_exposure_pct),
      positions
    };
  }

  async listRecentFills(limit: number): Promise<FillRow[]> {
    const result = await this.executor.query(
      `SELECT id, product_id, side, quote_size_usd, price, base_size, fee_usd, filled_at
         FROM paper_fills
        ORDER BY filled_at DESC
        LIMIT $1`,
      [limit]
    );
    return result.rows.map(rowToFill);
  }

  async getMetrics(): Promise<RealizedMetrics & { equityUsd: number | null }> {
    const result = await this.executor.query(
      `SELECT id, product_id, side, quote_size_usd, price, base_size, fee_usd, filled_at
         FROM paper_fills
        ORDER BY filled_at ASC`
    );
    const metrics = computeRealizedMetrics(result.rows.map(rowToFill));
    const portfolio = await this.getLatestPortfolio();
    return { ...metrics, equityUsd: portfolio?.equityUsd ?? null };
  }

  async getWorkerHeartbeat(workerId: string): Promise<WorkerHeartbeat | null> {
    const result = await this.executor.query(
      `SELECT worker_id, last_seen_at, mode, status, detail
         FROM worker_heartbeats
        WHERE worker_id = $1`,
      [workerId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      workerId: row.worker_id as string,
      lastSeenAt: date(row.last_seen_at),
      mode: row.mode as string,
      status: row.status as ComponentStatus,
      detail: (row.detail ?? null) as Record<string, unknown> | null
    };
  }

  async recordAuditEvent(event: AuditEventInput): Promise<void> {
    await this.executor.query(
      `INSERT INTO audit_events (id, type, actor, correlation_id, occurred_at, summary, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        event.id,
        event.type,
        event.actor,
        event.correlationId,
        event.occurredAt,
        event.summary,
        event.metadata ? JSON.stringify(event.metadata) : null
      ]
    );
  }

  async listAuditEvents(limit: number): Promise<AuditEventRow[]> {
    const result = await this.executor.query(
      `SELECT id, type, actor, correlation_id, occurred_at, summary, metadata
         FROM audit_events
        ORDER BY occurred_at DESC, created_at DESC
        LIMIT $1`,
      [limit]
    );
    return result.rows.map((row) => {
      const event: AuditEventRow = {
        id: row.id as string,
        type: row.type as string,
        actor: row.actor as AuditEventInput["actor"],
        correlationId: row.correlation_id as string,
        occurredAt: date(row.occurred_at),
        summary: row.summary as string
      };
      if (row.metadata != null) event.metadata = row.metadata as Record<string, unknown>;
      return event;
    });
  }

  async ingestHeartbeat(input: IngestHeartbeatInput): Promise<void> {
    await this.executor.transaction(async (tx) => {
      const inserted = await tx.query(
        `INSERT INTO portfolio_snapshots
           (worker_id, equity_usd, cash_usd, daily_pnl_pct, total_exposure_pct, positions, version, correlation_id, observed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (worker_id, observed_at) DO NOTHING
         RETURNING id`,
        [
          input.workerId,
          input.portfolio.equityUsd,
          input.portfolio.cashUsd,
          input.portfolio.dailyPnlPct,
          input.portfolio.totalExposurePct,
          JSON.stringify(input.portfolio.positions),
          input.version,
          input.correlationId,
          input.observedAt
        ]
      );

      // Duplicate retry for the same instant: the whole ingest is a no-op.
      if (inserted.rows.length === 0) return;

      await tx.query(
        `INSERT INTO worker_heartbeats (worker_id, last_seen_at, mode, status, detail, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (worker_id) DO UPDATE
           SET last_seen_at = EXCLUDED.last_seen_at,
               mode = EXCLUDED.mode,
               status = EXCLUDED.status,
               detail = EXCLUDED.detail,
               updated_at = now()`,
        [input.workerId, input.observedAt, input.mode, input.status, input.detail ? JSON.stringify(input.detail) : null]
      );

      await tx.query(
        `INSERT INTO audit_events (id, type, actor, correlation_id, occurred_at, summary, metadata)
         VALUES (gen_random_uuid(), 'worker.heartbeat', 'worker', $1, $2, $3, $4)`,
        [
          input.correlationId,
          input.observedAt,
          `worker ${input.workerId} heartbeat (${input.status})`,
          input.detail ? JSON.stringify(input.detail) : null
        ]
      );
    });
  }

  async close(): Promise<void> {
    await this.executor.close();
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation — keeps hermetic API unit/security tests DB-free.
// ---------------------------------------------------------------------------

export class InMemoryOperatorRepository implements OperatorRepository {
  private snapshots: Array<{ observedAt: Date; portfolio: PortfolioSnapshot; key: string }> = [];
  private fills: FillRow[] = [];
  private heartbeats = new Map<string, WorkerHeartbeat>();
  private audit: AuditEventRow[] = [];

  /** Test seam: seed fills (the worker writes these via the audit chain). */
  seedFills(fills: FillRow[]): void {
    this.fills.push(...fills);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async getLatestPortfolio(): Promise<PortfolioSnapshot | null> {
    if (this.snapshots.length === 0) return null;
    return [...this.snapshots].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0]!.portfolio;
  }

  async listRecentFills(limit: number): Promise<FillRow[]> {
    return [...this.fills].sort((a, b) => b.filledAt.getTime() - a.filledAt.getTime()).slice(0, limit);
  }

  async getMetrics(): Promise<RealizedMetrics & { equityUsd: number | null }> {
    const ordered = [...this.fills].sort((a, b) => a.filledAt.getTime() - b.filledAt.getTime());
    const portfolio = await this.getLatestPortfolio();
    return { ...computeRealizedMetrics(ordered), equityUsd: portfolio?.equityUsd ?? null };
  }

  async getWorkerHeartbeat(workerId: string): Promise<WorkerHeartbeat | null> {
    return this.heartbeats.get(workerId) ?? null;
  }

  async recordAuditEvent(event: AuditEventInput): Promise<void> {
    if (this.audit.some((e) => e.id === event.id)) return;
    this.audit.push({ ...event });
  }

  async listAuditEvents(limit: number): Promise<AuditEventRow[]> {
    return [...this.audit].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, limit);
  }

  async ingestHeartbeat(input: IngestHeartbeatInput): Promise<void> {
    const key = `${input.workerId}:${input.observedAt.getTime()}`;
    if (this.snapshots.some((s) => s.key === key)) return;
    this.snapshots.push({ observedAt: input.observedAt, portfolio: input.portfolio, key });
    this.heartbeats.set(input.workerId, {
      workerId: input.workerId,
      lastSeenAt: input.observedAt,
      mode: input.mode,
      status: input.status,
      detail: input.detail ?? null
    });
    const event: AuditEventRow = {
      id: randomUUID(),
      type: "worker.heartbeat",
      actor: "worker",
      correlationId: input.correlationId,
      occurredAt: input.observedAt,
      summary: `worker ${input.workerId} heartbeat (${input.status})`
    };
    if (input.detail) event.metadata = input.detail;
    this.audit.push(event);
  }

  async close(): Promise<void> {}
}

export function createOperatorRepository(options: {
  executor?: SqlExecutor | undefined;
}): OperatorRepository {
  if (options.executor) {
    return new PostgresOperatorRepository(options.executor);
  }
  return new InMemoryOperatorRepository();
}
