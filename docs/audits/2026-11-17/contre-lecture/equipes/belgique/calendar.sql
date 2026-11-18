SELECT m.id, m.match_date, m.kickoff_at, m.status, m.competition_season_id, m.season_id, m.source,
       m.home_team_id, th.name AS home_name, m.away_team_id, ta.name AS away_name, m.home_score, m.away_score,
       ARRAY(SELECT k.provider||'='||k.provider_key FROM core.provider_ids k WHERE k.entity_type='match' AND k.entity_id=m.id AND k.is_current ORDER BY 1) AS keys,
       (SELECT count(*) FROM agg.team_elo e WHERE e.match_id=m.id) AS elo_sides,
       (SELECT count(*) FROM agg.player_match_grades g WHERE g.season_id=m.season_id AND g.match_id=m.id) AS player_scores
FROM core.matches m
LEFT JOIN core.teams th ON th.id=m.home_team_id LEFT JOIN core.teams ta ON ta.id=m.away_team_id
WHERE m.competition_season_id=358 ORDER BY m.match_date,m.id
