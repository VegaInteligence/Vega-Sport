SELECT g.award_season AS award, g.ref_season, count(*) AS published,
 count(*) FILTER (WHERE g.role IS DISTINCT FROM p.role) AS different_role,
 count(*) FILTER (WHERE p.match_id IS NULL) AS missing_power_row,
 count(*) FILTER (WHERE (g.team_id,g.minutes) IS DISTINCT FROM (p.team_id,p.minutes)) AS different_team_minutes,
 count(*) FILTER (WHERE g.run_id IS DISTINCT FROM p.run_id) AS older_grade_run,
 count(*) FILTER (WHERE g.z IS DISTINCT FROM p.match_index) AS different_z,
 count(*) FILTER (WHERE abs(g.z-p.match_index) > 0.0001) AS above_update_threshold,
 count(*) FILTER (WHERE g.z IS DISTINCT FROM p.match_index AND g.run_id=p.run_id) AS different_z_in_same_run,
 max(abs(g.z-p.match_index)) AS max_abs_z,
 count(*) FILTER (WHERE (g.minutes>=20 OR abs(g.z)>=1) AND floor(100/(1+power(10::float8,-g.z::float8/4))+0.5)
            IS DISTINCT FROM floor(100/(1+power(10::float8,-p.match_index::float8/4))+0.5)) AS exposed_rounded_differences,
 count(*) FILTER (WHERE floor(100/(1+power(10::float8,-g.z::float8/4))+0.5)
            IS DISTINCT FROM floor(100/(1+power(10::float8,-p.match_index::float8/4))+0.5)) AS all_rounded_differences
FROM agg.player_match_grades g LEFT JOIN agg.player_power_matches p
  ON p.season_id=g.award_season AND p.match_id=g.match_id AND p.player_id=g.player_id
GROUP BY g.award_season,g.ref_season ORDER BY 1,2
