-- Scoped phase source receipts (VI-27). Match publication keeps its existing typed columns.
CREATE TABLE ops.dfb_period_observations (
  scope text NOT NULL CHECK (scope IN ('openligadb:germany-cup:2025/2026', 'openligadb:germany-cup:2026/2027')),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  ledger_sha256 text NOT NULL CHECK (ledger_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('accepted', 'refused')),
  code text NOT NULL,
  observed_at timestamptz NOT NULL,
  observation jsonb NOT NULL,
  detail text,
  PRIMARY KEY (scope, source_sha256, ledger_sha256, status, code)
);
REVOKE ALL ON ops.dfb_period_observations FROM PUBLIC, vega_collect, vega_read;
GRANT INSERT ON ops.dfb_period_observations TO vega_collect;
COMMENT ON TABLE ops.dfb_period_observations IS
  'Native DFB-Pokal phase observations and their acceptance or refusal, bound to source bytes and the applied DFB ledger.';
