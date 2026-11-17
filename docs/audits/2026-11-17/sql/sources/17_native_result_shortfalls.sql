WITH folders(folder,edition) AS (VALUES
 ('SCO_1_premiership',13),
 ('GER_2_2-bundesliga',35),
 ('POR_1_primeira-liga',54),
 ('RUS_1_premier-liga',25),
 ('ESP_2_segunda-division',36),
 ('FRA_2_ligue-2',882)
)
SELECT f.folder,m.id,m.status,coalesce(m.match_date,(m.kickoff_at AT TIME ZONE 'UTC')::date) AS match_day,
 m.home_team_name,m.away_team_name,h.name AS home_team,a.name AS away_team,m.home_score,m.away_score
FROM folders f JOIN core.matches m ON m.season_id=2026 AND m.competition_season_id=f.edition JOIN core.teams h ON h.id=m.home_team_id JOIN core.teams a ON a.id=m.away_team_id
WHERE coalesce(m.match_date,(m.kickoff_at AT TIME ZONE 'UTC')::date)<=DATE '2026-11-17'
ORDER BY f.folder,match_day,m.id
