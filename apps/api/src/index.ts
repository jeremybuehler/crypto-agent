import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadConfig, logger, type PortfolioState } from "@agent/core";
import { createOpsState, type OpsState } from "@agent/risk";

const config = loadConfig();
const app = Fastify({ loggerInstance: logger });
let opsState: OpsState;

// In-memory state shared with worker via POST /internal/fill
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

const trades: TradeRecord[] = [];
let portfolio: PortfolioState = {
  equityUsd: 1_000,
  cashUsd: 1_000,
  dailyPnlPct: 0,
  totalExposurePct: 0,
  positions: []
};

await app.register(cors);

app.addHook("onReady", async () => {
  opsState = await createOpsState(config.redisUrl);
});

app.addHook("onClose", async () => {
  await opsState?.close();
});

app.get("/health", async () => ({
  ok: true,
  service: "crypto-agent-api",
  mode: config.tradingMode,
  timestamp: new Date().toISOString()
}));

app.get("/status", async () => ({
  mode: config.tradingMode,
  enabledProducts: config.enabledProducts,
  paused: await opsState.getPaused(),
  killSwitchEnabled: await opsState.getKillSwitchEnabled(),
  risk: config.risk
}));

app.get("/portfolio", async () => portfolio);

app.get("/trades", async () => trades.slice().reverse());

app.get("/metrics", async () => {
  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.side === "BUY").length;
  const totalFees = trades.reduce((s, t) => s + t.feeUsd, 0);
  const realizedPnl = portfolio.equityUsd - 1_000;
  return { totalTrades, wins, totalFees, realizedPnl, equityUsd: portfolio.equityUsd };
});

// Called by worker after each fill
app.post("/internal/fill", async (req) => {
  const body = req.body as { trade: TradeRecord; portfolio: PortfolioState };
  trades.push(body.trade);
  if (trades.length > TRADE_RING_SIZE) trades.shift();
  portfolio = body.portfolio;
  return { ok: true };
});

app.post("/ops/pause", async () => {
  await opsState.setPaused(true);
  return { paused: true };
});

app.post("/ops/resume", async () => {
  await opsState.setPaused(false);
  return { paused: false };
});

app.post("/ops/kill-switch", async () => {
  await opsState.setKillSwitchEnabled(true);
  return { killSwitchEnabled: true };
});

app.post("/ops/clear-kill-switch", async () => {
  if (config.tradingMode === "live") {
    throw new Error("Refusing to clear kill switch in live mode.");
  }
  await opsState.setKillSwitchEnabled(false);
  return { killSwitchEnabled: false };
});

if (import.meta.url === `file://${process.argv[1]}`) {
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

export { app };
