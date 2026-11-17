-- All persisted grade values, stratified by edition. z==0 is a legitimate median; identify actual missingness with player-scores.sql.
-- Tail checks are review flags rather than clinical or calibration diagnoses. PostgreSQL NaN is separately reported by player-grade-integrity.sql.
SELECT m.competition_season_id AS edition_id,count(*) AS grades,min(g.z) AS min_z,avg(g.z)::numeric(10,4) AS mean_z,
       max(g.z) AS max_z,stddev_samp(g.z)::numeric(10,4) AS sd_z,
       count(*) FILTER(WHERE g.z=0) AS equal_to_reference_median,count(*) FILTER(WHERE abs(g.z)>=3) AS absolute_z_at_least_three,
       count(*) FILTER(WHERE g.minutes<=0) AS grade_with_nonpositive_minutes,count(*) FILTER(WHERE g.minutes>130) AS minutes_above_130
FROM agg.player_match_grades g JOIN core.matches m ON m.season_id=g.season_id AND m.id=g.match_id
GROUP BY m.competition_season_id ORDER BY 1
