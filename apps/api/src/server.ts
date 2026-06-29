/**
 * Builds the operator API: a hardened Fastify instance with authenticated
 * routes. Only `/health` (liveness) is unauthenticated. Operator data and
 * operation routes require the operator bearer token; the worker ingestion
 * route requires the distinct internal token.
 *
 * `buildServer` accepts an injectable `opsState` so tests run without Redis.
 * The in-memory trade/portfolio store here is a Task-2 placeholder; Task 3
 * replaces it with durable transactional state.
 */
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { loadConfig, LOG_REDACT_PATHS, type AgentConfig, type PortfolioState } from "@agent/core";
import { createOpsState, type OpsState } from "@agent/risk";
import { requireInternal, requireOperator } from "./auth.js";
import { registerSecurity } from "./plugins/security.js";

const TRADE_RING_SIZE = 50;

interface TradeRecord {
  id: string;
  productId: string;
  side: "BUY" | "SELL";
  quoteSizeUsd: number;
  price: number;
  baseSize: number;
  feeUsd: number;
  strategyVersion: string;
  filledAt: string;
}

export interface ServerDeps {
  /** Inject an ops-state (e.g. InMemoryOpsState) to avoid Redis in tests. */
  opsState?: OpsState;
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
  app.addHook("onReady", async () => {
    if (!opsState) opsState = await createOpsState(config.redisUrl);
  });
  app.addHook("onClose", async () => {
    if (ownsOpsState) await opsState?.close();
  });

  const requireOp = requireOperator(config.security.operatorApiToken);
  const requireInt = requireInternal(config.security.internalApiToken);

  const trades: TradeRecord[] = [];
  let portfolio: PortfolioState = {
    equityUsd: 1_000,
    cashUsd: 1_000,
    dailyPnlPct: 0,
    totalExposurePct: 0,
    positions: []
  };

  // Liveness is the only unauthenticated route and carries no secrets.
  app.get("/health", async () => ({ status: "ok" as const }));

  app.get("/status", { preHandler: requireOp }, async () => ({
    mode: config.tradingMode,
    enabledProducts: config.enabledProducts,
    paused: await opsState!.getPaused(),
    killSwitchEnabled: await opsState!.getKillSwitchEnabled(),
    risk: config.risk
  }));

  app.get("/portfolio", { preHandler: requireOp }, async () => portfolio);

  app.get("/trades", { preHandler: requireOp }, async () => trades.slice().reverse());

  app.get("/metrics", { preHandler: requireOp }, async () => {
    const totalTrades = trades.length;
    const wins = trades.filter((trade) => trade.side === "BUY").length;
    const totalFees = trades.reduce((sum, trade) => sum + trade.feeUsd, 0);
    const realizedPnl = portfolio.equityUsd - 1_000;
    return { totalTrades, wins, totalFees, realizedPnl, equityUsd: portfolio.equityUsd };
  });

  app.post("/internal/fill", { preHandler: requireInt }, async (request) => {
    const body = request.body as { trade: TradeRecord; portfolio: PortfolioState };
    trades.push(body.trade);
    if (trades.length > TRADE_RING_SIZE) trades.shift();
    portfolio = body.portfolio;
    return { ok: true };
  });

  app.post("/ops/pause", { preHandler: requireOp }, async () => {
    await opsState!.setPaused(true);
    return { paused: true };
  });

  app.post("/ops/resume", { preHandler: requireOp }, async () => {
    await opsState!.setPaused(false);
    return { paused: false };
  });

  app.post("/ops/kill-switch", { preHandler: requireOp }, async () => {
    await opsState!.setKillSwitchEnabled(true);
    return { killSwitchEnabled: true };
  });

  app.post("/ops/clear-kill-switch", { preHandler: requireOp }, async (_request, reply) => {
    if (config.tradingMode === "live") {
      reply.code(409);
      return { error: "Refusing to clear kill switch in live mode." };
    }
    await opsState!.setKillSwitchEnabled(false);
    return { killSwitchEnabled: false };
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const app = await buildServer(config);
  await app.listen({ port: config.port, host: "0.0.0.0" });
}
