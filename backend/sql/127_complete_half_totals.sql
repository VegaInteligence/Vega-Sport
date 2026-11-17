-- A player's season by half on complete halves (VI-23 B3, calculation audit of 16 November 2026,
-- finding 15c; docs/calculs/09-audit-2026-11/FAILURE_MODES.md §4). The view (083, 084) summed
-- coalesce(statistic, 0) over every half played: a statistic the source did not publish counted
-- as 0, and the minutes of a half without it still divided the rates.
--
-- A half counts now when its match is finished, its minutes are positive and every statistic the
-- route reads is known: touches (a measured half), goals, shots, passes, touches in the box,
-- dribbles, duels won, tackles, recoveries, and a finite xG, a blank xG being 0 only where the half
-- has no shot (the one structural zero; a published finite xG is kept as it is). A NaN, +∞ or −∞ xG
-- makes the half incomplete, with or without a shot (VI-23 stage 5, FAILURE_MODES §14.5): one such
-- half turned its player's half xG into NaN. No match-level zero flag is
-- read for halves. Every sum, the matches and the minutes cover the complete halves only, so the
-- per-90 rates of a half share one denominator. A (player, half) without a complete half has no
-- row: the route answers « unavailable », never a 0. chances_created, which the source does not
-- publish per half, is the sum of the known values (NULL without any).
--
-- Columns, order and types are those of 084; excluded_matches and excluded_minutes are added at
-- the end: the eligible halves (finished, played) left out, unmeasured or incomplete.
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE VIEW api.player_half_totals AS
WITH h AS (
  SELECT h.season_id, h.player_id, h.period, h.minutes_played, h.goals, h.total_shots,
    coalesce(h.xg, CASE WHEN h.total_shots = 0 THEN 0 END) AS xg,
    h.chances_created, h.accurate_passes, h.touches, h.duels_won, h.recoveries, h.touches_opp_box,
    h.dribbles_succeeded, h.tackles
  FROM core.player_match_half_stats h
  JOIN core.matches m ON m.id = h.match_id AND m.season_id = h.season_id AND m.status = 'finished'
  WHERE h.minutes_played > 0
), c AS (
  SELECT h.*,
    (h.touches IS NOT NULL AND h.goals IS NOT NULL AND h.total_shots IS NOT NULL AND h.xg IS NOT NULL
     AND h.xg NOT IN ('NaN', 'Infinity', '-Infinity')
     AND h.accurate_passes IS NOT NULL AND h.duels_won IS NOT NULL AND h.recoveries IS NOT NULL
     AND h.touches_opp_box IS NOT NULL AND h.dribbles_succeeded IS NOT NULL AND h.tackles IS NOT NULL) AS complete
  FROM h
)
SELECT c.season_id, c.player_id AS player_key, c.period::text AS period,
  (count(*) FILTER (WHERE c.complete))::integer AS matches,
  (sum(c.minutes_played) FILTER (WHERE c.complete))::integer AS minutes,
  (sum(c.goals) FILTER (WHERE c.complete))::integer AS goals,
  (sum(c.total_shots) FILTER (WHERE c.complete))::integer AS shots,
  (sum(c.xg) FILTER (WHERE c.complete))::float8 AS xg,
  (sum(c.chances_created) FILTER (WHERE c.complete))::integer AS chances_created,
  (sum(c.accurate_passes) FILTER (WHERE c.complete))::integer AS passes,
  (sum(c.touches) FILTER (WHERE c.complete))::integer AS touches,
  (sum(c.duels_won) FILTER (WHERE c.complete))::integer AS duels_won,
  (sum(c.recoveries) FILTER (WHERE c.complete))::integer AS recoveries,
  (sum(c.touches_opp_box) FILTER (WHERE c.complete))::integer AS touches_box,
  (sum(c.dribbles_succeeded) FILTER (WHERE c.complete))::integer AS dribbles,
  (sum(c.tackles) FILTER (WHERE c.complete))::integer AS tackles,
  (count(*) FILTER (WHERE NOT c.complete))::integer AS excluded_matches,
  coalesce(sum(c.minutes_played) FILTER (WHERE NOT c.complete), 0)::integer AS excluded_minutes
FROM c
GROUP BY c.season_id, c.player_id, c.period
HAVING count(*) FILTER (WHERE c.complete) > 0;
