-- Same coverage, goal period, minute, final score and ordering gates as calculator.refresh_game_states.
WITH grouped AS (
 SELECT m.season_id,m.id,m.home_score,m.away_score,count(e.match_id) AS goals,
  bool_or(e.match_id IS NOT NULL AND (e.score_home IS NULL OR e.score_away IS NULL)) AS missing_running,
  (array_agg(e.score_home ORDER BY e.period DESC NULLS FIRST,e.minute DESC,e.minute_added DESC NULLS LAST,e.seq DESC))[1] AS last_home,
  (array_agg(e.score_away ORDER BY e.period DESC NULLS FIRST,e.minute DESC,e.minute_added DESC NULLS LAST,e.seq DESC))[1] AS last_away,
  count(*) FILTER (WHERE e.minute_added>0) AS goals_with_added
 FROM core.matches m JOIN core.match_coverage c ON c.season_id=m.season_id AND c.match_id=m.id AND c.events='ok'
 LEFT JOIN core.match_events e ON e.season_id=m.season_id AND e.match_id=m.id AND e.event_type='goal' AND e.period IS DISTINCT FROM 'penalties' AND e.minute IS NOT NULL
 WHERE m.status='finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL GROUP BY m.season_id,m.id,m.home_score,m.away_score
)
SELECT season_id,count(*) AS covered_matches,count(*) FILTER(WHERE goals>0 AND missing_running) AS null_running_matches,
 count(*) FILTER(WHERE missing_running AND goals=home_score+away_score AND last_home=home_score AND last_away=away_score) AS reaches_unsafe_subtraction,
 count(*) FILTER(WHERE goals=home_score+away_score AND goals>0 AND (last_home IS DISTINCT FROM home_score OR last_away IS DISTINCT FROM away_score)) AS excluded_final_running_disagreement,
 sum(goals_with_added) AS nonzero_added_goal_observations
FROM grouped GROUP BY season_id ORDER BY season_id
