WITH pa AS (SELECT a.player_id,a.team_id,a.match_id FROM agg.player_match_grades a WHERE a.season_id=2026 AND a.match_id IN(40022,40023)),
joined AS (SELECT player_id,team_id,count(DISTINCT match_id) AS copies FROM pa GROUP BY 1,2)
SELECT count(*) AS distinct_player_participations,count(*) FILTER(WHERE copies=2) AS graded_on_both,
sum(copies) AS stored_player_grades FROM joined
