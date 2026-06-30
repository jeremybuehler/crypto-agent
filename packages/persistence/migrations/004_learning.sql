-- T6.7: inspectable, always-learning user memory.
-- Every learned item carries provenance, confidence, scope, and retention, and
-- is fully inspectable/correctable/deletable. profile_memory_history is an
-- immutable audit of every change. Secrets are never stored (enforced in code).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS profile_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('explicit', 'derived')),
  confidence NUMERIC(6, 5) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  retention_until TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('active', 'pending', 'rejected', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_memories_status ON profile_memories (status);

CREATE TABLE IF NOT EXISTS profile_memory_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES profile_memories(id),
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'corrected', 'rejected', 'deleted', 'observed')),
  old_value TEXT,
  new_value TEXT,
  actor TEXT NOT NULL CHECK (actor IN ('operator', 'worker', 'system')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_memory_history_memory ON profile_memory_history (memory_id, changed_at DESC);
