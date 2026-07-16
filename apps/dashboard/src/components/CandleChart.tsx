"use client";
import { useEffect, useRef, useState } from "react";
import type { Candle, Trade } from "../lib/api";

// Up/down use the domain-standard green/red. Direction is also encoded by body
// position (close above vs below open) and stated explicitly in the hover
// tooltip, so the pairing never relies on color alone.
const GREEN = "#3fb950";
const RED = "#f85149";
const DIM = "#7d8590";
const BLUE = "#58c8ff";
const GRID = "#1c2128";

const H = 300;
const PAD = { top: 16, right: 64, bottom: 24, left: 12 };

interface Props {
  candles: Candle[];
  trades: Trade[];
  productId: string;
  bucketSeconds: number;
}

export default function CandleChart({ candles, trades, productId, bucketSeconds }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [hover, setHover] = useState<number | null>(null);

  // Render at real pixel width (measured) rather than stretching a fixed viewBox
  // with preserveAspectRatio="none" — that non-uniform scale is what squashed the
  // candles. Real coordinates also make hover hit-testing exact.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (candles.length < 2) {
    return (
      <div className="border border-terminal-border bg-terminal-surface flex flex-col">
        <ChartHeader productId={productId} bucketSeconds={bucketSeconds} last={candles.at(-1)} />
        <div className="px-4 py-12 text-terminal-dim text-xs text-center">
          COLLECTING MARKET DATA<span className="blink ml-1">▌</span>
        </div>
      </div>
    );
  }

  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const bucketMs = bucketSeconds * 1000;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  let pMax = Math.max(...highs);
  let pMin = Math.min(...lows);
  const padP = (pMax - pMin) * 0.08 || pMax * 0.01;
  pMax += padP;
  pMin -= padP;

  const slotW = plotW / candles.length;
  const xAt = (i: number) => PAD.left + (i + 0.5) * slotW;
  const y = (p: number) => PAD.top + ((pMax - p) / (pMax - pMin)) * plotH;
  const bodyW = Math.max(2, Math.min(slotW * 0.66, 15));

  const ticks = 5;
  const gridlines = Array.from({ length: ticks + 1 }, (_, i) => pMin + ((pMax - pMin) * i) / ticks);

  const indexForTime = (t: number) => candles.findIndex((c) => t >= c.time && t < c.time + bucketMs);
  const markers = trades
    .map((tr) => ({ ...tr, idx: indexForTime(new Date(tr.filledAt).getTime()) }))
    .filter((tr) => tr.idx >= 0);

  const last = candles.at(-1)!;
  const hovered = hover != null ? candles[hover] : undefined;

  function onMove(e: React.PointerEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const i = Math.round((x - PAD.left) / slotW - 0.5);
    setHover(Math.max(0, Math.min(candles.length - 1, i)));
  }

  return (
    <div className="border border-terminal-border bg-terminal-surface flex flex-col">
      <ChartHeader productId={productId} bucketSeconds={bucketSeconds} last={last} hovered={hovered} />

      <div
        ref={wrapRef}
        className="relative w-full"
        style={{ height: H }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg width={width} height={H} className="block" shapeRendering="crispEdges">
          {gridlines.map((p, i) => (
            <g key={i}>
              <line x1={PAD.left} y1={y(p)} x2={PAD.left + plotW} y2={y(p)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left + plotW + 6} y={y(p) + 3} fill={DIM} fontSize={11} fontFamily="monospace">
                {p.toFixed(2)}
              </text>
            </g>
          ))}

          {/* Crosshair on the hovered candle */}
          {hovered && (
            <g shapeRendering="auto">
              <line x1={xAt(hover!)} y1={PAD.top} x2={xAt(hover!)} y2={PAD.top + plotH} stroke={DIM} strokeWidth={1} strokeDasharray="2 3" opacity={0.5} />
              <rect x={xAt(hover!) - slotW / 2} y={PAD.top} width={slotW} height={plotH} fill="#ffffff" opacity={0.04} />
            </g>
          )}

          {candles.map((c, i) => {
            const cx = xAt(i);
            const up = c.close >= c.open;
            const color = up ? GREEN : RED;
            const top = Math.min(y(c.open), y(c.close));
            const height = Math.max(1.5, Math.abs(y(c.close) - y(c.open)));
            const faded = hover != null && hover !== i;
            return (
              <g key={i} opacity={faded ? 0.55 : 1} shapeRendering="auto">
                <line x1={cx} y1={y(c.high)} x2={cx} y2={y(c.low)} stroke={color} strokeWidth={1.25} />
                <rect x={cx - bodyW / 2} y={top} width={bodyW} height={height} fill={color} rx={0.5} />
              </g>
            );
          })}

          {markers.map((m, i) => {
            const cx = xAt(m.idx);
            const cy = y(m.price);
            const up = m.side === "BUY";
            const color = up ? GREEN : RED;
            const d = up ? `M${cx},${cy + 10} l6,10 l-12,0 z` : `M${cx},${cy - 10} l6,-10 l-12,0 z`;
            return (
              <path key={i} d={d} fill={color} stroke="#0d1117" strokeWidth={0.75} shapeRendering="auto">
                <title>{`${m.side} @ ${m.price.toFixed(2)}`}</title>
              </path>
            );
          })}

          {/* Last-price line + tag on the right axis */}
          <line x1={PAD.left} y1={y(last.close)} x2={PAD.left + plotW} y2={y(last.close)} stroke={BLUE} strokeWidth={0.75} strokeDasharray="3 3" opacity={0.55} />
          <g shapeRendering="auto">
            <rect x={PAD.left + plotW + 1} y={y(last.close) - 8} width={PAD.right - 2} height={16} fill={BLUE} rx={2} />
            <text x={PAD.left + plotW + PAD.right / 2} y={y(last.close) + 3} fill="#0d1117" fontSize={11} fontFamily="monospace" fontWeight={700} textAnchor="middle">
              {last.close.toFixed(2)}
            </text>
          </g>
        </svg>

        {hovered && <CandleTooltip candle={hovered} cx={xAt(hover!)} chartWidth={width} />}
      </div>
    </div>
  );
}

function CandleTooltip({ candle, cx, chartWidth }: { candle: Candle; cx: number; chartWidth: number }) {
  const up = candle.close >= candle.open;
  const changePct = candle.open !== 0 ? ((candle.close - candle.open) / candle.open) * 100 : 0;
  // Flip to the left of the crosshair when near the right edge so it never
  // slides under the price axis.
  const onRight = cx > chartWidth * 0.6;
  const style: React.CSSProperties = onRight ? { right: chartWidth - cx + 10 } : { left: cx + 10 };

  const Row = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div className="flex justify-between gap-4">
      <span className="text-terminal-dim">{label}</span>
      <span style={color ? { color } : undefined} className="text-terminal-text tabular-nums">
        {value}
      </span>
    </div>
  );

  return (
    <div
      className="absolute top-3 z-10 pointer-events-none border border-terminal-border bg-terminal-surface/95 px-3 py-2 text-[11px] font-mono shadow-lg"
      style={style}
    >
      <div className="text-terminal-dim mb-1 tracking-wider">
        {new Date(candle.time).toLocaleTimeString("en-US", { hour12: false })}
      </div>
      <Row label="O" value={candle.open.toFixed(3)} />
      <Row label="H" value={candle.high.toFixed(3)} color={GREEN} />
      <Row label="L" value={candle.low.toFixed(3)} color={RED} />
      <Row label="C" value={candle.close.toFixed(3)} />
      <div className="mt-1 pt-1 border-t border-terminal-border/60 flex justify-between gap-4">
        <span className="text-terminal-dim">Δ</span>
        <span style={{ color: up ? GREEN : RED }} className="font-bold tabular-nums">
          {changePct >= 0 ? "+" : ""}
          {changePct.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

function ChartHeader({
  productId,
  bucketSeconds,
  last,
  hovered
}: {
  productId: string;
  bucketSeconds: number;
  last?: Candle;
  hovered?: Candle;
}) {
  const shown = hovered ?? last;
  return (
    <div className="text-terminal-dim text-xs tracking-widest uppercase border-b border-terminal-border px-4 py-2 flex items-center justify-between">
      <span>
        {productId} <span className="text-terminal-dim normal-case tracking-normal">· {bucketSeconds}s candles</span>
        <span className="text-terminal-dim/60 normal-case tracking-normal hidden sm:inline"> · hover for OHLC</span>
      </span>
      {shown && <span className="text-terminal-blue tabular-nums">${shown.close.toFixed(2)}</span>}
    </div>
  );
}
