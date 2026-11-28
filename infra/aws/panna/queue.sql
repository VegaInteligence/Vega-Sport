-- Operate as owner after review. The daily role receives only DML on this operational schema.
CREATE SCHEMA IF NOT EXISTS panna_sync;
CREATE TABLE IF NOT EXISTS panna_sync.sources (
  source_key text PRIMARY KEY,
  last_inventory_at timestamptz,
  next_inventory_at timestamptz,
  state text NOT NULL DEFAULT 'inventory_pending',
  detail text
);
CREATE TABLE IF NOT EXISTS panna_sync.work (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handler text NOT NULL,
  asset_name text NOT NULL,
  digest text NOT NULL,
  cutoff date NOT NULL,
  fixture_pin text NOT NULL DEFAULT '',
  asset jsonb NOT NULL,
  status text NOT NULL CHECK (status IN (
    'pending','leased','retry','verified','unavailable','capacity_blocked','handler_pending','dependency_pending'
  )),
  reason text,
  attempt integer NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL,
  lease_until timestamptz,
  run_id bigint,
  UNIQUE (handler, asset_name, digest, cutoff, fixture_pin)
);
ALTER TABLE panna_sync.work ADD COLUMN IF NOT EXISTS result jsonb;
CREATE INDEX IF NOT EXISTS panna_sync_ready ON panna_sync.work (status, next_at, id);
INSERT INTO panna_sync.sources(source_key)
VALUES ('github:opta-latest'), ('github:other-releases'), ('r2:catalog'), ('archives-and-native-formats')
ON CONFLICT DO NOTHING;
