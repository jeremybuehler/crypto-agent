export interface BacktestSummary {
  trades: number;
  realizedPnlUsd: number;
  maxDrawdownPct: number;
}

export function createEmptyBacktestSummary(): BacktestSummary {
  return {
    trades: 0,
    realizedPnlUsd: 0,
    maxDrawdownPct: 0
  };
}
