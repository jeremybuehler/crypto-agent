"use client";
import type { Candle, Trade } from "../lib/api";

const GREEN = "#3fb950";
const RED = "#f85149";
const DIM = "#7d8590";
const BLUE = "#00d8ff";

// Fixed viewBox; the SVG scales to its container via width=100%.
const W = 1000;
const H = 260;
const PAD = { top: 12, right: 56, bottom: 20, left: 8 };

interface Props {
  candles: Candle[];
  trades: Trade[];
  productId: string;
  bucketSeconds: number;
}

export default function CandleChart({ candles, trades, productId, bucketSeconds }: Props) {
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  if (candles.length < 2) {
    return (
      <div className="border border-terminal-border bg-terminal-surface flex flex-col">
        <ChartHeader productId={productId} bucketSeconds={bucketSeconds} last={candles.at(-1)} />
        <div className="px-4 py-10 text-terminal-dim text-xs text-center">
          COLLECTING MARKET DATA<span className="blink ml-1">▌</span>
        </div>
      </div>
    );
  }

  const bucketMs = bucketSeconds * 1000;
  const prices = candles.flatMap((c) => [c.high, c.low]);
  let pMax = Math.max(...prices);
  let pMin = Math.min(...prices);
  const padP = (pMax - pMin) * 0.08 || pMax * 0.01;
  pMax += padP;
  pMin -= padP;

  // Index-based x-axis: candles are evenly spaced (time gaps collapsed), the
  // convention for candlestick charts.
  const slotW = plotW / candles.length;
  const xAt = (i: number) => PAD.left + (i + 0.5) * slotW;
  const y = (p: number) => PAD.top + ((pMax - p) / (pMax - pMin)) * plotH;
  const bodyW = Math.max(1.5, slotW * 0.62);

  // Horizontal price gridlines / labels.
  const ticks = 4;
  const gridlines = Array.from({ length: ticks + 1 }, (_, i) => pMin + ((pMax - pMin) * i) / ticks);

  // Map each trade to the candle bucket it falls in, so markers sit on the
  // candle where the fill happened.
  const indexForTime = (t: number) => candles.findIndex((c) => t >= c.time && t < c.time + bucketMs);
  const markers = trades
    .map((tr) => ({ ...tr, idx: indexForTime(new Date(tr.filledAt).getTime()) }))
    .filter((tr) => tr.idx >= 0);

  return (
    <div className="border border-terminal-border bg-terminal-surface flex flex-col">
      <ChartHeader productId={productId} bucketSeconds={bucketSeconds} last={candles.at(-1)} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "clamp(180px, 26vw, 260px)" }} preserveAspectRatio="none">
        {gridlines.map((p, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={y(p)} x2={PAD.left + plotW} y2={y(p)} stroke="#21262d" strokeWidth={1} />
            <text x={PAD.left + plotW + 6} y={y(p) + 3} fill={DIM} fontSize={11} fontFamily="monospace">
              {p.toFixed(2)}
            </text>
          </g>
        ))}

        {candles.map((c, i) => {
          const cx = xAt(i);
          const up = c.close >= c.open;
          const color = up ? GREEN : RED;
          const yOpen = y(c.open);
          const yClose = y(c.close);
          const top = Math.min(yOpen, yClose);
          const height = Math.max(1, Math.abs(yClose - yOpen));
          return (
            <g key={i}>
              <line x1={cx} y1={y(c.high)} x2={cx} y2={y(c.low)} stroke={color} strokeWidth={1} />
              <rect x={cx - bodyW / 2} y={top} width={bodyW} height={height} fill={color} />
            </g>
          );
        })}

        {markers.map((m, i) => {
          const cx = xAt(m.idx);
          const cy = y(m.price);
          const up = m.side === "BUY";
          const color = up ? GREEN : RED;
          const d = up ? `M${cx},${cy + 9} l5,9 l-10,0 z` : `M${cx},${cy - 9} l5,-9 l-10,0 z`;
          return <path key={i} d={d} fill={color} stroke="#0d1117" strokeWidth={0.5}><title>{`${m.side} @ ${m.price.toFixed(2)}`}</title></path>;
        })}

        {/* Last price marker */}
        <line
          x1={PAD.left}
          y1={y(candles.at(-1)!.close)}
          x2={PAD.left + plotW}
          y2={y(candles.at(-1)!.close)}
          stroke={BLUE}
          strokeWidth={0.75}
          strokeDasharray="3 3"
          opacity={0.6}
        />
      </svg>
    </div>
  );
}

function ChartHeader({ productId, bucketSeconds, last }: { productId: string; bucketSeconds: number; last?: Candle }) {
  return (
    <div className="text-terminal-dim text-xs tracking-widest uppercase border-b border-terminal-border px-4 py-2 flex items-center justify-between">
      <span>
        {productId} <span className="text-terminal-dim normal-case tracking-normal">· {bucketSeconds}s candles</span>
      </span>
      {last && <span className="text-terminal-blue">${last.close.toFixed(2)}</span>}
    </div>
  );
}
