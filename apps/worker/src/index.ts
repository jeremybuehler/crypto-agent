import { ClaudeAIContextProvider, ConservativeStubAIContextProvider, type AIContextProvider } from "@agent/ai";
import { CoinbasePublicMarketData } from "@agent/coinbase";
import { loadConfig, logger, type MarketSnapshot, type PortfolioState } from "@agent/core";
import { PaperBroker } from "@agent/execution";
import { computeFeatures, type Candle } from "@agent/market-data";
import { createPersistenceRepository } from "@agent/persistence";
import { evaluateRisk } from "@agent/risk";
import { aiAssistedTrendStrategy } from "@agent/strategy";

const config = loadConfig();
const persistence = createPersistenceRepository(config.persistence);

const initialPortfolio: PortfolioState = {
  equityUsd: 1_000,
  cashUsd: 1_000,
  dailyPnlPct: 0,
  totalExposurePct: 0,
  positions: []
};

export async function runOnce(portfolio: PortfolioState = initialPortfolio): Promise<PortfolioState> {
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

  const intent = aiAssistedTrendStrategy({ config, features, aiContext, portfolio });
  if (!intent) {
    logger.info({ productId: market.productId, features, aiContext }, "No trade intent generated.");
    return portfolio;
  }
  await persistence.saveTradeIntent(intent);

  const decision = evaluateRisk({ config, intent, portfolio, killSwitchEnabled: false });
  await persistence.saveRiskDecision(decision);
  if (!decision.approved) {
    logger.warn({ intent, decision }, "Trade intent rejected by risk engine.");
    return portfolio;
  }

  if (config.tradingMode !== "paper") {
    logger.warn({ tradingMode: config.tradingMode, intent }, "Non-paper execution is not implemented in scaffold.");
    return portfolio;
  }

  const broker = new PaperBroker();
  const result = broker.execute(decision, market, portfolio);
  await persistence.savePaperFill({ tradeIntentId: intent.id, fill: result.fill });
  logger.info({ intent, decision, fill: result.fill, portfolio: result.portfolio }, "Paper trade executed.");
  return result.portfolio;
}

async function loadMarketInputs(productId: `${string}-${string}`): Promise<{ market: MarketSnapshot; candles: Candle[] }> {
  if (config.coinbase.useSampleMarketData) {
    return sampleMarketInputs(productId);
  }

  const marketData = new CoinbasePublicMarketData(config.coinbase);

  try {
    const [market, candles] = await Promise.all([
      marketData.getBestBidAsk(productId),
      marketData.getCandles({ productId, granularity: "ONE_MINUTE", limit: 20 })
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

function sampleMarketInputs(productId: `${string}-${string}`): { market: MarketSnapshot; candles: Candle[] } {
  const market: MarketSnapshot = {
    productId,
    price: 101,
    bid: 100.95,
    ask: 101.05,
    spreadBps: 10,
    timestamp: new Date()
  };

  return {
    market,
    candles: [
      { productId, start: new Date(Date.now() - 5 * 60_000), open: 98, high: 100, low: 97, close: 98, volume: 10 },
      { productId, start: new Date(Date.now() - 4 * 60_000), open: 98, high: 101, low: 98, close: 99, volume: 11 },
      { productId, start: new Date(Date.now() - 3 * 60_000), open: 99, high: 102, low: 99, close: 100, volume: 12 },
      { productId, start: new Date(Date.now() - 2 * 60_000), open: 100, high: 103, low: 100, close: 101, volume: 13 },
      { productId, start: new Date(Date.now() - 1 * 60_000), open: 101, high: 104, low: 100, close: 102, volume: 14 }
    ]
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await persistence.migrate();
    await runOnce();
  } catch (error) {
    logger.error({ error }, "Worker failed.");
    process.exitCode = 1;
  } finally {
    await persistence.close();
  }
}
