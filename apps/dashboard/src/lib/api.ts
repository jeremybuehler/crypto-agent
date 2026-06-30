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
