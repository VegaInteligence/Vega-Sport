-- One integer 2026. Confirmed cues include positive minutes, named starter, or substitution
-- involving this player (both endpoints of a substitution are participants). Listing on bench alone
-- is not participation. No estimate substitutes a roster for a result-only match.
WITH f AS MATERIALIZED (
 SELECT id,competition_season_id AS edition_id FROM core.matches WHERE season_id=2026 AND status='finished'
), cues AS (
 SELECT f.edition_id,f.id,s.player_id,'stats' AS origin, s.minutes_played AS minutes,s.minutes_played>0 AS played
 FROM f JOIN core.player_match_stats s ON s.season_id=2026 AND s.match_id=f.id
 UNION ALL
 SELECT f.edition_id,f.id,l.player_id,'lineup',NULL,l.is_starter IS TRUE
 FROM f JOIN core.lineup_players l ON l.season_id=2026 AND l.match_id=f.id
 UNION ALL
 SELECT f.edition_id,f.id,who.player_id,'substitution',NULL,TRUE
 FROM f JOIN core.match_events ev ON ev.season_id=2026 AND ev.match_id=f.id AND ev.event_type='substitution'
 CROSS JOIN LATERAL (VALUES (ev.player_id),(ev.related_player_id)) AS who(player_id) WHERE who.player_id IS NOT NULL
), known AS (
 SELECT edition_id,id,player_id,bool_or(played) IS TRUE AS played,max(minutes) AS minutes,
        bool_or(origin='stats') AS had_stats,bool_or(origin='lineup') AS had_lineup
 FROM cues GROUP BY edition_id,id,player_id
), by_match AS (
 SELECT f.id, f.edition_id,count(k.player_id) AS listed,count(*) FILTER(WHERE k.played) AS known_participants,
 count(*) FILTER(WHERE k.played AND NOT k.had_stats) AS known_no_stats,
 count(*) FILTER(WHERE k.played AND k.had_stats AND coalesce(k.minutes,0)<=0) AS known_without_positive_minutes,
 count(*) FILTER(WHERE k.had_lineup AND NOT k.played) AS bench_or_unconfirmed
 FROM f LEFT JOIN known k USING (edition_id,id) GROUP BY f.id,f.edition_id
)
SELECT edition_id,count(*) AS finished_matches,count(*) FILTER(WHERE listed=0) AS matches_without_player_records,
 count(*) FILTER(WHERE known_participants=0) AS matches_without_confirmed_participants,sum(known_participants) AS confirmed_participations,
 sum(known_no_stats) AS participants_without_stats,sum(known_without_positive_minutes) AS participants_without_measured_minutes,
 sum(bench_or_unconfirmed) AS lineup_presence_unconfirmed
FROM by_match GROUP BY edition_id ORDER BY edition_id
