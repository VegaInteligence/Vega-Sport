-- Optional migration: requires PostgreSQL pgvector package to be installed.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE agg.player_profile_vectors(
  player_id integer REFERENCES core.players,
  season_id smallint REFERENCES core.seasons,
  cohort_id integer REFERENCES agg.cohorts,
  embedding vector(30),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(player_id, season_id)
);

CREATE INDEX player_profile_vectors_hnsw ON agg.player_profile_vectors USING hnsw (embedding vector_cosine_ops);
