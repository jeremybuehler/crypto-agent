/**
 * Technical indicators — the standard building blocks of trading strategies.
 * Each is a pure function so it is deterministic and testable. Doc-comments
 * explain what the indicator measures, for operators learning the craft.
 *
 * All functions return the indicator's value at the END of the input series
 * (the most recent bar), which is what a live strategy acts on.
 */
import type { Candle } from "./index.js";

/** Simple moving average: the arithmetic mean of the last `period` values. */
export function sma(values: number[], period: number): number {
  const window = values.slice(-period);
  return window.reduce((sum, v) => sum + v, 0) / window.length;
}

/**
 * Exponential moving average: like an SMA but weights recent bars more, so it
 * reacts faster to new prices. Seeded with the SMA of the first `period` values.
 */
export function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) return sma(values, values.length);
  const k = 2 / (period + 1);
  let value = sma(values.slice(0, period), period);
  for (let i = period; i < values.length; i++) {
    value = values[i]! * k + value * (1 - k);
  }
  return value;
}

/** Full EMA series (one value per input bar after the seed), used by MACD. */
function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [sma(values.slice(0, period), period)];
  for (let i = period; i < values.length; i++) {
    out.push(values[i]! * k + out[out.length - 1]! * (1 - k));
  }
  return out;
}

/**
 * Relative Strength Index (Wilder). A 0-100 momentum oscillator: below 30 is
 * "oversold" (selling may be overdone), above 70 is "overbought". Flat series
 * return a neutral 50.
 */
export function rsi(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0 && avgGain === 0) return 50;
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface Macd {
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * MACD: the gap between a fast and slow EMA (trend direction/strength), plus a
 * signal line (EMA of the MACD) and their difference (histogram). Histogram
 * crossing above zero is a classic bullish trigger.
 */
export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): Macd {
  if (closes.length < slow) return { macd: 0, signal: 0, histogram: 0 };
  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);
  // Align the two EMA series to the same (shorter) tail before subtracting.
  const n = Math.min(fastSeries.length, slowSeries.length);
  const macdSeries = Array.from({ length: n }, (_, i) => fastSeries[fastSeries.length - n + i]! - slowSeries[slowSeries.length - n + i]!);
  const macdValue = macdSeries[macdSeries.length - 1]!;
  // ema() gracefully falls back to an SMA of the available values when the MACD
  // series is shorter than the signal period (warmup), so the histogram is still
  // meaningful with limited history instead of being pinned to zero.
  const signal = ema(macdSeries, signalPeriod);
  return { macd: macdValue, signal, histogram: macdValue - signal };
}

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
}

/**
 * Bollinger Bands: a moving average (middle) with an envelope `mult` standard
 * deviations wide. Price near the upper band is stretched high; near the lower
 * band, stretched low — the basis of mean-reversion entries.
 */
export function bollingerBands(closes: number[], period = 20, mult = 2): BollingerBands {
  const window = closes.slice(-period);
  const middle = window.reduce((sum, v) => sum + v, 0) / window.length;
  const variance = window.reduce((sum, v) => sum + (v - middle) ** 2, 0) / window.length;
  const sd = Math.sqrt(variance);
  return { upper: middle + mult * sd, middle, lower: middle - mult * sd };
}

/**
 * Average True Range: how much price typically moves per bar (volatility),
 * accounting for gaps. Used to size positions and place stops proportional to
 * current volatility.
 */
export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  const window = trs.slice(-period);
  return window.reduce((sum, v) => sum + v, 0) / window.length;
}

export interface DonchianChannel {
  upper: number;
  lower: number;
}

/**
 * Donchian channel: the highest high and lowest low over `period` bars. A close
 * above the upper channel is a breakout (new local high) — a trend-entry trigger.
 */
export function donchianChannel(candles: Candle[], period = 20): DonchianChannel {
  const window = candles.slice(-period);
  return {
    upper: Math.max(...window.map((c) => c.high)),
    lower: Math.min(...window.map((c) => c.low))
  };
}
