# Real Strategies + Backtest — Design

## Context

The agent shipped with one toy strategy (`aiAssistedTrendStrategy`) built on a
5-candle SMA and a crude momentum check. It works as plumbing but isn't a real
trading strategy, and there's no way to validate a strategy before running it.

The operator wants **real strategies plus a backtest to validate them**, and
explicitly wants to **learn trading** in the process. So the design optimizes for
two things: correct, standard technical strategies, and an *educational* surface
— every signal and every backtest explains itself in plain English.

Constraint (CLAUDE.md): the strategy engine is deterministic TypeScript; the LLM
stays advisory-only and never emits orders. Risk may still veto.

## 1. Indicator library (`packages/market-data/src/indicators.ts`)

Pure, unit-tested functions over candle/price arrays, each with a teaching
doc-comment:
- `ema(values, period)`, `sma(values, period)`
- `rsi(closes, period=14)` — momentum oscillator, 0-100
- `macd(closes, fast=12, slow=26, signal=9)` → `{ macd, signal, histogram }`
- `bollingerBands(closes, period=20, mult=2)` → `{ upper, middle, lower }`
- `atr(candles, period=14)` — average true range (volatility)
- `donchianChannel(candles, period=20)` → `{ upper, lower }`

These need real lookback, so the worker/backtest feed full candle history
(50-100 candles), not the 5-candle window.

## 2. Strategy framework (`packages/strategy`)

```
interface StrategySignal {
  side: "BUY" | "SELL";
  confidence: number;          // 0..1
  reasonCode: string;
  rationale: string;           // plain-English, educational
  indicators: Record<string, number>; // snapshot for transparency
}
interface Strategy {
  name: string;                // "trend" | "mean-reversion" | "breakout"
  version: string;
  describe(): string;          // one-paragraph explainer
  evaluate(ctx: StrategyContext): StrategySignal | null;
}
interface StrategyContext { candles: Candle[]; market: MarketSnapshot; portfolio: PortfolioState; config: AgentConfig; aiContext: AIContext; }
```

Three strategies, each computing indicators, deciding, and building a rationale
like *"RSI 24 (oversold, <30) and price at the lower Bollinger Band → mean
reversion buy."* SELL signals only reduce an existing position (no shorting;
ALLOW_SHORTS=false). AI `doNotTrade` and spread/volatility guards still apply.

Registry: `createStrategy(name)` + `STRATEGIES` map. Selected via a new
`STRATEGY` env (`config.strategy.name`, default `trend`). A `TradeIntent` is
built from the signal (side/size/rationale) so the rest of the pipeline
(risk → proposal/fill → dashboard rationale) is unchanged.

Position size stays within `MAX_TRADE_NOTIONAL_USD`; ATR is surfaced in the
signal for context and future stop placement.

## 3. Backtest (`packages/backtest` + `apps/worker/src/backtest.ts`)

Generalize `runBacktest(candles, config, strategy)` to take a strategy. Keep the
existing metrics (trades, win rate, realized PnL, max drawdown, Sharpe) and add a
short plain-English explanation of each in `printBacktestReport`.

CLI fetches **real historical Coinbase candles** (public API, no keys) for the
product and window, runs the selected strategy, prints the report:
`pnpm backtest --strategy mean-reversion --product BTC-USD --granularity ONE_MINUTE --limit 300`.

## 4. Testing

- Indicators: unit tests with known fixtures (e.g. Wilder's RSI reference values).
- Strategies: unit tests for each entry/exit condition + the guards.
- Backtest: deterministic run over a fixed candle fixture asserts metric shape.
- All hermetic; the CLI's live Coinbase fetch is manual/verification only.

## Out of scope (this pass)

Parameter sweeps / auto-ranking, stop-loss order execution, multi-product
portfolio optimization, ML strategies.
