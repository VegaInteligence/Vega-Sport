-- The archive index (GET /api/archives/index), precomputed per season.
--
-- The index lists every archive season with its counts: matches, results, goals. It
-- counted them on every request over the whole archive: 494,713 matches, 422,187 goals
-- in 141,268 of them on 10 November 2026. The goals index took 5.8 s written at its
-- best on the views and timed out before; both grow with core.match_events, which the
-- PitchAPI backfill fills in the same partitions. The doc allows the precomputation
-- ("Ce qui change en v2": a block that stays slow is precomputed in a typed agg table).
--
-- One row per season that holds archive matches. The result columns count the matches
-- of the results archive (key 'r:...'), the goal columns the archive matches that have
-- goals: the same definitions as the reads on api.archive_matches and api.archive_goals
-- they replace.
--
-- The archives change when an archive is imported (a one-off task) and when a collected
-- match brings goals to an archive match. The worker refreshes the table once a day
-- (Worker.daily), so the index is at most a day behind the archive pages, which read
-- the matches themselves.
CREATE TABLE agg.archive_seasons(
  season_id smallint PRIMARY KEY REFERENCES core.seasons,
  result_competitions integer NOT NULL,
  result_matches integer NOT NULL,
  results integer NOT NULL,
  unplayed integer NOT NULL,
  unverified_dates integer NOT NULL,
  goal_competitions integer NOT NULL,
  goal_matches integer NOT NULL,
  goal_events integer NOT NULL,
  score_disagreements integer NOT NULL,
  latest_goal_match date
);

-- Rewrites only the seasons whose counts changed; returns how many.
CREATE FUNCTION agg.refresh_archive_seasons() RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  changed integer;
BEGIN
  -- Two refreshes run one after the other, each counting after the lock.
  PERFORM pg_advisory_xact_lock(92003, 0);
  WITH r AS (
    SELECT m.season_id, count(DISTINCT cs.archive_key)::integer AS competitions, count(*)::integer AS matches,
      (count(*) FILTER (WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND m.status::text <> 'canceled'))::integer AS results,
      (count(*) FILTER (WHERE m.status::text = 'canceled'))::integer AS unplayed,
      (count(*) FILTER (WHERE m.date_unverified))::integer AS unverified_dates
    FROM core.matches m
    JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
    WHERE m.archive_key LIKE 'r:%'
    GROUP BY m.season_id
  ), g AS (
    -- The goals are counted per match first, then joined to their matches by id alone:
    -- one pass over the goals, one over the matches.
    SELECT m.season_id, count(DISTINCT cs.archive_key)::integer AS competitions, count(*)::integer AS matches,
      sum(e.goals)::integer AS events, sum(e.disagreements)::integer AS score_disagreements, max(m.match_date) AS latest
    FROM (SELECT e.match_id, count(*) AS goals, count(*) FILTER (WHERE e.score_disagreement) AS disagreements
          FROM core.match_events e WHERE e.event_type = 'goal' GROUP BY e.match_id) e
    JOIN core.matches m ON m.id = e.match_id AND m.archive_key IS NOT NULL
    JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
    GROUP BY m.season_id
  ), fresh AS (
    SELECT coalesce(r.season_id, g.season_id) AS season_id,
      coalesce(r.competitions, 0) AS result_competitions, coalesce(r.matches, 0) AS result_matches,
      coalesce(r.results, 0) AS results, coalesce(r.unplayed, 0) AS unplayed, coalesce(r.unverified_dates, 0) AS unverified_dates,
      coalesce(g.competitions, 0) AS goal_competitions, coalesce(g.matches, 0) AS goal_matches,
      coalesce(g.events, 0) AS goal_events, coalesce(g.score_disagreements, 0) AS score_disagreements, g.latest AS latest_goal_match
    FROM r FULL JOIN g ON g.season_id = r.season_id
  ), gone AS (
    DELETE FROM agg.archive_seasons a
    WHERE NOT EXISTS (SELECT 1 FROM fresh f WHERE f.season_id = a.season_id)
    RETURNING 1
  ), written AS (
    INSERT INTO agg.archive_seasons AS a (season_id, result_competitions, result_matches, results, unplayed, unverified_dates,
      goal_competitions, goal_matches, goal_events, score_disagreements, latest_goal_match)
    SELECT f.season_id, f.result_competitions, f.result_matches, f.results, f.unplayed, f.unverified_dates,
      f.goal_competitions, f.goal_matches, f.goal_events, f.score_disagreements, f.latest_goal_match
    FROM fresh f
    ON CONFLICT (season_id) DO UPDATE SET
      result_competitions = EXCLUDED.result_competitions, result_matches = EXCLUDED.result_matches,
      results = EXCLUDED.results, unplayed = EXCLUDED.unplayed, unverified_dates = EXCLUDED.unverified_dates,
      goal_competitions = EXCLUDED.goal_competitions, goal_matches = EXCLUDED.goal_matches,
      goal_events = EXCLUDED.goal_events, score_disagreements = EXCLUDED.score_disagreements,
      latest_goal_match = EXCLUDED.latest_goal_match
    WHERE (a.result_competitions, a.result_matches, a.results, a.unplayed, a.unverified_dates,
           a.goal_competitions, a.goal_matches, a.goal_events, a.score_disagreements, a.latest_goal_match)
      IS DISTINCT FROM
          (EXCLUDED.result_competitions, EXCLUDED.result_matches, EXCLUDED.results, EXCLUDED.unplayed, EXCLUDED.unverified_dates,
           EXCLUDED.goal_competitions, EXCLUDED.goal_matches, EXCLUDED.goal_events, EXCLUDED.score_disagreements, EXCLUDED.latest_goal_match)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM gone) + (SELECT count(*) FROM written) INTO changed;
  RETURN changed;
END
$$;
REVOKE ALL ON FUNCTION agg.refresh_archive_seasons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agg.refresh_archive_seasons() TO vega_calc;
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.archive_seasons TO vega_calc;

-- The index's two lists: a season is in one when it holds matches of that archive.
CREATE VIEW api.archive_result_seasons AS
SELECT a.season_id, se.label AS season, a.result_competitions AS competitions, a.result_matches AS matches,
  a.results, a.unplayed, a.unverified_dates
FROM agg.archive_seasons a
JOIN core.seasons se ON se.id = a.season_id
WHERE a.result_matches > 0;

CREATE VIEW api.archive_goal_seasons AS
SELECT a.season_id, se.label AS season, a.goal_competitions AS competitions, a.goal_events AS events,
  a.goal_matches AS matches, a.score_disagreements, a.latest_goal_match AS latest_event
FROM agg.archive_seasons a
JOIN core.seasons se ON se.id = a.season_id
WHERE a.goal_matches > 0;

GRANT SELECT ON api.archive_result_seasons, api.archive_goal_seasons TO vega_read;

SELECT agg.refresh_archive_seasons() AS seasons;
