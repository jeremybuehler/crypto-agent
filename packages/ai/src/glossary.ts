/**
 * Static trading glossary for the educational assistant. Canonical definitions
 * live here (not generated per-conversation) so the same term always gets the
 * same explanation, with a curated reputable reference per entry.
 */

export interface GlossaryEntry {
  term: string;
  definition: string;
  whyItMatters: string;
  reference: string;
}

const ENTRIES: GlossaryEntry[] = [
  {
    term: "EMA (exponential moving average)",
    definition:
      "An average of recent prices that weights newer prices more heavily than older ones, so it reacts faster to change than a simple average.",
    whyItMatters:
      "Our trend strategy compares a fast EMA to a slow EMA: fast crossing above slow signals an uptrend, crossing below signals a breakdown. Because EMAs average the past, the signal always confirms AFTER the move has started.",
    reference: "https://www.investopedia.com/terms/e/ema.asp"
  },
  {
    term: "MACD",
    definition:
      "Moving Average Convergence Divergence — the difference between a fast and a slow EMA, plus a histogram showing whether that difference is growing or shrinking.",
    whyItMatters:
      "A positive, growing histogram supports 'the uptrend is strengthening'; a negative one supports 'it broke'. It lags price like every moving-average tool.",
    reference: "https://www.investopedia.com/terms/m/macd.asp"
  },
  {
    term: "notional",
    definition: "The total dollar value of a trade — price times quantity.",
    whyItMatters:
      "Our risk engine caps notional per trade (MAX_TRADE_NOTIONAL_USD). Sizing by dollars, not coins, keeps risk comparable across products with wildly different prices.",
    reference: "https://www.investopedia.com/terms/n/notionalvalue.asp"
  },
  {
    term: "slippage",
    definition:
      "The difference between the price you expected and the price you actually got, caused by the market moving or your order eating through the order book.",
    whyItMatters:
      "Order previews here include an estimated slippage in basis points. At small trade sizes slippage plus fees can exceed the profit a strategy expects to capture.",
    reference: "https://www.investopedia.com/terms/s/slippage.asp"
  },
  {
    term: "basis points (bps)",
    definition: "One basis point is 0.01%. 100 bps = 1%.",
    whyItMatters:
      "Spreads, slippage, and fees are quoted in bps because trading edges are usually smaller than 1%. A 10 bps spread means paying 0.1% just to enter and exit.",
    reference: "https://www.investopedia.com/terms/b/basispoint.asp"
  },
  {
    term: "spread",
    definition:
      "The gap between the best bid (highest price a buyer will pay) and the best ask (lowest price a seller will take).",
    whyItMatters:
      "You buy at the ask and sell at the bid, so the spread is an invisible cost paid on every round trip — before fees and slippage.",
    reference: "https://www.investopedia.com/terms/b/bid-askspread.asp"
  },
  {
    term: "fill",
    definition: "An executed trade: the exchange matched your order and money changed hands at a specific price.",
    whyItMatters:
      "In this system a fill is the durable record everything else hangs off: PnL, fees, the audit chain, and the cooldown clock all measure from fills.",
    reference: "https://www.investopedia.com/terms/f/fill.asp"
  },
  {
    term: "market order",
    definition: "An order to buy or sell immediately at the best available price, with no price guarantee.",
    whyItMatters:
      "This system uses IOC market orders: guaranteed speed, not price. That is why previews estimate slippage — the fill price can differ from the quote you saw.",
    reference: "https://www.investopedia.com/terms/m/marketorder.asp"
  },
  {
    term: "PnL (profit and loss)",
    definition:
      "How much money a position or account has made or lost. Realized PnL comes from closed trades; unrealized PnL is paper gains on open positions.",
    whyItMatters:
      "The dashboard's daily PnL feeds the daily-loss risk rule: breach the configured limit and the system halts trading for the day.",
    reference: "https://www.investopedia.com/terms/p/plstatement.asp"
  },
  {
    term: "exposure",
    definition: "The share of your account currently at risk in positions, usually a percentage of equity.",
    whyItMatters:
      "Risk rules cap exposure per product and in total, so one bad market cannot take down the whole account. Diversification enforced by code, not discipline.",
    reference: "https://www.investopedia.com/terms/m/marketexposure.asp"
  },
  {
    term: "drawdown",
    definition: "The decline from an account's peak value to its lowest point before recovering.",
    whyItMatters:
      "A 50% drawdown needs a 100% gain to recover — losses hurt more than symmetric gains help. This asymmetry is why capital preservation beats trade frequency.",
    reference: "https://www.investopedia.com/terms/d/drawdown.asp"
  },
  {
    term: "cooldown",
    definition: "A mandatory waiting period between trades (MIN_SECONDS_BETWEEN_TRADES here).",
    whyItMatters:
      "It blocks overtrading and revenge-trading: after a fill, the strategy can beg to trade every tick and the risk engine will veto until the clock runs out.",
    reference: "https://www.investopedia.com/terms/o/overtrading.asp"
  },
  {
    term: "kill switch",
    definition: "An operator control that halts all trading immediately, independent of what any strategy wants.",
    whyItMatters:
      "The human's final authority. In live mode it cannot even be cleared through the API — a deliberate speed bump so re-enabling trading is a considered act.",
    reference: "https://www.investopedia.com/terms/c/circuitbreaker.asp"
  },
  {
    term: "candlestick (OHLC)",
    definition:
      "A chart element summarizing one time bucket: Open, High, Low, Close. Green/hollow means close above open; red/filled means below.",
    whyItMatters:
      "The dashboard chart is 20-second candles. All our indicators (EMA, MACD) are computed from candle closes, so the chart IS the strategy's raw input.",
    reference: "https://www.investopedia.com/terms/c/candlestick.asp"
  },
  {
    term: "proposal",
    definition:
      "In this system: an exact order preview (product, side, size, estimated fees and slippage) parked for operator approval, with a cryptographic digest and an expiry.",
    whyItMatters:
      "The approval gate is the core safety design — the strategy proposes, deterministic risk checks veto, and only a human approval of the exact digest can release a real order.",
    reference: "https://www.investopedia.com/terms/r/riskmanagement.asp"
  },
  {
    term: "trend following",
    definition:
      "A strategy family that buys when price momentum points up and exits when it turns down, accepting late entries in exchange for catching long moves.",
    whyItMatters:
      "Our 'trend' strategy is this. It loses small amounts often in choppy markets (late in, late out) and pays for itself only when a real sustained trend arrives.",
    reference: "https://www.investopedia.com/terms/t/trendtrading.asp"
  }
];

const INDEX = new Map<string, GlossaryEntry>();
for (const entry of ENTRIES) {
  INDEX.set(normalizeTerm(entry.term), entry);
}

// Aliases resolve common shorthand to canonical entries.
const ALIASES: Record<string, string> = {
  ema: "EMA (exponential moving average)",
  "exponential moving average": "EMA (exponential moving average)",
  "moving average": "EMA (exponential moving average)",
  bps: "basis points (bps)",
  "basis point": "basis points (bps)",
  "basis points": "basis points (bps)",
  "bid-ask spread": "spread",
  "bid ask spread": "spread",
  pnl: "PnL (profit and loss)",
  "profit and loss": "PnL (profit and loss)",
  "p&l": "PnL (profit and loss)",
  candle: "candlestick (OHLC)",
  candlestick: "candlestick (OHLC)",
  ohlc: "candlestick (OHLC)",
  "kill-switch": "kill switch",
  "trend-following": "trend following",
  trend: "trend following",
  "market orders": "market order",
  fills: "fill",
  fees: "basis points (bps)"
};

function normalizeTerm(term: string): string {
  return term.toLowerCase().replace(/\s+/g, " ").trim();
}

export function lookupTerm(term: string): GlossaryEntry | null {
  const normalized = normalizeTerm(term);
  const direct = INDEX.get(normalized);
  if (direct) return direct;
  const alias = ALIASES[normalized];
  if (alias) return INDEX.get(normalizeTerm(alias)) ?? null;
  // Prefix match lets "macd histogram" or "ema cross" resolve to their entry.
  if (normalized.length >= 3) {
    for (const [key, entry] of INDEX) {
      const headword = key.split(" ")[0]!;
      if (key.startsWith(normalized) || (headword.length >= 3 && normalized.startsWith(headword))) return entry;
    }
  }
  return null;
}

export function listGlossaryTerms(): string[] {
  return ENTRIES.map((entry) => entry.term);
}

/**
 * Scan free text (e.g. "what is slippage?") for the first known term or alias,
 * longest match first so "basis points" beats "basis".
 */
export function findTermInText(text: string): GlossaryEntry | null {
  const haystack = ` ${normalizeTerm(text).replace(/[?!.,;:'"()]/g, " ")} `;
  const candidates = [...INDEX.keys(), ...Object.keys(ALIASES)].sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    if (haystack.includes(` ${candidate} `)) return lookupTerm(candidate);
  }
  return null;
}
