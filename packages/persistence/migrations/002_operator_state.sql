-- T6.3: durable operator and audit state.
-- Portfolio snapshots, worker heartbeats, and immutable audit events. Fills
-- already live in paper_fills (001); the operator API reads those for metrics.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Latest-wins portfolio snapshots reported by the worker on each heartbeat.
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL,
  equity_usd NUMERIC(28, 12) NOT NULL,
  cash_usd NUMERIC(28, 12) NOT NULL,
  daily_pnl_pct NUMERIC(18, 8) NOT NULL,
  total_exposure_pct NUMERIC(18, 8) NOT NULL,
  positions JSONB NOT NULL,
  version BIGINT NOT NULL,
  correlation_id UUID NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotency: a retried heartbeat for the same instant is a no-op.
  UNIQUE (worker_id, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_created
  ON portfolio_snapshots (created_at DESC);

-- One row per worker, upserted on every heartbeat. Drives readiness staleness.
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'degraded', 'down')),
  detail JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable audit log. Code only ever INSERTs and SELECTs; never UPDATE/DELETE.
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('operator', 'worker', 'system')),
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_occurred
  ON audit_events (occurred_at DESC);
