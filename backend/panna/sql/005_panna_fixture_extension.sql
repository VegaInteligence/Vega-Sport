-- 28 Nov 2026 (GitHub #278, VI-177): the 14 columns opta_fixtures.parquet holds after H1's 13 since the release
-- asset of 28 Nov 2026, 14:18 UTC (backend/panna/FAILURE_MODES.md section 9). After 001-004.
--
-- A key's 14 values are one segment of the dataset opta_fixtures_ext (none when they are all NULL), beside its segment
-- of H1's 13 columns, which keeps its digest and is not copied again. A manifest entry names both segments; a load
-- names the extension it read. panna.fixture_rows gives a generation's 27 columns with each row's source ordinal.
--
-- Online: catalog changes. The two new columns are NULL in H1's rows (no rewrite), the manifest's new foreign key is
-- validated over those NULLs. H1's loader must not run once this file is applied: it writes no extension pair.
SET LOCAL lock_timeout = '3s';

ALTER TABLE panna.columns DROP CONSTRAINT columns_pg_type_check;
ALTER TABLE panna.columns ADD CONSTRAINT columns_pg_type_check
  CHECK (pg_type IN ('text', 'bigint', 'double precision', 'boolean'));

-- 1,119 bytes a row measured with the B-tree on the asset of 28 Nov 2026 (README, Fixtures with the 14 added columns).
INSERT INTO panna.datasets (dataset, segment_by, bytes_per_row) VALUES ('opta_fixtures_ext', 'match_id', 1150);
INSERT INTO panna.columns (dataset, source_ordinal, name, source_type, pg_type, physical_ordinal) VALUES
  ('opta_fixtures_ext', 0, 'venue_id', 'string', 'text', 4),
  ('opta_fixtures_ext', 1, 'venue_name', 'string', 'text', 5),
  ('opta_fixtures_ext', 2, 'venue_latitude', 'double', 'double precision', 0),
  ('opta_fixtures_ext', 3, 'venue_longitude', 'double', 'double precision', 1),
  ('opta_fixtures_ext', 4, 'venue_neutral', 'bool', 'boolean', 3),
  ('opta_fixtures_ext', 5, 'local_date', 'string', 'text', 6),
  ('opta_fixtures_ext', 6, 'local_time', 'string', 'text', 7),
  ('opta_fixtures_ext', 7, 'match_week', 'string', 'text', 8),
  ('opta_fixtures_ext', 8, 'coverage_level', 'string', 'text', 9),
  ('opta_fixtures_ext', 9, 'var', 'string', 'text', 10),
  ('opta_fixtures_ext', 10, 'referee_id', 'string', 'text', 11),
  ('opta_fixtures_ext', 11, 'referee_name', 'string', 'text', 12),
  ('opta_fixtures_ext', 12, 'attendance', 'double', 'double precision', 2),
  ('opta_fixtures_ext', 13, 'match_officials_json', 'string', 'text', 13);

-- The 14 values of the rows of a key, in the source's types; fixed-width columns first. The row of a key's segment of
-- opta_fixtures and the row of its extension segment with the same ordinal are one source row.
CREATE TABLE panna_data.opta_fixtures_ext (
  segment_id integer NOT NULL,
  ordinal integer NOT NULL,
  venue_latitude double precision, venue_longitude double precision, attendance double precision, venue_neutral boolean,
  venue_id text, venue_name text, local_date text, local_time text, match_week text, coverage_level text, var text,
  referee_id text, referee_name text, match_officials_json text
);
CREATE INDEX opta_fixtures_ext_segment_id ON panna_data.opta_fixtures_ext (segment_id);

-- NULL: the key's 14 values are all NULL in that generation, or its object has no such column (loads.extension NULL).
ALTER TABLE panna.manifest ADD COLUMN extension_segment_id integer REFERENCES panna.segments;
ALTER TABLE panna.loads ADD COLUMN extension text REFERENCES panna.datasets;

-- A complete extended fixtures load's generation: each stored source row, its ordinal in the object (exact for a key
-- whose entry that object wrote, FAILURE_MODES.md section 9) and its 27 values in the object's order. A load of a
-- 13-column object is refused rather than shown with 14 invented NULLs; so is a scoped run's load (review F), whose
-- other keys' entries may come from a 13-column object.
CREATE FUNCTION panna.fixture_rows(p_load bigint)
RETURNS TABLE (source_ordinal bigint, match_id text, match_date text, match_status text, home_team text, away_team text,
               home_team_id text, away_team_id text, home_score text, away_score text, home_score_ht text,
               away_score_ht text, competition text, season text, venue_id text, venue_name text,
               venue_latitude double precision, venue_longitude double precision, venue_neutral boolean,
               local_date text, local_time text, match_week text, coverage_level text, var text, referee_id text,
               referee_name text, attendance double precision, match_officials_json text)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM panna.loads l JOIN panna.streams s ON s.stream_id = l.stream_id
                   JOIN panna.runs u ON u.run_id = l.run_id
                 WHERE l.load_id = p_load AND l.status = 'complete' AND s.dataset = 'opta_fixtures'
                   AND l.extension = 'opta_fixtures_ext' AND coalesce(jsonb_typeof(u.plan->'scope'), 'null') = 'null') THEN
    RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value',
      MESSAGE = 'panna.fixture_rows: not a complete full opta_fixtures load of an object holding the 14 added columns';
  END IF;
  RETURN QUERY
  SELECT CASE WHEN c.runs IS NULL THEN c.first_row + d.ordinal ELSE o.ordinals[d.ordinal + 1] END,
         d.match_id, d.match_date, d.match_status, d.home_team, d.away_team, d.home_team_id, d.away_team_id,
         d.home_score, d.away_score, d.home_score_ht, d.away_score_ht, d.competition, d.season,
         e.venue_id, e.venue_name, e.venue_latitude, e.venue_longitude, e.venue_neutral, e.local_date, e.local_time,
         e.match_week, e.coverage_level, e.var, e.referee_id, e.referee_name, e.attendance, e.match_officials_json
  FROM (SELECT DISTINCT ON (m.key) m.key, m.segment_id, m.extension_segment_id, m.first_row, m.runs
        FROM panna.manifest m JOIN panna.loads l ON l.load_id = m.load_id
        WHERE m.stream_id = (SELECT x.stream_id FROM panna.loads x WHERE x.load_id = p_load)
          AND m.load_id <= p_load AND l.status = 'complete'
        ORDER BY m.key, m.load_id DESC) c
  JOIN panna_data.opta_fixtures d ON d.segment_id = c.segment_id
  LEFT JOIN panna_data.opta_fixtures_ext e ON e.segment_id = c.extension_segment_id AND e.ordinal = d.ordinal
  LEFT JOIN LATERAL (SELECT array_agg(c.runs[2 * i - 1] + g ORDER BY i, g) AS ordinals
                     FROM generate_series(1, array_length(c.runs, 1) / 2) i, generate_series(0, c.runs[2 * i] - 1) g) o
    ON c.runs IS NOT NULL
  WHERE c.segment_id IS NOT NULL;
END $$;

-- The loader's login writes the new rows as H1's; the readback is the owner's (FAILURE_MODES.md GH278-ai unchanged).
GRANT SELECT, INSERT ON panna_data.opta_fixtures_ext TO vega_panna;
REVOKE ALL ON FUNCTION panna.fixture_rows(bigint) FROM PUBLIC;
