-- Optional migration (pgvector): profile vectors are relative to a cohort, so the cohort
-- is part of their identity. 009 drops the prototype table; this recreates it whenever
-- the optional vector migrations are applied, before or after 009.

DROP TABLE IF EXISTS agg.player_profile_vectors;

CREATE TABLE agg.player_profile_vectors(
  player_id integer NOT NULL REFERENCES core.players,
  season_id smallint NOT NULL REFERENCES core.seasons,
  cohort_id integer NOT NULL REFERENCES agg.cohorts ON DELETE CASCADE,
  embedding vector(30) NOT NULL,
  calc_run_id integer NOT NULL REFERENCES agg.calc_runs,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, season_id, cohort_id)
);

CREATE INDEX player_profile_vectors_hnsw ON agg.player_profile_vectors USING hnsw (embedding vector_cosine_ops);
