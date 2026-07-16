"use client";
import useSWR from "swr";
import { fetcher, type Performance } from "../lib/api";

const GREEN = "#3fb950";
const RED = "#f85149";
const BLUE = "#58c8ff";

function usd(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function EquityCurve({ points }: { points: Array<{ time: number; equityUsd: number }> }) {
  const W = 520;
  const H = 120;
  const PAD = 6;
  if (points.length < 2) {
    return <div className="px-3 py-10 text-terminal-dim text-xs text-center">NOT ENOUGH HISTORY YET<span className="blink ml-1">▌</span></div>;
  }
  const vals = points.map((p) => p.equityUsd);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - 2 * PAD);
  const line = points.map((p, i) => `${x(i)},${y(p.equityUsd)}`).join(" ");
  const area = `${line} ${x(points.length - 1)},${H - PAD} ${x(0)},${H - PAD}`;
  const up = vals[vals.length - 1]! >= vals[0]!;
  const stroke = up ? GREEN : RED;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 120 }} preserveAspectRatio="none">
      <polygon points={area} fill={stroke} opacity={0.08} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-terminal-dim text-[10px] tracking-wider uppercase">{label}</span>
      <span className="tabular-nums text-sm" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

export default function PerformancePanel() {
  const { data } = useSWR<Performance>("/api/performance", fetcher, { refreshInterval: 5000 });
  const s = data?.stats;
  const equity = data?.equity ?? [];
  const winColor = s && s.winRate >= 0.5 ? GREEN : RED;
  const pnlColor = s && s.realizedPnl >= 0 ? GREEN : RED;

  return (
    <div className="border border-terminal-border bg-terminal-surface flex flex-col">
      <div className="text-terminal-dim text-xs tracking-widest uppercase border-b border-terminal-border px-4 py-2 flex items-center justify-between">
        <span>Performance</span>
        {s && <span className="tabular-nums" style={{ color: pnlColor }}>{usd(s.realizedPnl)} realized</span>}
      </div>

      <div className="px-2 pt-2">
        <div className="text-terminal-dim text-[10px] tracking-wider uppercase px-2">Equity Curve</div>
        <EquityCurve points={equity} />
      </div>

      {s && (
        <div className="grid grid-cols-3 gap-3 px-4 py-3 border-t border-terminal-border">
          <Stat label="Win Rate" value={`${(s.winRate * 100).toFixed(0)}%`} color={winColor} />
          <Stat label="Wins / Losses" value={`${s.wins} / ${s.losses}`} />
          <Stat label="Max Drawdown" value={`${s.maxDrawdownPct.toFixed(1)}%`} color={s.maxDrawdownPct > 0 ? RED : undefined} />
          <Stat label="Avg Win" value={usd(s.avgWin)} color={GREEN} />
          <Stat label="Avg Loss" value={usd(s.avgLoss)} color={RED} />
          <Stat label="Fees Paid" value={usd(s.totalFees)} color={RED} />
          <Stat label="Best Trade" value={usd(s.bestTrade)} color={GREEN} />
          <Stat label="Worst Trade" value={usd(s.worstTrade)} color={RED} />
          <Stat label="Equity" value={equity.length ? usd(equity[equity.length - 1]!.equityUsd) : "—"} color={BLUE} />
        </div>
      )}
    </div>
  );
}
