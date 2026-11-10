-- The editions (one row per PitchAPI competition season: dates, match counts, collection
-- watermark) as a typed precomputed table. api.editions used to aggregate core.matches
-- and ops.family_state (one lookup per match) on every request: about 4 s for the
-- manifest once the archives were in, and part of every read's publication. The doc
-- allows it ("Ce qui change en v2": a block that stays slow is precomputed in a typed agg
-- table; only the JSON format goes). agg.editions is refreshed by the publication
-- (worker.publish, at most every 5 minutes) through ops.refresh_editions, the only write
-- the collect role may make there; api.editions reads it with the same columns.

CREATE TABLE agg.editions(
  competition_season_id integer PRIMARY KEY REFERENCES core.competition_seasons ON DELETE CASCADE,
  start_date date,
  end_date date,
  match_count bigint NOT NULL,
  finished_count bigint NOT NULL,
  collected_count bigint NOT NULL,
  team_count bigint NOT NULL,
  retrieved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION ops.refresh_editions() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  changed integer;
BEGIN
  WITH fresh AS (
    SELECT m.competition_season_id, min(m.match_date) AS start_date, max(m.match_date) AS end_date, count(*) AS match_count,
      count(*) FILTER (WHERE m.status = 'finished') AS finished_count,
      count(*) FILTER (WHERE mc.player_stats = 'ok') AS collected_count,
      max(f.last_success_at) AS retrieved_at
    FROM core.matches m
    JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
    LEFT JOIN (SELECT fs.match_id, max(fs.last_success_at) AS last_success_at FROM ops.family_state fs GROUP BY fs.match_id) f
      ON f.match_id = m.id
    LEFT JOIN core.match_coverage mc ON mc.season_id = m.season_id AND mc.match_id = m.id
    GROUP BY m.competition_season_id
  ), teams AS (
    SELECT ts.competition_season_id, count(*) AS team_count FROM core.team_seasons ts GROUP BY ts.competition_season_id
  ), next AS (
    SELECT fr.*, coalesce(t.team_count, 0) AS team_count FROM fresh fr LEFT JOIN teams t USING (competition_season_id)
  ), gone AS (
    DELETE FROM agg.editions e WHERE NOT EXISTS (SELECT 1 FROM next n WHERE n.competition_season_id = e.competition_season_id)
    RETURNING 1
  ), written AS (
    INSERT INTO agg.editions AS e (competition_season_id, start_date, end_date, match_count, finished_count, collected_count, team_count, retrieved_at)
    SELECT competition_season_id, start_date, end_date, match_count, finished_count, collected_count, team_count, retrieved_at FROM next
    ON CONFLICT (competition_season_id) DO UPDATE SET
      start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, match_count = EXCLUDED.match_count,
      finished_count = EXCLUDED.finished_count, collected_count = EXCLUDED.collected_count,
      team_count = EXCLUDED.team_count, retrieved_at = EXCLUDED.retrieved_at, updated_at = now()
    WHERE (e.start_date, e.end_date, e.match_count, e.finished_count, e.collected_count, e.team_count, e.retrieved_at)
      IS DISTINCT FROM (EXCLUDED.start_date, EXCLUDED.end_date, EXCLUDED.match_count, EXCLUDED.finished_count,
                        EXCLUDED.collected_count, EXCLUDED.team_count, EXCLUDED.retrieved_at)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM gone) + (SELECT count(*) FROM written) INTO changed;
  RETURN changed;
END
$$;
REVOKE ALL ON FUNCTION ops.refresh_editions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.refresh_editions() TO vega_collect, vega_calc;

CREATE OR REPLACE VIEW api.editions AS
SELECT cs.id AS competition_season_id, s.label AS season, cs.native_label, cs.is_current,
  api.public_id('competition', c.id) AS league_id, c.name AS league_name, c.country_code AS country,
  c.kind::text AS kind, lg.source_url AS league_image_url,
  x.start_date, x.end_date, x.match_count, x.finished_count, x.collected_count, x.team_count, x.retrieved_at
FROM core.competition_seasons cs
JOIN core.seasons s ON s.id = cs.season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
JOIN core.competitions c ON c.id = cs.competition_id
LEFT JOIN core.assets lg ON lg.id = c.logo_asset_id
JOIN agg.editions x ON x.competition_season_id = cs.id AND x.match_count > 0;

SELECT ops.refresh_editions();
