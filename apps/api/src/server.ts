/**
 * Builds the operator API: a hardened Fastify instance with authenticated
 * routes. Only `/health` (liveness) is unauthenticated. Operator data and
 * operation routes require the operator bearer token; the worker ingestion
 * route requires the distinct internal token.
 *
 * `buildServer` accepts injectable `opsState` and `operatorRepo` dependencies so
 * tests run without Redis or Postgres. Operator-facing state (portfolio,
 * trades, metrics, audit) is durable: it is read from / written to the operator
 * repository, never process memory.
 */
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import {
  loadConfig,
  LOG_REDACT_PATHS,
  AlertDispatcher,
  StdoutAlertSink,
  WebhookAlertSink,
  type AgentConfig,
  type AlertSink
} from "@agent/core";
import { createOpsState, type OpsState } from "@agent/risk";
import { AssistantAskSchema, createAssistantForApi } from "./assistant.js";
import {
  computeTradeStats,
  createOperatorRepositoryForConfig,
  maxDrawdownPct,
  type FillRow,
  type OperatorRepository,
  type PriceCandle
} from "@agent/persistence";
import { CoinbasePublicMarketData, type CoinbaseGranularity } from "@agent/coinbase";
import { emaLine, macdHistogramLine, rsiLine } from "@agent/market-data";
import { requireInternal, requireOperator } from "./auth.js";
import { registerSecurity } from "./plugins/security.js";
import { registerReadiness } from "./routes/health.js";
import { registerPrometheus } from "./routes/metrics.js";
import { registerProposalRoutes } from "./routes/proposals.js";
import { registerLearningRoutes } from "./routes/learning.js";
import { registerAdviceRoutes } from "./routes/advice.js";
import { ValidationError } from "./errors.js";
import {
  AuditListResponseSchema,
  CandlesResponseSchema,
  HeartbeatIngestSchema,
  MetricsResponseSchema,
  PerformanceResponseSchema,
  PortfolioResponseSchema,
  TickersResponseSchema,
  TradeListResponseSchema,
  type PortfolioResponse
} from "./contracts.js";

const WORKER_ID = process.env.WORKER_ID ?? "worker-1";
const HEARTBEAT_MAX_AGE_MS = 90_000;

const EMPTY_PORTFOLIO: PortfolioResponse = {
  equityUsd: 0,
  cashUsd: 0,
  dailyPnlPct: 0,
  totalExposurePct: 0,
  positions: []
};

const RECENT_LIMIT = 50;

/** A candle as served to the dashboard: OHLC + time + (live-only) volume. */
type ApiCandle = PriceCandle & { volume: number | null };

/** Chart timeframes → Coinbase granularity (live) and bucket size (sample). */
const TIMEFRAMES: Record<string, { granularity: CoinbaseGranularity; seconds: number }> = {
  "1m": { granularity: "ONE_MINUTE", seconds: 60 },
  "5m": { granularity: "FIVE_MINUTE", seconds: 300 },
  "15m": { granularity: "FIFTEEN_MINUTE", seconds: 900 },
  "1h": { granularity: "ONE_HOUR", seconds: 3600 }
};

// EMA-12/26, MACD histogram (12/26/9), and RSI-14 — the exact indicators the
// trend strategy trades on (packages/strategy), as series aligned to the candles.
function computeIndicatorSeries(closes: number[]) {
  return {
    emaFast: emaLine(closes, 12),
    emaSlow: emaLine(closes, 26),
    macdHistogram: macdHistogramLine(closes),
    rsi: rsiLine(closes, 14)
  };
}

function toFillResponse(fill: FillRow) {
  return {
    fillId: fill.fillId,
    productId: fill.productId,
    side: fill.side,
    quoteSizeUsd: fill.quoteSizeUsd,
    price: fill.price,
    baseSize: fill.baseSize,
    feeUsd: fill.feeUsd,
    filledAt: fill.filledAt.toISOString(),
    reasonCode: fill.reasonCode,
    rationale: fill.rationale,
    proposalId: fill.proposalId
  };
}

export interface ServerDeps {
  /** Inject an ops-state (e.g. InMemoryOpsState) to avoid Redis in tests. */
  opsState?: OpsState;
  /** Inject an operator repository (e.g. pglite-backed) to avoid Postgres. */
  operatorRepo?: OperatorRepository;
  /** Inject alert sinks (e.g. a capturing sink) to observe alerts in tests. */
  alertSinks?: AlertSink[];
}

export async function buildServer(config: AgentConfig, deps: ServerDeps = {}) {
  const app = Fastify({
    logger: { level: config.logLevel, redact: LOG_REDACT_PATHS },
    genReqId: () => randomUUID(),
    bodyLimit: config.security.bodyLimitBytes,
    trustProxy: config.security.trustProxy
  });

  await registerSecurity(app, config);

  const ownsOpsState = !deps.opsState;
  let opsState: OpsState | undefined = deps.opsState;
  const ownsRepo = !deps.operatorRepo;
  let repo: OperatorRepository | undefined = deps.operatorRepo;

  app.addHook("onReady", async () => {
    if (!opsState) opsState = await createOpsState(config.redisUrl);
    if (!repo) repo = createOperatorRepositoryForConfig(config.persistence);
  });
  app.addHook("onClose", async () => {
    if (ownsOpsState) await opsState?.close();
    if (ownsRepo) await repo?.close();
  });

  const requireOp = requireOperator(config.security.operatorApiToken);
  const requireInt = requireInternal(config.security.internalApiToken);

  // Live market-data source for the price chart (public, no auth). Only created
  // when not in sample mode. Candles are cached briefly to bound external calls.
  const marketData = config.coinbase.useSampleMarketData ? null : new CoinbasePublicMarketData(config.coinbase);
  const candleCache = new Map<string, { at: number; candles: ApiCandle[] }>();
  const CANDLE_TTL_MS = 15_000;
  async function liveCandles(productId: string, granularity: CoinbaseGranularity, limit: number): Promise<ApiCandle[]> {
    const key = `${productId}:${granularity}`;
    const cached = candleCache.get(key);
    if (cached && Date.now() - cached.at < CANDLE_TTL_MS) return cached.candles.slice(-limit);
    try {
      const raw = await marketData!.getCandles({ productId: productId as `${string}-${string}`, granularity, limit });
      const candles: ApiCandle[] = raw.map((c) => ({
        time: c.start.getTime(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      }));
      candleCache.set(key, { at: Date.now(), candles });
      return candles;
    } catch (error) {
      app.log.warn({ error }, "live candle fetch failed; serving cached/empty");
      return cached?.candles.slice(-limit) ?? [];
    }
  }

  // Operational alerts: always to stdout; optionally to an authenticated webhook
  // (ALERT_WEBHOOK_URL/ALERT_WEBHOOK_TOKEN). The dispatcher dedupes by alert id
  // and isolates sink failures so one broken sink can't silence the others.
  const alertSinks: AlertSink[] = deps.alertSinks ?? [
    new StdoutAlertSink((line) => app.log.warn({ alert: line }, "alert"))
  ];
  if (!deps.alertSinks && process.env.ALERT_WEBHOOK_URL) {
    alertSinks.push(
      new WebhookAlertSink({
        url: process.env.ALERT_WEBHOOK_URL,
        ...(process.env.ALERT_WEBHOOK_TOKEN ? { token: process.env.ALERT_WEBHOOK_TOKEN } : {})
      })
    );
  }
  const alerts = new AlertDispatcher(alertSinks, (error) => app.log.error({ error }, "alert sink failed"));

  /** Record an immutable audit event for an operator action. */
  async function auditOperator(type: string, correlationId: string, summary: string): Promise<void> {
    await repo!.recordAuditEvent({
      id: randomUUID(),
      type,
      actor: "operator",
      correlationId,
      occurredAt: new Date(),
      summary
    });
  }

  // Liveness is the only unauthenticated route and carries no secrets.
  app.get("/health", async () => ({ status: "ok" as const }));

  // Readiness (unauthenticated, secret-free): DB/Redis/worker dependency health.
  registerReadiness(app, {
    repo: {
      ping: () => repo!.ping(),
      getWorkerHeartbeat: (id) => repo!.getWorkerHeartbeat(id)
    },
    opsState: { ping: () => opsState!.ping() },
    tradingMode: config.tradingMode,
    workerId: WORKER_ID,
    heartbeatMaxAgeMs: HEARTBEAT_MAX_AGE_MS
  });

  // Prometheus exposition (operator auth) at /metrics/prom; JSON metrics at /metrics.
  registerPrometheus(app, {
    repo: {
      getMetrics: () => repo!.getMetrics(),
      getWorkerHeartbeat: (id) => repo!.getWorkerHeartbeat(id)
    },
    workerId: WORKER_ID,
    requireOperator: requireOp
  });

  // Interactive proposals: worker creates (internal auth), operator decides.
  registerProposalRoutes(app, {
    repo: {
      createProposal: (input) => repo!.createProposal(input),
      getProposal: (id) => repo!.getProposal(id),
      listProposals: (limit, statuses) => repo!.listProposals(limit, statuses),
      decideProposal: (input) => repo!.decideProposal(input),
      recordAuditEvent: (event) => repo!.recordAuditEvent(event)
    },
    requireOperator: requireOp,
    requireInternal: requireInt
  });

  // Inspectable learning memory: operator manages facts; worker submits insights.
  registerLearningRoutes(app, {
    repo: {
      upsertMemory: (input) => repo!.upsertMemory(input),
      getProfile: () => repo!.getProfile(),
      correctMemory: (input) => repo!.correctMemory(input),
      setMemoryStatus: (id, status, actor) => repo!.setMemoryStatus(id, status, actor),
      exportMemories: () => repo!.exportMemories()
    },
    requireOperator: requireOp,
    requireInternal: requireInt
  });

  // Sourced advice: read-only over the profile, no execution capability.
  registerAdviceRoutes(app, {
    repo: {
      getProfile: () => repo!.getProfile(),
      saveAdvice: (input) => repo!.saveAdvice(input)
    },
    requireOperator: requireOp
  });

  app.get("/status", { preHandler: requireOp }, async () => ({
    mode: config.tradingMode,
    enabledProducts: config.enabledProducts,
    paused: await opsState!.getPaused(),
    killSwitchEnabled: await opsState!.getKillSwitchEnabled(),
    risk: config.risk
  }));

  app.get("/portfolio", { preHandler: requireOp }, async () => {
    const portfolio = await repo!.getLatestPortfolio();
    return PortfolioResponseSchema.parse(portfolio ?? EMPTY_PORTFOLIO);
  });

  app.get("/trades", { preHandler: requireOp }, async () => {
    const fills = await repo!.listRecentFills(RECENT_LIMIT);
    return TradeListResponseSchema.parse({ trades: fills.map(toFillResponse) });
  });

  app.get("/candles", { preHandler: requireOp }, async (request) => {
    const query = request.query as { product?: string; bucket?: string; limit?: string; tf?: string };
    const productId = query.product ?? config.enabledProducts[0] ?? "BTC-USD";
    const limit = Math.min(300, Math.max(1, Number(query.limit ?? "60")));
    const tf = TIMEFRAMES[query.tf ?? ""] ?? TIMEFRAMES["1m"]!;

    // Live mode: real Coinbase candles at the requested timeframe (cached briefly
    // so a 3s dashboard poll doesn't hammer the public API). Sample mode:
    // aggregate the agent's own market snapshots into buckets of the same size.
    const candles = marketData
      ? await liveCandles(productId, tf.granularity, limit)
      : (await repo!.getCandles(productId, tf.seconds, limit)).map((c) => ({ ...c, volume: null as number | null }));

    return CandlesResponseSchema.parse({
      productId,
      bucketSeconds: tf.seconds,
      candles,
      indicators: computeIndicatorSeries(candles.map((c) => c.close))
    });
  });

  // Watchlist: real last price + ~24h change + sparkline per configured product.
  // Read-only; independent of what the bot trades. Empty in sample mode (no
  // multi-product real data). Per-product failures are dropped, not fatal.
  app.get("/tickers", { preHandler: requireOp }, async () => {
    if (!marketData) return { tickers: [] };
    const tickers = await Promise.all(
      config.watchlistProducts.map(async (productId) => {
        try {
          const candles = await liveCandles(productId, "ONE_HOUR", 24);
          if (candles.length < 2) return null;
          const price = candles.at(-1)!.close;
          const first = candles[0]!.open;
          return {
            productId,
            price,
            changePct: first !== 0 ? ((price - first) / first) * 100 : 0,
            spark: candles.map((c) => c.close)
          };
        } catch {
          return null;
        }
      })
    );
    return TickersResponseSchema.parse({ tickers: tickers.filter((t): t is NonNullable<typeof t> => t != null) });
  });

  // Equity curve + realized-trade stats for the performance panels.
  app.get("/performance", { preHandler: requireOp }, async () => {
    const [fills, equity] = await Promise.all([repo!.listRecentFills(500), repo!.getEquitySeries(300)]);
    const stats = computeTradeStats([...fills].reverse()); // listRecentFills is newest-first
    return PerformanceResponseSchema.parse({
      equity,
      stats: { ...stats, maxDrawdownPct: maxDrawdownPct(equity.map((e) => e.equityUsd)) }
    });
  });

  app.get("/metrics", { preHandler: requireOp }, async () => {
    const metrics = await repo!.getMetrics();
    return MetricsResponseSchema.parse(metrics);
  });

  // Educational assistant: explains trades and concepts over a read-only tool
  // belt. Falls back to deterministic data-only answers without an Anthropic
  // key. Constructed lazily because `repo` is bound during onReady.
  let assistant: ReturnType<typeof createAssistantForApi> | undefined;
  app.post("/assistant/ask", { preHandler: requireOp }, async (request, reply) => {
    const parsed = AssistantAskSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: { code: "INVALID_REQUEST", message: parsed.error.issues.map((i) => i.message).join("; ") } };
    }
    assistant ??= createAssistantForApi({ repo: repo!, config });
    return assistant.ask(parsed.data);
  });

  app.get("/audit", { preHandler: requireOp }, async () => {
    const events = await repo!.listAuditEvents(RECENT_LIMIT);
    return AuditListResponseSchema.parse({
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        actor: event.actor,
        correlationId: event.correlationId,
        occurredAt: event.occurredAt.toISOString(),
        summary: event.summary,
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {})
      }))
    });
  });

  app.post("/internal/heartbeat", { preHandler: requireInt }, async (request) => {
    const parsed = HeartbeatIngestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError("Heartbeat failed validation.");
    }
    const body = parsed.data;
    await repo!.ingestHeartbeat({
      workerId: body.workerId,
      mode: body.mode,
      status: body.status,
      portfolio: body.portfolio,
      version: body.version,
      correlationId: body.correlationId,
      observedAt: new Date(body.observedAt),
      ...(body.detail !== undefined ? { detail: body.detail } : {})
    });
    return { ok: true };
  });

  app.post("/ops/pause", { preHandler: requireOp }, async (request) => {
    await opsState!.setPaused(true);
    await auditOperator("ops.pause", request.id, "operator paused the trading loop");
    return { paused: true };
  });

  app.post("/ops/resume", { preHandler: requireOp }, async (request) => {
    await opsState!.setPaused(false);
    await auditOperator("ops.resume", request.id, "operator resumed the trading loop");
    return { paused: false };
  });

  app.post("/ops/kill-switch", { preHandler: requireOp }, async (request) => {
    await opsState!.setKillSwitchEnabled(true);
    await auditOperator("ops.kill_switch", request.id, "operator enabled the kill switch");
    await alerts.dispatch({
      id: `kill_switch:${request.id}`,
      kind: "kill_switch",
      severity: "critical",
      summary: "Operator enabled the kill switch; trading is halted.",
      at: new Date()
    });
    return { killSwitchEnabled: true };
  });

  app.post("/ops/clear-kill-switch", { preHandler: requireOp }, async (request, reply) => {
    if (config.tradingMode === "live") {
      reply.code(409);
      return { error: "Refusing to clear kill switch in live mode." };
    }
    await opsState!.setKillSwitchEnabled(false);
    await auditOperator("ops.clear_kill_switch", request.id, "operator cleared the kill switch");
    return { killSwitchEnabled: false };
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const app = await buildServer(config);
  await app.listen({ port: config.port, host: "0.0.0.0" });
}
