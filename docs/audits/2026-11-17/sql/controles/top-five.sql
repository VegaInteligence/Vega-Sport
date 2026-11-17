-- Continuous native domestic-league seasons, one final per exact same fixture.
SELECT m.id,m.season_id,m.match_date,m.kickoff_at,m.home_team_id,m.away_team_id,
       m.home_score,m.away_score,coalesce(m.is_neutral,false),cs.competition_id,c.name
FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
JOIN core.competitions c ON c.id=cs.competition_id
WHERE cs.competition_id IN(1,2,12,30,55) AND cs.cup_key IS NULL AND cs.archive_key IS NULL
 AND m.status='finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
 AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL AND m.home_team_id<>m.away_team_id
 AND m.match_date >= DATE '2021-08-01' AND m.match_date < DATE '2026-11-17'
ORDER BY m.match_date,m.kickoff_at NULLS LAST,m.id
