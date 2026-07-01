import "dotenv/config";
import { loadConfig } from "@agent/core";
import type { Candle } from "@agent/market-data";
import { CoinbasePublicMarketData, type CoinbaseGranularity } from "@agent/coinbase";
import { createStrategy, STRATEGIES } from "@agent/strategy";
import { runBacktest, printBacktestReport } from "@agent/backtest";

/**
 * Backtest CLI. Fetches real historical Coinbase candles (public API, no keys)
 * and replays a strategy over them.
 *
 *   pnpm backtest --strategy mean-reversion --product BTC-USD --granularity ONE_MINUTE --limit 300
 *   pnpm backtest --all   # run every strategy over the same window and compare
 */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const productId = arg("product", "BTC-USD") as `${string}-${string}`;
const granularity = arg("granularity", "ONE_MINUTE") as CoinbaseGranularity;
const limit = Math.min(350, Math.max(30, Number(arg("limit", "300"))));
const runAll = process.argv.includes("--all");
const strategyName = arg("strategy", "trend");

const config = loadConfig({ ...process.env, PERSISTENCE_ENABLED: "false" });

async function loadCandles(): Promise<Candle[]> {
  try {
    const marketData = new CoinbasePublicMarketData(config.coinbase);
    const candles = await marketData.getCandles({ productId, granularity, limit });
    if (candles.length >= 30) {
      console.log(`Loaded ${candles.length} real ${granularity} candles for ${productId} from Coinbase.`);
      return candles;
    }
    console.warn(`Only ${candles.length} candles returned; using a synthetic series instead.`);
  } catch (error) {
    console.warn(`Live candle fetch failed (${(error as Error).message}); using a synthetic series.`);
  }
  // Deterministic synthetic fallback so the CLI always runs.
  return Array.from({ length: limit }, (_, i) => {
    const close = 100 + 8 * Math.sin((i * 2 * Math.PI) / 24) + i * 0.05;
    return {
      productId,
      start: new Date(Date.now() - (limit - i) * 60_000),
      open: i === 0 ? close : 100 + 8 * Math.sin(((i - 1) * 2 * Math.PI) / 24) + (i - 1) * 0.05,
      high: close + 1,
      low: close - 1,
      close,
      volume: 10
    };
  });
}

const candles = await loadCandles();
const names = runAll ? Object.keys(STRATEGIES) : [strategyName];

for (const name of names) {
  const strategy = createStrategy(name);
  console.log(`\n> ${strategy.name}: ${strategy.describe()}`);
  const result = await runBacktest(candles, config, strategy);
  printBacktestReport(result);
}
