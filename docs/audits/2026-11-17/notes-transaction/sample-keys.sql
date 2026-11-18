WITH sample(source_season,match_id,player_id,kind) AS (VALUES
(2021,231255,12062,'goalkeeper'),
(2021,231260,4718,'goalkeeper'),
(2021,247720,843,'goalkeeper'),
(2021,247721,61021,'goalkeeper'),
(2021,250819,10368,'goalkeeper'),
(2021,250820,2723,'goalkeeper'),
(2021,231255,214,'outfield'),
(2021,231260,161,'outfield'),
(2021,231265,3468,'outfield'),
(2021,231270,99,'outfield'),
(2021,231276,229,'outfield'),
(2021,247720,241,'outfield'),
(2021,247721,149,'outfield'),
(2021,247722,100,'outfield'),
(2021,247723,177,'outfield'),
(2021,247724,180,'outfield'),
(2021,250819,1069,'outfield'),
(2021,250820,332,'outfield'),
(2021,250821,1036,'outfield'),
(2021,250822,1011,'outfield'),
(2021,250823,1044,'outfield'),
(2021,232588,14126,'unresolved_slot'),
(2021,242035,63889,'unresolved_slot')), latest AS (SELECT id,started_at,finished_at,method_version FROM agg.power_runs WHERE kind='players' AND season_id=2021 AND status='published' ORDER BY started_at DESC LIMIT 1)
SELECT s.*,l.id AS latest_player_run,l.started_at,l.finished_at,l.method_version,m.status,m.updated_at AS match_updated,p.updated_at AS stats_updated,p.minutes_played,p.team_id AS source_team,
 pm.match_id IS NOT NULL AS processed,pm.role AS computed_role,pm.match_index,pm.run_id AS intermediate_run,g.z,g.minutes,g.team_id AS graded_team,g.award_season,g.ref_season,g.run_id AS grade_run,
 CASE WHEN g.minutes>=20 OR abs(g.z)>=1 THEN (100/(1+power(10,-g.z::float8/4))) END AS visible_grade,
 CASE WHEN g.z IS NOT NULL THEN (100/(1+power(10,-g.z::float8/4))) END AS raw_grade
FROM sample s CROSS JOIN latest l JOIN core.matches m ON m.id=s.match_id AND m.season_id=s.source_season
LEFT JOIN core.player_match_stats p ON (p.season_id,p.match_id,p.player_id)=(s.source_season,s.match_id,s.player_id)
LEFT JOIN agg.player_power_matches pm ON (pm.season_id,pm.match_id,pm.player_id)=(2021,s.match_id,s.player_id)
LEFT JOIN agg.player_match_grades g ON (g.season_id,g.match_id,g.player_id)=(s.source_season,s.match_id,s.player_id)
ORDER BY kind,match_id,player_id
