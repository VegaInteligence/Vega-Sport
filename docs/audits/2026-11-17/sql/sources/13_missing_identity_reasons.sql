SELECT m.source,CASE WHEN cs.archive_key IS NOT NULL THEN 'archive' WHEN cs.cup_key IS NOT NULL THEN 'cup' ELSE 'native' END AS edition_kind,
 m.home_team_id IS NULL AS missing_home_id, m.away_team_id IS NULL AS missing_away_id,
 nullif(btrim(m.home_team_name),'') IS NULL AS missing_home_name, nullif(btrim(m.away_team_name),'') IS NULL AS missing_away_name,
 m.home_score IS NULL AS missing_home_score,m.away_score IS NULL AS missing_away_score,
 count(*) AS matches,min(m.season_id) AS first_season,max(m.season_id) AS last_season,min(m.id) AS example_match_id
FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
WHERE m.status='finished' AND (m.home_team_id IS NULL OR m.away_team_id IS NULL OR m.home_score IS NULL OR m.away_score IS NULL)
GROUP BY 1,2,3,4,5,6,7,8 ORDER BY matches DESC
