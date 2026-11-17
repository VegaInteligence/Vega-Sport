WITH games AS (
 SELECT m.season_id,m.id,m.home_team_id,m.away_team_id,m.home_score,m.away_score,
 m.home_score_90,m.away_score_90,
 CASE WHEN m.home_score_90 IS NULL OR m.away_score_90 IS NULL THEN true ELSE false END AS uses_final,
 count(*) FILTER(WHERE e.period='extra_time' AND e.event_type='goal') AS et_goals,
 count(*) FILTER(WHERE e.period='extra_time' AND e.event_type='goal' AND e.team_id=m.home_team_id) AS et_home,
 count(*) FILTER(WHERE e.period='extra_time' AND e.event_type='goal' AND e.team_id=m.away_team_id) AS et_away,
 count(*) FILTER(WHERE e.period IN ('first_half','second_half') AND e.event_type='goal' AND e.team_id=m.home_team_id) AS ft_home,
 count(*) FILTER(WHERE e.period IN ('first_half','second_half') AND e.event_type='goal' AND e.team_id=m.away_team_id) AS ft_away
 FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
 JOIN core.teams th ON th.id=m.home_team_id AND th.is_national IS NOT TRUE
 JOIN core.match_events e ON m.season_id=e.season_id AND e.match_id=m.id
 WHERE m.status='finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND e.event_type='goal'
 AND EXISTS(SELECT 1 FROM agg.team_elo h WHERE h.match_id=m.id AND h.team_id=m.home_team_id)
 AND EXISTS(SELECT 1 FROM agg.team_elo a WHERE a.match_id=m.id AND a.team_id=m.away_team_id)
 GROUP BY m.season_id,m.id,m.home_team_id,m.away_team_id,m.home_score,m.away_score,m.home_score_90,m.away_score_90
)
SELECT season_id,count(*) FILTER(WHERE et_goals>0) AS known_et_goals_in_fit,
count(*) FILTER(WHERE et_goals>0 AND uses_final) AS coalesced_90_target,
count(*) FILTER(WHERE et_goals>0 AND uses_final AND ft_home+et_home=home_score AND ft_away+et_away=away_score AND et_goals=et_home+et_away
 AND (coalesce(home_score_90,home_score)<>ft_home OR coalesce(away_score_90,away_score)<>ft_away)) AS confirmed_training_target_disagreement,
min(id) FILTER(WHERE et_goals>0 AND uses_final AND ft_home+et_home=home_score AND ft_away+et_away=away_score AND et_goals=et_home+et_away
 AND (coalesce(home_score_90,home_score)<>ft_home OR coalesce(away_score_90,away_score)<>ft_away)) AS first_disagreement
FROM games GROUP BY season_id ORDER BY season_id
