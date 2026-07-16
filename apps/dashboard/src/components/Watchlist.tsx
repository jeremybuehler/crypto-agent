"use client";
import useSWR from "swr";
import { fetcher, type TickersResponse } from "../lib/api";

const GREEN = "#3fb950";
const RED = "#f85149";

function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  if (points.length < 2) return null;
  const w = 56;
  const h = 18;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / span) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline points={d} fill="none" stroke={up ? GREEN : RED} strokeWidth={1} />
    </svg>
  );
}

interface Props {
  selected: string;
  onSelect: (product: string) => void;
}

export default function Watchlist({ selected, onSelect }: Props) {
  const { data } = useSWR<TickersResponse>("/api/tickers", fetcher, { refreshInterval: 5000 });
  const tickers = data?.tickers ?? [];

  return (
    <div className="border border-terminal-border bg-terminal-surface flex flex-col lg:w-60 self-start">
      <div className="text-terminal-dim text-xs tracking-widest uppercase border-b border-terminal-border px-3 py-2">
        Watchlist
      </div>
      {tickers.length === 0 ? (
        <div className="px-3 py-6 text-terminal-dim text-xs text-center">
          LOADING MARKETS<span className="blink ml-1">▌</span>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-terminal-border/40">
          {tickers.map((t) => {
            const up = t.changePct >= 0;
            const active = t.productId === selected;
            return (
              <button
                key={t.productId}
                onClick={() => onSelect(t.productId)}
                className={`px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-white/5 ${
                  active ? "bg-terminal-blue/10 border-l-2 border-terminal-blue" : "border-l-2 border-transparent"
                }`}
              >
                <div className="flex flex-col">
                  <span className={`text-xs font-semibold ${active ? "text-terminal-blue" : "text-terminal-text"}`}>
                    {t.productId.replace("-USD", "")}
                  </span>
                  <span className="text-terminal-dim text-[11px] tabular-nums">
                    ${t.price.toLocaleString("en-US", { maximumFractionDigits: t.price > 100 ? 0 : 4 })}
                  </span>
                </div>
                <Sparkline points={t.spark} up={up} />
                <span className="text-[11px] tabular-nums w-14 text-right" style={{ color: up ? GREEN : RED }}>
                  {up ? "+" : ""}
                  {t.changePct.toFixed(2)}%
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="px-3 py-1.5 text-terminal-dim/60 text-[10px] border-t border-terminal-border">
        24h change · click to chart
      </div>
    </div>
  );
}
