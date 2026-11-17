SELECT s.season_id,count(*) AS positive_minute_rows,
 count(*) FILTER (WHERE s.team_id IS NULL) AS unknown_team,
 count(*) FILTER (WHERE s.team_id IS NOT NULL AND s.team_id IS DISTINCT FROM m.home_team_id AND s.team_id IS DISTINCT FROM m.away_team_id) AS unrelated_team,
 count(*) FILTER (WHERE m.id IS NULL) AS missing_match
FROM core.player_match_stats s LEFT JOIN core.matches m ON m.id=s.match_id AND m.season_id=s.season_id
WHERE s.minutes_played>0 GROUP BY 1 ORDER BY 1
