-- Per season, also find stored grade rows that the stats-based left join cannot see.
SELECT 2023 AS season_id,count(*) AS persisted_total,count(*) FILTER(WHERE m.id IS NULL) AS missing_match_or_wrong_partition,
 count(*) FILTER(WHERE m.id IS NOT NULL AND m.status IS DISTINCT FROM 'finished') AS not_finished,
 count(*) FILTER(WHERE p.player_id IS NULL) AS no_source_stats,
 count(*) FILTER(WHERE g.z::float8 NOT BETWEEN '-1e308'::float8 AND '1e308'::float8) AS nonfinite,
 count(*) FILTER(WHERE m.id IS NOT NULL AND g.award_season IS DISTINCT FROM extract(year FROM m.match_date - interval '7 months')::int) AS wrong_award,
 count(*) FILTER(WHERE p.player_id IS NOT NULL AND g.team_id IS DISTINCT FROM p.team_id) AS wrong_team,
 count(*) FILTER(WHERE p.player_id IS NOT NULL AND g.minutes IS DISTINCT FROM p.minutes_played) AS wrong_minutes,
 count(*) FILTER(WHERE cr.id IS NULL OR cr.kind<>'players' OR cr.season_id IS DISTINCT FROM g.award_season) AS wrong_run_provenance
FROM agg.player_match_grades g
LEFT JOIN core.matches m ON m.id=g.match_id AND m.season_id=2023
LEFT JOIN core.player_match_stats p ON p.season_id=2023 AND p.match_id=g.match_id AND p.player_id=g.player_id
LEFT JOIN agg.power_runs cr ON cr.id=g.run_id
WHERE g.season_id=2023
