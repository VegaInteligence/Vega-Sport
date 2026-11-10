-- Sources other than PitchAPI (vega_v2/sources): one row per adapter scope and its last
-- run. The worker runs an adapter again once its period has elapsed.
CREATE TABLE ops.source_runs(
  source core.provider NOT NULL,
  scope text NOT NULL CHECK (scope ~ '^[a-z0-9_:/-]{1,80}$'),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'error')),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  rows_written integer NOT NULL DEFAULT 0 CHECK (rows_written >= 0),
  unmatched integer NOT NULL DEFAULT 0 CHECK (unmatched >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, scope)
);
GRANT SELECT, INSERT, UPDATE ON ops.source_runs TO vega_collect;
