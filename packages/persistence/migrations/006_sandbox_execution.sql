-- Sandbox (and future live) execution lifecycle.
--
-- The worker executes an operator-approved proposal against the real Coinbase
-- Advanced Trade API. Approval (pending -> approved | rejected) stays owned by
-- the API; the worker owns the disjoint execution lifecycle
-- (approved -> executing -> executed | execution_failed). `executing` is the
-- in-flight/in-doubt state: a proposal left here means an order may have landed
-- and reconciliation or the operator must resolve it.
--
-- Fills are reused from `paper_fills` so the dashboard/metrics render sandbox
-- and live fills with no read-path change; a `mode` column distinguishes them,
-- and `client_order_id` is the exchange idempotency key (== proposal id).

-- Extend the proposal status domain. The inline CHECK on 001/003 is named
-- `proposals_status_check` by Postgres; drop and re-add with the new states.
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'executed', 'cancelled', 'executing', 'execution_failed'));

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS exchange_order_id TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS client_order_id TEXT;

-- Real-order provenance on the shared fills table. `mode` defaults to 'paper'
-- so every existing row is correctly classified.
ALTER TABLE paper_fills ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'paper';
ALTER TABLE paper_fills DROP CONSTRAINT IF EXISTS paper_fills_mode_check;
ALTER TABLE paper_fills ADD CONSTRAINT paper_fills_mode_check
  CHECK (mode IN ('paper', 'sandbox', 'live'));
ALTER TABLE paper_fills ADD COLUMN IF NOT EXISTS exchange_order_id TEXT;
ALTER TABLE paper_fills ADD COLUMN IF NOT EXISTS client_order_id TEXT;
ALTER TABLE paper_fills ADD COLUMN IF NOT EXISTS proposal_id UUID;

-- Idempotency backstop: a given exchange order can produce at most one fill row,
-- so a crashed-then-retried execution cannot double-count. Partial (real orders
-- only) because paper fills carry no client_order_id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_paper_fills_client_order_id
  ON paper_fills (client_order_id) WHERE client_order_id IS NOT NULL;
