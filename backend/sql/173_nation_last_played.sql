-- A nation's last match is a played one (FAILURE_MODES.md §58; production on 24 Nov 2026: eight nations showed a
-- Nations League fixture of March 2027 as their « Dernier match »). api.nation_list as 159 defines it, with one
-- change: last_match is the latest day of a match of the nation that is finished with both scores known (one match per
-- day and pair, as before: played when one of its copies is). The rows, `matches` (the matches held, fixtures
-- included, as the nation page lists them, §43) and every other column are unchanged; so is the shape the plan test
-- reads (§43.4, 43s: core.matches read twice, the copy test by equal keys). No table: nothing naming a match.
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION api.nation_list(season_key smallint)
RETURNS TABLE(team_id text, team_key integer, name text, image_url text, matches integer, last_match date,
  elo float8, elo_at date, rank integer, season_elo float8, elo_change float8, season_matches integer,
  wins integer, draws integer, losses integer, result_sum float8, expected_sum float8)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH nations AS MATERIALIZED (
    SELECT t.id, t.name, t.crest_asset_id FROM core.teams t WHERE t.is_national AND t.merged_into IS NULL
  ), games AS MATERIALIZED (
    -- Each branch carries what the copy test reads: core.matches is read twice, as in 119 (§43.4, 43s). `single`: the
    -- one row of the match the copy test reads (its home side's, or its away side's when the home side is no nation).
    SELECT g.team, g.d, least(g.h, g.v) AS a, greatest(g.h, g.v) AS b, g.match, g.edition, g.single,
      coalesce(cs.cup_key IS NULL AND cs.archive_key IS NULL, true) AS native,
      coalesce(CASE WHEN g.h <= g.v THEN g.hs ELSE g.vs END, -1) AS score_a,
      coalesce(CASE WHEN g.h <= g.v THEN g.vs ELSE g.hs END, -1) AS score_b, g.played
    FROM (
      SELECT n.id AS team, m.id AS match, coalesce(m.match_date, m.kickoff_at::date) AS d, m.home_team_id AS h,
        m.away_team_id AS v, m.home_score AS hs, m.away_score AS vs, m.competition_season_id AS edition, true AS single,
        (m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL) AS played
      FROM nations n JOIN core.matches m ON m.home_team_id = n.id
      UNION ALL
      SELECT n.id, m.id, coalesce(m.match_date, m.kickoff_at::date), m.home_team_id, m.away_team_id, m.home_score,
        m.away_score, m.competition_season_id, m.home_team_id NOT IN (SELECT x.id FROM nations x),
        (m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL)
      FROM nations n JOIN core.matches m ON m.away_team_id = n.id
    ) g
    LEFT JOIN core.competition_seasons cs ON cs.id = g.edition
  ), adjacent AS MATERIALIZED (
    -- Only a meeting held, with one score, on two consecutive days by two editions can hold a copy. Each match is
    -- keyed by its day and by the day before: a hash aggregate finds the few keys two such matches share, so the copy
    -- test below joins these matches only, never every meeting of a pair (§43.4, 43s).
    SELECT x.a, x.b, x.score_a, x.score_b, x.w
    FROM (
      SELECT g.a, g.b, g.score_a, g.score_b, g.d AS w, g.d, g.edition FROM games g WHERE g.single AND g.d IS NOT NULL AND g.edition IS NOT NULL
      UNION ALL
      SELECT g.a, g.b, g.score_a, g.score_b, g.d - 1, g.d, g.edition FROM games g WHERE g.single AND g.d IS NOT NULL AND g.edition IS NOT NULL
    ) x
    GROUP BY x.a, x.b, x.score_a, x.score_b, x.w
    HAVING min(x.d) <> max(x.d) AND min(x.edition) <> max(x.edition)
  ), candidates AS MATERIALIZED (
    SELECT g.* FROM games g WHERE g.single AND EXISTS (
      SELECT 1 FROM adjacent j WHERE j.a = g.a AND j.b = g.b AND j.score_a = g.score_a AND j.score_b = g.score_b
        AND (g.d = j.w OR g.d = j.w + 1))
  ), absorbed AS MATERIALIZED (
    -- api.nation_matches' copy test, by equal keys (pair, day + 1 or day - 1, score).
    SELECT g.match FROM candidates g JOIN candidates k
      ON k.a = g.a AND k.b = g.b AND k.d = g.d + 1 AND k.score_a = g.score_a AND k.score_b = g.score_b
     AND k.edition <> g.edition AND (k.native > g.native OR (k.native = g.native AND k.match < g.match))
    UNION
    SELECT g.match FROM candidates g JOIN candidates k
      ON k.a = g.a AND k.b = g.b AND k.d = g.d - 1 AND k.score_a = g.score_a AND k.score_b = g.score_b
     AND k.edition <> g.edition AND (k.native > g.native OR (k.native = g.native AND k.match < g.match))
  ), played AS MATERIALIZED (
    -- One match per day and pair, as 119 counts them (a match without a date or a team is its own match), by two hash
    -- aggregates instead of a sort of every key; a copy api.nation_matches absorbs is not counted.
    -- §58: the last match is the latest day with a played copy (finished, both scores), never a fixture.
    SELECT k.team, count(*)::integer AS matches, max(k.d) FILTER (WHERE k.played) AS last_match
    FROM (
      SELECT g.team, g.d, g.a, g.b, CASE WHEN g.d IS NULL OR g.a IS NULL OR g.b IS NULL THEN g.match END AS solo,
        bool_or(g.played) AS played
      FROM games g
      WHERE g.match NOT IN (SELECT x.match FROM absorbed x)
      GROUP BY 1, 2, 3, 4, 5
    ) k
    GROUP BY k.team
  )
  SELECT api.public_id('team', n.id), n.id, n.name, cr.source_url, p.matches, p.last_match,
    e.elo_after::numeric::float8, e.kickoff_at::date,
    tp.rank, tp.elo::numeric::float8, tp.elo_change::numeric::float8, tp.matches, tp.wins, tp.draws, tp.losses,
    tp.result_sum::numeric::float8, tp.expected_sum::numeric::float8
  FROM nations n
  JOIN played p ON p.team = n.id
  LEFT JOIN core.assets cr ON cr.id = n.crest_asset_id
  LEFT JOIN LATERAL (
    SELECT x.elo_after, x.kickoff_at FROM agg.team_elo x WHERE x.team_id = n.id ORDER BY x.kickoff_at DESC NULLS LAST LIMIT 1
  ) e ON true
  LEFT JOIN agg.team_power tp ON tp.season_id = season_key AND tp.team_id = n.id AND tp.scope = 'nations'
$$;

