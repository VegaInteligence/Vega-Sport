-- Replace __SEASON_ID__ by one edition season or use the all-seasons variant for historical archives.
-- Goals incl own goals, substitutions, shooter & participating keeper are credible match signals. A lone booking can be on the bench.
-- One deduplicated count for additional participants absent from stats>0/starters/subs. Complements player-participations.sql.
WITH more AS (
 SELECT season_id,match_id,who.player_id FROM core.match_events e
 CROSS JOIN LATERAL (VALUES (e.player_id),(e.related_player_id)) AS who(player_id)
 WHERE season_id=__SEASON_ID__ AND e.event_type='goal' AND who.player_id IS NOT NULL
 UNION
 SELECT season_id,match_id,who.player_id FROM core.shots sh CROSS JOIN LATERAL (VALUES (sh.player_id),(sh.keeper_id)) AS who(player_id)
 WHERE season_id=__SEASON_ID__ AND who.player_id IS NOT NULL
), old AS (
 SELECT season_id,match_id,player_id FROM core.player_match_stats WHERE season_id=__SEASON_ID__ AND minutes_played>0
 UNION ALL SELECT season_id,match_id,player_id FROM core.lineup_players WHERE season_id=__SEASON_ID__ AND is_starter IS TRUE
 UNION ALL SELECT season_id,match_id,who.player_id FROM core.match_events e CROSS JOIN LATERAL (VALUES (e.player_id),(e.related_player_id)) AS who(player_id)
 WHERE season_id=__SEASON_ID__ AND e.event_type='substitution' AND who.player_id IS NOT NULL
)
SELECT m.competition_season_id AS edition_id,count(*) AS additional_confirmed_participations,
 count(DISTINCT m.id) AS matches_with_additional_cues,
 count(*) FILTER(WHERE p.player_id IS NULL) AS additional_without_stats,
 count(*) FILTER(WHERE p.player_id IS NOT NULL) AS additional_without_measured_minutes
FROM more c JOIN core.matches m ON m.season_id=c.season_id AND m.id=c.match_id AND m.status='finished'
LEFT JOIN core.player_match_stats p ON p.season_id=c.season_id AND p.match_id=c.match_id AND p.player_id=c.player_id
WHERE NOT EXISTS(SELECT 1 FROM old o WHERE (o.season_id,o.match_id,o.player_id)=(c.season_id,c.match_id,c.player_id))
GROUP BY m.competition_season_id ORDER BY 1
