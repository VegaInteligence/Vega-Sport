WITH played AS (
 SELECT e.season_id,e.match_id,count(*) AS sides,
  min(e.run_id) AS run_lo,max(e.run_id) AS run_hi,min(e.stakes) AS stake_lo,max(e.stakes) AS stake_hi
 FROM agg.team_elo e GROUP BY e.season_id,e.match_id
)
SELECT p.season_id,p.match_id,p.sides,p.run_lo,p.run_hi,p.stake_lo::float8,p.stake_hi::float8,
 m.match_date,m.is_neutral,m.source,m.home_team_id,m.away_team_id,m.home_score,m.away_score,
 m.competition_season_id,cs.competition_id,c.name,cs.native_label,cs.cup_key,cs.archive_key,
 m.round_id,r.stage::text,r.name,m.home_team_name,m.away_team_name,h.is_national,a.is_national,
 h.country_code,a.country_code
FROM played p LEFT JOIN core.matches m ON (m.season_id,m.id)=(p.season_id,p.match_id)
LEFT JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
LEFT JOIN core.competitions c ON c.id=cs.competition_id
LEFT JOIN core.rounds r ON r.id=m.round_id
LEFT JOIN core.teams h ON h.id=m.home_team_id LEFT JOIN core.teams a ON a.id=m.away_team_id
ORDER BY p.season_id,p.match_id
