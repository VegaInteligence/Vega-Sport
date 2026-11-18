WITH fixtures AS (
 SELECT DISTINCT p.provider, m.id, m.season_id FROM core.provider_ids p JOIN core.matches m ON m.id=p.entity_id
 WHERE p.entity_type='match' AND p.is_current AND p.provider IN ('open_matchday','openfootball','openligadb','international_results')
 AND m.status='not_started'
)
SELECT f.provider, count(*) AS upcoming,
 count(*) FILTER(WHERE EXISTS (SELECT 1 FROM core.match_odds o WHERE (o.season_id,o.match_id)=(f.season_id,f.id))) AS with_odds,
 count(*) FILTER(WHERE EXISTS (SELECT 1 FROM core.team_match_stats o WHERE (o.season_id,o.match_id)=(f.season_id,f.id))) AS with_team_stats,
 count(*) FILTER(WHERE EXISTS (SELECT 1 FROM core.match_events o WHERE (o.season_id,o.match_id)=(f.season_id,f.id))) AS with_events,
 count(*) FILTER(WHERE EXISTS (SELECT 1 FROM core.player_match_stats o WHERE (o.season_id,o.match_id)=(f.season_id,f.id))) AS with_player_stats,
 count(*) FILTER(WHERE EXISTS (SELECT 1 FROM core.lineups o WHERE (o.season_id,o.match_id)=(f.season_id,f.id))) AS with_lineups
 FROM fixtures f GROUP BY f.provider ORDER BY f.provider