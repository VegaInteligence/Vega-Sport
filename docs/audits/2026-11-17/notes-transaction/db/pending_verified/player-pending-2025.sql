-- One edition partition, using the same award date gate as PLAYER_MATCHES; group only missing power match rows.
-- Direct roles are guaranteed assignable regardless of other appearances. Other rows might acquire the player's inferred role.
WITH runs AS (
 SELECT season_id,max(started_at) AS started FROM agg.power_runs WHERE kind='players' AND status='published' GROUP BY season_id
), missing AS (
 SELECT m.competition_season_id AS edition_id,extract(year FROM m.match_date - interval '7 months')::int AS award,
        m.id AS match_id,p.player_id,p.updated_at AS source_updated,r.started,coalesce(l.position_id,p.position_id) AS pos,
        p.goals_prevented IS NOT NULL AS keeper,p.touches IS NOT NULL AS touches,p.minutes_played AS minutes
 FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id AND cs.cup_key IS NULL AND cs.archive_key IS NULL
 JOIN core.player_match_stats p ON p.match_id=m.id AND p.season_id=m.season_id AND p.minutes_played>0
 JOIN core.teams t ON t.id=p.team_id
 LEFT JOIN core.lineup_players l ON l.match_id=m.id AND l.season_id=m.season_id AND l.player_id=p.player_id
 LEFT JOIN runs r ON r.season_id=extract(year FROM m.match_date - interval '7 months')::int
 LEFT JOIN agg.player_power_matches pm ON pm.season_id=extract(year FROM m.match_date - interval '7 months')::int AND pm.match_id=m.id AND pm.player_id=p.player_id
 WHERE m.season_id=2025 AND m.status='finished' AND pm.match_id IS NULL
 AND extract(year FROM m.match_date - interval '7 months')::int IN(2025,2025-1)
), facts AS (
 SELECT *, (coalesce(pos IN(0,1,2,3,11) OR pos BETWEEN 30 AND 119,false) OR keeper) AS direct_role FROM missing
)
SELECT edition_id,award,count(*) AS pending_inputs,count(*) FILTER(WHERE direct_role) AS definitely_assignable_role,
 count(*) FILTER(WHERE direct_role AND touches) AS with_role_and_measured_touches,
 count(*) FILTER(WHERE NOT direct_role) AS need_role_history,count(*) FILTER(WHERE started IS NULL) AS no_published_award,
 count(*) FILTER(WHERE source_updated>started) AS stats_newer_than_run,count(*) FILTER(WHERE started IS NOT NULL AND source_updated<=started AND direct_role) AS role_before_published_run,
 min(source_updated) AS earliest_source_update,max(source_updated) AS latest_source_update,max(started) AS last_published_run
FROM facts GROUP BY edition_id,award ORDER BY edition_id,award
