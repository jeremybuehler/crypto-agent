import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadConfig, logger } from "@agent/core";
import { createOpsState, type OpsState } from "@agent/risk";

const config = loadConfig();
const app = Fastify({ loggerInstance: logger });
let opsState: OpsState;

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
