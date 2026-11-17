WITH input AS MATERIALIZED (
 SELECT s.match_id,m.competition_season_id ed,extract(year from m.match_date - interval '7 months')::int award,
        s.touches IS NOT NULL measured,s.duels_won won,s.duels_lost lost,s.goals,mc.events,
        CASE WHEN mc.events='ok' AND s.goals>0 THEN s.goals-(SELECT count(*) FROM core.match_events e WHERE e.season_id=s.season_id AND e.match_id=s.match_id AND e.player_id=s.player_id AND e.event_type='goal' AND e.is_penalty AND e.is_own_goal IS NOT TRUE) END AS non_penalty
 FROM core.player_match_stats s JOIN core.matches m ON m.id=s.match_id AND m.season_id=s.season_id
 JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
 LEFT JOIN core.match_coverage mc ON mc.season_id=s.season_id AND mc.match_id=s.match_id
 WHERE s.season_id=2026 AND s.minutes_played>0 AND s.team_id IS NOT NULL AND m.status='finished'
 AND cs.cup_key IS NULL AND cs.archive_key IS NULL AND m.match_date IS NOT NULL AND s.season_id IN (extract(year from m.match_date - interval '7 months')::int,extract(year from m.match_date - interval '7 months')::int+1)
), per_match AS (SELECT match_id,bool_or(won+lost>0) seen FROM input GROUP BY match_id),
per_edition AS (SELECT ed,award,bool_or(non_penalty>0) seen FROM input GROUP BY ed,award)
SELECT 2026 AS edition_season,count(*) admitted,
 count(*) FILTER(WHERE i.measured AND i.won>0 AND i.lost IS NULL AND m.seen) positive_wins_with_restored_zero_attempts,
 count(*) FILTER(WHERE i.measured AND i.goals>0 AND i.events IS DISTINCT FROM 'ok' AND e.seen) known_scorer_without_event_coverage_restored_to_zero_np_goals
FROM input i JOIN per_match m USING(match_id) JOIN per_edition e USING(ed,award)
