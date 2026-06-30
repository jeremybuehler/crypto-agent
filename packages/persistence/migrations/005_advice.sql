-- T6.8: sourced advice records, kept separate from trade approval. Advice can
-- never execute; this table only records what guidance was given, with its
-- provenance, for audit and feedback.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS advice_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_version INTEGER NOT NULL,
  jurisdiction TEXT NOT NULL CHECK (jurisdiction = 'US'),
  question TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload JSONB NOT NULL,
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_advice_records_created ON advice_records (created_at DESC);
