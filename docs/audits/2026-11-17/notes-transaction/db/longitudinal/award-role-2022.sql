-- Role eligibility equals assign_roles under the deployed source: only a detailed slot (11, 30..119) supplies role history.
-- Generic codes and goalkeeper signals apply only to that same player's current row.
WITH missing AS MATERIALIZED (
 SELECT m.competition_season_id AS edition_id,extract(year FROM m.match_date-interval '7 months')::int AS award,m.id AS match_id,p.player_id,
        coalesce(l.position_id,p.position_id) AS pos,p.position_id AS stats_slot,p.goals_prevented IS NOT NULL AS keeper,p.touches IS NOT NULL AS measured,p.updated_at
 FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id AND cs.cup_key IS NULL AND cs.archive_key IS NULL
 JOIN core.player_match_stats p ON p.match_id=m.id AND p.season_id=m.season_id AND p.minutes_played>0 JOIN core.teams t ON t.id=p.team_id
 LEFT JOIN core.lineup_players l ON (l.season_id,l.match_id,l.player_id)=(p.season_id,p.match_id,p.player_id)
 LEFT JOIN agg.player_power_matches pm ON pm.season_id=extract(year FROM m.match_date-interval '7 months')::int AND pm.match_id=m.id AND pm.player_id=p.player_id
 WHERE m.season_id=2022 AND m.status='finished' AND pm.match_id IS NULL
 AND extract(year FROM m.match_date-interval '7 months')::int IN (2022,2022-1)
), direct AS MATERIALIZED (
 SELECT *,coalesce(pos IN(0,1,2,3,11) OR pos BETWEEN 30 AND 119,false) OR keeper AS immediate FROM missing
), unresolved AS MATERIALIZED (
 SELECT DISTINCT award,player_id FROM direct WHERE NOT immediate
), history AS MATERIALIZED (
 SELECT u.*,exists(
 SELECT 1 FROM core.player_match_stats p JOIN core.matches m ON m.id=p.match_id AND m.season_id=p.season_id AND m.status='finished'
 JOIN core.competition_seasons cs ON cs.id=m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
 JOIN core.teams t ON t.id=p.team_id LEFT JOIN core.lineup_players l ON (l.season_id,l.match_id,l.player_id)=(p.season_id,p.match_id,p.player_id)
 WHERE p.season_id IN(u.award,u.award+1) AND m.match_date>=make_date(u.award,8,1) AND m.match_date<make_date(u.award+1,8,1)
 AND p.player_id=u.player_id AND p.minutes_played>0 AND (coalesce(l.position_id,p.position_id)=11 OR coalesce(l.position_id,p.position_id) BETWEEN 30 AND 119)) AS has_detailed
 FROM unresolved u
)
SELECT d.edition_id,d.award,count(*) AS pending,count(*) FILTER (WHERE immediate) AS current_assignable,
 count(*) FILTER (WHERE immediate AND measured) AS current_assignable_touches,
 count(*) FILTER (WHERE NOT immediate AND h.has_detailed IS TRUE) AS recovered_by_award_history,
 count(*) FILTER (WHERE NOT immediate AND h.has_detailed IS FALSE) AS no_model_role_after_award_history,
 count(*) FILTER (WHERE NOT immediate AND h.has_detailed IS FALSE AND (stats_slot IN(0,1,2,3,11) OR stats_slot BETWEEN 30 AND 119)) AS valid_stats_slot_shadowed_by_lineup,
 count(*) FILTER (WHERE updated_at<=r.started_at AND (immediate OR h.has_detailed IS TRUE)) AS assignable_stats_older_than_latest_player_start,
 r.id AS latest_player_run,r.started_at AS latest_player_start
FROM direct d LEFT JOIN history h USING(award,player_id)
LEFT JOIN LATERAL (SELECT id,started_at FROM agg.power_runs WHERE kind='players' AND status='published' AND season_id=d.award ORDER BY started_at DESC LIMIT 1) r ON true
GROUP BY d.edition_id,d.award,r.id,r.started_at ORDER BY d.edition_id,d.award
