WITH candidates AS (
 SELECT m.id,m.season_id,m.source,m.archive_key AS match_key,cs.archive_key AS edition_key,m.match_date,m.home_team_id,m.away_team_id,m.home_team_name,m.away_team_name,m.home_score,m.away_score,
 row_number() OVER(PARTITION BY m.source ORDER BY m.season_id DESC,m.id) AS example
 FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
 WHERE m.status='finished' AND (m.home_team_id IS NULL OR m.away_team_id IS NULL)
)
SELECT source,id,season_id,edition_key,match_key,match_date,home_team_name,away_team_name,home_score,away_score FROM candidates WHERE example<=3 ORDER BY source,example
