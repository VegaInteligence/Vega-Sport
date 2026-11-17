WITH ids AS (SELECT unnest(ARRAY[811,5390,5309,5327,5317,5334,5325,5331,5318,5328,5315,5584,5316,5330]) AS id),
sides AS (SELECT m.season_id,m.id AS mid,m.competition_season_id,t.id AS tid,
 CASE WHEN m.home_team_id=t.id THEN m.away_team_id ELSE m.home_team_id END AS foe FROM ids t JOIN core.matches m ON m.home_team_id=t.id OR m.away_team_id=t.id)
SELECT t.id AS team,t.name,c.id AS competition,c.name AS competition_name,
 min(s.season_id) AS first_season,max(s.season_id) AS last_season,count(DISTINCT s.mid) AS played_or_scheduled,
 count(DISTINCT p.player_id) AS measured_player_ids
FROM ids x JOIN core.teams t ON x.id=t.id LEFT JOIN sides s ON s.tid=t.id
LEFT JOIN core.competition_seasons cs ON s.competition_season_id=cs.id LEFT JOIN core.competitions c ON c.id=cs.competition_id
LEFT JOIN core.player_match_stats p ON p.season_id=s.season_id AND p.match_id=s.mid AND p.team_id=t.id AND p.minutes_played>0
GROUP BY t.id,t.name,c.id,c.name ORDER BY t.id,c.name
