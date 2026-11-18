-- Partition support, supplementing edition inventory. Empty relations report their actual zero count.
-- A score/activity row for a season outside the normal recent list cannot be silently zero-filled.
SELECT 'stats' AS domain,season_id,count(*) AS rows FROM core.player_match_stats GROUP BY season_id
UNION ALL SELECT 'lineup',season_id,count(*) FROM core.lineup_players GROUP BY season_id
UNION ALL SELECT 'substitution_or_goal_actor',season_id,count(*) FROM core.match_events WHERE event_type IN('substitution','goal') AND (player_id IS NOT NULL OR related_player_id IS NOT NULL) GROUP BY season_id
UNION ALL SELECT 'player_grade',season_id,count(*) FROM agg.player_match_grades GROUP BY season_id
UNION ALL SELECT 'team_elo',season_id,count(*) FROM agg.team_elo GROUP BY season_id
ORDER BY 1,2
