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

/** Execution mode for a real (non-paper) fill. */
export type ExecutionMode = "sandbox" | "live";

/**
 * A proposal atomically claimed for execution (status flipped approved ->
 * executing). Carries the `tradeIntentId` — dropped by `StoredProposal` but
 * required for the fill's foreign key.
 */
export interface ClaimedProposal {
  id: string;
  tradeIntentId: string | null;
  preview: OrderPreview;
  digest: string;
  createdAt: Date;
  expiresAt: Date;
}

/** A real, exchange-confirmed fill written when a proposal is marked executed. */
export interface ExecutedFillInput {
  fillId: string;
  tradeIntentId: string;
  proposalId: string;
  productId: string;
  side: Side;
  quoteSizeUsd: number;
  price: number;
  baseSize: number;
  feeUsd: number;
  filledAt: Date;
  mode: ExecutionMode;
  exchangeOrderId: string;
  clientOrderId: string;
}

export interface MarkProposalExecutedInput {
  proposalId: string;
  fill: ExecutedFillInput;
  auditId: string;
  correlationId: string;
  now: Date;
}

export interface MarkProposalExecutionFailedInput {
  proposalId: string;
  /** Redacted reason — never a raw exchange payload. */
  reason: string;
  auditId: string;
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
  /** Originating proposal (null for paper auto-fills) — the trade-story anchor. */
  proposalId: string | null;
}

export interface RealizedMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  totalFees: number;
  realizedPnl: number;
}

/** An OHLC candle aggregated from market snapshots. `time` is epoch millis. */
export interface PriceCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
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

/**
 * The reconstructed causal chain for one proposal — the audit trail told as a
 * story for the educational assistant. Every section is nullable: a partial
 * chain (e.g. an expired proposal that never executed) returns partial data
 * with explicit gaps, never a throw. Read-only by construction.
 */
export interface TradeStory {
  proposal: (StoredProposal & { executedAt: Date | null; exchangeOrderId: string | null }) | null;
  /** The operator's approve/reject, when one was recorded. */
  operatorDecision: { decision: "approved" | "rejected"; decidedAt: Date } | null;
  intent: {
    id: string;
    productId: string;
    side: Side;
    quoteSizeUsd: number;
    confidence: number;
    reasonCode: string;
    rationale: string;
    createdAt: Date;
  } | null;
  /** All risk evaluations for the intent — intent-time and execution-time re-check. */
  riskDecisions: Array<{
    approved: boolean;
    reasons: string[];
    ruleResults: Array<{ rule: string; passed: boolean; message: string }>;
    checkedAt: Date;
  }>;
  fill: {
    productId: string;
    side: Side;
    quoteSizeUsd: number;
    price: number;
    baseSize: number;
    feeUsd: number;
    filledAt: Date;
    mode: string;
  } | null;
  /** Nearest AI market context before the intent (linked by product + time, not FK). */
  aiContext: {
    marketRegime: string;
    confidence: number;
    doNotTrade: boolean;
    output: Record<string, unknown>;
    createdAt: Date;
  } | null;
  /** Nearest market snapshot before the intent (linked by product + time, not FK). */
  marketSnapshot: { price: number; bid: number; ask: number; spreadBps: number; sourceTimestamp: Date } | null;
  auditEvents: AuditEventRow[];
}

export interface OperatorRepository {
  /** Cheap connectivity probe for readiness checks. */
  ping(): Promise<boolean>;
  getLatestPortfolio(): Promise<PortfolioSnapshot | null>;
  listRecentFills(limit: number): Promise<FillRow[]>;
  getCandles(productId: string, bucketSeconds: number, limit: number): Promise<PriceCandle[]>;
  getMetrics(): Promise<RealizedMetrics & { equityUsd: number | null }>;
  getWorkerHeartbeat(workerId: string): Promise<WorkerHeartbeat | null>;
  recordAuditEvent(event: AuditEventInput): Promise<void>;
  listAuditEvents(limit: number): Promise<AuditEventRow[]>;
  ingestHeartbeat(input: IngestHeartbeatInput): Promise<void>;
  /** Reconstruct the causal chain for a proposal (read-only; partial chains allowed). */
  getTradeStory(proposalId: string): Promise<TradeStory>;
  createProposal(input: CreateProposalInput): Promise<void>;
  getProposal(id: string): Promise<StoredProposal | null>;
  listProposals(limit: number, statuses?: ProposalStatus[]): Promise<StoredProposal[]>;
  decideProposal(input: DecideProposalInput): Promise<DecisionResult>;
  /**
   * Atomically claim the oldest approved proposal for execution (approved ->
   * executing). Exactly-once via `FOR UPDATE SKIP LOCKED`: concurrent claimers
   * get different rows or null. Returns null when nothing is approved.
   */
  claimNextApprovedProposal(now: Date): Promise<ClaimedProposal | null>;
  /** executing -> executed, plus the real fill and audit event, in one tx. Idempotent. */
  markProposalExecuted(input: MarkProposalExecutedInput): Promise<void>;
  /** executing -> execution_failed (terminal) plus audit event. Idempotent. */
  markProposalExecutionFailed(input: MarkProposalExecutionFailedInput): Promise<void>;
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

/** JSONB columns arrive parsed from pg; tolerate stringified values from other executors. */
function jsonColumn<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

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
    rationale: (row.rationale as string | undefined) ?? null,
    proposalId: (row.proposal_id as string | undefined) ?? null
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
              f.proposal_id, i.reason_code, i.rationale
         FROM paper_fills f
         LEFT JOIN trade_intents i ON i.id = f.trade_intent_id
        ORDER BY f.filled_at DESC
        LIMIT $1`,
      [limit]
    );
    return result.rows.map(rowToFill);
  }

  async getCandles(productId: string, bucketSeconds: number, limit: number): Promise<PriceCandle[]> {
    const result = await this.executor.query(
      `SELECT (floor(extract(epoch FROM created_at) / $2) * $2)::bigint AS bucket,
              (array_agg(price ORDER BY created_at ASC))[1]  AS open,
              max(price) AS high,
              min(price) AS low,
              (array_agg(price ORDER BY created_at DESC))[1] AS close
         FROM market_snapshots
        WHERE product_id = $1
        GROUP BY bucket
        ORDER BY bucket DESC
        LIMIT $3`,
      [productId, bucketSeconds, limit]
    );
    // Query is newest-first for the limit; return oldest-first for charting.
    return result.rows
      .map((row) => ({
        time: num(row.bucket) * 1000,
        open: num(row.open),
        high: num(row.high),
        low: num(row.low),
        close: num(row.close)
      }))
      .reverse();
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

  async getTradeStory(proposalId: string): Promise<TradeStory> {
    const story: TradeStory = {
      proposal: null,
      operatorDecision: null,
      intent: null,
      riskDecisions: [],
      fill: null,
      aiContext: null,
      marketSnapshot: null,
      auditEvents: []
    };

    const proposalResult = await this.executor.query("SELECT * FROM proposals WHERE id = $1", [proposalId]);
    const proposalRow = proposalResult.rows[0];
    if (proposalRow) {
      story.proposal = {
        ...rowToProposal(proposalRow),
        executedAt: proposalRow.executed_at ? date(proposalRow.executed_at) : null,
        exchangeOrderId: (proposalRow.exchange_order_id as string | null) ?? null
      };
    }

    const decisionResult = await this.executor.query(
      "SELECT decision, decided_at FROM proposal_decisions WHERE proposal_id = $1",
      [proposalId]
    );
    const decisionRow = decisionResult.rows[0];
    if (decisionRow) {
      story.operatorDecision = {
        decision: decisionRow.decision as "approved" | "rejected",
        decidedAt: date(decisionRow.decided_at)
      };
    }

    const intentId = proposalRow?.trade_intent_id as string | null | undefined;
    if (intentId) {
      const intentResult = await this.executor.query("SELECT * FROM trade_intents WHERE id = $1", [intentId]);
      const intentRow = intentResult.rows[0];
      if (intentRow) {
        story.intent = {
          id: intentRow.id as string,
          productId: intentRow.product_id as string,
          side: intentRow.side as Side,
          quoteSizeUsd: num(intentRow.quote_size_usd),
          confidence: num(intentRow.confidence),
          reasonCode: intentRow.reason_code as string,
          rationale: intentRow.rationale as string,
          createdAt: date(intentRow.created_at)
        };
      }

      const riskResult = await this.executor.query(
        "SELECT approved, reasons, rule_results, checked_at FROM risk_decisions WHERE trade_intent_id = $1 ORDER BY checked_at ASC",
        [intentId]
      );
      story.riskDecisions = riskResult.rows.map((row) => ({
        approved: row.approved as boolean,
        reasons: jsonColumn<string[]>(row.reasons, []),
        ruleResults: jsonColumn<Array<{ rule: string; passed: boolean; message: string }>>(row.rule_results, []),
        checkedAt: date(row.checked_at)
      }));
    }

    const fillResult = await this.executor.query(
      "SELECT product_id, side, quote_size_usd, price, base_size, fee_usd, filled_at, mode FROM paper_fills WHERE proposal_id = $1 ORDER BY filled_at DESC LIMIT 1",
      [proposalId]
    );
    const fillRow = fillResult.rows[0];
    if (fillRow) {
      story.fill = {
        productId: fillRow.product_id as string,
        side: fillRow.side as Side,
        quoteSizeUsd: num(fillRow.quote_size_usd),
        price: num(fillRow.price),
        baseSize: num(fillRow.base_size),
        feeUsd: num(fillRow.fee_usd),
        filledAt: date(fillRow.filled_at),
        mode: fillRow.mode as string
      };
    }

    // AI context and market snapshot have no FK to the intent — join by product
    // and nearest-before time. Anchor on the intent when it exists, else the
    // proposal, so orphaned proposals still get market context.
    const anchorProduct = story.intent?.productId ?? story.proposal?.preview.productId;
    const anchorAt = story.intent?.createdAt ?? story.proposal?.createdAt;
    if (anchorProduct && anchorAt) {
      const contextResult = await this.executor.query(
        `SELECT market_regime, confidence, do_not_trade, output_json, created_at
           FROM ai_contexts WHERE product_id = $1 AND created_at <= $2
          ORDER BY created_at DESC LIMIT 1`,
        [anchorProduct, anchorAt]
      );
      const contextRow = contextResult.rows[0];
      if (contextRow) {
        story.aiContext = {
          marketRegime: contextRow.market_regime as string,
          confidence: num(contextRow.confidence),
          doNotTrade: contextRow.do_not_trade as boolean,
          output: jsonColumn<Record<string, unknown>>(contextRow.output_json, {}),
          createdAt: date(contextRow.created_at)
        };
      }

      const snapshotResult = await this.executor.query(
        `SELECT price, bid, ask, spread_bps, source_timestamp
           FROM market_snapshots WHERE product_id = $1 AND created_at <= $2
          ORDER BY created_at DESC LIMIT 1`,
        [anchorProduct, anchorAt]
      );
      const snapshotRow = snapshotResult.rows[0];
      if (snapshotRow) {
        story.marketSnapshot = {
          price: num(snapshotRow.price),
          bid: num(snapshotRow.bid),
          ask: num(snapshotRow.ask),
          spreadBps: num(snapshotRow.spread_bps),
          sourceTimestamp: date(snapshotRow.source_timestamp)
        };
      }
    }

    const auditResult = await this.executor.query(
      `SELECT id, type, actor, correlation_id, occurred_at, summary, metadata
         FROM audit_events WHERE correlation_id = $1
        ORDER BY occurred_at ASC LIMIT 50`,
      [proposalId]
    );
    story.auditEvents = auditResult.rows.map((row) => {
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

    return story;
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

  async claimNextApprovedProposal(now: Date): Promise<ClaimedProposal | null> {
    // Single-statement atomic claim. The inner SELECT ... FOR UPDATE SKIP LOCKED
    // reserves at most one approved row; a concurrent claimer skips it and takes
    // the next (or none). RETURNING gives us the claimed row.
    const result = await this.executor.query(
      `UPDATE proposals SET status = 'executing', claimed_at = $1
         WHERE id = (
           SELECT id FROM proposals
            WHERE status = 'approved'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
         )
       RETURNING *`,
      [now]
    );
    const row = result.rows[0];
    if (!row) return null;
    const proposal = rowToProposal(row);
    return {
      id: proposal.id,
      tradeIntentId: (row.trade_intent_id as string | null) ?? null,
      preview: proposal.preview,
      digest: proposal.digest,
      createdAt: proposal.createdAt,
      expiresAt: proposal.expiresAt
    };
  }

  async markProposalExecuted(input: MarkProposalExecutedInput): Promise<void> {
    await this.executor.transaction(async (tx) => {
      // Guard the flip on the `executing` state and RETURN it: a duplicate call
      // (status already `executed`) matches zero rows, so we skip the fill and
      // audit inserts — the first call already wrote them. The whole thing is
      // one transaction, so a failed fill insert rolls the status flip back too.
      const updated = await tx.query(
        `UPDATE proposals
            SET status = 'executed', executed_at = $2, exchange_order_id = $3, client_order_id = $4
          WHERE id = $1 AND status = 'executing'
        RETURNING id`,
        [input.proposalId, input.now, input.fill.exchangeOrderId, input.fill.clientOrderId]
      );
      if (updated.rows.length === 0) return;

      const f = input.fill;
      await tx.query(
        `INSERT INTO paper_fills
           (id, trade_intent_id, product_id, side, quote_size_usd, price, base_size, fee_usd, filled_at,
            mode, exchange_order_id, client_order_id, proposal_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (client_order_id) WHERE client_order_id IS NOT NULL DO NOTHING`,
        [
          f.fillId,
          f.tradeIntentId,
          f.productId,
          f.side,
          f.quoteSizeUsd,
          f.price,
          f.baseSize,
          f.feeUsd,
          f.filledAt,
          f.mode,
          f.exchangeOrderId,
          f.clientOrderId,
          f.proposalId
        ]
      );

      await tx.query(
        `INSERT INTO audit_events (id, type, actor, correlation_id, occurred_at, summary, metadata)
         VALUES ($1, 'proposal.executed', 'worker', $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [
          input.auditId,
          input.correlationId,
          input.now,
          `executed ${f.mode} ${f.side} ${f.productId} (order ${f.exchangeOrderId})`,
          JSON.stringify({ mode: f.mode, exchangeOrderId: f.exchangeOrderId, proposalId: f.proposalId })
        ]
      );
    });
  }

  async markProposalExecutionFailed(input: MarkProposalExecutionFailedInput): Promise<void> {
    await this.executor.transaction(async (tx) => {
      const updated = await tx.query(
        `UPDATE proposals SET status = 'execution_failed', executed_at = $2
          WHERE id = $1 AND status = 'executing'
        RETURNING id`,
        [input.proposalId, input.now]
      );
      if (updated.rows.length === 0) return;
      await tx.query(
        `INSERT INTO audit_events (id, type, actor, correlation_id, occurred_at, summary, metadata)
         VALUES ($1, 'proposal.execution_failed', 'worker', $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [
          input.auditId,
          input.correlationId,
          input.now,
          `execution failed for proposal ${input.proposalId}: ${input.reason}`,
          JSON.stringify({ reason: input.reason })
        ]
      );
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
  private proposalTradeIntents = new Map<string, string | null>();
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

  async getCandles(): Promise<PriceCandle[]> {
    // Market snapshots are not tracked in the in-memory repo (hermetic tests).
    return [];
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
    this.proposalTradeIntents.set(input.id, input.tradeIntentId ?? null);
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

  async getTradeStory(proposalId: string): Promise<TradeStory> {
    // In-memory keeps only proposals and audit events; the worker pipeline
    // tables (intents, risk decisions, contexts) live in Postgres. Partial
    // stories are the contract, so hermetic API tests still exercise the shape.
    const proposal = this.proposals.get(proposalId) ?? null;
    return {
      proposal: proposal ? { ...proposal, executedAt: null, exchangeOrderId: null } : null,
      operatorDecision: null,
      intent: null,
      riskDecisions: [],
      fill: null,
      aiContext: null,
      marketSnapshot: null,
      auditEvents: this.audit.filter((event) => event.correlationId === proposalId)
    };
  }

  async claimNextApprovedProposal(now: Date): Promise<ClaimedProposal | null> {
    const approved = [...this.proposals.values()]
      .filter((p) => p.status === "approved")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const next = approved[0];
    if (!next) return null;
    this.proposals.set(next.id, { ...next, status: "executing" });
    void now;
    return {
      id: next.id,
      tradeIntentId: this.proposalTradeIntents.get(next.id) ?? null,
      preview: next.preview,
      digest: next.digest,
      createdAt: next.createdAt,
      expiresAt: next.expiresAt
    };
  }

  async markProposalExecuted(input: MarkProposalExecutedInput): Promise<void> {
    const proposal = this.proposals.get(input.proposalId);
    if (!proposal || proposal.status !== "executing") return;
    this.proposals.set(input.proposalId, { ...proposal, status: "executed" });
    const f = input.fill;
    if (!this.fills.some((existing) => existing.fillId === f.fillId)) {
      this.fills.push({
        fillId: f.fillId,
        productId: f.productId,
        side: f.side,
        quoteSizeUsd: f.quoteSizeUsd,
        price: f.price,
        baseSize: f.baseSize,
        feeUsd: f.feeUsd,
        filledAt: f.filledAt,
        proposalId: f.proposalId,
        reasonCode: null,
        rationale: null
      });
    }
    this.audit.push({
      id: input.auditId,
      type: "proposal.executed",
      actor: "worker",
      correlationId: input.correlationId,
      occurredAt: input.now,
      summary: `executed ${f.mode} ${f.side} ${f.productId} (order ${f.exchangeOrderId})`
    });
  }

  async markProposalExecutionFailed(input: MarkProposalExecutionFailedInput): Promise<void> {
    const proposal = this.proposals.get(input.proposalId);
    if (!proposal || proposal.status !== "executing") return;
    this.proposals.set(input.proposalId, { ...proposal, status: "execution_failed" });
    this.audit.push({
      id: input.auditId,
      type: "proposal.execution_failed",
      actor: "worker",
      correlationId: input.correlationId,
      occurredAt: input.now,
      summary: `execution failed for proposal ${input.proposalId}: ${input.reason}`
    });
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
