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
import { loadConfig, LOG_REDACT_PATHS, type AgentConfig } from "@agent/core";
import { createOpsState, type OpsState } from "@agent/risk";
import {
  createOperatorRepositoryForConfig,
  type FillRow,
  type OperatorRepository
} from "@agent/persistence";
import { requireInternal, requireOperator } from "./auth.js";
import { registerSecurity } from "./plugins/security.js";
import { ValidationError } from "./errors.js";
import {
  AuditListResponseSchema,
  HeartbeatIngestSchema,
  MetricsResponseSchema,
  PortfolioResponseSchema,
  TradeListResponseSchema,
  type PortfolioResponse
} from "./contracts.js";

const EMPTY_PORTFOLIO: PortfolioResponse = {
  equityUsd: 0,
  cashUsd: 0,
  dailyPnlPct: 0,
  totalExposurePct: 0,
  positions: []
};

const RECENT_LIMIT = 50;

function toFillResponse(fill: FillRow) {
  return {
    fillId: fill.fillId,
    productId: fill.productId,
    side: fill.side,
    quoteSizeUsd: fill.quoteSizeUsd,
    price: fill.price,
    baseSize: fill.baseSize,
    feeUsd: fill.feeUsd,
    filledAt: fill.filledAt.toISOString()
  };
}

export interface ServerDeps {
  /** Inject an ops-state (e.g. InMemoryOpsState) to avoid Redis in tests. */
  opsState?: OpsState;
  /** Inject an operator repository (e.g. pglite-backed) to avoid Postgres. */
  operatorRepo?: OperatorRepository;
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

  app.get("/metrics", { preHandler: requireOp }, async () => {
    const metrics = await repo!.getMetrics();
    return MetricsResponseSchema.parse(metrics);
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
