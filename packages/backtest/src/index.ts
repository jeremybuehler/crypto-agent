import type { AgentConfig, PortfolioState } from "@agent/core";
import { SystemClock } from "@agent/core";
import { ConservativeStubAIContextProvider } from "@agent/ai";
import type { Candle } from "@agent/market-data";
import { computeFeatures } from "@agent/market-data";
import { aiAssistedTrendStrategy } from "@agent/strategy";
import { evaluateRisk } from "@agent/risk";
import { PaperBroker } from "@agent/execution";

export interface BacktestResult {
  trades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  realizedPnlUsd: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  finalPortfolio: PortfolioState;
}

export async function runBacktest(candles: Candle[], config: AgentConfig): Promise<BacktestResult> {
  if (candles.length < 5) {
    throw new Error("Backtest requires at least 5 candles.");
  }

  let portfolio: PortfolioState = {
    equityUsd: 1_000,
    cashUsd: 1_000,
    dailyPnlPct: 0,
    totalExposurePct: 0,
    positions: []
  };

  const aiProvider = new ConservativeStubAIContextProvider();
  const broker = new PaperBroker(0.006, 10, SystemClock);
  const equityHistory: number[] = [portfolio.equityUsd];
  const tradeReturns: number[] = [];
  let trades = 0;
  let winningTrades = 0;
  let peakEquity = portfolio.equityUsd;
  let maxDrawdownPct = 0;

  for (let i = 4; i < candles.length; i++) {
    const window = candles.slice(i - 4, i + 1);
    const market = {
      productId: candles[i]!.productId,
      price: candles[i]!.close,
      bid: candles[i]!.close * 0.9995,
      ask: candles[i]!.close * 1.0005,
      spreadBps: 10,
      timestamp: candles[i]!.start
    };

    const features = computeFeatures(window, market);
    const aiContext = await aiProvider.generateContext({
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
    });

    const intent = aiAssistedTrendStrategy({ config, features, aiContext, portfolio });
    if (!intent) continue;

    const decision = evaluateRisk({ config, intent, portfolio, killSwitchEnabled: false });
    if (!decision.approved) continue;

    const entryEquity = portfolio.equityUsd;
    const result = broker.execute(decision, market, portfolio);
    portfolio = result.portfolio;

    const exitEquity = portfolio.equityUsd;
    const tradeReturn = (exitEquity - entryEquity) / entryEquity;
    tradeReturns.push(tradeReturn);
    trades++;
    if (tradeReturn > 0) winningTrades++;

    equityHistory.push(portfolio.equityUsd);
    if (portfolio.equityUsd > peakEquity) peakEquity = portfolio.equityUsd;
    const drawdown = ((peakEquity - portfolio.equityUsd) / peakEquity) * 100;
    if (drawdown > maxDrawdownPct) maxDrawdownPct = drawdown;
  }

  const realizedPnlUsd = portfolio.equityUsd - 1_000;
  const sharpeRatio = computeSharpe(tradeReturns);
  const winRate = trades > 0 ? winningTrades / trades : 0;

  return {
    trades,
    winningTrades,
    losingTrades: trades - winningTrades,
    winRate,
    realizedPnlUsd,
    maxDrawdownPct,
    sharpeRatio,
    finalPortfolio: portfolio
  };
}

function computeSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  return stdDev === 0 ? 0 : (mean / stdDev) * Math.sqrt(252);
}

export function printBacktestReport(result: BacktestResult): void {
  console.log("\n=== Backtest Report ===");
  console.log(`Trades:        ${result.trades} (${result.winningTrades}W / ${result.losingTrades}L)`);
  console.log(`Win rate:      ${(result.winRate * 100).toFixed(1)}%`);
  console.log(`Realized PnL:  $${result.realizedPnlUsd.toFixed(2)}`);
  console.log(`Max drawdown:  ${result.maxDrawdownPct.toFixed(2)}%`);
  console.log(`Sharpe ratio:  ${result.sharpeRatio.toFixed(2)}`);
  console.log("======================\n");
}
