CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS market_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id TEXT NOT NULL,
  price NUMERIC(28, 12) NOT NULL,
  bid NUMERIC(28, 12) NOT NULL,
  ask NUMERIC(28, 12) NOT NULL,
  spread_bps NUMERIC(18, 8) NOT NULL,
  source_timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_product_created
  ON market_snapshots (product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  input_json JSONB NOT NULL,
  output_json JSONB NOT NULL,
  market_regime TEXT NOT NULL,
  confidence NUMERIC(6, 5) NOT NULL,
  do_not_trade BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_contexts_product_created
  ON ai_contexts (product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS trade_intents (
  id UUID PRIMARY KEY,
  product_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quote_size_usd NUMERIC(28, 12) NOT NULL,
  confidence NUMERIC(6, 5) NOT NULL,
  reason_code TEXT NOT NULL,
  rationale TEXT NOT NULL,
  strategy_version TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trade_intents_product_created
  ON trade_intents (product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS risk_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_intent_id UUID NOT NULL REFERENCES trade_intents(id),
  approved BOOLEAN NOT NULL,
  reasons JSONB NOT NULL,
  rule_results JSONB NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_decisions_intent
  ON risk_decisions (trade_intent_id);

CREATE TABLE IF NOT EXISTS paper_fills (
  id UUID PRIMARY KEY,
  trade_intent_id UUID NOT NULL REFERENCES trade_intents(id),
  product_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quote_size_usd NUMERIC(28, 12) NOT NULL,
  price NUMERIC(28, 12) NOT NULL,
  base_size NUMERIC(28, 18) NOT NULL,
  fee_usd NUMERIC(28, 12) NOT NULL,
  filled_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_fills_product_filled
  ON paper_fills (product_id, filled_at DESC);
