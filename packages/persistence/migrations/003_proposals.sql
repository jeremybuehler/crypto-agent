-- T6.5: interactive proposals and one-time approvals.
-- A proposal is an immutable record of an exact order preview awaiting operator
-- approval. proposal_decisions enforces a single approve/reject per proposal.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'executed', 'cancelled')),
  trade_intent_id UUID,
  product_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quote_size_usd NUMERIC(28, 12) NOT NULL,
  base_size NUMERIC(28, 18) NOT NULL,
  limit_price NUMERIC(28, 12),
  estimated_fee_usd NUMERIC(28, 12) NOT NULL,
  estimated_slippage_bps NUMERIC(18, 8) NOT NULL,
  digest TEXT NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proposals_status_created
  ON proposals (status, created_at DESC);

-- One decision per proposal: the UNIQUE(proposal_id) is the one-time guarantee.
CREATE TABLE IF NOT EXISTS proposal_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL UNIQUE REFERENCES proposals(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  digest TEXT,
  reason TEXT,
  correlation_id UUID NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
