export interface Status {
  mode: string;
  enabledProducts: string[];
  paused: boolean;
  killSwitchEnabled: boolean;
  risk: {
    maxTradeNotionalUsd: number;
    maxProductExposurePct: number;
    maxTotalExposurePct: number;
    maxDailyLossPct: number;
    minSecondsBetweenTrades: number;
    allowShorts: boolean;
    allowLeverage: boolean;
    requireOrderPreview: boolean;
  };
}

export interface Portfolio {
  equityUsd: number;
  cashUsd: number;
  dailyPnlPct: number;
  totalExposurePct: number;
  positions: Array<{
    productId: string;
    baseSize: number;
    notionalUsd: number;
    exposurePct: number;
    averageEntryPrice: number;
  }>;
}

export interface Trade {
  fillId: string;
  productId: string;
  side: "BUY" | "SELL";
  quoteSizeUsd: number;
  price: number;
  baseSize: number;
  feeUsd: number;
  filledAt: string;
  reasonCode: string | null;
  rationale: string | null;
  proposalId: string | null;
}

export interface Learner {
  id: string;
  name: string;
  level: "beginner" | "intermediate" | "advanced";
}

export interface AssistantAnswer {
  answer: string;
  toolsUsed: string[];
  fallback: boolean;
}

export async function askAssistant(
  question: string,
  learner: Learner,
  correlationId?: string
): Promise<AssistantAnswer> {
  return postJson("/assistant/ask", { question, learner, ...(correlationId ? { correlationId } : {}) });
}

export interface TradeList {
  trades: Trade[];
}

export interface Metrics {
  totalTrades: number;
  wins: number;
  losses: number;
  totalFees: number;
  realizedPnl: number;
  equityUsd: number | null;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

/** Indicator series, each aligned 1:1 to `candles` (null during warmup). */
export interface IndicatorSeries {
  emaFast: (number | null)[];
  emaSlow: (number | null)[];
  macdHistogram: (number | null)[];
  rsi: (number | null)[];
}

export interface CandlesResponse {
  productId: string;
  bucketSeconds: number;
  candles: Candle[];
  indicators: IndicatorSeries;
}

export const TIMEFRAMES = ["1m", "5m", "15m", "1h"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export interface Ticker {
  productId: string;
  price: number;
  changePct: number;
  spark: number[];
}

export interface TickersResponse {
  tickers: Ticker[];
}

export interface Performance {
  equity: Array<{ time: number; equityUsd: number }>;
  stats: {
    wins: number;
    losses: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    bestTrade: number;
    worstTrade: number;
    realizedPnl: number;
    totalFees: number;
    maxDrawdownPct: number;
  };
}

export interface OrderPreview {
  productId: string;
  side: "BUY" | "SELL";
  quoteSizeUsd: number;
  baseSize: number;
  limitPrice: number | null;
  estimatedFeeUsd: number;
  estimatedSlippageBps: number;
}

export interface Proposal {
  id: string;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "expired"
    | "executed"
    | "cancelled"
    | "executing"
    | "execution_failed";
  preview: OrderPreview;
  digest: string;
  createdAt: string;
  expiresAt: string;
}

export interface ProposalList {
  proposals: Proposal[];
}

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function postOps(path: string) {
  const res = await fetch(`/api${path}`, { method: "POST" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function postJson(path: string, body: unknown) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
