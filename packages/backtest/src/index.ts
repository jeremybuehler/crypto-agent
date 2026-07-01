import type { AgentConfig, MarketSnapshot, PortfolioState } from "@agent/core";
import { SystemClock } from "@agent/core";
import { ConservativeStubAIContextProvider } from "@agent/ai";
import type { Candle } from "@agent/market-data";
import { computeFeatures } from "@agent/market-data";
import { createStrategy, runStrategy, type Strategy } from "@agent/strategy";
import { evaluateRisk } from "@agent/risk";
import { PaperBroker } from "@agent/execution";

export interface BacktestResult {
  strategy: string;
  trades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  realizedPnlUsd: number;
  totalReturnPct: number;
  buyHoldReturnPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  finalPortfolio: PortfolioState;
}

const STARTING_EQUITY = 1_000;
const LOOKBACK = 100; // candles of history handed to the strategy each step

/**
 * Replays a strategy over historical candles with the real risk engine and
 * paper broker, so you can see how it would have performed before trusting it.
 * The strategy sees a growing window of history (up to LOOKBACK bars) so its
 * indicators have proper lookback.
 */
export async function runBacktest(
  candles: Candle[],
  config: AgentConfig,
  strategy: Strategy = createStrategy(config.strategy.name)
): Promise<BacktestResult> {
  if (candles.length < 30) {
    throw new Error("Backtest requires at least 30 candles for the indicators to warm up.");
  }

  let portfolio: PortfolioState = {
    equityUsd: STARTING_EQUITY,
    cashUsd: STARTING_EQUITY,
    dailyPnlPct: 0,
    totalExposurePct: 0,
    positions: []
  };

  const aiProvider = new ConservativeStubAIContextProvider();
  const broker = new PaperBroker(0.006, 10, SystemClock);
  const barReturns: number[] = [];
  let trades = 0;
  let winningTrades = 0;
  let peakEquity = STARTING_EQUITY;
  let maxDrawdownPct = 0;
  let lastTradeAt: Date | undefined;
  let prevEquity = STARTING_EQUITY;

  // Mark equity to market: the PaperBroker updates cash + positions but not
  // equityUsd, so the backtest computes equity = cash + (base held × price).
  const markToMarket = (price: number) =>
    portfolio.cashUsd + portfolio.positions.reduce((sum, p) => sum + p.baseSize * price, 0);

  for (let i = 26; i < candles.length; i++) {
    const window = candles.slice(Math.max(0, i - LOOKBACK + 1), i + 1);
    const bar = candles[i]!;
    const market: MarketSnapshot = {
      productId: bar.productId,
      price: bar.close,
      bid: bar.close * 0.9995,
      ask: bar.close * 1.0005,
      spreadBps: 10,
      timestamp: bar.start
    };

    const features = computeFeatures(window.slice(-5), market);
    const aiContext = await aiProvider.generateContext({
      productId: market.productId,
      timeframe: "1m",
      features: { momentumPct: features.momentumPct, volatilityPercentile: features.volatilityPercentile, spreadBps: features.spreadBps },
      portfolioState: { dailyPnlPct: portfolio.dailyPnlPct, totalExposurePct: portfolio.totalExposurePct },
      riskPolicy: { maxTradeNotionalUsd: config.risk.maxTradeNotionalUsd, maxDailyLossPct: config.risk.maxDailyLossPct }
    });

    const intent = runStrategy(strategy, { candles: window, market, portfolio, config, aiContext });
    if (intent) {
      const decision = evaluateRisk({ config, intent, portfolio, killSwitchEnabled: false, ...(lastTradeAt ? { lastTradeAt } : {}) });
      if (decision.approved) {
        // Realized PnL on a SELL: exit price vs the position's average entry.
        const posBefore = portfolio.positions.find((p) => p.productId === bar.productId);
        const result = broker.execute(decision, market, portfolio);
        portfolio = result.portfolio;
        lastTradeAt = bar.start;
        trades++;
        if (intent.side === "SELL" && posBefore) {
          const realized = (bar.close - posBefore.averageEntryPrice) * result.fill.baseSize - result.fill.feeUsd;
          if (realized > 0) winningTrades++;
        }
      }
    }

    // Per-bar marked equity drives the return, drawdown, and Sharpe.
    const equity = markToMarket(bar.close);
    barReturns.push((equity - prevEquity) / prevEquity);
    prevEquity = equity;
    if (equity > peakEquity) peakEquity = equity;
    const drawdown = ((peakEquity - equity) / peakEquity) * 100;
    if (drawdown > maxDrawdownPct) maxDrawdownPct = drawdown;
  }

  const finalEquity = markToMarket(candles[candles.length - 1]!.close);
  const realizedPnlUsd = finalEquity - STARTING_EQUITY;
  const firstClose = candles[26]!.close;
  const lastClose = candles[candles.length - 1]!.close;

  return {
    strategy: strategy.name,
    trades,
    winningTrades,
    losingTrades: trades - winningTrades,
    winRate: trades > 0 ? winningTrades / trades : 0,
    realizedPnlUsd,
    totalReturnPct: (realizedPnlUsd / STARTING_EQUITY) * 100,
    buyHoldReturnPct: ((lastClose - firstClose) / firstClose) * 100,
    maxDrawdownPct,
    sharpeRatio: computeSharpe(barReturns),
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

/** Human-readable, self-explaining report — each metric says what it means. */
export function printBacktestReport(result: BacktestResult): void {
  const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  console.log(`\n=== Backtest: ${result.strategy} ===`);
  console.log(`Trades        ${result.trades} (${result.winningTrades}W / ${result.losingTrades}L)   — how many round-trips it took`);
  console.log(`Win rate      ${(result.winRate * 100).toFixed(1)}%   — share of trades that made money`);
  console.log(`Total return  ${pct(result.totalReturnPct)}   — the strategy's return on $${STARTING_EQUITY}`);
  console.log(`Buy & hold    ${pct(result.buyHoldReturnPct)}   — baseline: just holding over the same window`);
  console.log(`Realized PnL  $${result.realizedPnlUsd.toFixed(2)}`);
  console.log(`Max drawdown  ${result.maxDrawdownPct.toFixed(2)}%   — worst peak-to-trough drop (pain)`);
  console.log(`Sharpe        ${result.sharpeRatio.toFixed(2)}   — risk-adjusted return (>1 good, <0 poor)`);
  const verdict =
    result.totalReturnPct > result.buyHoldReturnPct
      ? "Beat buy-and-hold."
      : "Did NOT beat buy-and-hold — holding would have done better here.";
  console.log(`Verdict       ${verdict}`);
  console.log("=".repeat(28) + "\n");
}
