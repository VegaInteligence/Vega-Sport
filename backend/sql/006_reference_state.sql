-- Metadata for reference hydration; provider response bodies are never stored here.
CREATE TABLE ops.reference_state (
  provider core.provider NOT NULL,
  entity_type core.entity_type NOT NULL CHECK (entity_type IN ('team', 'player')),
  entity_id integer NOT NULL,
  fingerprint bytea CHECK (fingerprint IS NULL OR octet_length(fingerprint) = 32),
  status core.coverage_status NOT NULL DEFAULT 'pending',
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  next_due timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, entity_type, entity_id)
);
