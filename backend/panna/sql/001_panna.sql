-- 28 Nov 2026 (GitHub #278, VI-177), pass H1: PannaData's Opta fixtures and events of the window (Vega season
-- 2021/22 onwards, up to each run's as-of), every column, read outside AWS by backend/panna and written here by the
-- login vega_v2_panna. Failure modes and expected outcomes: backend/panna/FAILURE_MODES.md.
--
-- Apart from backend/sql: applied by vega.migrate only when V2_PANNA_PASSWORD is set, with its own record
-- (panna_admin.applied). Nothing here reads, writes or references core, agg, ops, api or account, and nothing there
-- references these schemas: removing them (backend/panna/ROLLBACK.sql) leaves the football schemas whole.
--
-- panna: what was read and how (runs, receipts, streams, loads, segments, chunks, manifest, scope index).
-- panna_data: the typed rows. Each row carries its segment (segment_id) and its place in it (ordinal), 8 bytes; a
-- segment is the rows of one key, stored once whatever the number of objects or generations naming it.
SET LOCAL lock_timeout = '3s';

CREATE SCHEMA panna;
CREATE SCHEMA panna_data;
REVOKE ALL ON SCHEMA panna, panna_data FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vega_panna') THEN CREATE ROLE vega_panna NOLOGIN; END IF;
END $$;

-- One run: one as-of, the exact assets it reads (its plan), its outcome. `token` is drawn by the loader before the
-- insert, so that a run whose COMMIT answer was lost finds its row again.
CREATE TABLE panna.runs (
  run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token uuid NOT NULL UNIQUE,
  as_of date NOT NULL,
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  runner text NOT NULL CHECK (char_length(runner) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'complete', 'partial', 'failed')),
  reason text,
  rows_written bigint NOT NULL DEFAULT 0,
  segments_written bigint NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- What one read of one asset proved: its listing (origin, release, name, asset id), its digest and size checked, the
-- Parquet footer's row count and groups, and its schema (name and Arrow type of each column, in order).
CREATE TABLE panna.receipts (
  receipt_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origin text NOT NULL CHECK (origin IN ('github', 'r2', 'tree', 'media')),
  container text NOT NULL,
  name text NOT NULL,
  asset_id bigint,
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  bytes bigint NOT NULL CHECK (bytes >= 0),
  updated_at timestamptz,
  source_rows bigint NOT NULL CHECK (source_rows >= 0),
  row_groups integer NOT NULL CHECK (row_groups >= 0),
  schema jsonb NOT NULL CHECK (jsonb_typeof(schema) = 'array'),
  first_run_id bigint NOT NULL REFERENCES panna.runs,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origin, container, name, sha256)
);

-- The datasets of pass H1 and their columns: the source's name, ordinal and Arrow type, the column's type here and its
-- place in the table (fixed-width columns first, for alignment).
CREATE TABLE panna.datasets (
  dataset text PRIMARY KEY CHECK (dataset ~ '^[a-z][a-z0-9_]{0,62}$'),
  segment_by text NOT NULL,
  bytes_per_row integer NOT NULL CHECK (bytes_per_row > 0)
);
CREATE TABLE panna.columns (
  dataset text NOT NULL REFERENCES panna.datasets,
  source_ordinal integer NOT NULL CHECK (source_ordinal >= 0),
  name text NOT NULL,
  source_type text NOT NULL,
  pg_type text NOT NULL CHECK (pg_type IN ('text', 'bigint', 'double precision')),
  physical_ordinal integer NOT NULL,
  PRIMARY KEY (dataset, source_ordinal),
  UNIQUE (dataset, name),
  UNIQUE (dataset, physical_ordinal)
);

-- One name over time (a release asset); its loads are its generations.
CREATE TABLE panna.streams (
  stream_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset text NOT NULL REFERENCES panna.datasets,
  origin text NOT NULL,
  container text NOT NULL,
  name text NOT NULL,
  UNIQUE (origin, container, name)
);

-- One generation of a stream read by one run at its as-of. `outcomes` counts each source row's outcome and adds up to
-- the receipt's source_rows. scope_load_id: the fixtures load whose index decided an events load.
CREATE TABLE panna.loads (
  load_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stream_id integer NOT NULL REFERENCES panna.streams,
  receipt_id bigint NOT NULL REFERENCES panna.receipts,
  run_id bigint NOT NULL REFERENCES panna.runs,
  as_of date NOT NULL,
  scope_load_id bigint REFERENCES panna.loads,
  status text NOT NULL DEFAULT 'loading' CHECK (status IN ('loading', 'complete', 'refused')),
  reason text,
  outcomes jsonb,
  segments_written integer NOT NULL DEFAULT 0,
  segments_reused integer NOT NULL DEFAULT 0,
  rows_written bigint NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (run_id, stream_id, receipt_id)
);
CREATE INDEX loads_stream ON panna.loads (stream_id, load_id);

-- A segment: the rows of one key of a dataset with one content digest, stored once. The digest is SHA-256 of the
-- canonical encoding of its rows in source order (backend/panna/encode.py), which the server recomputes from the
-- stored rows. Its ids are drawn in blocks by the loader (nextval) before the chunk's transaction opens.
CREATE TABLE panna.segments (
  segment_id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  dataset text NOT NULL REFERENCES panna.datasets,
  key text NOT NULL,
  digest bytea NOT NULL CHECK (octet_length(digest) = 32),
  rows integer NOT NULL CHECK (rows > 0),
  flag text NOT NULL CHECK (flag IN ('eligible', 'eligible_orphan')),
  day date,
  first_load_id bigint NOT NULL REFERENCES panna.loads,
  first_as_of date NOT NULL,
  UNIQUE (dataset, key, digest)
);

-- Whole segments committed together with their rows and manifest entries, after the server's digests matched.
CREATE TABLE panna.chunks (
  load_id bigint NOT NULL REFERENCES panna.loads,
  chunk_no integer NOT NULL CHECK (chunk_no >= 0),
  segments integer NOT NULL,
  rows integer NOT NULL,
  payload_bytes bigint NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (load_id, chunk_no)
);

-- What each load changed in its stream: a key whose segment is new or different (segment_id), or gone (NULL, a
-- tombstone). Where its rows were in the source: the first row, the count, and when they were not contiguous the
-- (start, length) pairs of their runs.
CREATE TABLE panna.manifest (
  stream_id integer NOT NULL REFERENCES panna.streams,
  key text NOT NULL,
  load_id bigint NOT NULL REFERENCES panna.loads,
  segment_id integer REFERENCES panna.segments,
  first_row bigint,
  row_count integer,
  runs integer[],
  PRIMARY KEY (stream_id, key, load_id)
);
CREATE INDEX manifest_load ON panna.manifest (load_id);

-- The scope index: each fixture key (and each event key without a fixture) with what decided it, never a data column
-- of a deferred fixture. `state` is the window's answer (in, out, unresolved, pending); `outcome` the decision at the
-- as-of of decided_load_id; next_eligible_on the day a deferred key becomes due.
CREATE TABLE panna.scope (
  dataset text NOT NULL REFERENCES panna.datasets,
  key text NOT NULL,
  state text NOT NULL CHECK (state IN ('in', 'out', 'unresolved', 'pending')),
  outcome text NOT NULL CHECK (outcome IN ('eligible', 'eligible_orphan', 'historical', 'deferred', 'pending', 'unresolved')),
  reason text NOT NULL,
  day date,
  vega_season integer,
  next_eligible_on date,
  first_seen_on date NOT NULL,
  decided_load_id bigint NOT NULL REFERENCES panna.loads,
  decided_as_of date NOT NULL,
  PRIMARY KEY (dataset, key)
);

-- The typed rows: every column of the source, in the source's types; fixed-width columns first.
CREATE TABLE panna_data.opta_fixtures (
  segment_id integer NOT NULL,
  ordinal integer NOT NULL,
  match_id text, match_date text, match_status text, home_team text, away_team text, home_team_id text,
  away_team_id text, home_score text, away_score text, home_score_ht text, away_score_ht text, competition text,
  season text
);
CREATE TABLE panna_data.opta_events (
  segment_id integer NOT NULL,
  ordinal integer NOT NULL,
  event_id bigint, type_id bigint, minute bigint, second bigint, x double precision, y double precision,
  end_x double precision, end_y double precision, outcome bigint, period_id bigint,
  match_id text, player_id text, player_name text, team_id text, qualifier_json text, competition text, season text
);
-- Rows arrive in segment order: a block range index finds a segment's rows at a fraction of a B-tree's size.
CREATE INDEX opta_fixtures_segment ON panna_data.opta_fixtures USING brin (segment_id);
CREATE INDEX opta_events_segment ON panna_data.opta_events USING brin (segment_id);

INSERT INTO panna.datasets (dataset, segment_by, bytes_per_row) VALUES
  ('opta_fixtures', 'match_id', 220),
  ('opta_events', 'match_id', 330);
INSERT INTO panna.columns (dataset, source_ordinal, name, source_type, pg_type, physical_ordinal)
SELECT 'opta_fixtures', o - 1, name, 'string', 'text', o - 1
FROM unnest(ARRAY['match_id', 'match_date', 'match_status', 'home_team', 'away_team', 'home_team_id', 'away_team_id',
                  'home_score', 'away_score', 'home_score_ht', 'away_score_ht', 'competition', 'season'])
     WITH ORDINALITY AS c (name, o);
INSERT INTO panna.columns (dataset, source_ordinal, name, source_type, pg_type, physical_ordinal) VALUES
  ('opta_events', 0, 'match_id', 'string', 'text', 10),
  ('opta_events', 1, 'event_id', 'int64', 'bigint', 0),
  ('opta_events', 2, 'type_id', 'int64', 'bigint', 1),
  ('opta_events', 3, 'player_id', 'string', 'text', 11),
  ('opta_events', 4, 'player_name', 'string', 'text', 12),
  ('opta_events', 5, 'team_id', 'string', 'text', 13),
  ('opta_events', 6, 'minute', 'int64', 'bigint', 2),
  ('opta_events', 7, 'second', 'int64', 'bigint', 3),
  ('opta_events', 8, 'x', 'double', 'double precision', 4),
  ('opta_events', 9, 'y', 'double', 'double precision', 5),
  ('opta_events', 10, 'end_x', 'double', 'double precision', 6),
  ('opta_events', 11, 'end_y', 'double', 'double precision', 7),
  ('opta_events', 12, 'outcome', 'int64', 'bigint', 8),
  ('opta_events', 13, 'period_id', 'int64', 'bigint', 9),
  ('opta_events', 14, 'qualifier_json', 'string', 'text', 14),
  ('opta_events', 15, 'competition', 'large_string', 'text', 15),
  ('opta_events', 16, 'season', 'large_string', 'text', 16);

-- A stream's current state: the latest entry of each key over its complete loads, tombstones left out. The views read
-- tables only.
CREATE VIEW panna.current_segments AS
SELECT s.origin, s.container, s.name, s.dataset, c.key, c.segment_id, c.load_id
FROM (SELECT DISTINCT ON (m.stream_id, m.key) m.stream_id, m.key, m.segment_id, m.load_id
      FROM panna.manifest m JOIN panna.loads l ON l.load_id = m.load_id
      WHERE l.status = 'complete'
      ORDER BY m.stream_id, m.key, m.load_id DESC) c
JOIN panna.streams s ON s.stream_id = c.stream_id
WHERE c.segment_id IS NOT NULL;

-- A past generation: its stream as it stood once that load completed.
CREATE FUNCTION panna.segments_as_of(p_load bigint)
RETURNS TABLE (key text, segment_id integer) LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT c.key, c.segment_id
  FROM (SELECT DISTINCT ON (m.key) m.key, m.segment_id
        FROM panna.manifest m JOIN panna.loads l ON l.load_id = m.load_id
        WHERE m.stream_id = (SELECT stream_id FROM panna.loads WHERE load_id = p_load)
          AND m.load_id <= p_load AND (l.status = 'complete' OR l.load_id = p_load)
        ORDER BY m.key, m.load_id DESC) c
  WHERE c.segment_id IS NOT NULL
$$;

-- What a reader of the current data reads: each current segment's rows with the name of the stream that holds it.
CREATE VIEW panna_data.opta_fixtures_current AS
SELECT s.name AS source_name, c.key, d.*
FROM (SELECT DISTINCT ON (m.stream_id, m.key) m.stream_id, m.key, m.segment_id
      FROM panna.manifest m JOIN panna.loads l ON l.load_id = m.load_id
      WHERE l.status = 'complete'
      ORDER BY m.stream_id, m.key, m.load_id DESC) c
JOIN panna.streams s ON s.stream_id = c.stream_id AND s.dataset = 'opta_fixtures'
JOIN panna_data.opta_fixtures d ON d.segment_id = c.segment_id;
CREATE VIEW panna_data.opta_events_current AS
SELECT s.name AS source_name, c.key, d.*
FROM (SELECT DISTINCT ON (m.stream_id, m.key) m.stream_id, m.key, m.segment_id
      FROM panna.manifest m JOIN panna.loads l ON l.load_id = m.load_id
      WHERE l.status = 'complete'
      ORDER BY m.stream_id, m.key, m.load_id DESC) c
JOIN panna.streams s ON s.stream_id = c.stream_id AND s.dataset = 'opta_events'
JOIN panna_data.opta_events d ON d.segment_id = c.segment_id;

-- The loader's login: read and insert, update its own control rows, draw segment ids; nothing else.
GRANT USAGE ON SCHEMA panna, panna_data TO vega_panna;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA panna TO vega_panna;
GRANT UPDATE ON panna.runs, panna.loads, panna.scope TO vega_panna;
GRANT SELECT, INSERT ON panna_data.opta_fixtures, panna_data.opta_events TO vega_panna;
GRANT SELECT ON panna_data.opta_fixtures_current, panna_data.opta_events_current TO vega_panna;
GRANT USAGE ON SEQUENCE panna.segments_segment_id_seq TO vega_panna;
REVOKE ALL ON FUNCTION panna.segments_as_of(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION panna.segments_as_of(bigint) TO vega_panna;
