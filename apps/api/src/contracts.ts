/**
 * Operator API request/response contracts.
 *
 * Every shape that crosses the API boundary is defined here as a strict Zod
 * schema. Strictness is a safety control, not a style choice (docs/SECURITY.md
 * "Untrusted input and prompt injection"):
 *  - `.strict()` rejects unknown keys so smuggled fields (secrets, overrides)
 *    cannot ride along in a request or leak in a response.
 *  - Bounded string and array sizes cap abuse and accidental payload blowups.
 *  - Auth headers for the operator and the worker are structurally distinct so
 *    one principal's credential cannot satisfy the other's routes.
 *
 * These are the typed contracts only. Route handlers, authentication, and
 * dependency wiring are layered on in later tasks.
 */
import { z } from "zod";
import { ERROR_CODES } from "./errors.js";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const MAX_TEXT_LEN = 4000;
export const MAX_SHORT_TEXT_LEN = 500;
export const MAX_LIST_ITEMS = 200;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const RequestIdSchema = z.string().uuid();
export const ErrorCodeSchema = z.enum(ERROR_CODES);
const ProductIdSchema = z.string().regex(/^[A-Z0-9]+-[A-Z0-9]+$/, "expected a PRODUCT-QUOTE id");
const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/, "expected a lowercase sha256 hex digest");
const IsoDateTimeSchema = z.string().datetime();
const SideSchema = z.enum(["BUY", "SELL"]);
const TradingModeSchema = z.enum(["paper", "sandbox", "live"]);

const ProvenanceSchema = z
  .object({
    source: z.string().min(1).max(MAX_SHORT_TEXT_LEN),
    observedAt: IsoDateTimeSchema,
    version: z.number().int().nonnegative()
  })
  .strict();

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

export const ErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: ErrorCodeSchema,
        message: z.string().min(1).max(MAX_TEXT_LEN),
        requestId: RequestIdSchema,
        details: z.unknown().optional()
      })
      .strict()
  })
  .strict();

// ---------------------------------------------------------------------------
// Authentication headers (operator vs. internal worker, structurally distinct)
// ---------------------------------------------------------------------------

export const OperatorAuthSchema = z
  .object({
    authorization: z.string().regex(/^Bearer\s+(.+)$/, "operator authorization must be a Bearer token")
  })
  .transform((headers) => ({ token: headers.authorization.replace(/^Bearer\s+/, "") }));

export const InternalAuthSchema = z
  .object({
    "x-internal-token": z.string().min(32).max(512)
  })
  .transform((headers) => ({ token: headers["x-internal-token"] }));

// ---------------------------------------------------------------------------
// Capability discovery
// ---------------------------------------------------------------------------

export const FeatureFlagsSchema = z
  .object({
    liveTrading: z.boolean(),
    advice: z.boolean(),
    education: z.boolean(),
    learning: z.boolean(),
    backtest: z.boolean()
  })
  .strict();

export const CapabilitiesResponseSchema = z
  .object({
    mode: TradingModeSchema,
    version: z.string().min(1).max(50),
    jurisdiction: z.string().min(1).max(10),
    features: FeatureFlagsSchema,
    enabledProducts: z.array(ProductIdSchema).max(MAX_LIST_ITEMS)
  })
  .strict();

// ---------------------------------------------------------------------------
// Health: shallow liveness vs. dependency readiness (never carries secrets)
// ---------------------------------------------------------------------------

export const LivenessResponseSchema = z.object({ status: z.literal("ok") }).strict();

const ComponentHealthSchema = z
  .object({
    status: z.enum(["ok", "degraded", "down"]),
    latencyMs: z.number().nonnegative().optional()
  })
  .strict();

export const ReadinessResponseSchema = z
  .object({
    status: z.enum(["ok", "degraded", "down"]),
    components: z
      .object({
        database: ComponentHealthSchema,
        redis: ComponentHealthSchema,
        coinbase: ComponentHealthSchema,
        worker: ComponentHealthSchema
      })
      .strict(),
    checkedAt: IsoDateTimeSchema
  })
  .strict();

// ---------------------------------------------------------------------------
// Profile and learning memory
// ---------------------------------------------------------------------------

export const LearningScopeSchema = z.enum(["explicit", "derived"]);

export const LearningItemSchema = z
  .object({
    id: z.string().uuid(),
    scope: LearningScopeSchema,
    key: z.string().min(1).max(MAX_SHORT_TEXT_LEN),
    value: z.string().min(1).max(MAX_TEXT_LEN),
    confidence: z.number().min(0).max(1),
    provenance: ProvenanceSchema,
    retentionUntil: IsoDateTimeSchema.nullable(),
    status: z.enum(["active", "pending", "rejected", "deleted"])
  })
  .strict();

export const ProfileResponseSchema = z
  .object({
    version: z.number().int().nonnegative(),
    facts: z.array(LearningItemSchema).max(MAX_LIST_ITEMS),
    pendingInsights: z.array(LearningItemSchema).max(MAX_LIST_ITEMS)
  })
  .strict();

export const ProfilePatchRequestSchema = z
  .object({
    key: z.string().min(1).max(MAX_SHORT_TEXT_LEN),
    value: z.string().min(1).max(MAX_TEXT_LEN)
  })
  .strict();

export const ProfileCorrectRequestSchema = z
  .object({
    value: z.string().min(1).max(MAX_TEXT_LEN),
    expectedVersion: z.number().int().nonnegative()
  })
  .strict();

// Worker -> API: a derived observation that becomes a reviewable pending insight.
export const InternalObservationSchema = z
  .object({
    key: z.string().min(1).max(MAX_SHORT_TEXT_LEN),
    value: z.string().min(1).max(MAX_TEXT_LEN),
    confidence: z.number().min(0).max(1),
    source: z.string().min(1).max(MAX_SHORT_TEXT_LEN)
  })
  .strict();

// ---------------------------------------------------------------------------
// Advice (U.S.-only, sourced, never executable)
// ---------------------------------------------------------------------------

export const AdviceRequestSchema = z
  .object({ question: z.string().min(1).max(MAX_TEXT_LEN) })
  .strict();

export const AdviceResponseSchema = z
  .object({
    id: z.string().uuid(),
    profileVersion: z.number().int().nonnegative(),
    jurisdiction: z.literal("US"),
    summary: z.string().min(1).max(MAX_TEXT_LEN),
    assumptions: z.array(z.string().max(MAX_SHORT_TEXT_LEN)).max(MAX_LIST_ITEMS),
    alternatives: z.array(z.string().max(MAX_SHORT_TEXT_LEN)).max(MAX_LIST_ITEMS),
    disclaimers: z.array(z.string().min(1).max(MAX_SHORT_TEXT_LEN)).min(1).max(MAX_LIST_ITEMS),
    sources: z.array(ProvenanceSchema).max(MAX_LIST_ITEMS),
    createdAt: IsoDateTimeSchema
  })
  .strict();

// ---------------------------------------------------------------------------
// Proposals, approvals, cancellation
// ---------------------------------------------------------------------------

export const ProposalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "executed",
  "cancelled",
  "executing",
  "execution_failed"
]);

export const OrderPreviewSchema = z
  .object({
    productId: ProductIdSchema,
    side: SideSchema,
    quoteSizeUsd: z.number().positive(),
    baseSize: z.number().positive(),
    limitPrice: z.number().positive().nullable(),
    estimatedFeeUsd: z.number().nonnegative(),
    estimatedSlippageBps: z.number().nonnegative()
  })
  .strict();

export const ProposalSchema = z
  .object({
    id: z.string().uuid(),
    status: ProposalStatusSchema,
    preview: OrderPreviewSchema,
    digest: Sha256HexSchema,
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema
  })
  .strict();

export const ProposalListResponseSchema = z
  .object({ proposals: z.array(ProposalSchema).max(MAX_LIST_ITEMS) })
  .strict();

export const ApprovalRequestSchema = z.object({ digest: Sha256HexSchema }).strict();

// Worker -> API: create a proposal awaiting operator approval. The API computes
// the digest and expiry server-side; the worker supplies the exact preview.
export const InternalProposalSchema = z
  .object({
    preview: OrderPreviewSchema,
    tradeIntentId: z.string().uuid().nullable().optional(),
    ttlSeconds: z.number().int().positive().max(3600),
    correlationId: z.string().uuid()
  })
  .strict();

export const InternalProposalResponseSchema = z
  .object({
    id: z.string().uuid(),
    digest: Sha256HexSchema,
    status: ProposalStatusSchema,
    expiresAt: IsoDateTimeSchema
  })
  .strict();

export const RejectionRequestSchema = z
  .object({ reason: z.string().max(MAX_SHORT_TEXT_LEN).optional() })
  .strict();

export const ApprovalResponseSchema = z
  .object({
    proposalId: z.string().uuid(),
    status: ProposalStatusSchema,
    decidedAt: IsoDateTimeSchema
  })
  .strict();

export const CancelOpenOrdersResponseSchema = z
  .object({
    requested: z.number().int().nonnegative(),
    cancelled: z.array(z.string().max(MAX_SHORT_TEXT_LEN)).max(MAX_LIST_ITEMS),
    failed: z
      .array(z.object({ orderId: z.string().max(MAX_SHORT_TEXT_LEN), code: ErrorCodeSchema }).strict())
      .max(MAX_LIST_ITEMS)
  })
  .strict();

// ---------------------------------------------------------------------------
// Portfolio, trades, metrics (durable operator state)
// ---------------------------------------------------------------------------

const PositionSchema = z
  .object({
    productId: ProductIdSchema,
    baseSize: z.number(),
    notionalUsd: z.number(),
    exposurePct: z.number(),
    averageEntryPrice: z.number()
  })
  .strict();

export const PortfolioResponseSchema = z
  .object({
    equityUsd: z.number(),
    cashUsd: z.number(),
    dailyPnlPct: z.number(),
    totalExposurePct: z.number(),
    positions: z.array(PositionSchema).max(MAX_LIST_ITEMS)
  })
  .strict();

export const FillSchema = z
  .object({
    fillId: z.string().uuid(),
    productId: ProductIdSchema,
    side: SideSchema,
    quoteSizeUsd: z.number(),
    price: z.number(),
    baseSize: z.number(),
    feeUsd: z.number(),
    filledAt: IsoDateTimeSchema,
    reasonCode: z.string().max(MAX_SHORT_TEXT_LEN).nullable(),
    rationale: z.string().max(MAX_TEXT_LEN).nullable(),
    proposalId: z.string().uuid().nullable()
  })
  .strict();

export const TradeListResponseSchema = z
  .object({ trades: z.array(FillSchema).max(MAX_LIST_ITEMS) })
  .strict();

export const CandleSchema = z
  .object({
    time: z.number().int().nonnegative(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    // Real volume in base units (live data). Null in sample mode, which has none.
    volume: z.number().nullable()
  })
  .strict();

// Technical-indicator series, each aligned 1:1 to `candles` (null during warmup).
// Computed with the same @agent/market-data functions the strategy uses, so the
// chart provably shows the signals the bot acts on.
export const IndicatorSeriesSchema = z
  .object({
    emaFast: z.array(z.number().nullable()),
    emaSlow: z.array(z.number().nullable()),
    macdHistogram: z.array(z.number().nullable()),
    rsi: z.array(z.number().nullable())
  })
  .strict();

export const CandlesResponseSchema = z
  .object({
    productId: ProductIdSchema,
    bucketSeconds: z.number().int().positive(),
    candles: z.array(CandleSchema).max(1000),
    indicators: IndicatorSeriesSchema
  })
  .strict();

// Watchlist ticker: last price, period change, and a tiny sparkline series.
export const TickerSchema = z
  .object({
    productId: ProductIdSchema,
    price: z.number(),
    changePct: z.number(),
    spark: z.array(z.number()).max(200)
  })
  .strict();

export const TickersResponseSchema = z.object({ tickers: z.array(TickerSchema).max(50) }).strict();

// Performance: equity curve + realized-trade stats for the analytics panels.
export const PerformanceResponseSchema = z
  .object({
    equity: z.array(z.object({ time: z.number().int().nonnegative(), equityUsd: z.number() }).strict()).max(1000),
    stats: z
      .object({
        wins: z.number().int().nonnegative(),
        losses: z.number().int().nonnegative(),
        winRate: z.number(),
        avgWin: z.number(),
        avgLoss: z.number(),
        bestTrade: z.number(),
        worstTrade: z.number(),
        realizedPnl: z.number(),
        totalFees: z.number(),
        maxDrawdownPct: z.number()
      })
      .strict()
  })
  .strict();

export const MetricsResponseSchema = z
  .object({
    totalTrades: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    totalFees: z.number(),
    realizedPnl: z.number(),
    equityUsd: z.number().nullable()
  })
  .strict();

// ---------------------------------------------------------------------------
// Worker heartbeat ingestion (internal, untrusted worker input)
// ---------------------------------------------------------------------------

export const HeartbeatIngestSchema = z
  .object({
    workerId: z.string().min(1).max(MAX_SHORT_TEXT_LEN),
    mode: TradingModeSchema,
    status: z.enum(["ok", "degraded", "down"]),
    version: z.number().int().nonnegative(),
    correlationId: z.string().uuid(),
    observedAt: IsoDateTimeSchema,
    portfolio: PortfolioResponseSchema,
    detail: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const AuditEventSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string().min(1).max(MAX_SHORT_TEXT_LEN),
    actor: z.enum(["operator", "worker", "system"]),
    correlationId: z.string().uuid(),
    occurredAt: IsoDateTimeSchema,
    summary: z.string().max(MAX_TEXT_LEN),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const AuditListResponseSchema = z
  .object({ events: z.array(AuditEventSchema).max(MAX_LIST_ITEMS) })
  .strict();

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;
export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
export type LearningItem = z.infer<typeof LearningItemSchema>;
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;
export type ProfilePatchRequest = z.infer<typeof ProfilePatchRequestSchema>;
export type AdviceResponse = z.infer<typeof AdviceResponseSchema>;
export type OrderPreview = z.infer<typeof OrderPreviewSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type ApprovalResponse = z.infer<typeof ApprovalResponseSchema>;
export type CancelOpenOrdersResponse = z.infer<typeof CancelOpenOrdersResponseSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type PortfolioResponse = z.infer<typeof PortfolioResponseSchema>;
export type Fill = z.infer<typeof FillSchema>;
export type TradeListResponse = z.infer<typeof TradeListResponseSchema>;
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;
export type HeartbeatIngest = z.infer<typeof HeartbeatIngestSchema>;
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;
export type InternalProposal = z.infer<typeof InternalProposalSchema>;
export type InternalProposalResponse = z.infer<typeof InternalProposalResponseSchema>;
