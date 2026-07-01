import { randomUUID } from "node:crypto";
import { ClaudeAIContextProvider, ConservativeStubAIContextProvider, type AIContextProvider } from "@agent/ai";
import { CoinbasePublicMarketData } from "@agent/coinbase";
import { loadConfig, logger, type MarketSnapshot, type PortfolioState } from "@agent/core";
import { PaperBroker, previewOrder } from "@agent/execution";
import { computeFeatures, type Candle } from "@agent/market-data";
import { createPersistenceRepository } from "@agent/persistence";
import { evaluateRisk } from "@agent/risk";
import { createStrategy, runStrategy } from "@agent/strategy";

const config = loadConfig();
const persistence = createPersistenceRepository(config.persistence);

const WORKER_ID = process.env.WORKER_ID ?? "worker-1";
const HEARTBEAT_TIMEOUT_MS = 5_000;
const HEARTBEAT_MAX_ATTEMPTS = 3;
let heartbeatVersion = 0;

const initialPortfolio: PortfolioState = {
  equityUsd: 1_000,
  cashUsd: 1_000,
  dailyPnlPct: 0,
  totalExposurePct: 0,
  positions: []
};

// Last fill time, tracked across loop iterations so the risk engine can enforce
// MIN_SECONDS_BETWEEN_TRADES. The loop interval is only the sampling cadence;
// trade spacing is governed here.
let lastFillAt: Date | undefined;

/**
 * Run one trading loop, then report a heartbeat with the resulting portfolio.
 * The heartbeat is the worker's durable liveness + portfolio signal; a loop
 * failure still reports a `degraded` heartbeat before rethrowing.
 */
export async function runOnce(portfolio: PortfolioState = initialPortfolio): Promise<PortfolioState> {
  try {
    const result = await runTradingLoop(portfolio);
    await postHeartbeat(result, "ok");
    return result;
  } catch (error) {
    await postHeartbeat(portfolio, "degraded");
    throw error;
  }
}

async function runTradingLoop(portfolio: PortfolioState): Promise<PortfolioState> {
  const productId = (config.enabledProducts[0] ?? "BTC-USD") as `${string}-${string}`;
  const { market, candles } = await loadMarketInputs(productId);
  await persistence.saveMarketSnapshot(market);

  const features = computeFeatures(candles, market);
  const aiProvider: AIContextProvider = config.anthropicApiKey
    ? new ClaudeAIContextProvider(config.anthropicApiKey)
    : new ConservativeStubAIContextProvider();
  const aiContextInput = {
    productId: market.productId,
    timeframe: "1m",
    features: {
      momentumPct: features.momentumPct,
      volatilityPercentile: features.volatilityPercentile,
      spreadBps: features.spreadBps
    },
    portfolioState: {
      dailyPnlPct: portfolio.dailyPnlPct,
      totalExposurePct: portfolio.totalExposurePct
    },
    riskPolicy: {
      maxTradeNotionalUsd: config.risk.maxTradeNotionalUsd,
      maxDailyLossPct: config.risk.maxDailyLossPct
    }
  };
  const aiContext = await aiProvider.generateContext(aiContextInput);
  await persistence.saveAIContext({
    productId: market.productId,
    timeframe: "1m",
    input: aiContextInput,
    output: aiContext
  });

  const strategy = createStrategy(config.strategy.name);
  const intent = runStrategy(strategy, { candles, market, portfolio, config, aiContext });
  if (!intent) {
    logger.info({ productId: market.productId, strategy: strategy.name, features, aiContext }, "No trade intent generated.");
    return portfolio;
  }
  await persistence.saveTradeIntent(intent);

  const decision = evaluateRisk({
    config,
    intent,
    portfolio,
    killSwitchEnabled: false,
    ...(lastFillAt ? { lastTradeAt: lastFillAt } : {})
  });
  await persistence.saveRiskDecision(decision);
  if (!decision.approved) {
    logger.warn({ intent, decision }, "Trade intent rejected by risk engine.");
    return portfolio;
  }

  if (config.tradingMode !== "paper") {
    logger.warn({ tradingMode: config.tradingMode, intent }, "Non-paper execution is not implemented in scaffold.");
    return portfolio;
  }

  // Interactive approval: emit a proposal for the operator instead of filling.
  // The simulation-only auto-fill below stays the default for tests/backtests.
  if (config.execution.interactiveApproval) {
    await postProposal(intent, market);
    // Reserve the trade slot so we don't spam identical proposals every loop.
    lastFillAt = new Date();
    return portfolio;
  }

  const broker = new PaperBroker();
  const result = broker.execute(decision, market, portfolio);
  await persistence.savePaperFill({ tradeIntentId: intent.id, fill: result.fill });
  lastFillAt = result.fill.filledAt;
  logger.info({ intent, decision, fill: result.fill, portfolio: result.portfolio }, "Paper trade executed.");

  return result.portfolio;
}

/**
 * Submit a proposal to the operator API for interactive approval. Authenticated
 * with the internal token and bounded by a timeout; a failure is logged, never
 * swallowed, but does not throw (the loop continues and will re-propose).
 */
async function postProposal(
  intent: import("@agent/core").TradeIntent,
  market: import("@agent/core").MarketSnapshot
): Promise<void> {
  const apiUrl = process.env.AGENT_API_URL;
  const token = config.security.internalApiToken;
  if (!apiUrl || !token) {
    logger.warn("Interactive approval is on but AGENT_API_URL/INTERNAL_API_TOKEN is missing; skipping proposal.");
    return;
  }

  const preview = previewOrder(intent, market);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${apiUrl}/internal/proposal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": token },
      body: JSON.stringify({
        preview,
        tradeIntentId: intent.id,
        ttlSeconds: config.execution.proposalTtlSeconds,
        correlationId: intent.id
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "Proposal submission rejected by API.");
      return;
    }
    logger.info({ intent, preview }, "Proposal submitted for operator approval.");
  } catch (error) {
    logger.error({ error }, "Proposal submission failed.");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Report the worker's latest portfolio + status to the operator API's internal
 * heartbeat route. Authenticated with the internal token, bounded by a timeout,
 * retried with backoff, and a final failure is logged (never swallowed). Fills
 * themselves are persisted directly (audit chain); this only conveys the
 * portfolio snapshot and liveness, which live in no audit-chain table.
 */
export async function postHeartbeat(portfolio: PortfolioState, status: "ok" | "degraded"): Promise<void> {
  const apiUrl = process.env.AGENT_API_URL;
  const token = config.security.internalApiToken;
  if (!apiUrl) return;
  if (!token) {
    logger.warn("AGENT_API_URL is set but INTERNAL_API_TOKEN is not; skipping heartbeat.");
    return;
  }

  heartbeatVersion += 1;
  const payload = JSON.stringify({
    workerId: WORKER_ID,
    mode: config.tradingMode,
    status,
    version: heartbeatVersion,
    correlationId: randomUUID(),
    observedAt: new Date().toISOString(),
    portfolio
  });

  for (let attempt = 1; attempt <= HEARTBEAT_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiUrl}/internal/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-token": token },
        body: payload,
        signal: controller.signal
      });
      if (res.ok) return;
      // 4xx are not retryable (bad token / payload); 5xx are.
      if (res.status < 500) {
        logger.error({ status: res.status }, "Heartbeat rejected by API; not retrying.");
        return;
      }
      throw new Error(`heartbeat HTTP ${res.status}`);
    } catch (error) {
      if (attempt === HEARTBEAT_MAX_ATTEMPTS) {
        logger.error({ error, attempts: attempt }, "Heartbeat failed after retries.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
}

async function loadMarketInputs(productId: `${string}-${string}`): Promise<{ market: MarketSnapshot; candles: Candle[] }> {
  if (config.coinbase.useSampleMarketData) {
    return sampleMarketInputs(productId);
  }

  const marketData = new CoinbasePublicMarketData(config.coinbase);

  try {
    const [market, candles] = await Promise.all([
      marketData.getBestBidAsk(productId),
      marketData.getCandles({ productId, granularity: "ONE_MINUTE", limit: 100 })
    ]);

    if (candles.length < 5) {
      throw new Error(`Expected at least 5 candles, received ${candles.length}.`);
    }

    return { market, candles };
  } catch (error) {
    logger.warn({ error, productId }, "Falling back to sample market data after Coinbase public market-data failure.");
    return sampleMarketInputs(productId);
  }
}

const SAMPLE_CANDLES = 60;
const SAMPLE_PERIOD = 20; // candles per oscillation cycle

function sampleMarketInputs(productId: `${string}-${string}`): { market: MarketSnapshot; candles: Candle[] } {
  // A smooth, index-based sine oscillation gives the real strategies enough
  // history (>=26 bars) with genuine uptrends, reversals, and range breaks. The
  // window drifts one bar per minute so a continuous loop keeps moving.
  const offset = Math.floor(Date.now() / 60_000);
  const closes = Array.from({ length: SAMPLE_CANDLES }, (_, i) =>
    100 * (1 + 0.05 * Math.sin(((offset + i) * 2 * Math.PI) / SAMPLE_PERIOD))
  );

  const candles: Candle[] = closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]!;
    return {
      productId,
      start: new Date(Date.now() - (SAMPLE_CANDLES - i) * 60_000),
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: 10 + (i % 5)
    };
  });

  const price = closes[closes.length - 1]!;
  const market: MarketSnapshot = {
    productId,
    price,
    bid: price * 0.9995,
    ask: price * 1.0005,
    spreadBps: 10,
    timestamp: new Date()
  };

  return { market, candles };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // `--once` forces a single run even when WORKER_LOOP_MS is configured.
  const loopMs = process.argv.includes("--once") ? 0 : Number(process.env.WORKER_LOOP_MS ?? "0");
  try {
    await persistence.migrate();
    if (loopMs > 0) {
      // Continuous mode: carry portfolio state across iterations so equity,
      // positions, and realized PnL evolve. Ctrl-C / SIGTERM to stop.
      let portfolio = initialPortfolio;
      let running = true;
      process.on("SIGINT", () => (running = false));
      process.on("SIGTERM", () => (running = false));
      logger.info({ loopMs }, "Worker loop started.");
      while (running) {
        try {
          portfolio = await runOnce(portfolio);
        } catch (error) {
          logger.error({ error }, "Loop iteration failed; continuing.");
        }
        await new Promise((resolve) => setTimeout(resolve, loopMs));
      }
    } else {
      await runOnce();
    }
  } catch (error) {
    logger.error({ error }, "Worker failed.");
    process.exitCode = 1;
  } finally {
    await persistence.close();
  }
}
