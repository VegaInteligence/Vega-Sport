-- api.player_appearances joins each row to its edition by the edition's id alone. A read
-- of one season's rows then had every edition of the base to go through: the planner,
-- which expects a few rows from the view, took the editions in their competitions' order
-- and compared each with the rows one by one. On 11 November 2026, for the 577 rows of a
-- club's 21 played matches against 2,156 editions: 0.47 s of the 0.58 s of the club's
-- second page of appearances (its first page, of matches to come, took 0.04 s).
--
-- The edition is now joined on its season too. A match's edition is of the match's
-- season (core.matches: foreign key on both columns), so the rows are the same; a read
-- that names a season keeps that season's editions (304 for 2026/2027) and no other.
-- Measured on the base with the same answers, five runs each: a club's second page of
-- appearances 0.59 s to 0.14 s, a league's season partition page 1.24 s to 0.33 s; a
-- player's read, a match's summary, a performance, the search and the home unchanged.
-- The view is 039's, this join apart.

CREATE OR REPLACE VIEW api.player_appearances AS
SELECT k.season_id, se.label AS season, k.match_id, m.competition_season_id,
  coalesce(cp.provider_key, 'l_v' || lpad(cs.competition_id::text, 7, '0')) AS league_id,
  c.name AS league, c.country_code AS country, m.match_date AS date, m.kickoff_at, m.status::text AS status,
  m.home_team_id, m.away_team_id, m.home_score, m.away_score,
  k.player_id, coalesce(s.team_id, lp.team_id) AS team_id, t.name AS team, t.is_national AS team_is_national,
  p.name AS player_name, ph.source_url AS image_url,
  coalesce(s.position_id, lp.position_id) AS position_number, lp.is_starter AS starter, lp.is_captain,
  lp.shirt_number::float8 AS shirt_number, lp.pitch_x::numeric::float8 AS raw_pitch_x, lp.pitch_y::numeric::float8 AS raw_pitch_y,
  CASE WHEN s.player_id IS NOT NULL THEN s.minutes_played::float8 WHEN mc.player_stats = 'ok' THEN 0::float8 END AS minutes,
  s.rating::numeric::float8 AS rating,
  s.goals::float8 AS goals,
  s.assists::float8 AS assists,
  s.xg::numeric::float8 AS xg,
  s.npxg::numeric::float8 AS npxg,
  s.xa::numeric::float8 AS xa,
  s.xgot::numeric::float8 AS xgot,
  s.total_shots::float8 AS shots,
  s.shots_on_target::float8 AS shots_on_target,
  s.chances_created::float8 AS chances_created,
  s.big_chances_created::float8 AS big_chances_created,
  s.accurate_passes::float8 AS passes_accurate,
  s.defensive_actions::float8 AS defensive_actions,
  s.interceptions::float8 AS interceptions,
  s.tackles::float8 AS tackles,
  s.recoveries::float8 AS recoveries,
  s.duels_won::float8 AS duels_won,
  s.duels_lost::float8 AS duels_lost,
  s.touches::float8 AS touches,
  s.touches_opp_box::float8 AS touches_box,
  s.passes_into_final_third::float8 AS passes_final_third,
  s.clearances::float8 AS clearances,
  s.shot_blocks::float8 AS blocks,
  s.dribbles_succeeded::float8 AS dribbles,
  s.saves::float8 AS saves,
  s.goals_prevented::numeric::float8 AS goals_prevented,
  s.shots_off_target::float8 AS shots_off_target,
  s.blocked_shots::float8 AS blocked_shots,
  s.shots_woodwork::float8 AS shots_woodwork,
  s.big_chances_missed::float8 AS big_chances_missed,
  s.long_balls_accurate::float8 AS long_balls_accurate,
  s.line_breaking_passes::float8 AS line_breaking_passes,
  s.accurate_crosses::float8 AS accurate_crosses,
  s.corners::float8 AS corners,
  s.throw_ins::float8 AS throws,
  s.offsides::float8 AS offsides,
  s.dispossessed::float8 AS dispossessed,
  s.dribbled_past::float8 AS dribbled_past,
  s.headed_clearances::float8 AS headed_clearances,
  s.aerials_won::float8 AS aerials_won,
  s.ground_duels_won::float8 AS ground_duels_won,
  s.fouls::float8 AS fouls,
  s.was_fouled::float8 AS was_fouled,
  s.errors_led_to_goal::float8 AS errors_led_to_goal,
  s.goals_conceded::float8 AS goals_conceded,
  s.saves_inside_box::float8 AS saves_inside_box,
  s.diving_saves::float8 AS dive_saves,
  s.sweeper_actions::float8 AS sweeper_actions,
  s.high_claims::float8 AS high_claims,
  s.punches::float8 AS punches,
  s.xgot_faced::numeric::float8 AS xgot_faced,
  s.distance_m::numeric::float8 AS distance_covered,
  s.top_speed_kmh::numeric::float8 AS top_speed,
  s.sprints::float8 AS sprints,
  s.running_m::numeric::float8 AS running_distance,
  s.sprinting_m::numeric::float8 AS sprinting_distance,
  s.fantasy_points::numeric::float8 AS fantasy_points,
  s.accurate_passes_total::float8 AS passes_attempted,
  s.long_balls_total::float8 AS long_balls_attempted,
  s.accurate_crosses_total::float8 AS crosses_attempted,
  s.ground_duels_total::float8 AS ground_duels,
  s.aerials_total::float8 AS aerial_duels,
  s.dribbles_total::float8 AS dribbles_attempted,
  CASE WHEN s.xg IS NOT NULL AND s.xa IS NOT NULL THEN (s.xg::numeric + s.xa::numeric)::float8 END AS xg_plus_xa,
  (s.player_id IS NOT NULL) AS has_stats
FROM (
  SELECT season_id, match_id, player_id FROM core.player_match_stats
  UNION ALL
  SELECT l.season_id, l.match_id, l.player_id FROM core.lineup_players l
  WHERE NOT EXISTS (SELECT 1 FROM core.player_match_stats x
                    WHERE x.season_id = l.season_id AND x.match_id = l.match_id AND x.player_id = l.player_id)
) k
LEFT JOIN core.player_match_stats s ON s.season_id = k.season_id AND s.match_id = k.match_id AND s.player_id = k.player_id
LEFT JOIN core.lineup_players lp ON lp.season_id = k.season_id AND lp.match_id = k.match_id AND lp.player_id = k.player_id
LEFT JOIN core.match_coverage mc ON mc.season_id = k.season_id AND mc.match_id = k.match_id
JOIN core.matches m ON m.id = k.match_id AND m.season_id = k.season_id
JOIN core.seasons se ON se.id = k.season_id
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.season_id = k.season_id
JOIN core.competitions c ON c.id = cs.competition_id
JOIN core.players p ON p.id = k.player_id
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN core.teams t ON t.id = coalesce(s.team_id, lp.team_id)
LEFT JOIN core.provider_ids cp ON cp.entity_type = 'competition' AND cp.entity_id = cs.competition_id
  AND cp.provider = 'pitchapi' AND cp.is_current;
