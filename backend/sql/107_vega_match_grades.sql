-- Vega's match grade replaces the source's rating (15 November 2026). The ranking pass
-- (vega/power.py, « Match grades ») writes each player-match's grade where the statistics
-- are, keyed like core.player_match_stats (the edition's season, the match, the player): its
-- normal score z, the award year it was computed in, the finished year it was read against,
-- and when it was first written and last changed (only a grade that moved is rewritten, so
-- its drift between runs can be read). The grade is 100 / (1 + 10^(−z/4)), computed by the
-- views, never stored, and shown as the match page shows it: from 20 minutes, or below them
-- when the match stood a full standard deviation from the ordinary (grade_z is always there).
-- Each edition's player sums for the season grade (the grade of his minutes-weighted mean z
-- over his matches of 20 minutes or more) are kept beside them.
-- The appearances, the home's player rows and the list's editions read them, columns added
-- at their ends (070's, 068's and 060's views); the source's rating is still read until the
-- next migration removes it.
SET LOCAL lock_timeout = '3s';
CREATE TABLE agg.player_match_grades (
  season_id smallint NOT NULL,
  match_id integer NOT NULL,
  player_id integer NOT NULL REFERENCES core.players,
  award_season smallint NOT NULL,
  team_id integer REFERENCES core.teams,
  role text NOT NULL,
  minutes smallint NOT NULL,
  z real NOT NULL,
  first_z real NOT NULL,
  ref_season smallint,
  graded_at timestamptz NOT NULL DEFAULT now(),
  changed_at timestamptz NOT NULL DEFAULT now(),
  run_id integer NOT NULL REFERENCES agg.power_runs,
  PRIMARY KEY (season_id, match_id, player_id)
);
CREATE INDEX player_match_grades_award ON agg.player_match_grades (award_season);
CREATE TABLE agg.player_grade_editions (
  season_id smallint NOT NULL,
  competition_season_id integer NOT NULL REFERENCES core.competition_seasons ON DELETE CASCADE,
  player_id integer NOT NULL REFERENCES core.players,
  grade_count integer NOT NULL,
  grade_minutes integer NOT NULL,
  zm_sum double precision NOT NULL,
  PRIMARY KEY (season_id, competition_season_id, player_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.player_match_grades, agg.player_grade_editions TO vega_calc;

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
  coalesce(s.goals, CASE WHEN s.touches IS NOT NULL AND z.goals THEN 0 END)::float8 AS goals,
  coalesce(s.assists, CASE WHEN s.touches IS NOT NULL AND z.assists THEN 0 END)::float8 AS assists,
  coalesce(s.xg, CASE WHEN s.touches IS NOT NULL AND z.xg THEN 0 END)::numeric::float8 AS xg,
  coalesce(s.npxg, CASE WHEN s.touches IS NOT NULL AND z.npxg THEN 0 END)::numeric::float8 AS npxg,
  coalesce(s.xa, CASE WHEN s.touches IS NOT NULL AND z.xa THEN 0 END)::numeric::float8 AS xa,
  coalesce(s.xgot, CASE WHEN s.touches IS NOT NULL AND z.xgot THEN 0 END)::numeric::float8 AS xgot,
  coalesce(s.total_shots, CASE WHEN s.touches IS NOT NULL AND z.total_shots THEN 0 END)::float8 AS shots,
  coalesce(s.shots_on_target, CASE WHEN s.touches IS NOT NULL AND z.shots_on_target THEN 0 END)::float8 AS shots_on_target,
  coalesce(s.chances_created, CASE WHEN s.touches IS NOT NULL AND z.chances_created THEN 0 END)::float8 AS chances_created,
  coalesce(s.big_chances_created, CASE WHEN s.touches IS NOT NULL AND z.big_chances_created THEN 0 END)::float8 AS big_chances_created,
  s.accurate_passes::float8 AS passes_accurate,
  s.defensive_actions::float8 AS defensive_actions,
  s.interceptions::float8 AS interceptions,
  s.tackles::float8 AS tackles,
  s.recoveries::float8 AS recoveries,
  coalesce(s.duels_won, CASE WHEN s.touches IS NOT NULL AND z.duels_won THEN 0 END)::float8 AS duels_won,
  coalesce(s.duels_lost, CASE WHEN s.touches IS NOT NULL AND z.duels_lost THEN 0 END)::float8 AS duels_lost,
  s.touches::float8 AS touches,
  coalesce(s.touches_opp_box, CASE WHEN s.touches IS NOT NULL AND z.touches_opp_box THEN 0 END)::float8 AS touches_box,
  coalesce(s.passes_into_final_third, CASE WHEN s.touches IS NOT NULL AND z.passes_into_final_third THEN 0 END)::float8 AS passes_final_third,
  s.clearances::float8 AS clearances,
  coalesce(s.shot_blocks, CASE WHEN s.touches IS NOT NULL AND z.shot_blocks THEN 0 END)::float8 AS blocks,
  coalesce(s.dribbles_succeeded, CASE WHEN s.touches IS NOT NULL AND z.dribbles_succeeded THEN 0 END)::float8 AS dribbles,
  s.saves::float8 AS saves,
  coalesce(s.goals_prevented, CASE WHEN s.touches IS NOT NULL AND lp.position_id = 11 AND coalesce(s.saves, 0) = 0 AND coalesce(s.goals_conceded, 0) = 0
    AND z.goals_prevented THEN 0 END)::numeric::float8 AS goals_prevented,
  coalesce(s.shots_off_target, CASE WHEN s.touches IS NOT NULL AND z.shots_off_target THEN 0 END)::float8 AS shots_off_target,
  coalesce(s.blocked_shots, CASE WHEN s.touches IS NOT NULL AND z.blocked_shots THEN 0 END)::float8 AS blocked_shots,
  coalesce(s.shots_woodwork, CASE WHEN s.touches IS NOT NULL AND z.shots_woodwork THEN 0 END)::float8 AS shots_woodwork,
  coalesce(s.big_chances_missed, CASE WHEN s.touches IS NOT NULL AND z.big_chances_missed THEN 0 END)::float8 AS big_chances_missed,
  coalesce(s.long_balls_accurate, CASE WHEN s.touches IS NOT NULL AND z.long_balls_accurate THEN 0 END)::float8 AS long_balls_accurate,
  s.line_breaking_passes::float8 AS line_breaking_passes,
  coalesce(s.accurate_crosses, CASE WHEN s.touches IS NOT NULL AND z.accurate_crosses THEN 0 END)::float8 AS accurate_crosses,
  coalesce(s.corners, CASE WHEN s.touches IS NOT NULL AND z.corners THEN 0 END)::float8 AS corners,
  coalesce(s.throw_ins, CASE WHEN s.touches IS NOT NULL AND z.throw_ins THEN 0 END)::float8 AS throws,
  coalesce(s.offsides, CASE WHEN s.touches IS NOT NULL AND z.offsides THEN 0 END)::float8 AS offsides,
  coalesce(s.dispossessed, CASE WHEN s.touches IS NOT NULL AND z.dispossessed THEN 0 END)::float8 AS dispossessed,
  coalesce(s.dribbled_past, CASE WHEN s.touches IS NOT NULL AND z.dribbled_past THEN 0 END)::float8 AS dribbled_past,
  coalesce(s.headed_clearances, CASE WHEN s.touches IS NOT NULL AND z.headed_clearances THEN 0 END)::float8 AS headed_clearances,
  coalesce(s.aerials_won, CASE WHEN s.touches IS NOT NULL AND z.aerials_won THEN 0 END)::float8 AS aerials_won,
  coalesce(s.ground_duels_won, CASE WHEN s.touches IS NOT NULL AND z.ground_duels_won THEN 0 END)::float8 AS ground_duels_won,
  s.fouls::float8 AS fouls,
  coalesce(s.was_fouled, CASE WHEN s.touches IS NOT NULL AND z.was_fouled THEN 0 END)::float8 AS was_fouled,
  coalesce(s.errors_led_to_goal, CASE WHEN s.touches IS NOT NULL AND z.errors_led_to_goal THEN 0 END)::float8 AS errors_led_to_goal,
  s.goals_conceded::float8 AS goals_conceded,
  s.saves_inside_box::float8 AS saves_inside_box,
  s.diving_saves::float8 AS dive_saves,
  s.sweeper_actions::float8 AS sweeper_actions,
  s.high_claims::float8 AS high_claims,
  s.punches::float8 AS punches,
  coalesce(s.xgot_faced, CASE WHEN s.touches IS NOT NULL AND lp.position_id = 11 AND coalesce(s.saves, 0) = 0 AND coalesce(s.goals_conceded, 0) = 0
    AND z.xgot_faced THEN 0 END)::numeric::float8 AS xgot_faced,
  s.distance_m::numeric::float8 AS distance_covered,
  s.top_speed_kmh::numeric::float8 AS top_speed,
  s.sprints::float8 AS sprints,
  s.running_m::numeric::float8 AS running_distance,
  s.sprinting_m::numeric::float8 AS sprinting_distance,
  s.fantasy_points::numeric::float8 AS fantasy_points,
  s.accurate_passes_total::float8 AS passes_attempted,
  coalesce(s.long_balls_total, CASE WHEN s.touches IS NOT NULL AND z.long_balls_total THEN 0 END)::float8 AS long_balls_attempted,
  coalesce(s.accurate_crosses_total, CASE WHEN s.touches IS NOT NULL AND z.accurate_crosses_total THEN 0 END)::float8 AS crosses_attempted,
  coalesce(s.ground_duels_total, CASE WHEN s.touches IS NOT NULL AND z.ground_duels_total THEN 0 END)::float8 AS ground_duels,
  coalesce(s.aerials_total, CASE WHEN s.touches IS NOT NULL AND z.aerials_total THEN 0 END)::float8 AS aerial_duels,
  coalesce(s.dribbles_total, CASE WHEN s.touches IS NOT NULL AND z.dribbles_total THEN 0 END)::float8 AS dribbles_attempted,
  CASE WHEN coalesce(s.xg, CASE WHEN s.touches IS NOT NULL AND z.xg THEN 0 END) IS NOT NULL AND coalesce(s.xa, CASE WHEN s.touches IS NOT NULL AND z.xa THEN 0 END) IS NOT NULL
      THEN (coalesce(s.xg, CASE WHEN s.touches IS NOT NULL AND z.xg THEN 0 END)::numeric + coalesce(s.xa, CASE WHEN s.touches IS NOT NULL AND z.xa THEN 0 END)::numeric)::float8 END AS xg_plus_xa,
  (s.player_id IS NOT NULL) AS has_stats,
  g.z::float8 AS grade_z,
  CASE WHEN g.minutes >= 20 OR abs(g.z) >= 1 THEN (100 / (1 + power(10, -g.z / 4.0)))::float8 END AS grade
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
LEFT JOIN agg.match_zeros z ON z.season_id = k.season_id AND z.match_id = k.match_id
LEFT JOIN agg.player_match_grades g ON g.season_id = k.season_id AND g.match_id = k.match_id AND g.player_id = k.player_id
JOIN core.matches m ON m.id = k.match_id AND m.season_id = k.season_id
JOIN core.seasons se ON se.id = k.season_id
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.season_id = k.season_id
JOIN core.competitions c ON c.id = cs.competition_id
JOIN core.players p ON p.id = k.player_id
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN core.teams t ON t.id = coalesce(s.team_id, lp.team_id)
LEFT JOIN core.provider_ids cp ON cp.entity_type = 'competition' AND cp.entity_id = cs.competition_id
  AND cp.provider = 'pitchapi' AND cp.is_current;

CREATE OR REPLACE VIEW api.home_player_matches AS
SELECT s.season_id, s.match_id, s.player_id, s.team_id, t.name AS team, t.is_national AS team_is_national,
  p.name AS player_name, ph.source_url AS image_url,
  s.minutes_played::float8 AS minutes, s.rating::numeric::float8 AS rating,
  coalesce(s.goals, CASE WHEN s.touches IS NOT NULL AND z.goals THEN 0 END)::float8 AS goals,
  coalesce(s.assists, CASE WHEN s.touches IS NOT NULL AND z.assists THEN 0 END)::float8 AS assists,
  coalesce(s.xg, CASE WHEN s.touches IS NOT NULL AND z.xg THEN 0 END)::numeric::float8 AS xg,
  coalesce(s.xa, CASE WHEN s.touches IS NOT NULL AND z.xa THEN 0 END)::numeric::float8 AS xa,
  g.z::float8 AS grade_z,
  CASE WHEN g.minutes >= 20 OR abs(g.z) >= 1 THEN (100 / (1 + power(10, -g.z / 4.0)))::float8 END AS grade
FROM core.player_match_stats s
JOIN core.players p ON p.id = s.player_id
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN core.teams t ON t.id = s.team_id
LEFT JOIN agg.match_zeros z ON z.season_id = s.season_id AND z.match_id = s.match_id
LEFT JOIN agg.player_match_grades g ON g.season_id = s.season_id AND g.match_id = s.match_id AND g.player_id = s.player_id;

CREATE OR REPLACE VIEW api.player_list_editions AS
SELECT r.season_id, r.competition_season_id, r.player_id,
  r.matches, r.total_minutes, r.unknown_matches, r.starts, r.known_starts, r.rating_sum, r.rating_count,
  r.identity_match_id, r.identity_date, r.identity_kickoff, r.identity_team_id, r.identity_position, r.latest_match_id,
  r.latest_date, r.latest_kickoff, r.latest_team_id, r.latest_position, r.goals_sum, r.goals_count, r.goals_minutes,
  r.assists_sum, r.assists_count, r.assists_minutes, r.xg_sum, r.xg_count, r.xg_minutes, r.npxg_sum, r.npxg_count,
  r.npxg_minutes, r.xgot_sum, r.xgot_count, r.xgot_minutes, r.xa_sum, r.xa_count, r.xa_minutes, r.shots_sum,
  r.shots_count, r.shots_minutes, r.shots_on_target_sum, r.shots_on_target_count, r.shots_on_target_minutes,
  r.touches_box_sum, r.touches_box_count, r.touches_box_minutes, r.chances_created_sum, r.chances_created_count,
  r.chances_created_minutes, r.big_chances_created_sum, r.big_chances_created_count, r.big_chances_created_minutes,
  r.passes_final_third_sum, r.passes_final_third_count, r.passes_final_third_minutes, r.dribbles_sum, r.dribbles_count,
  r.dribbles_minutes, r.touches_sum, r.touches_count, r.touches_minutes, r.passes_accurate_sum,
  r.passes_accurate_count, r.passes_accurate_minutes, r.passes_attempted_sum, r.passes_attempted_count,
  r.passes_attempted_minutes, r.duels_won_sum, r.duels_won_count, r.duels_won_minutes, r.duels_lost_sum,
  r.duels_lost_count, r.duels_lost_minutes, r.tackles_sum, r.tackles_count, r.tackles_minutes, r.interceptions_sum,
  r.interceptions_count, r.interceptions_minutes, r.recoveries_sum, r.recoveries_count, r.recoveries_minutes,
  r.clearances_sum, r.clearances_count, r.clearances_minutes, r.defensive_actions_sum, r.defensive_actions_count,
  r.defensive_actions_minutes, r.blocks_sum, r.blocks_count, r.blocks_minutes, r.saves_sum, r.saves_count,
  r.saves_minutes, r.goals_prevented_sum, r.goals_prevented_count, r.goals_prevented_minutes,
  r.pass_accuracy_numerator, r.pass_accuracy_denominator, r.pass_accuracy_count, r.pass_accuracy_minutes,
  r.duel_rate_numerator, r.duel_rate_denominator, r.duel_rate_count, r.duel_rate_minutes,
  g.grade_count, g.grade_minutes, g.zm_sum AS grade_zm
FROM agg.player_list_editions r
LEFT JOIN agg.player_grade_editions g ON g.season_id = r.season_id AND g.competition_season_id = r.competition_season_id AND g.player_id = r.player_id;

-- A match's grades: 099's view, read from the grades where the statistics are.
CREATE OR REPLACE VIEW api.match_grades AS
SELECT g.award_season AS season_id, g.match_id AS match_key, api.public_id('match', g.match_id) AS match_id,
  api.public_id('player', g.player_id) AS player_id, api.public_id('team', g.team_id) AS team_id,
  g.role, g.minutes, g.z::numeric::float8 AS match_index,
  (100 / (1 + power(10, -g.z / 4.0)))::numeric::float8 AS grade, g.season_id AS edition_season
FROM agg.player_match_grades g;

-- Each edition's grade sums for a player, for the reads that add editions up (the home's
-- season leaders): season grade = 100 / (1 + 10^(−(Σ zm / Σ minutes) / 4)).
CREATE VIEW api.player_grade_editions AS
SELECT g.season_id, g.competition_season_id, g.player_id, g.grade_count, g.grade_minutes, g.zm_sum AS grade_zm
FROM agg.player_grade_editions g;
GRANT SELECT ON api.player_grade_editions TO vega_read;
