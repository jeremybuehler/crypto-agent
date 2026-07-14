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
}

export interface CandlesResponse {
  productId: string;
  bucketSeconds: number;
  candles: Candle[];
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
