import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadConfig, logger } from "@agent/core";

const config = loadConfig();
const app = Fastify({ loggerInstance: logger });
let paused = false;
let killSwitchEnabled = false;

await app.register(cors);

app.get("/health", async () => ({
  ok: true,
  service: "crypto-agent-api",
  mode: config.tradingMode,
  timestamp: new Date().toISOString()
}));

app.get("/status", async () => ({
  mode: config.tradingMode,
  enabledProducts: config.enabledProducts,
  paused,
  killSwitchEnabled,
  risk: config.risk
}));

app.post("/ops/pause", async () => {
  paused = true;
  return { paused };
});

app.post("/ops/resume", async () => {
  paused = false;
  return { paused };
});

app.post("/ops/kill-switch", async () => {
  killSwitchEnabled = true;
  return { killSwitchEnabled };
});

app.post("/ops/clear-kill-switch", async () => {
  if (config.tradingMode === "live") {
    throw new Error("Refusing to clear kill switch through scaffold API in live mode.");
  }
  killSwitchEnabled = false;
  return { killSwitchEnabled };
});

if (import.meta.url === `file://${process.argv[1]}`) {
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

export { app };
