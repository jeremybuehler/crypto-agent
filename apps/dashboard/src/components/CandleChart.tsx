"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Candle, IndicatorSeries, Timeframe, Trade } from "../lib/api";
import { TIMEFRAMES } from "../lib/api";

// Up/down use domain-standard green/red; direction is also encoded by body
// position and stated in the hover tooltip, so it never relies on color alone.
const GREEN = "#3fb950";
const RED = "#f85149";
const DIM = "#7d8590";
const BLUE = "#58c8ff";
const AMBER = "#f0a848";
const GRID = "#1c2128";
const INK = "#c9d1d9";

const PAD = { top: 8, right: 64, bottom: 18, left: 12 };
const GAP = 10;
const PRICE_H = 220;
const VOL_H = 46;
const MACD_H = 62;
const RSI_H = 62;
const TOTAL_H = PAD.top + PRICE_H + GAP + VOL_H + GAP + MACD_H + GAP + RSI_H + PAD.bottom;

const priceTop = PAD.top;
const volTop = priceTop + PRICE_H + GAP;
const macdTop = volTop + VOL_H + GAP;
const rsiTop = macdTop + MACD_H + GAP;

interface Props {
  candles: Candle[];
  indicators?: IndicatorSeries;
  trades: Trade[];
  productId: string;
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
}

export default function CandleChart({ candles, indicators, trades, productId, timeframe, onTimeframe }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  // Start small so the first paint never renders an over-wide SVG that overflows
  // its container on mobile; the callback ref below sizes it to the container.
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);

  // Callback ref (not a mount-only effect): the chart shows a loading branch
  // first and the real chart element mounts later, so a `useEffect([])` would
  // attach to nothing and never re-run. This fires whenever the chart wrapper
  // actually mounts/unmounts, measuring it and observing size changes.
  const attachWrap = useCallback((el: HTMLDivElement | null) => {
    wrapRef.current = el;
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, []);

  // Reliable fallback for resize / orientation change: the window resize event
  // always fires, and reads the live wrapper each time (so it works even though
  // the wrapper mounts after this effect). Belt-and-suspenders with the observer.
  useEffect(() => {
    const onResize = () => {
      const el = wrapRef.current;
      if (el && el.clientWidth > 0) setWidth(el.clientWidth);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (candles.length < 2 || !indicators) {
    return (
      <div className="border border-terminal-border bg-terminal-surface flex flex-col">
        <ChartHeader productId={productId} timeframe={timeframe} onTimeframe={onTimeframe} />
        <div className="px-4 py-12 text-terminal-dim text-xs text-center">
          COLLECTING MARKET DATA<span className="blink ml-1">▌</span>
        </div>
      </div>
    );
  }

  const plotW = width - PAD.left - PAD.right;
  const slotW = plotW / candles.length;
  const xAt = (i: number) => PAD.left + (i + 0.5) * slotW;
  const bodyW = Math.max(1.5, Math.min(slotW * 0.66, 14));

  // Price scale spans candle extremes AND visible EMA values so the MAs stay on screen.
  const emaVals = [...indicators.emaFast, ...indicators.emaSlow].filter((v): v is number => v != null);
  let pMax = Math.max(...candles.map((c) => c.high), ...emaVals);
  let pMin = Math.min(...candles.map((c) => c.low), ...emaVals);
  const padP = (pMax - pMin) * 0.08 || pMax * 0.01;
  pMax += padP;
  pMin -= padP;
  const yPrice = (p: number) => priceTop + ((pMax - p) / (pMax - pMin)) * PRICE_H;

  const maxVol = Math.max(1, ...candles.map((c) => c.volume ?? 0));
  const yVol = (v: number) => volTop + VOL_H - (v / maxVol) * VOL_H;

  const macdVals = indicators.macdHistogram.filter((v): v is number => v != null);
  const macdMax = Math.max(0.0001, ...macdVals.map((v) => Math.abs(v)));
  const yMacd = (v: number) => macdTop + MACD_H / 2 - (v / macdMax) * (MACD_H / 2 - 2);

  const yRsi = (v: number) => rsiTop + RSI_H - (v / 100) * RSI_H;

  const gridlines = Array.from({ length: 5 }, (_, i) => pMin + ((pMax - pMin) * i) / 4);
  const last = candles.at(-1)!;

  const bucketMs = (TF_SECONDS[timeframe] ?? 60) * 1000;
  const indexForTime = (t: number) => candles.findIndex((c) => t >= c.time && t < c.time + bucketMs);
  const markers = trades
    .map((tr) => ({ ...tr, idx: indexForTime(new Date(tr.filledAt).getTime()) }))
    .filter((tr) => tr.idx >= 0);

  const emaPath = (series: (number | null)[]) =>
    series
      .map((v, i) => (v == null ? null : `${xAt(i)},${yPrice(v)}`))
      .filter((p): p is string => p != null)
      .join(" ");

  function onMove(e: React.PointerEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const i = Math.round((e.clientX - rect.left - PAD.left) / slotW - 0.5);
    setHover(Math.max(0, Math.min(candles.length - 1, i)));
  }

  const hovered = hover != null ? candles[hover] : undefined;

  return (
    <div className="border border-terminal-border bg-terminal-surface flex flex-col">
      <ChartHeader productId={productId} timeframe={timeframe} onTimeframe={onTimeframe} last={last} hovered={hovered} />

      <div ref={attachWrap} className="relative w-full overflow-hidden" style={{ height: TOTAL_H }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg width={width} height={TOTAL_H} className="block" shapeRendering="crispEdges">
          {/* Panel labels */}
          <PanelLabel y={priceTop} text={`${productId}  EMA12`} color={BLUE} extra="EMA26" extraColor={AMBER} />
          <PanelLabel y={volTop} text="VOLUME" color={DIM} />
          <PanelLabel y={macdTop} text="MACD 12·26·9" color={DIM} />
          <PanelLabel y={rsiTop} text="RSI 14" color={DIM} />

          {/* Price gridlines + labels */}
          {gridlines.map((p, i) => (
            <g key={i}>
              <line x1={PAD.left} y1={yPrice(p)} x2={PAD.left + plotW} y2={yPrice(p)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left + plotW + 6} y={yPrice(p) + 3} fill={DIM} fontSize={10} fontFamily="monospace">
                {p.toFixed(p > 1000 ? 0 : 2)}
              </text>
            </g>
          ))}

          {/* MACD zero line + RSI guides */}
          <line x1={PAD.left} y1={yMacd(0)} x2={PAD.left + plotW} y2={yMacd(0)} stroke={GRID} strokeWidth={1} />
          {[70, 50, 30].map((lvl) => (
            <g key={lvl}>
              <line x1={PAD.left} y1={yRsi(lvl)} x2={PAD.left + plotW} y2={yRsi(lvl)} stroke={GRID} strokeWidth={1} strokeDasharray={lvl === 50 ? undefined : "2 3"} />
              <text x={PAD.left + plotW + 6} y={yRsi(lvl) + 3} fill={DIM} fontSize={9} fontFamily="monospace">
                {lvl}
              </text>
            </g>
          ))}

          {/* Crosshair across all panels */}
          {hover != null && (
            <line x1={xAt(hover)} y1={priceTop} x2={xAt(hover)} y2={rsiTop + RSI_H} stroke={DIM} strokeWidth={1} strokeDasharray="2 3" opacity={0.5} shapeRendering="auto" />
          )}

          {/* Volume bars */}
          {candles.map((c, i) => {
            const v = c.volume ?? 0;
            if (v <= 0) return null;
            const up = c.close >= c.open;
            return <rect key={`v${i}`} x={xAt(i) - bodyW / 2} y={yVol(v)} width={bodyW} height={volTop + VOL_H - yVol(v)} fill={up ? GREEN : RED} opacity={0.45} />;
          })}

          {/* MACD histogram */}
          {indicators.macdHistogram.map((h, i) =>
            h == null ? null : (
              <rect key={`m${i}`} x={xAt(i) - bodyW / 2} y={Math.min(yMacd(0), yMacd(h))} width={bodyW} height={Math.max(1, Math.abs(yMacd(h) - yMacd(0)))} fill={h >= 0 ? GREEN : RED} opacity={0.85} />
            )
          )}

          {/* RSI line */}
          <polyline points={indicators.rsi.map((v, i) => (v == null ? null : `${xAt(i)},${yRsi(v)}`)).filter(Boolean).join(" ")} fill="none" stroke={INK} strokeWidth={1.25} shapeRendering="auto" />

          {/* Candles */}
          {candles.map((c, i) => {
            const up = c.close >= c.open;
            const color = up ? GREEN : RED;
            const top = Math.min(yPrice(c.open), yPrice(c.close));
            const height = Math.max(1.5, Math.abs(yPrice(c.close) - yPrice(c.open)));
            const faded = hover != null && hover !== i;
            return (
              <g key={i} opacity={faded ? 0.5 : 1} shapeRendering="auto">
                <line x1={xAt(i)} y1={yPrice(c.high)} x2={xAt(i)} y2={yPrice(c.low)} stroke={color} strokeWidth={1.1} />
                <rect x={xAt(i) - bodyW / 2} y={top} width={bodyW} height={height} fill={color} />
              </g>
            );
          })}

          {/* EMA overlays */}
          <polyline points={emaPath(indicators.emaFast)} fill="none" stroke={BLUE} strokeWidth={1.4} shapeRendering="auto" opacity={0.95} />
          <polyline points={emaPath(indicators.emaSlow)} fill="none" stroke={AMBER} strokeWidth={1.4} shapeRendering="auto" opacity={0.95} />

          {/* Trade markers on the price panel */}
          {markers.map((m, i) => {
            const cx = xAt(m.idx);
            const cy = yPrice(m.price);
            const up = m.side === "BUY";
            const d = up ? `M${cx},${cy + 9} l6,10 l-12,0 z` : `M${cx},${cy - 9} l6,-10 l-12,0 z`;
            return (
              <path key={i} d={d} fill={up ? GREEN : RED} stroke="#0d1117" strokeWidth={0.75} shapeRendering="auto">
                <title>{`${m.side} @ ${m.price.toFixed(2)}`}</title>
              </path>
            );
          })}

          {/* Last-price tag */}
          <line x1={PAD.left} y1={yPrice(last.close)} x2={PAD.left + plotW} y2={yPrice(last.close)} stroke={BLUE} strokeWidth={0.75} strokeDasharray="3 3" opacity={0.5} />
          <g shapeRendering="auto">
            <rect x={PAD.left + plotW + 1} y={yPrice(last.close) - 8} width={PAD.right - 2} height={16} fill={BLUE} rx={2} />
            <text x={PAD.left + plotW + PAD.right / 2} y={yPrice(last.close) + 3} fill="#0d1117" fontSize={10} fontFamily="monospace" fontWeight={700} textAnchor="middle">
              {last.close.toFixed(last.close > 1000 ? 0 : 2)}
            </text>
          </g>
        </svg>

        {hover != null && (
          <CockpitTooltip candle={candles[hover]!} ind={indicators} i={hover} cx={xAt(hover)} chartWidth={width} />
        )}
      </div>
    </div>
  );
}

const TF_SECONDS: Record<Timeframe, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600 };

function CockpitTooltip({ candle, ind, i, cx, chartWidth }: { candle: Candle; ind: IndicatorSeries; i: number; cx: number; chartWidth: number }) {
  const up = candle.close >= candle.open;
  const changePct = candle.open !== 0 ? ((candle.close - candle.open) / candle.open) * 100 : 0;
  const onRight = cx > chartWidth * 0.6;
  const style: React.CSSProperties = onRight ? { right: chartWidth - cx + 10 } : { left: cx + 10 };
  const num = (v: number | null, d = 2) => (v == null ? "—" : v.toFixed(d));

  const Row = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div className="flex justify-between gap-4">
      <span className="text-terminal-dim">{label}</span>
      <span style={color ? { color } : undefined} className="text-terminal-text tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="absolute top-2 z-10 pointer-events-none border border-terminal-border bg-terminal-surface/95 px-3 py-2 text-[11px] font-mono shadow-lg min-w-[9rem]" style={style}>
      <div className="text-terminal-dim mb-1 tracking-wider">{new Date(candle.time).toLocaleString("en-US", { hour12: false, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
      <Row label="O" value={num(candle.open)} />
      <Row label="H" value={num(candle.high)} color={GREEN} />
      <Row label="L" value={num(candle.low)} color={RED} />
      <Row label="C" value={num(candle.close)} />
      <Row label="Vol" value={candle.volume == null ? "—" : candle.volume.toFixed(2)} />
      <div className="mt-1 pt-1 border-t border-terminal-border/60 flex flex-col gap-0.5">
        <Row label="EMA12" value={num(ind.emaFast[i])} color={BLUE} />
        <Row label="EMA26" value={num(ind.emaSlow[i])} color={AMBER} />
        <Row label="MACD" value={num(ind.macdHistogram[i], 3)} color={(ind.macdHistogram[i] ?? 0) >= 0 ? GREEN : RED} />
        <Row label="RSI" value={num(ind.rsi[i], 1)} />
      </div>
      <div className="mt-1 pt-1 border-t border-terminal-border/60 flex justify-between gap-4">
        <span className="text-terminal-dim">Δ</span>
        <span style={{ color: up ? GREEN : RED }} className="font-bold tabular-nums">{changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%</span>
      </div>
    </div>
  );
}

function PanelLabel({ y, text, color, extra, extraColor }: { y: number; text: string; color: string; extra?: string; extraColor?: string }) {
  return (
    <text x={PAD.left + 2} y={y + 10} fontSize={9} fontFamily="monospace" className="uppercase tracking-wider">
      <tspan fill={color}>{text}</tspan>
      {extra && <tspan fill={extraColor} dx={6}>{extra}</tspan>}
    </text>
  );
}

function ChartHeader({
  productId,
  timeframe,
  onTimeframe,
  last,
  hovered
}: {
  productId: string;
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
  last?: Candle;
  hovered?: Candle;
}) {
  const shown = hovered ?? last;
  return (
    <div className="text-terminal-dim text-xs tracking-widest uppercase border-b border-terminal-border px-4 py-2 flex items-center justify-between gap-3">
      <span className="flex items-center gap-3">
        {productId}
        <span className="flex items-center gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframe(tf)}
              className={`px-1.5 py-0.5 border text-[10px] tracking-wider ${
                tf === timeframe
                  ? "border-terminal-blue text-terminal-blue"
                  : "border-terminal-border text-terminal-dim hover:text-terminal-text"
              }`}
            >
              {tf}
            </button>
          ))}
        </span>
      </span>
      {shown && <span className="text-terminal-blue tabular-nums">${shown.close.toFixed(shown.close > 1000 ? 2 : 4)}</span>}
    </div>
  );
}
