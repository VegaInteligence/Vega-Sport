-- The peers of a performance (GET /api/read/performance), precomputed per edition.
--
-- A performance is ranked among the season's performances of the same line (30 minutes
-- or more): for each profile metric, how many peers are below, tied and known. The read
-- counted them over api.player_appearances on every request: 34 s for one performance of
-- 2026/2027 on 10 November 2026 (86,500 statistics rows, a twelfth of a full season),
-- 0.3 to 0.6 s for the same count written directly on core, so 3 to 7 s by the end of the
-- season. The doc allows the precomputation ("Ce qui change en v2": a block that stays
-- slow is precomputed in a typed agg table; only the JSON format goes).
--
-- agg.performance_values is the one SQL definition of the profile metrics (the getters of
-- dashboard/shared/player-profile.js PROFILE_METRICS, same thresholds), one row per
-- appearance and known metric. agg.performance_distribution is its exact histogram per
-- edition and peer line: (value, number of appearances of 30 minutes or more), so the
-- read sums a few thousand rows instead of ranking every appearance of the season. The
-- counts stay exact: nothing is sampled or rounded.
--
-- The calculator refreshes an edition's histogram with its other aggregates
-- (calculator.refresh_competition_season); the daily models refresh the due seasons'.

-- The peer line is shared/player-profile.js peerGroup(): the position's line (the line-up
-- carries the position: the statistics rows of PitchAPI have none), else a keeper when he
-- made a save, else the outfield players ('F'). 'appearances' counts the peers.
CREATE VIEW agg.performance_values AS
SELECT s.season_id, s.match_id, s.player_id, m.competition_season_id,
  coalesce(core.position_group(coalesce(s.position_id, lp.position_id)::integer),
           CASE WHEN s.saves > 0 THEN 'G' ELSE 'F' END) AS profile_group,
  s.minutes_played AS minutes, v.metric, v.value
FROM core.player_match_stats s
JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id
LEFT JOIN core.lineup_players lp ON lp.season_id = s.season_id AND lp.match_id = s.match_id AND lp.player_id = s.player_id
CROSS JOIN LATERAL (SELECT
  nullif(nullif(nullif(s.xg::numeric::float8, 'NaN'), 'Infinity'), '-Infinity') AS xg,
  nullif(nullif(nullif(s.goals_prevented::numeric::float8, 'NaN'), 'Infinity'), '-Infinity') AS goals_prevented) f
CROSS JOIN LATERAL (VALUES
  ('appearances', 1::float8),
  -- No shot means no xG and nothing on target: the source leaves them empty.
  ('xg', coalesce(f.xg, CASE WHEN s.total_shots = 0 THEN 0::float8 END)),
  ('shots', s.total_shots::float8),
  ('shots_on_target', coalesce(s.shots_on_target::float8, CASE WHEN s.total_shots = 0 THEN 0::float8 END)),
  ('touches_box', s.touches_opp_box::float8),
  ('chances_created', s.chances_created::float8),
  ('dribbles', s.dribbles_succeeded::float8),
  ('touches', s.touches::float8),
  ('passes_accurate', s.accurate_passes::float8),
  ('pass_accuracy', CASE WHEN s.accurate_passes_total >= 10 THEN s.accurate_passes::float8 / s.accurate_passes_total::float8 * 100 END),
  ('passes_final_third', s.passes_into_final_third::float8),
  ('tackles', s.tackles::float8),
  ('interceptions', s.interceptions::float8),
  ('recoveries', s.recoveries::float8),
  ('clearances', s.clearances::float8),
  ('blocks', s.shot_blocks::float8),
  ('duels_won', s.duels_won::float8),
  ('duel_rate', CASE WHEN s.duels_won + s.duels_lost >= 4 THEN s.duels_won::float8 / (s.duels_won::float8 + s.duels_lost::float8) * 100 END),
  ('saves', s.saves::float8),
  ('goals_prevented', f.goals_prevented)
) v(metric, value)
WHERE v.value IS NOT NULL;

CREATE TABLE agg.performance_distribution(
  competition_season_id integer NOT NULL REFERENCES core.competition_seasons ON DELETE CASCADE,
  profile_group text NOT NULL CHECK (profile_group IN ('G', 'D', 'M', 'O', 'F')),
  metric text NOT NULL,
  value double precision NOT NULL,
  appearances integer NOT NULL CHECK (appearances > 0),
  PRIMARY KEY (competition_season_id, profile_group, metric, value)
);

-- Rewrites only what changed (a match adds a few dozen appearances to an edition that
-- holds thousands); returns the number of rows written or removed.
CREATE FUNCTION agg.refresh_performance_distribution(edition_id integer) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  edition_season smallint;
  changed integer;
BEGIN
  -- The calculator's lock on an edition (calculator.refresh_competition_season): two
  -- refreshes of one edition run one after the other, each counting after the lock, so
  -- an older count never lands over a newer one.
  PERFORM pg_advisory_xact_lock(92002, edition_id);
  SELECT cs.season_id INTO edition_season FROM core.competition_seasons cs WHERE cs.id = edition_id;
  WITH fresh AS (
    SELECT v.profile_group, v.metric, v.value, count(*)::integer AS appearances
    FROM agg.performance_values v
    WHERE v.season_id = edition_season AND v.competition_season_id = edition_id AND v.minutes >= 30
    GROUP BY v.profile_group, v.metric, v.value
  ), gone AS (
    DELETE FROM agg.performance_distribution d
    WHERE d.competition_season_id = edition_id
      AND NOT EXISTS (SELECT 1 FROM fresh f WHERE f.profile_group = d.profile_group AND f.metric = d.metric AND f.value = d.value)
    RETURNING 1
  ), written AS (
    INSERT INTO agg.performance_distribution AS d (competition_season_id, profile_group, metric, value, appearances)
    SELECT edition_id, f.profile_group, f.metric, f.value, f.appearances FROM fresh f
    ON CONFLICT (competition_season_id, profile_group, metric, value) DO UPDATE SET appearances = EXCLUDED.appearances
    WHERE d.appearances IS DISTINCT FROM EXCLUDED.appearances
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM gone) + (SELECT count(*) FROM written) INTO changed;
  RETURN changed;
END
$$;
REVOKE ALL ON FUNCTION agg.refresh_performance_distribution(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agg.refresh_performance_distribution(integer) TO vega_calc;
GRANT SELECT ON agg.performance_values TO vega_calc;
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.performance_distribution TO vega_calc;

-- The read's two sources: the target's own values, and the histogram of its peers.
CREATE VIEW api.performance_values AS
SELECT season_id, match_id, player_id, metric, value FROM agg.performance_values;

CREATE VIEW api.performance_distribution AS
SELECT competition_season_id, profile_group, metric, value, appearances FROM agg.performance_distribution;

GRANT SELECT ON api.performance_values, api.performance_distribution TO vega_read;

-- Only PitchAPI editions carry player statistics.
SELECT count(agg.refresh_performance_distribution(e.id)) AS editions
FROM (SELECT DISTINCT m.competition_season_id AS id
      FROM core.player_match_stats s JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id) e;
