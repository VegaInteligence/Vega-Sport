WITH last_run AS (
 SELECT id,started_at FROM agg.power_runs WHERE season_id=2021 AND kind='players' AND status='published' ORDER BY started_at DESC LIMIT 1
), eligible AS (
 SELECT s.season_id,s.player_id,s.team_id,m.id AS match_id,m.competition_season_id AS edition_id,
   m.match_date,s.updated_at AS stat_updated,m.updated_at AS match_updated,lr.id AS last_run_id,lr.started_at AS last_run_start,
   coalesce(lp.position_id,s.position_id) AS slot,s.goals_prevented IS NOT NULL AS with_gk_signal,s.touches IS NOT NULL AS with_touches,
   pm.match_id IS NULL AS missing_intermediate,g.z AS persisted_z,
   CASE WHEN coalesce(lp.position_id,s.position_id) IN (0,11) THEN 'goalkeeper'
        WHEN coalesce(lp.position_id,s.position_id) IN (1,2,3) OR coalesce(lp.position_id,s.position_id) BETWEEN 30 AND 119 THEN 'outfield'
        WHEN s.goals_prevented IS NOT NULL THEN 'goalkeeper'
        ELSE 'unresolved_slot' END AS bucket
 FROM core.matches m
 JOIN core.competition_seasons cs ON cs.id=m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
 JOIN core.player_match_stats s ON s.match_id=m.id AND s.season_id=m.season_id AND s.minutes_played>0
 JOIN core.teams t ON t.id=s.team_id CROSS JOIN last_run lr
 LEFT JOIN core.lineup_players lp ON lp.season_id=s.season_id AND lp.match_id=m.id AND lp.player_id=s.player_id
 LEFT JOIN agg.player_power_matches pm ON pm.season_id=2021 AND pm.match_id=m.id AND pm.player_id=s.player_id
 LEFT JOIN agg.player_match_grades g ON g.season_id=s.season_id AND g.match_id=m.id AND g.player_id=s.player_id
 WHERE m.status='finished' AND s.season_id=2021 AND m.match_date>=date '2021-08-01' AND m.match_date<date '2022-08-01'
 AND s.updated_at<=timestamptz '2026-11-17 21:05:04.550448+00' AND m.updated_at<=timestamptz '2026-11-17 21:05:04.550448+00'
), unique_matches AS (
 SELECT DISTINCT ON (edition_id,bucket,match_id) * FROM eligible
 WHERE missing_intermediate AND persisted_z IS NULL AND
   (bucket='unresolved_slot' OR (edition_id IN (418,755,883) AND with_touches AND stat_updated>timestamptz '2026-11-17 19:47:16.655980+00'))
 ORDER BY edition_id,bucket,match_id,player_id
), ranked AS (
 SELECT *,row_number() OVER (PARTITION BY CASE WHEN bucket='unresolved_slot' THEN 0 ELSE edition_id END,bucket ORDER BY edition_id,match_id,player_id) AS pick
 FROM unique_matches
)
SELECT * FROM ranked WHERE (bucket='outfield' AND pick<=5) OR (bucket='goalkeeper' AND pick<=2) OR (bucket='unresolved_slot' AND pick<=2)
ORDER BY bucket,edition_id,pick
