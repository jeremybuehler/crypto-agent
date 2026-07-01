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
import { evaluateApproval, type OrderPreview, type ProposalStatus, type StoredProposal } from "@agent/execution";
import type { SqlExecutor } from "./sql-executor.js";
import {
  assertNoSecret,
  type CorrectMemoryInput,
  type CorrectResult,
  type LearnedMemory,
  type MemoryScope,
  type MemoryStatus,
  type UpsertMemoryInput
} from "./learning-memory.js";

export interface ProfileView {
  version: number;
  facts: LearnedMemory[];
  pendingInsights: LearnedMemory[];
}

function rowToMemory(row: Record<string, unknown>): LearnedMemory {
  return {
    id: row.id as string,
    key: row.key as string,
    value: row.value as string,
    scope: row.scope as MemoryScope,
    confidence: num(row.confidence),
    source: row.source as string,
    observedAt: date(row.observed_at),
    version: num(row.version),
    retentionUntil: row.retention_until === null ? null : date(row.retention_until),
    status: row.status as MemoryStatus
  };
}

export interface CreateProposalInput {
  id: string;
  tradeIntentId?: string | null;
  preview: OrderPreview;
  digest: string;
  correlationId: string;
  createdAt: Date;
  expiresAt: Date;
}

export type DecisionReason = "not_found" | "not_pending" | "expired" | "digest_mismatch";

export type DecisionResult =
  | { ok: true; status: "approved" | "rejected"; decidedAt: Date }
  | { ok: false; reason: DecisionReason };

export interface DecideProposalInput {
  proposalId: string;
  decision: "approved" | "rejected";
  digest?: string;
  reason?: string;
  correlationId: string;
  now: Date;
}

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
  /** Why this trade happened, from the originating trade intent. */
  reasonCode: string | null;
  rationale: string | null;
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
  createProposal(input: CreateProposalInput): Promise<void>;
  getProposal(id: string): Promise<StoredProposal | null>;
  listProposals(limit: number, statuses?: ProposalStatus[]): Promise<StoredProposal[]>;
  decideProposal(input: DecideProposalInput): Promise<DecisionResult>;
  upsertMemory(input: UpsertMemoryInput): Promise<LearnedMemory>;
  getProfile(): Promise<ProfileView>;
  correctMemory(input: CorrectMemoryInput): Promise<CorrectResult>;
  setMemoryStatus(id: string, status: MemoryStatus, actor: "operator" | "worker" | "system"): Promise<boolean>;
  exportMemories(): Promise<LearnedMemory[]>;
  saveAdvice(input: SaveAdviceInput): Promise<void>;
  close(): Promise<void>;
}

export interface SaveAdviceInput {
  id: string;
  profileVersion: number;
  question: string;
  summary: string;
  payload: unknown;
  correlationId: string;
  createdAt: Date;
}

function rowToProposal(row: Record<string, unknown>): StoredProposal {
  return {
    id: row.id as string,
    status: row.status as ProposalStatus,
    preview: {
      productId: row.product_id as string,
      side: row.side as Side,
      quoteSizeUsd: num(row.quote_size_usd),
      baseSize: num(row.base_size),
      limitPrice: row.limit_price === null ? null : num(row.limit_price),
      estimatedFeeUsd: num(row.estimated_fee_usd),
      estimatedSlippageBps: num(row.estimated_slippage_bps)
    },
    digest: row.digest as string,
    createdAt: date(row.created_at),
    expiresAt: date(row.expires_at)
  };
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
    filledAt: date(row.filled_at),
    reasonCode: (row.reason_code as string | undefined) ?? null,
    rationale: (row.rationale as string | undefined) ?? null
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
      `SELECT f.id, f.product_id, f.side, f.quote_size_usd, f.price, f.base_size, f.fee_usd, f.filled_at,
              i.reason_code, i.rationale
         FROM paper_fills f
         LEFT JOIN trade_intents i ON i.id = f.trade_intent_id
        ORDER BY f.filled_at DESC
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

  async createProposal(input: CreateProposalInput): Promise<void> {
    await this.executor.query(
      `INSERT INTO proposals
         (id, status, trade_intent_id, product_id, side, quote_size_usd, base_size, limit_price,
          estimated_fee_usd, estimated_slippage_bps, digest, correlation_id, created_at, expires_at)
       VALUES ($1, 'pending', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO NOTHING`,
      [
        input.id,
        input.tradeIntentId ?? null,
        input.preview.productId,
        input.preview.side,
        input.preview.quoteSizeUsd,
        input.preview.baseSize,
        input.preview.limitPrice,
        input.preview.estimatedFeeUsd,
        input.preview.estimatedSlippageBps,
        input.digest,
        input.correlationId,
        input.createdAt,
        input.expiresAt
      ]
    );
  }

  async getProposal(id: string): Promise<StoredProposal | null> {
    const result = await this.executor.query("SELECT * FROM proposals WHERE id = $1", [id]);
    const row = result.rows[0];
    return row ? rowToProposal(row) : null;
  }

  async listProposals(limit: number, statuses?: ProposalStatus[]): Promise<StoredProposal[]> {
    const result = statuses?.length
      ? await this.executor.query(
          "SELECT * FROM proposals WHERE status = ANY($1::text[]) ORDER BY created_at DESC LIMIT $2",
          [statuses, limit]
        )
      : await this.executor.query("SELECT * FROM proposals ORDER BY created_at DESC LIMIT $1", [limit]);
    return result.rows.map(rowToProposal);
  }

  async decideProposal(input: DecideProposalInput): Promise<DecisionResult> {
    return this.executor.transaction(async (tx) => {
      // FOR UPDATE serializes concurrent deciders: the second waits, then sees a
      // non-pending status. The UNIQUE(proposal_id) decision row is a backstop.
      const found = await tx.query("SELECT * FROM proposals WHERE id = $1 FOR UPDATE", [input.proposalId]);
      const row = found.rows[0];
      if (!row) return { ok: false, reason: "not_found" };
      const proposal = rowToProposal(row);

      if (input.decision === "approved") {
        const verdict = evaluateApproval(proposal, input.digest ?? "", input.now);
        if (!verdict.ok) {
          return { ok: false, reason: verdict.reason };
        }
      } else if (proposal.status !== "pending") {
        return { ok: false, reason: "not_pending" };
      }

      await tx.query(
        `INSERT INTO proposal_decisions (proposal_id, decision, digest, reason, correlation_id, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.proposalId, input.decision, input.digest ?? null, input.reason ?? null, input.correlationId, input.now]
      );
      await tx.query("UPDATE proposals SET status = $2 WHERE id = $1", [input.proposalId, input.decision]);
      return { ok: true, status: input.decision, decidedAt: input.now };
    });
  }

  async upsertMemory(input: UpsertMemoryInput): Promise<LearnedMemory> {
    assertNoSecret(input.key, input.value);
    return this.executor.transaction(async (tx) => {
      const existing = await tx.query("SELECT * FROM profile_memories WHERE key = $1 FOR UPDATE", [input.key]);
      const prev = existing.rows[0];
      let memory: LearnedMemory;
      if (prev) {
        const updated = await tx.query(
          `UPDATE profile_memories
              SET value = $2, scope = $3, confidence = $4, source = $5, observed_at = $6,
                  status = $7, retention_until = $8, version = version + 1, updated_at = now()
            WHERE key = $1
            RETURNING *`,
          [input.key, input.value, input.scope, input.confidence, input.source, input.observedAt, input.status, input.retentionUntil ?? null]
        );
        memory = rowToMemory(updated.rows[0]!);
        await this.appendHistory(tx, memory.id, "observed", prev.value as string, input.value, input.actor);
      } else {
        const inserted = await tx.query(
          `INSERT INTO profile_memories (key, value, scope, confidence, source, observed_at, status, retention_until)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [input.key, input.value, input.scope, input.confidence, input.source, input.observedAt, input.status, input.retentionUntil ?? null]
        );
        memory = rowToMemory(inserted.rows[0]!);
        await this.appendHistory(tx, memory.id, "created", null, input.value, input.actor);
      }
      return memory;
    });
  }

  async getProfile(): Promise<ProfileView> {
    const result = await this.executor.query(
      "SELECT * FROM profile_memories WHERE status IN ('active', 'pending') ORDER BY updated_at DESC"
    );
    const memories = result.rows.map(rowToMemory);
    const version = memories.reduce((max, m) => Math.max(max, m.version), 0);
    return {
      version,
      facts: memories.filter((m) => m.status === "active"),
      pendingInsights: memories.filter((m) => m.status === "pending")
    };
  }

  async correctMemory(input: CorrectMemoryInput): Promise<CorrectResult> {
    assertNoSecret("value", input.value);
    return this.executor.transaction(async (tx) => {
      const found = await tx.query("SELECT * FROM profile_memories WHERE id = $1 FOR UPDATE", [input.id]);
      const row = found.rows[0];
      if (!row) return { ok: false, reason: "not_found" };
      if (num(row.version) !== input.expectedVersion) return { ok: false, reason: "version_conflict" };
      const updated = await tx.query(
        `UPDATE profile_memories SET value = $2, status = 'active', version = version + 1, updated_at = now()
          WHERE id = $1 RETURNING version`,
        [input.id, input.value]
      );
      await this.appendHistory(tx, input.id, "corrected", row.value as string, input.value, input.actor);
      return { ok: true, version: num(updated.rows[0]!.version) };
    });
  }

  async setMemoryStatus(id: string, status: MemoryStatus, actor: "operator" | "worker" | "system"): Promise<boolean> {
    return this.executor.transaction(async (tx) => {
      const found = await tx.query("SELECT value FROM profile_memories WHERE id = $1 FOR UPDATE", [id]);
      if (!found.rows[0]) return false;
      await tx.query("UPDATE profile_memories SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
      const changeType = status === "rejected" ? "rejected" : status === "deleted" ? "deleted" : "corrected";
      await this.appendHistory(tx, id, changeType, found.rows[0].value as string, null, actor);
      return true;
    });
  }

  async exportMemories(): Promise<LearnedMemory[]> {
    const result = await this.executor.query("SELECT * FROM profile_memories ORDER BY created_at ASC");
    return result.rows.map(rowToMemory);
  }

  async saveAdvice(input: SaveAdviceInput): Promise<void> {
    await this.executor.query(
      `INSERT INTO advice_records (id, profile_version, jurisdiction, question, summary, payload, correlation_id, created_at)
       VALUES ($1, $2, 'US', $3, $4, $5, $6, $7)`,
      [input.id, input.profileVersion, input.question, input.summary, JSON.stringify(input.payload), input.correlationId, input.createdAt]
    );
  }

  private async appendHistory(
    tx: { query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> },
    memoryId: string,
    changeType: string,
    oldValue: string | null,
    newValue: string | null,
    actor: string
  ): Promise<void> {
    await tx.query(
      `INSERT INTO profile_memory_history (memory_id, change_type, old_value, new_value, actor)
       VALUES ($1, $2, $3, $4, $5)`,
      [memoryId, changeType, oldValue, newValue, actor]
    );
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
  private proposals = new Map<string, StoredProposal>();
  private memories = new Map<string, LearnedMemory>();

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

  async createProposal(input: CreateProposalInput): Promise<void> {
    if (this.proposals.has(input.id)) return;
    this.proposals.set(input.id, {
      id: input.id,
      status: "pending",
      preview: input.preview,
      digest: input.digest,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt
    });
  }

  async getProposal(id: string): Promise<StoredProposal | null> {
    return this.proposals.get(id) ?? null;
  }

  async listProposals(limit: number, statuses?: ProposalStatus[]): Promise<StoredProposal[]> {
    return [...this.proposals.values()]
      .filter((p) => !statuses?.length || statuses.includes(p.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async decideProposal(input: DecideProposalInput): Promise<DecisionResult> {
    const proposal = this.proposals.get(input.proposalId);
    if (!proposal) return { ok: false, reason: "not_found" };
    if (input.decision === "approved") {
      const verdict = evaluateApproval(proposal, input.digest ?? "", input.now);
      if (!verdict.ok) return { ok: false, reason: verdict.reason };
    } else if (proposal.status !== "pending") {
      return { ok: false, reason: "not_pending" };
    }
    this.proposals.set(input.proposalId, { ...proposal, status: input.decision });
    return { ok: true, status: input.decision, decidedAt: input.now };
  }

  async upsertMemory(input: UpsertMemoryInput): Promise<LearnedMemory> {
    assertNoSecret(input.key, input.value);
    const existing = [...this.memories.values()].find((m) => m.key === input.key);
    const memory: LearnedMemory = {
      id: existing?.id ?? randomUUID(),
      key: input.key,
      value: input.value,
      scope: input.scope,
      confidence: input.confidence,
      source: input.source,
      observedAt: input.observedAt,
      version: (existing?.version ?? 0) + 1,
      retentionUntil: input.retentionUntil ?? null,
      status: input.status
    };
    this.memories.set(memory.id, memory);
    return memory;
  }

  async getProfile(): Promise<ProfileView> {
    const memories = [...this.memories.values()].filter((m) => m.status === "active" || m.status === "pending");
    return {
      version: memories.reduce((max, m) => Math.max(max, m.version), 0),
      facts: memories.filter((m) => m.status === "active"),
      pendingInsights: memories.filter((m) => m.status === "pending")
    };
  }

  async correctMemory(input: CorrectMemoryInput): Promise<CorrectResult> {
    assertNoSecret("value", input.value);
    const memory = this.memories.get(input.id);
    if (!memory) return { ok: false, reason: "not_found" };
    if (memory.version !== input.expectedVersion) return { ok: false, reason: "version_conflict" };
    const updated = { ...memory, value: input.value, status: "active" as MemoryStatus, version: memory.version + 1 };
    this.memories.set(input.id, updated);
    return { ok: true, version: updated.version };
  }

  async setMemoryStatus(id: string, status: MemoryStatus): Promise<boolean> {
    const memory = this.memories.get(id);
    if (!memory) return false;
    this.memories.set(id, { ...memory, status });
    return true;
  }

  async exportMemories(): Promise<LearnedMemory[]> {
    return [...this.memories.values()];
  }

  async saveAdvice(): Promise<void> {}

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
