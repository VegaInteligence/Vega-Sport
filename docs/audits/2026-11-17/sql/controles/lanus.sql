SELECT m.id,m.season_id,m.match_date,m.home_team_id,m.away_team_id,m.home_score,m.away_score,m.status,
 (SELECT count(*) FROM core.match_events e WHERE e.season_id=m.season_id AND e.match_id=m.id) AS events,
 (SELECT count(*) FROM core.player_match_stats p WHERE p.season_id=m.season_id AND p.match_id=m.id) AS player_stats,
 (SELECT count(*) FROM agg.player_match_grades p WHERE p.season_id=m.season_id AND p.match_id=m.id) AS grades,
 (SELECT count(*) FROM agg.team_elo te WHERE te.season_id=m.season_id AND te.match_id=m.id) AS team_elo
FROM core.matches m WHERE m.id IN (40022,40023) AND m.season_id IN (2025,2026) ORDER BY m.id
