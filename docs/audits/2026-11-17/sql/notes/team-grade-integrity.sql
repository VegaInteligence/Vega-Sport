-- All rating and season runs in one grouped result. Missing match rows are detected by the pair
-- (match_id, stored season_id), including wrong season. Elo result quality is checked for two-sided sums.
WITH q AS (
 SELECT e.match_id,e.season_id,count(*) AS stored_sides,
        bool_and(t.id IS NOT NULL) AS teams_exist, bool_and(r.kind='elo') AS own_elo_run,
        bool_and(e.elo_after BETWEEN '-1e30'::real AND '1e30'::real AND e.elo_before BETWEEN '-1e30'::real AND '1e30'::real AND e.expected BETWEEN 0 AND 1) AS finite,
        sum(e.result) AS results, sum(e.expected) AS expectations,
        count(*) FILTER(WHERE m.id IS NULL) AS missing_match_or_season,
        count(*) FILTER(WHERE m.status IS DISTINCT FROM 'finished' AND m.id IS NOT NULL) AS not_finished,
        count(*) FILTER(WHERE e.team_id IN (m.home_team_id,m.away_team_id)) AS teams_on_match
 FROM agg.team_elo e LEFT JOIN core.matches m ON m.id=e.match_id AND m.season_id=e.season_id
 LEFT JOIN core.teams t ON t.id=e.team_id LEFT JOIN agg.power_runs r ON r.id=e.run_id
 GROUP BY e.match_id,e.season_id
)
SELECT season_id,count(*) AS rated_matches,sum(stored_sides) AS rated_sides,
 sum(missing_match_or_season) AS orphan_or_wrong_season_rows,sum(not_finished) AS nonfinished_rows,
 count(*) FILTER (WHERE stored_sides<>2) AS incorrect_pair_count,
 count(*) FILTER (WHERE teams_on_match<>stored_sides AND missing_match_or_season=0) AS live_or_stale_identity_review,
 count(*) FILTER (WHERE finite IS NOT TRUE OR own_elo_run IS NOT TRUE OR teams_exist IS NOT TRUE) AS invalid_value_or_run,
 count(*) FILTER (WHERE stored_sides=2 AND (abs(expectations-1)>0.00001 OR results<>1)) AS broken_complementarity
FROM q GROUP BY season_id ORDER BY season_id
