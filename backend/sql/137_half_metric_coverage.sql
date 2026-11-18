-- Each half metric's own coverage (calculation audit of 16 November 2026, finding 15c:
-- « couverture et minutes observées par mesure, comme pour les agrégats saison principaux »;
-- docs/calculs/09-audit-2026-11/FAILURE_MODES.md §4.1). api.player_half_totals (129) keeps the
-- complete halves only and no group without one: a half that misses one metric loses all of
-- its others, and a goalkeeper, whose halves publish no touches, has no season by half at all
-- (17 November 2026, read-only: 216,659 of 2,738,261 eligible half rows left out, 15,342
-- player-season-period groups hidden although they had positive passing). 129 is unchanged.
--
-- One row per (season, player, period) with an eligible half, complete or not: its match
-- finished and its minutes positive, as in 129. matches and minutes count the eligible halves;
-- excluded_matches and excluded_minutes those 129 leaves out, by its rule (equal to its columns
-- wherever it has a row). Per metric of the route: <metric>_count, the eligible halves that know
-- it; <metric>_minutes, their minutes (0 without any); <metric>_sum, its sum on them (NULL
-- without any, never 0). A metric is known when it is not NULL; xG when it is finite, or blank
-- on a half whose 0 shots are published (129's structural zero). A blank xG with unknown shots or
-- with a shot, NaN, +∞ and −∞ are unknown.
--
-- xG precision (FAILURE_MODES §4.1, FM-HC.10–12; Astra review of 18 November 2026): each stored
-- single-precision xG is read as the shortest decimal that reads back as the same stored value
-- (0.12345679, never its binary 0.12345679104328156… nor real::numeric's 6 digits, 0.123457),
-- whatever the reading session's extra_float_digits; these decimals are summed exactly (xg_sum is
-- numeric) and the route converts the sum to a JSON number once. Corrected in place before any
-- release: 137 was only on codex/audit-1-linear (c3c8232747), production runs 8018e0836c.
SET LOCAL lock_timeout = '3s';

-- The shortest decimal that reads back as the same single-precision value: PostgreSQL's own
-- shortest output, which it gives only when extra_float_digits is above 0 (at 0, 6 digits).
CREATE FUNCTION core.real_decimal(value real) RETURNS numeric
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET extra_float_digits = 1
RETURN value::text::numeric;

CREATE VIEW api.player_half_coverage AS
WITH h AS (
  SELECT h.season_id, h.player_id, h.period, h.minutes_played, h.goals, h.total_shots,
    CASE WHEN h.xg IS NULL THEN CASE WHEN h.total_shots = 0 THEN 0::numeric END
         WHEN h.xg NOT IN ('NaN', 'Infinity', '-Infinity') THEN core.real_decimal(h.xg) END AS xg,
    h.accurate_passes, h.touches, h.duels_won, h.recoveries, h.touches_opp_box, h.dribbles_succeeded, h.tackles
  FROM core.player_match_half_stats h
  JOIN core.matches m ON m.id = h.match_id AND m.season_id = h.season_id AND m.status = 'finished'
  WHERE h.minutes_played > 0
), c AS (
  SELECT h.*,
    (h.touches IS NOT NULL AND h.goals IS NOT NULL AND h.total_shots IS NOT NULL AND h.xg IS NOT NULL
     AND h.accurate_passes IS NOT NULL AND h.duels_won IS NOT NULL AND h.recoveries IS NOT NULL
     AND h.touches_opp_box IS NOT NULL AND h.dribbles_succeeded IS NOT NULL AND h.tackles IS NOT NULL) AS complete
  FROM h
)
SELECT c.season_id, c.player_id AS player_key, c.period::text AS period,
  count(*)::integer AS matches,
  sum(c.minutes_played)::integer AS minutes,
  (count(*) FILTER (WHERE NOT c.complete))::integer AS excluded_matches,
  coalesce(sum(c.minutes_played) FILTER (WHERE NOT c.complete), 0)::integer AS excluded_minutes,
  sum(c.goals)::integer AS goals_sum, count(c.goals)::integer AS goals_count,
  coalesce(sum(c.minutes_played) FILTER (WHERE c.goals IS NOT NULL), 0)::integer AS goals_minutes,
  sum(c.total_shots)::integer AS shots_sum, count(c.total_shots)::integer AS shots_count,
  coalesce(sum(c.minutes_played) FILTER (WHERE c.total_shots IS NOT NULL), 0)::integer AS shots_minutes,
  sum(c.xg) AS xg_sum, count(c.xg)::integer AS xg_count,
  coalesce(sum(c.minutes_played) FILTER (WHERE c.xg IS NOT NULL), 0)::integer AS xg_minutes,
  sum(c.touches_opp_box)::integer AS touches_box_sum, count(c.touches_opp_box)::integer AS touches_box_count,
  coalesce(sum(c.minutes_played) FILTER (WHERE c.touches_opp_box IS NOT NULL), 0)::integer AS touches_box_minutes,
  sum(c.dribbles_succeeded)::integer AS dribbles_sum, count(c.dribbles_succeeded)::integer AS dribbles_count,
  coalesce(sum(c.minutes_played) FILTER (WHERE c.dribbles_succeeded IS NOT NULL), 0)::integer AS dribbles_minutes,
  sum(c.accurate_passes)::integer AS passes_sum, count(c.accurate_passes)::integer AS passes_count,
  coalesce(sum(c.minutes_played) FILTER (WHERE c.accurate_passes IS NOT NULL), 0)::integer AS passes_minutes,
  sum(c.touches)::integer AS touches_sum, count(c.touches)::integer AS touches_count,
  coalesce(sum(c.minutes_played) FILTER (WHERE c.touches IS NOT NULL), 0)::integer AS touches_minutes,
  sum(c.duels_won)::integer AS duels_won_sum, count(c.duels_won)::integer AS duels_won_count,
  coalesce(sum(c.minutes_played) FILTER (WHERE c.duels_won IS NOT NULL), 0)::integer AS duels_won_minutes,
  sum(c.tackles)::integer AS tackles_sum, count(c.tackles)::integer AS tackles_count,
  coalesce(sum(c.minutes_played) FILTER (WHERE c.tackles IS NOT NULL), 0)::integer AS tackles_minutes,
  sum(c.recoveries)::integer AS recoveries_sum, count(c.recoveries)::integer AS recoveries_count,
  coalesce(sum(c.minutes_played) FILTER (WHERE c.recoveries IS NOT NULL), 0)::integer AS recoveries_minutes
FROM c
GROUP BY c.season_id, c.player_id, c.period;

GRANT SELECT ON api.player_half_coverage TO vega_read;
