import "dotenv/config";
import { loadConfig } from "@agent/core";
import type { Candle } from "@agent/market-data";
import { runBacktest, printBacktestReport } from "@agent/backtest";

const config = loadConfig({ ...process.env, PERSISTENCE_ENABLED: "false" });
const productId = (config.enabledProducts[0] ?? "BTC-USD") as `${string}-${string}`;

// Sample 30-candle trending series for a quick smoke-run
const basePrice = 100_000;
const candles: Candle[] = Array.from({ length: 30 }, (_, i) => {
  const trend = i * 50;
  const noise = (Math.random() - 0.5) * 200;
  const close = basePrice + trend + noise;
  return {
    productId,
    start: new Date(Date.now() - (30 - i) * 60_000),
    open: close - 25,
    high: close + 50,
    low: close - 50,
    close,
    volume: 1 + Math.random()
  };
});

const result = await runBacktest(candles, config);
printBacktestReport(result);
