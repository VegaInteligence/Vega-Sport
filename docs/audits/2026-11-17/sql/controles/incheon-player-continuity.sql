WITH both_rosters AS (SELECT DISTINCT p.team_id,p.player_id,p.season_id FROM core.player_match_stats p WHERE p.team_id IN(811,5390) AND p.season_id BETWEEN 2024 AND 2026 AND p.minutes_played>0)
SELECT a.season_id AS top_flight,b.season_id AS second_tier,count(DISTINCT a.player_id) AS common_players,
 (array_agg(DISTINCT player.name ORDER BY player.name))[1:8] AS example_players
FROM both_rosters a JOIN both_rosters b ON b.player_id=a.player_id AND b.team_id=5390 JOIN core.players player ON player.id=a.player_id
WHERE a.team_id=811 GROUP BY a.season_id,b.season_id ORDER BY a.season_id,b.season_id
