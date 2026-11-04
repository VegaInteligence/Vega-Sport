-- Initial construction provenance only. Typed refreshes retain this receipt.
-- No cascading foreign key: publishing a partition replaces its serving rows.
CREATE TABLE IF NOT EXISTS statarena_app.partition_bootstrap_sources (
    season text NOT NULL,
    league_id text NOT NULL,
    source_path text NOT NULL CHECK (source_path <> ''),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (season, league_id)
);
