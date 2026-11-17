WITH goals AS (
 SELECT m.season_id,m.id,m.home_score,m.away_score,g.team_id = m.home_team_id AS by_home,
 g.team_id=m.away_team_id AS by_away,g.score_home,g.score_away,
 count(*) FILTER(WHERE g.team_id=m.home_team_id) OVER w AS credited_home,
 count(*) FILTER(WHERE g.team_id=m.away_team_id) OVER w AS credited_away
 FROM core.matches m JOIN core.match_coverage c ON c.season_id=m.season_id AND c.match_id=m.id AND c.events='ok'
 JOIN core.match_events g ON g.season_id=m.season_id AND g.match_id=m.id AND g.event_type='goal' AND g.period IS DISTINCT FROM 'penalties' AND g.minute IS NOT NULL
 WHERE m.status='finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
 WINDOW w AS (PARTITION BY m.season_id,m.id ORDER BY g.period,g.minute,g.minute_added NULLS FIRST,g.seq ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
), matches AS (
 SELECT season_id,id, count(*) AS events, bool_and(by_home OR by_away) AS known_teams,
 max(credited_home)=max(home_score) AND max(credited_away)=max(away_score) AS reconciled,
 bool_and((score_home=credited_home AND score_away=credited_away) IS TRUE) AS all_after,
 bool_and((score_home=credited_home-by_home::int AND score_away=credited_away-by_away::int) IS TRUE) AS all_before
 FROM goals GROUP BY season_id,id
)
SELECT season_id,count(*) AS matches_with_goals,count(*) FILTER(WHERE events>0 AND reconciled AND known_teams AND all_before) AS before_every_goal,
 count(*) FILTER(WHERE reconciled AND known_teams AND all_after) AS after_every_goal,
 count(*) FILTER(WHERE reconciled AND known_teams AND NOT all_before AND NOT all_after) AS mixed_or_other,
 count(*) FILTER(WHERE known_teams IS DISTINCT FROM TRUE OR NOT reconciled) AS unreconciled
FROM matches GROUP BY season_id ORDER BY season_id
