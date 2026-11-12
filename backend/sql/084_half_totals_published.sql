-- A player's season by half (083): the source publishes no chances created per half, so the
-- read gains three statistics it does publish (touches in the opposition box, dribbles,
-- tackles); the route leaves the chances out.
CREATE OR REPLACE VIEW api.player_half_totals AS
SELECT h.season_id, h.player_id AS player_key, h.period::text AS period, count(*)::integer AS matches,
  sum(h.minutes_played)::integer AS minutes, sum(coalesce(h.goals, 0))::integer AS goals,
  sum(coalesce(h.total_shots, 0))::integer AS shots, sum(coalesce(h.xg, 0))::float8 AS xg,
  sum(coalesce(h.chances_created, 0))::integer AS chances_created, sum(coalesce(h.accurate_passes, 0))::integer AS passes,
  sum(coalesce(h.touches, 0))::integer AS touches, sum(coalesce(h.duels_won, 0))::integer AS duels_won,
  sum(coalesce(h.recoveries, 0))::integer AS recoveries,
  sum(coalesce(h.touches_opp_box, 0))::integer AS touches_box, sum(coalesce(h.dribbles_succeeded, 0))::integer AS dribbles,
  sum(coalesce(h.tackles, 0))::integer AS tackles
FROM core.player_match_half_stats h
WHERE h.minutes_played > 0
GROUP BY h.season_id, h.player_id, h.period;
