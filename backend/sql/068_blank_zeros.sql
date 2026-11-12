-- A statistic the source leaves blank is, most of the time, a zero it did not write: a
-- player who took no shot has no expected goals, not unknown ones. The site read every
-- blank as unknown, so a player's statistic counted only the matches where he had a
-- value; one match without (a forward who did not shoot) left the statistic incomplete,
-- and an incomplete statistic is neither ranked nor in a role's index. The power ranking
-- gives the blanks their zeros since its version 2 (power.restore_zeros); the player
-- pages, the lists and the season's rows did not.
--
-- A blank is not always a zero: an edition, or its first matches, may lack a statistic
-- altogether (doc "Valeurs absentes et fiabilité"). The rule, by match:
--   * the player's row is measured (its touches are filled);
--   * and the match shows the statistic for one of its measured rows;
--   * or the edition shows it somewhere and the match is complete: it shows each of the
--     marker statistics the edition shows (xg, xa, shots_on_target, duels_won, chances_created),
--     those that no match of a few dozen players lacks when the source publishes them. A statistic rare
--     enough for a whole match to lack it (a big chance, an offside, an error leading to
--     a goal) gets its zeros this way, and the matches played before an edition's
--     statistics began stay blank.
-- agg.match_zeros keeps the answer, one row per match and one column per statistic; the
-- readers give a blank its zero where the column is true. The source's rows in core are
-- not changed. The goalkeepers' statistics and the physical ones are read as before.
CREATE TABLE agg.match_zeros(
  season_id smallint NOT NULL,
  match_id integer NOT NULL,
  competition_season_id integer NOT NULL REFERENCES core.competition_seasons ON DELETE CASCADE,
  goals boolean NOT NULL,
  assists boolean NOT NULL,
  own_goals boolean NOT NULL,
  total_shots boolean NOT NULL,
  shots_on_target boolean NOT NULL,
  shots_off_target boolean NOT NULL,
  blocked_shots boolean NOT NULL,
  shots_woodwork boolean NOT NULL,
  big_chances_created boolean NOT NULL,
  big_chances_missed boolean NOT NULL,
  penalties_won boolean NOT NULL,
  penalties_missed boolean NOT NULL,
  passes_into_final_third boolean NOT NULL,
  chances_created boolean NOT NULL,
  accurate_crosses boolean NOT NULL,
  accurate_crosses_total boolean NOT NULL,
  long_balls_accurate boolean NOT NULL,
  long_balls_total boolean NOT NULL,
  corners boolean NOT NULL,
  throw_ins boolean NOT NULL,
  touches_opp_box boolean NOT NULL,
  dribbles_succeeded boolean NOT NULL,
  dribbles_total boolean NOT NULL,
  dispossessed boolean NOT NULL,
  offsides boolean NOT NULL,
  was_fouled boolean NOT NULL,
  last_man_tackles boolean NOT NULL,
  headed_clearances boolean NOT NULL,
  clearances_off_line boolean NOT NULL,
  shot_blocks boolean NOT NULL,
  dribbled_past boolean NOT NULL,
  errors_led_to_goal boolean NOT NULL,
  penalties_conceded boolean NOT NULL,
  duels_won boolean NOT NULL,
  duels_lost boolean NOT NULL,
  ground_duels_won boolean NOT NULL,
  ground_duels_total boolean NOT NULL,
  aerials_won boolean NOT NULL,
  aerials_total boolean NOT NULL,
  xg boolean NOT NULL,
  npxg boolean NOT NULL,
  xgot boolean NOT NULL,
  xa boolean NOT NULL,
  PRIMARY KEY (season_id, match_id)
);
CREATE INDEX match_zeros_edition ON agg.match_zeros(competition_season_id);

-- Rewrites only the rows of the edition that changed; returns how many.
CREATE FUNCTION agg.refresh_match_zeros(edition_id integer) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  edition_season smallint;
  changed integer;
BEGIN
  -- The calculator's lock of the edition (re-entrant in its transaction).
  PERFORM pg_advisory_xact_lock(92002, edition_id);
  SELECT cs.season_id INTO edition_season FROM core.competition_seasons cs WHERE cs.id = edition_id;
  WITH seen AS MATERIALIZED (
    SELECT s.match_id,
      bool_or(s.goals IS NOT NULL) AS goals,
      bool_or(s.assists IS NOT NULL) AS assists,
      bool_or(s.own_goals IS NOT NULL) AS own_goals,
      bool_or(s.total_shots IS NOT NULL) AS total_shots,
      bool_or(s.shots_on_target IS NOT NULL) AS shots_on_target,
      bool_or(s.shots_off_target IS NOT NULL) AS shots_off_target,
      bool_or(s.blocked_shots IS NOT NULL) AS blocked_shots,
      bool_or(s.shots_woodwork IS NOT NULL) AS shots_woodwork,
      bool_or(s.big_chances_created IS NOT NULL) AS big_chances_created,
      bool_or(s.big_chances_missed IS NOT NULL) AS big_chances_missed,
      bool_or(s.penalties_won IS NOT NULL) AS penalties_won,
      bool_or(s.penalties_missed IS NOT NULL) AS penalties_missed,
      bool_or(s.passes_into_final_third IS NOT NULL) AS passes_into_final_third,
      bool_or(s.chances_created IS NOT NULL) AS chances_created,
      bool_or(s.accurate_crosses IS NOT NULL) AS accurate_crosses,
      bool_or(s.accurate_crosses_total IS NOT NULL) AS accurate_crosses_total,
      bool_or(s.long_balls_accurate IS NOT NULL) AS long_balls_accurate,
      bool_or(s.long_balls_total IS NOT NULL) AS long_balls_total,
      bool_or(s.corners IS NOT NULL) AS corners,
      bool_or(s.throw_ins IS NOT NULL) AS throw_ins,
      bool_or(s.touches_opp_box IS NOT NULL) AS touches_opp_box,
      bool_or(s.dribbles_succeeded IS NOT NULL) AS dribbles_succeeded,
      bool_or(s.dribbles_total IS NOT NULL) AS dribbles_total,
      bool_or(s.dispossessed IS NOT NULL) AS dispossessed,
      bool_or(s.offsides IS NOT NULL) AS offsides,
      bool_or(s.was_fouled IS NOT NULL) AS was_fouled,
      bool_or(s.last_man_tackles IS NOT NULL) AS last_man_tackles,
      bool_or(s.headed_clearances IS NOT NULL) AS headed_clearances,
      bool_or(s.clearances_off_line IS NOT NULL) AS clearances_off_line,
      bool_or(s.shot_blocks IS NOT NULL) AS shot_blocks,
      bool_or(s.dribbled_past IS NOT NULL) AS dribbled_past,
      bool_or(s.errors_led_to_goal IS NOT NULL) AS errors_led_to_goal,
      bool_or(s.penalties_conceded IS NOT NULL) AS penalties_conceded,
      bool_or(s.duels_won IS NOT NULL) AS duels_won,
      bool_or(s.duels_lost IS NOT NULL) AS duels_lost,
      bool_or(s.ground_duels_won IS NOT NULL) AS ground_duels_won,
      bool_or(s.ground_duels_total IS NOT NULL) AS ground_duels_total,
      bool_or(s.aerials_won IS NOT NULL) AS aerials_won,
      bool_or(s.aerials_total IS NOT NULL) AS aerials_total,
      bool_or(s.xg IS NOT NULL) AS xg,
      bool_or(s.npxg IS NOT NULL) AS npxg,
      bool_or(s.xgot IS NOT NULL) AS xgot,
      bool_or(s.xa IS NOT NULL) AS xa
    FROM core.player_match_stats s
    WHERE s.season_id = edition_season AND s.touches IS NOT NULL
      AND s.match_id IN (SELECT m.id FROM core.matches m
                         WHERE m.competition_season_id = edition_id AND m.season_id = edition_season)
    GROUP BY s.match_id
  ), e AS MATERIALIZED (
    SELECT
      bool_or(seen.goals) AS goals,
      bool_or(seen.assists) AS assists,
      bool_or(seen.own_goals) AS own_goals,
      bool_or(seen.total_shots) AS total_shots,
      bool_or(seen.shots_on_target) AS shots_on_target,
      bool_or(seen.shots_off_target) AS shots_off_target,
      bool_or(seen.blocked_shots) AS blocked_shots,
      bool_or(seen.shots_woodwork) AS shots_woodwork,
      bool_or(seen.big_chances_created) AS big_chances_created,
      bool_or(seen.big_chances_missed) AS big_chances_missed,
      bool_or(seen.penalties_won) AS penalties_won,
      bool_or(seen.penalties_missed) AS penalties_missed,
      bool_or(seen.passes_into_final_third) AS passes_into_final_third,
      bool_or(seen.chances_created) AS chances_created,
      bool_or(seen.accurate_crosses) AS accurate_crosses,
      bool_or(seen.accurate_crosses_total) AS accurate_crosses_total,
      bool_or(seen.long_balls_accurate) AS long_balls_accurate,
      bool_or(seen.long_balls_total) AS long_balls_total,
      bool_or(seen.corners) AS corners,
      bool_or(seen.throw_ins) AS throw_ins,
      bool_or(seen.touches_opp_box) AS touches_opp_box,
      bool_or(seen.dribbles_succeeded) AS dribbles_succeeded,
      bool_or(seen.dribbles_total) AS dribbles_total,
      bool_or(seen.dispossessed) AS dispossessed,
      bool_or(seen.offsides) AS offsides,
      bool_or(seen.was_fouled) AS was_fouled,
      bool_or(seen.last_man_tackles) AS last_man_tackles,
      bool_or(seen.headed_clearances) AS headed_clearances,
      bool_or(seen.clearances_off_line) AS clearances_off_line,
      bool_or(seen.shot_blocks) AS shot_blocks,
      bool_or(seen.dribbled_past) AS dribbled_past,
      bool_or(seen.errors_led_to_goal) AS errors_led_to_goal,
      bool_or(seen.penalties_conceded) AS penalties_conceded,
      bool_or(seen.duels_won) AS duels_won,
      bool_or(seen.duels_lost) AS duels_lost,
      bool_or(seen.ground_duels_won) AS ground_duels_won,
      bool_or(seen.ground_duels_total) AS ground_duels_total,
      bool_or(seen.aerials_won) AS aerials_won,
      bool_or(seen.aerials_total) AS aerials_total,
      bool_or(seen.xg) AS xg,
      bool_or(seen.npxg) AS npxg,
      bool_or(seen.xgot) AS xgot,
      bool_or(seen.xa) AS xa
    FROM seen
  ), fresh AS (
    SELECT seen.match_id,
      (seen.goals OR (c.complete AND e.goals)) AS goals,
      (seen.assists OR (c.complete AND e.assists)) AS assists,
      (seen.own_goals OR (c.complete AND e.own_goals)) AS own_goals,
      (seen.total_shots OR (c.complete AND e.total_shots)) AS total_shots,
      (seen.shots_on_target OR (c.complete AND e.shots_on_target)) AS shots_on_target,
      (seen.shots_off_target OR (c.complete AND e.shots_off_target)) AS shots_off_target,
      (seen.blocked_shots OR (c.complete AND e.blocked_shots)) AS blocked_shots,
      (seen.shots_woodwork OR (c.complete AND e.shots_woodwork)) AS shots_woodwork,
      (seen.big_chances_created OR (c.complete AND e.big_chances_created)) AS big_chances_created,
      (seen.big_chances_missed OR (c.complete AND e.big_chances_missed)) AS big_chances_missed,
      (seen.penalties_won OR (c.complete AND e.penalties_won)) AS penalties_won,
      (seen.penalties_missed OR (c.complete AND e.penalties_missed)) AS penalties_missed,
      (seen.passes_into_final_third OR (c.complete AND e.passes_into_final_third)) AS passes_into_final_third,
      (seen.chances_created OR (c.complete AND e.chances_created)) AS chances_created,
      (seen.accurate_crosses OR (c.complete AND e.accurate_crosses)) AS accurate_crosses,
      (seen.accurate_crosses_total OR (c.complete AND e.accurate_crosses_total)) AS accurate_crosses_total,
      (seen.long_balls_accurate OR (c.complete AND e.long_balls_accurate)) AS long_balls_accurate,
      (seen.long_balls_total OR (c.complete AND e.long_balls_total)) AS long_balls_total,
      (seen.corners OR (c.complete AND e.corners)) AS corners,
      (seen.throw_ins OR (c.complete AND e.throw_ins)) AS throw_ins,
      (seen.touches_opp_box OR (c.complete AND e.touches_opp_box)) AS touches_opp_box,
      (seen.dribbles_succeeded OR (c.complete AND e.dribbles_succeeded)) AS dribbles_succeeded,
      (seen.dribbles_total OR (c.complete AND e.dribbles_total)) AS dribbles_total,
      (seen.dispossessed OR (c.complete AND e.dispossessed)) AS dispossessed,
      (seen.offsides OR (c.complete AND e.offsides)) AS offsides,
      (seen.was_fouled OR (c.complete AND e.was_fouled)) AS was_fouled,
      (seen.last_man_tackles OR (c.complete AND e.last_man_tackles)) AS last_man_tackles,
      (seen.headed_clearances OR (c.complete AND e.headed_clearances)) AS headed_clearances,
      (seen.clearances_off_line OR (c.complete AND e.clearances_off_line)) AS clearances_off_line,
      (seen.shot_blocks OR (c.complete AND e.shot_blocks)) AS shot_blocks,
      (seen.dribbled_past OR (c.complete AND e.dribbled_past)) AS dribbled_past,
      (seen.errors_led_to_goal OR (c.complete AND e.errors_led_to_goal)) AS errors_led_to_goal,
      (seen.penalties_conceded OR (c.complete AND e.penalties_conceded)) AS penalties_conceded,
      (seen.duels_won OR (c.complete AND e.duels_won)) AS duels_won,
      (seen.duels_lost OR (c.complete AND e.duels_lost)) AS duels_lost,
      (seen.ground_duels_won OR (c.complete AND e.ground_duels_won)) AS ground_duels_won,
      (seen.ground_duels_total OR (c.complete AND e.ground_duels_total)) AS ground_duels_total,
      (seen.aerials_won OR (c.complete AND e.aerials_won)) AS aerials_won,
      (seen.aerials_total OR (c.complete AND e.aerials_total)) AS aerials_total,
      (seen.xg OR (c.complete AND e.xg)) AS xg,
      (seen.npxg OR (c.complete AND e.npxg)) AS npxg,
      (seen.xgot OR (c.complete AND e.xgot)) AS xgot,
      (seen.xa OR (c.complete AND e.xa)) AS xa
    FROM seen CROSS JOIN e
    CROSS JOIN LATERAL (SELECT (
      (seen.xg OR NOT e.xg)
      AND (seen.xa OR NOT e.xa)
      AND (seen.shots_on_target OR NOT e.shots_on_target)
      AND (seen.duels_won OR NOT e.duels_won)
      AND (seen.chances_created OR NOT e.chances_created)) AS complete) c
  ), gone AS (
    DELETE FROM agg.match_zeros a
    WHERE a.competition_season_id = edition_id
      AND NOT EXISTS (SELECT 1 FROM fresh f WHERE f.match_id = a.match_id)
    RETURNING 1
  ), written AS (
    INSERT INTO agg.match_zeros AS a (season_id, match_id, competition_season_id,
      goals, assists, own_goals, total_shots, shots_on_target, shots_off_target, blocked_shots, shots_woodwork,
      big_chances_created, big_chances_missed, penalties_won, penalties_missed, passes_into_final_third,
      chances_created, accurate_crosses, accurate_crosses_total, long_balls_accurate, long_balls_total, corners,
      throw_ins, touches_opp_box, dribbles_succeeded, dribbles_total, dispossessed, offsides, was_fouled,
      last_man_tackles, headed_clearances, clearances_off_line, shot_blocks, dribbled_past, errors_led_to_goal,
      penalties_conceded, duels_won, duels_lost, ground_duels_won, ground_duels_total, aerials_won, aerials_total, xg,
      npxg, xgot, xa)
    SELECT edition_season, f.match_id, edition_id,
      goals, assists, own_goals, total_shots, shots_on_target, shots_off_target, blocked_shots, shots_woodwork,
      big_chances_created, big_chances_missed, penalties_won, penalties_missed, passes_into_final_third,
      chances_created, accurate_crosses, accurate_crosses_total, long_balls_accurate, long_balls_total, corners,
      throw_ins, touches_opp_box, dribbles_succeeded, dribbles_total, dispossessed, offsides, was_fouled,
      last_man_tackles, headed_clearances, clearances_off_line, shot_blocks, dribbled_past, errors_led_to_goal,
      penalties_conceded, duels_won, duels_lost, ground_duels_won, ground_duels_total, aerials_won, aerials_total, xg,
      npxg, xgot, xa
    FROM fresh f
    ON CONFLICT (season_id, match_id) DO UPDATE SET (competition_season_id,
      goals, assists, own_goals, total_shots, shots_on_target, shots_off_target, blocked_shots, shots_woodwork,
      big_chances_created, big_chances_missed, penalties_won, penalties_missed, passes_into_final_third,
      chances_created, accurate_crosses, accurate_crosses_total, long_balls_accurate, long_balls_total, corners,
      throw_ins, touches_opp_box, dribbles_succeeded, dribbles_total, dispossessed, offsides, was_fouled,
      last_man_tackles, headed_clearances, clearances_off_line, shot_blocks, dribbled_past, errors_led_to_goal,
      penalties_conceded, duels_won, duels_lost, ground_duels_won, ground_duels_total, aerials_won, aerials_total, xg,
      npxg, xgot, xa) = (EXCLUDED.competition_season_id,
        EXCLUDED.goals, EXCLUDED.assists, EXCLUDED.own_goals, EXCLUDED.total_shots, EXCLUDED.shots_on_target,
        EXCLUDED.shots_off_target, EXCLUDED.blocked_shots, EXCLUDED.shots_woodwork, EXCLUDED.big_chances_created,
        EXCLUDED.big_chances_missed, EXCLUDED.penalties_won, EXCLUDED.penalties_missed,
        EXCLUDED.passes_into_final_third, EXCLUDED.chances_created, EXCLUDED.accurate_crosses,
        EXCLUDED.accurate_crosses_total, EXCLUDED.long_balls_accurate, EXCLUDED.long_balls_total, EXCLUDED.corners,
        EXCLUDED.throw_ins, EXCLUDED.touches_opp_box, EXCLUDED.dribbles_succeeded, EXCLUDED.dribbles_total,
        EXCLUDED.dispossessed, EXCLUDED.offsides, EXCLUDED.was_fouled, EXCLUDED.last_man_tackles,
        EXCLUDED.headed_clearances, EXCLUDED.clearances_off_line, EXCLUDED.shot_blocks, EXCLUDED.dribbled_past,
        EXCLUDED.errors_led_to_goal, EXCLUDED.penalties_conceded, EXCLUDED.duels_won, EXCLUDED.duels_lost,
        EXCLUDED.ground_duels_won, EXCLUDED.ground_duels_total, EXCLUDED.aerials_won, EXCLUDED.aerials_total,
        EXCLUDED.xg, EXCLUDED.npxg, EXCLUDED.xgot, EXCLUDED.xa)
    WHERE (a.competition_season_id,
        a.goals, a.assists, a.own_goals, a.total_shots, a.shots_on_target, a.shots_off_target, a.blocked_shots,
        a.shots_woodwork, a.big_chances_created, a.big_chances_missed, a.penalties_won, a.penalties_missed,
        a.passes_into_final_third, a.chances_created, a.accurate_crosses, a.accurate_crosses_total,
        a.long_balls_accurate, a.long_balls_total, a.corners, a.throw_ins, a.touches_opp_box, a.dribbles_succeeded,
        a.dribbles_total, a.dispossessed, a.offsides, a.was_fouled, a.last_man_tackles, a.headed_clearances,
        a.clearances_off_line, a.shot_blocks, a.dribbled_past, a.errors_led_to_goal, a.penalties_conceded,
        a.duels_won, a.duels_lost, a.ground_duels_won, a.ground_duels_total, a.aerials_won, a.aerials_total, a.xg,
        a.npxg, a.xgot, a.xa)
      IS DISTINCT FROM (EXCLUDED.competition_season_id,
        EXCLUDED.goals, EXCLUDED.assists, EXCLUDED.own_goals, EXCLUDED.total_shots, EXCLUDED.shots_on_target,
        EXCLUDED.shots_off_target, EXCLUDED.blocked_shots, EXCLUDED.shots_woodwork, EXCLUDED.big_chances_created,
        EXCLUDED.big_chances_missed, EXCLUDED.penalties_won, EXCLUDED.penalties_missed,
        EXCLUDED.passes_into_final_third, EXCLUDED.chances_created, EXCLUDED.accurate_crosses,
        EXCLUDED.accurate_crosses_total, EXCLUDED.long_balls_accurate, EXCLUDED.long_balls_total, EXCLUDED.corners,
        EXCLUDED.throw_ins, EXCLUDED.touches_opp_box, EXCLUDED.dribbles_succeeded, EXCLUDED.dribbles_total,
        EXCLUDED.dispossessed, EXCLUDED.offsides, EXCLUDED.was_fouled, EXCLUDED.last_man_tackles,
        EXCLUDED.headed_clearances, EXCLUDED.clearances_off_line, EXCLUDED.shot_blocks, EXCLUDED.dribbled_past,
        EXCLUDED.errors_led_to_goal, EXCLUDED.penalties_conceded, EXCLUDED.duels_won, EXCLUDED.duels_lost,
        EXCLUDED.ground_duels_won, EXCLUDED.ground_duels_total, EXCLUDED.aerials_won, EXCLUDED.aerials_total,
        EXCLUDED.xg, EXCLUDED.npxg, EXCLUDED.xgot, EXCLUDED.xa)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM gone) + (SELECT count(*) FROM written) INTO changed;
  RETURN changed;
END
$$;
REVOKE ALL ON FUNCTION agg.refresh_match_zeros(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agg.refresh_match_zeros(integer) TO vega_calc;
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.match_zeros TO vega_calc;

-- The appearances: 065's view, a blank given its zero where the match says so.
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
  s.goals_prevented::numeric::float8 AS goals_prevented,
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
  s.xgot_faced::numeric::float8 AS xgot_faced,
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
LEFT JOIN agg.match_zeros z ON z.season_id = k.season_id AND z.match_id = k.match_id
JOIN core.matches m ON m.id = k.match_id AND m.season_id = k.season_id
JOIN core.seasons se ON se.id = k.season_id
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.season_id = k.season_id
JOIN core.competitions c ON c.id = cs.competition_id
JOIN core.players p ON p.id = k.player_id
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN core.teams t ON t.id = coalesce(s.team_id, lp.team_id)
LEFT JOIN core.provider_ids cp ON cp.entity_type = 'competition' AND cp.entity_id = cs.competition_id
  AND cp.provider = 'pitchapi' AND cp.is_current;

-- The home's player rows of a match: 048's view, the same zeros.
CREATE OR REPLACE VIEW api.home_player_matches AS
SELECT s.season_id, s.match_id, s.player_id, s.team_id, t.name AS team, t.is_national AS team_is_national,
  p.name AS player_name, ph.source_url AS image_url,
  s.minutes_played::float8 AS minutes, s.rating::numeric::float8 AS rating,
  coalesce(s.goals, CASE WHEN s.touches IS NOT NULL AND z.goals THEN 0 END)::float8 AS goals,
  coalesce(s.assists, CASE WHEN s.touches IS NOT NULL AND z.assists THEN 0 END)::float8 AS assists,
  coalesce(s.xg, CASE WHEN s.touches IS NOT NULL AND z.xg THEN 0 END)::numeric::float8 AS xg,
  coalesce(s.xa, CASE WHEN s.touches IS NOT NULL AND z.xa THEN 0 END)::numeric::float8 AS xa
FROM core.player_match_stats s
JOIN core.players p ON p.id = s.player_id
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN core.teams t ON t.id = s.team_id
LEFT JOIN agg.match_zeros z ON z.season_id = s.season_id AND z.match_id = s.match_id;

-- The player list's rows: 060's function, the same zeros in the rows it sums.
CREATE OR REPLACE FUNCTION agg.refresh_player_list(edition_id integer) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  edition_season smallint;
  changed integer;
BEGIN
  -- The calculator's lock of the edition (re-entrant in its transaction): two refreshes
  -- run one after the other, each reading after the lock.
  PERFORM pg_advisory_xact_lock(92002, edition_id);
  SELECT cs.season_id INTO edition_season FROM core.competition_seasons cs WHERE cs.id = edition_id;
  WITH m AS MATERIALIZED (
    SELECT m.id, m.match_date, m.kickoff_at FROM core.matches m
    WHERE m.competition_season_id = edition_id AND m.season_id = edition_season
  ), k AS MATERIALIZED (
    -- One row per player and match, a statistics row or a line-up row, ranked among the
    -- player's rows of the edition: ord oldest first, identity_rank most recent first,
    -- latest_rank most recent first among the played rows.
    SELECT r.*,
      row_number() OVER (PARTITION BY r.player_id ORDER BY r.match_date NULLS LAST, r.kickoff_at NULLS LAST, r.match_id) AS ord,
      row_number() OVER (PARTITION BY r.player_id
        ORDER BY r.match_date DESC NULLS LAST, r.kickoff_at NULLS LAST, r.match_id) AS identity_rank,
      CASE WHEN r.minutes > 0 THEN row_number() OVER (PARTITION BY r.player_id, (r.minutes > 0)
        ORDER BY r.match_date DESC NULLS LAST, r.kickoff_at NULLS LAST, r.match_id) END AS latest_rank
    FROM (
      SELECT coalesce(s.player_id, lp.player_id) AS player_id, m.id AS match_id, m.match_date, m.kickoff_at,
        coalesce(s.team_id, lp.team_id) AS team_id, coalesce(s.position_id, lp.position_id) AS position_number,
        lp.is_starter AS starter,
        -- Played minutes; 0 for a line-up row of a match whose player statistics are
        -- collected; unknown (NULL) otherwise.
        CASE WHEN s.player_id IS NOT NULL THEN s.minutes_played::integer WHEN mc.player_stats = 'ok' THEN 0 END AS minutes,
        nullif(nullif(nullif(s.rating::numeric::float8, 'NaN'), 'Infinity'), '-Infinity') AS rating,
        coalesce(s.goals, CASE WHEN s.touches IS NOT NULL AND z.goals THEN 0 END) AS goals,
        coalesce(s.assists, CASE WHEN s.touches IS NOT NULL AND z.assists THEN 0 END) AS assists,
        nullif(nullif(nullif(coalesce(s.xg, CASE WHEN s.touches IS NOT NULL AND z.xg THEN 0 END)::numeric::float8, 'NaN'), 'Infinity'), '-Infinity') AS xg,
        nullif(nullif(nullif(coalesce(s.npxg, CASE WHEN s.touches IS NOT NULL AND z.npxg THEN 0 END)::numeric::float8, 'NaN'), 'Infinity'), '-Infinity') AS npxg,
        nullif(nullif(nullif(coalesce(s.xgot, CASE WHEN s.touches IS NOT NULL AND z.xgot THEN 0 END)::numeric::float8, 'NaN'), 'Infinity'), '-Infinity') AS xgot,
        nullif(nullif(nullif(coalesce(s.xa, CASE WHEN s.touches IS NOT NULL AND z.xa THEN 0 END)::numeric::float8, 'NaN'), 'Infinity'), '-Infinity') AS xa,
        coalesce(s.total_shots, CASE WHEN s.touches IS NOT NULL AND z.total_shots THEN 0 END) AS shots,
        coalesce(s.shots_on_target, CASE WHEN s.touches IS NOT NULL AND z.shots_on_target THEN 0 END) AS shots_on_target,
        coalesce(s.touches_opp_box, CASE WHEN s.touches IS NOT NULL AND z.touches_opp_box THEN 0 END) AS touches_box,
        coalesce(s.chances_created, CASE WHEN s.touches IS NOT NULL AND z.chances_created THEN 0 END) AS chances_created,
        coalesce(s.big_chances_created, CASE WHEN s.touches IS NOT NULL AND z.big_chances_created THEN 0 END) AS big_chances_created,
        coalesce(s.passes_into_final_third, CASE WHEN s.touches IS NOT NULL AND z.passes_into_final_third THEN 0 END) AS passes_final_third,
        coalesce(s.dribbles_succeeded, CASE WHEN s.touches IS NOT NULL AND z.dribbles_succeeded THEN 0 END) AS dribbles,
        s.touches,
        s.accurate_passes AS passes_accurate, s.accurate_passes_total AS passes_attempted,
        coalesce(s.duels_won, CASE WHEN s.touches IS NOT NULL AND z.duels_won THEN 0 END) AS duels_won,
        coalesce(s.duels_lost, CASE WHEN s.touches IS NOT NULL AND z.duels_lost THEN 0 END) AS duels_lost,
        s.tackles, s.interceptions, s.recoveries, s.clearances, s.defensive_actions,
        coalesce(s.shot_blocks, CASE WHEN s.touches IS NOT NULL AND z.shot_blocks THEN 0 END) AS blocks, s.saves,
        nullif(nullif(nullif(s.goals_prevented::numeric::float8, 'NaN'), 'Infinity'), '-Infinity') AS goals_prevented
      FROM (SELECT * FROM core.player_match_stats s
            WHERE s.season_id = edition_season AND s.match_id IN (SELECT id FROM m)) s
      FULL JOIN (SELECT * FROM core.lineup_players l
                 WHERE l.season_id = edition_season AND l.match_id IN (SELECT id FROM m)) lp
        ON lp.match_id = s.match_id AND lp.player_id = s.player_id
      JOIN m ON m.id = coalesce(s.match_id, lp.match_id)
      LEFT JOIN core.match_coverage mc ON mc.season_id = edition_season AND mc.match_id = m.id
      LEFT JOIN agg.match_zeros z ON z.season_id = edition_season AND z.match_id = m.id
    ) r
  ), fresh_editions AS (
    SELECT k.player_id,
      (count(*) FILTER (WHERE k.minutes > 0))::integer AS matches,
      coalesce(sum(k.minutes) FILTER (WHERE k.minutes > 0), 0)::integer AS total_minutes,
      (count(*) FILTER (WHERE k.minutes IS NULL))::integer AS unknown_matches,
      (count(*) FILTER (WHERE k.minutes > 0 AND k.starter IS TRUE))::integer AS starts,
      (count(*) FILTER (WHERE k.minutes > 0 AND k.starter IS NOT NULL))::integer AS known_starts,
      sum(k.rating) FILTER (WHERE k.minutes > 0) AS rating_sum,
      (count(k.rating) FILTER (WHERE k.minutes > 0))::integer AS rating_count,
      max(k.match_id) FILTER (WHERE k.identity_rank = 1) AS identity_match_id,
      max(k.match_date) FILTER (WHERE k.identity_rank = 1) AS identity_date,
      max(k.kickoff_at) FILTER (WHERE k.identity_rank = 1) AS identity_kickoff,
      max(k.team_id) FILTER (WHERE k.identity_rank = 1) AS identity_team_id,
      max(k.position_number) FILTER (WHERE k.identity_rank = 1) AS identity_position,
      max(k.match_id) FILTER (WHERE k.latest_rank = 1) AS latest_match_id,
      max(k.match_date) FILTER (WHERE k.latest_rank = 1) AS latest_date,
      max(k.kickoff_at) FILTER (WHERE k.latest_rank = 1) AS latest_kickoff,
      max(k.team_id) FILTER (WHERE k.latest_rank = 1) AS latest_team_id,
      max(k.position_number) FILTER (WHERE k.latest_rank = 1) AS latest_position,
      (sum(k.goals) FILTER (WHERE k.minutes > 0))::integer AS goals_sum,
      (count(k.goals) FILTER (WHERE k.minutes > 0))::integer AS goals_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.goals IS NOT NULL))::integer AS goals_minutes,
      (sum(k.assists) FILTER (WHERE k.minutes > 0))::integer AS assists_sum,
      (count(k.assists) FILTER (WHERE k.minutes > 0))::integer AS assists_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.assists IS NOT NULL))::integer AS assists_minutes,
      sum(k.xg) FILTER (WHERE k.minutes > 0) AS xg_sum,
      (count(k.xg) FILTER (WHERE k.minutes > 0))::integer AS xg_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.xg IS NOT NULL))::integer AS xg_minutes,
      sum(k.npxg) FILTER (WHERE k.minutes > 0) AS npxg_sum,
      (count(k.npxg) FILTER (WHERE k.minutes > 0))::integer AS npxg_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.npxg IS NOT NULL))::integer AS npxg_minutes,
      sum(k.xgot) FILTER (WHERE k.minutes > 0) AS xgot_sum,
      (count(k.xgot) FILTER (WHERE k.minutes > 0))::integer AS xgot_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.xgot IS NOT NULL))::integer AS xgot_minutes,
      sum(k.xa) FILTER (WHERE k.minutes > 0) AS xa_sum,
      (count(k.xa) FILTER (WHERE k.minutes > 0))::integer AS xa_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.xa IS NOT NULL))::integer AS xa_minutes,
      (sum(k.shots) FILTER (WHERE k.minutes > 0))::integer AS shots_sum,
      (count(k.shots) FILTER (WHERE k.minutes > 0))::integer AS shots_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.shots IS NOT NULL))::integer AS shots_minutes,
      (sum(k.shots_on_target) FILTER (WHERE k.minutes > 0))::integer AS shots_on_target_sum,
      (count(k.shots_on_target) FILTER (WHERE k.minutes > 0))::integer AS shots_on_target_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.shots_on_target IS NOT NULL))::integer AS shots_on_target_minutes,
      (sum(k.touches_box) FILTER (WHERE k.minutes > 0))::integer AS touches_box_sum,
      (count(k.touches_box) FILTER (WHERE k.minutes > 0))::integer AS touches_box_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.touches_box IS NOT NULL))::integer AS touches_box_minutes,
      (sum(k.chances_created) FILTER (WHERE k.minutes > 0))::integer AS chances_created_sum,
      (count(k.chances_created) FILTER (WHERE k.minutes > 0))::integer AS chances_created_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.chances_created IS NOT NULL))::integer AS chances_created_minutes,
      (sum(k.big_chances_created) FILTER (WHERE k.minutes > 0))::integer AS big_chances_created_sum,
      (count(k.big_chances_created) FILTER (WHERE k.minutes > 0))::integer AS big_chances_created_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.big_chances_created IS NOT NULL))::integer AS big_chances_created_minutes,
      (sum(k.passes_final_third) FILTER (WHERE k.minutes > 0))::integer AS passes_final_third_sum,
      (count(k.passes_final_third) FILTER (WHERE k.minutes > 0))::integer AS passes_final_third_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.passes_final_third IS NOT NULL))::integer AS passes_final_third_minutes,
      (sum(k.dribbles) FILTER (WHERE k.minutes > 0))::integer AS dribbles_sum,
      (count(k.dribbles) FILTER (WHERE k.minutes > 0))::integer AS dribbles_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.dribbles IS NOT NULL))::integer AS dribbles_minutes,
      (sum(k.touches) FILTER (WHERE k.minutes > 0))::integer AS touches_sum,
      (count(k.touches) FILTER (WHERE k.minutes > 0))::integer AS touches_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.touches IS NOT NULL))::integer AS touches_minutes,
      (sum(k.passes_accurate) FILTER (WHERE k.minutes > 0))::integer AS passes_accurate_sum,
      (count(k.passes_accurate) FILTER (WHERE k.minutes > 0))::integer AS passes_accurate_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.passes_accurate IS NOT NULL))::integer AS passes_accurate_minutes,
      (sum(k.passes_attempted) FILTER (WHERE k.minutes > 0))::integer AS passes_attempted_sum,
      (count(k.passes_attempted) FILTER (WHERE k.minutes > 0))::integer AS passes_attempted_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.passes_attempted IS NOT NULL))::integer AS passes_attempted_minutes,
      (sum(k.duels_won) FILTER (WHERE k.minutes > 0))::integer AS duels_won_sum,
      (count(k.duels_won) FILTER (WHERE k.minutes > 0))::integer AS duels_won_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.duels_won IS NOT NULL))::integer AS duels_won_minutes,
      (sum(k.duels_lost) FILTER (WHERE k.minutes > 0))::integer AS duels_lost_sum,
      (count(k.duels_lost) FILTER (WHERE k.minutes > 0))::integer AS duels_lost_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.duels_lost IS NOT NULL))::integer AS duels_lost_minutes,
      (sum(k.tackles) FILTER (WHERE k.minutes > 0))::integer AS tackles_sum,
      (count(k.tackles) FILTER (WHERE k.minutes > 0))::integer AS tackles_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.tackles IS NOT NULL))::integer AS tackles_minutes,
      (sum(k.interceptions) FILTER (WHERE k.minutes > 0))::integer AS interceptions_sum,
      (count(k.interceptions) FILTER (WHERE k.minutes > 0))::integer AS interceptions_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.interceptions IS NOT NULL))::integer AS interceptions_minutes,
      (sum(k.recoveries) FILTER (WHERE k.minutes > 0))::integer AS recoveries_sum,
      (count(k.recoveries) FILTER (WHERE k.minutes > 0))::integer AS recoveries_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.recoveries IS NOT NULL))::integer AS recoveries_minutes,
      (sum(k.clearances) FILTER (WHERE k.minutes > 0))::integer AS clearances_sum,
      (count(k.clearances) FILTER (WHERE k.minutes > 0))::integer AS clearances_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.clearances IS NOT NULL))::integer AS clearances_minutes,
      (sum(k.defensive_actions) FILTER (WHERE k.minutes > 0))::integer AS defensive_actions_sum,
      (count(k.defensive_actions) FILTER (WHERE k.minutes > 0))::integer AS defensive_actions_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.defensive_actions IS NOT NULL))::integer AS defensive_actions_minutes,
      (sum(k.blocks) FILTER (WHERE k.minutes > 0))::integer AS blocks_sum,
      (count(k.blocks) FILTER (WHERE k.minutes > 0))::integer AS blocks_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.blocks IS NOT NULL))::integer AS blocks_minutes,
      (sum(k.saves) FILTER (WHERE k.minutes > 0))::integer AS saves_sum,
      (count(k.saves) FILTER (WHERE k.minutes > 0))::integer AS saves_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.saves IS NOT NULL))::integer AS saves_minutes,
      sum(k.goals_prevented) FILTER (WHERE k.minutes > 0) AS goals_prevented_sum,
      (count(k.goals_prevented) FILTER (WHERE k.minutes > 0))::integer AS goals_prevented_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.goals_prevented IS NOT NULL))::integer AS goals_prevented_minutes,
      (sum(k.passes_accurate) FILTER (WHERE k.minutes > 0 AND k.passes_accurate IS NOT NULL AND k.passes_attempted > 0))::integer AS pass_accuracy_numerator,
      (sum(k.passes_attempted) FILTER (WHERE k.minutes > 0 AND k.passes_accurate IS NOT NULL AND k.passes_attempted > 0))::integer AS pass_accuracy_denominator,
      (count(*) FILTER (WHERE k.minutes > 0 AND k.passes_accurate IS NOT NULL AND k.passes_attempted > 0))::integer AS pass_accuracy_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.passes_accurate IS NOT NULL AND k.passes_attempted > 0))::integer AS pass_accuracy_minutes,
      (sum(k.duels_won) FILTER (WHERE k.minutes > 0 AND k.duels_won IS NOT NULL AND k.duels_lost IS NOT NULL AND k.duels_won + k.duels_lost > 0))::integer AS duel_rate_numerator,
      (sum(k.duels_won + k.duels_lost) FILTER (WHERE k.minutes > 0 AND k.duels_won IS NOT NULL AND k.duels_lost IS NOT NULL AND k.duels_won + k.duels_lost > 0))::integer AS duel_rate_denominator,
      (count(*) FILTER (WHERE k.minutes > 0 AND k.duels_won IS NOT NULL AND k.duels_lost IS NOT NULL AND k.duels_won + k.duels_lost > 0))::integer AS duel_rate_count,
      (sum(k.minutes) FILTER (WHERE k.minutes > 0 AND k.duels_won IS NOT NULL AND k.duels_lost IS NOT NULL AND k.duels_won + k.duels_lost > 0))::integer AS duel_rate_minutes
    FROM k GROUP BY k.player_id
  ), fresh_teams AS (
    SELECT k.player_id, k.team_id, min(k.ord)::integer AS first_order
    FROM k WHERE k.minutes > 0 AND k.team_id IS NOT NULL GROUP BY k.player_id, k.team_id
  ), fresh_positions AS (
    SELECT k.player_id, k.position_number, sum(k.minutes)::integer AS minutes, min(k.ord)::integer AS first_order
    FROM k WHERE k.minutes > 0 AND k.position_number IS NOT NULL GROUP BY k.player_id, k.position_number
  ),
  gone_editions AS (
    DELETE FROM agg.player_list_editions a
    WHERE a.competition_season_id = edition_id
      AND NOT EXISTS (SELECT 1 FROM fresh_editions f WHERE f.player_id = a.player_id)
    RETURNING 1
  ), written_editions AS (
    INSERT INTO agg.player_list_editions AS a (competition_season_id, player_id, season_id, matches, total_minutes, unknown_matches, starts, known_starts,
      rating_sum, rating_count, identity_match_id, identity_date, identity_kickoff, identity_team_id,
      identity_position, latest_match_id, latest_date, latest_kickoff, latest_team_id, latest_position, goals_sum,
      goals_count, goals_minutes, assists_sum, assists_count, assists_minutes, xg_sum, xg_count, xg_minutes, npxg_sum,
      npxg_count, npxg_minutes, xgot_sum, xgot_count, xgot_minutes, xa_sum, xa_count, xa_minutes, shots_sum,
      shots_count, shots_minutes, shots_on_target_sum, shots_on_target_count, shots_on_target_minutes, touches_box_sum,
      touches_box_count, touches_box_minutes, chances_created_sum, chances_created_count, chances_created_minutes,
      big_chances_created_sum, big_chances_created_count, big_chances_created_minutes, passes_final_third_sum,
      passes_final_third_count, passes_final_third_minutes, dribbles_sum, dribbles_count, dribbles_minutes,
      touches_sum, touches_count, touches_minutes, passes_accurate_sum, passes_accurate_count, passes_accurate_minutes,
      passes_attempted_sum, passes_attempted_count, passes_attempted_minutes, duels_won_sum, duels_won_count,
      duels_won_minutes, duels_lost_sum, duels_lost_count, duels_lost_minutes, tackles_sum, tackles_count,
      tackles_minutes, interceptions_sum, interceptions_count, interceptions_minutes, recoveries_sum, recoveries_count,
      recoveries_minutes, clearances_sum, clearances_count, clearances_minutes, defensive_actions_sum,
      defensive_actions_count, defensive_actions_minutes, blocks_sum, blocks_count, blocks_minutes, saves_sum,
      saves_count, saves_minutes, goals_prevented_sum, goals_prevented_count, goals_prevented_minutes,
      pass_accuracy_numerator, pass_accuracy_denominator, pass_accuracy_count, pass_accuracy_minutes,
      duel_rate_numerator, duel_rate_denominator, duel_rate_count, duel_rate_minutes)
    SELECT edition_id, f.player_id, edition_season, f.matches, f.total_minutes, f.unknown_matches, f.starts, f.known_starts,
      f.rating_sum, f.rating_count, f.identity_match_id, f.identity_date, f.identity_kickoff, f.identity_team_id,
      f.identity_position, f.latest_match_id, f.latest_date, f.latest_kickoff, f.latest_team_id, f.latest_position,
      f.goals_sum, f.goals_count, f.goals_minutes, f.assists_sum, f.assists_count, f.assists_minutes, f.xg_sum,
      f.xg_count, f.xg_minutes, f.npxg_sum, f.npxg_count, f.npxg_minutes, f.xgot_sum, f.xgot_count, f.xgot_minutes,
      f.xa_sum, f.xa_count, f.xa_minutes, f.shots_sum, f.shots_count, f.shots_minutes, f.shots_on_target_sum,
      f.shots_on_target_count, f.shots_on_target_minutes, f.touches_box_sum, f.touches_box_count,
      f.touches_box_minutes, f.chances_created_sum, f.chances_created_count, f.chances_created_minutes,
      f.big_chances_created_sum, f.big_chances_created_count, f.big_chances_created_minutes, f.passes_final_third_sum,
      f.passes_final_third_count, f.passes_final_third_minutes, f.dribbles_sum, f.dribbles_count, f.dribbles_minutes,
      f.touches_sum, f.touches_count, f.touches_minutes, f.passes_accurate_sum, f.passes_accurate_count,
      f.passes_accurate_minutes, f.passes_attempted_sum, f.passes_attempted_count, f.passes_attempted_minutes,
      f.duels_won_sum, f.duels_won_count, f.duels_won_minutes, f.duels_lost_sum, f.duels_lost_count,
      f.duels_lost_minutes, f.tackles_sum, f.tackles_count, f.tackles_minutes, f.interceptions_sum,
      f.interceptions_count, f.interceptions_minutes, f.recoveries_sum, f.recoveries_count, f.recoveries_minutes,
      f.clearances_sum, f.clearances_count, f.clearances_minutes, f.defensive_actions_sum, f.defensive_actions_count,
      f.defensive_actions_minutes, f.blocks_sum, f.blocks_count, f.blocks_minutes, f.saves_sum, f.saves_count,
      f.saves_minutes, f.goals_prevented_sum, f.goals_prevented_count, f.goals_prevented_minutes,
      f.pass_accuracy_numerator, f.pass_accuracy_denominator, f.pass_accuracy_count, f.pass_accuracy_minutes,
      f.duel_rate_numerator, f.duel_rate_denominator, f.duel_rate_count, f.duel_rate_minutes
    FROM fresh_editions f
    ON CONFLICT (competition_season_id, player_id) DO UPDATE SET
      season_id = EXCLUDED.season_id, matches = EXCLUDED.matches, total_minutes = EXCLUDED.total_minutes,
      unknown_matches = EXCLUDED.unknown_matches, starts = EXCLUDED.starts, known_starts = EXCLUDED.known_starts,
      rating_sum = EXCLUDED.rating_sum, rating_count = EXCLUDED.rating_count,
      identity_match_id = EXCLUDED.identity_match_id, identity_date = EXCLUDED.identity_date,
      identity_kickoff = EXCLUDED.identity_kickoff, identity_team_id = EXCLUDED.identity_team_id,
      identity_position = EXCLUDED.identity_position, latest_match_id = EXCLUDED.latest_match_id,
      latest_date = EXCLUDED.latest_date, latest_kickoff = EXCLUDED.latest_kickoff,
      latest_team_id = EXCLUDED.latest_team_id, latest_position = EXCLUDED.latest_position,
      goals_sum = EXCLUDED.goals_sum, goals_count = EXCLUDED.goals_count, goals_minutes = EXCLUDED.goals_minutes,
      assists_sum = EXCLUDED.assists_sum, assists_count = EXCLUDED.assists_count,
      assists_minutes = EXCLUDED.assists_minutes, xg_sum = EXCLUDED.xg_sum, xg_count = EXCLUDED.xg_count,
      xg_minutes = EXCLUDED.xg_minutes, npxg_sum = EXCLUDED.npxg_sum, npxg_count = EXCLUDED.npxg_count,
      npxg_minutes = EXCLUDED.npxg_minutes, xgot_sum = EXCLUDED.xgot_sum, xgot_count = EXCLUDED.xgot_count,
      xgot_minutes = EXCLUDED.xgot_minutes, xa_sum = EXCLUDED.xa_sum, xa_count = EXCLUDED.xa_count,
      xa_minutes = EXCLUDED.xa_minutes, shots_sum = EXCLUDED.shots_sum, shots_count = EXCLUDED.shots_count,
      shots_minutes = EXCLUDED.shots_minutes, shots_on_target_sum = EXCLUDED.shots_on_target_sum,
      shots_on_target_count = EXCLUDED.shots_on_target_count,
      shots_on_target_minutes = EXCLUDED.shots_on_target_minutes, touches_box_sum = EXCLUDED.touches_box_sum,
      touches_box_count = EXCLUDED.touches_box_count, touches_box_minutes = EXCLUDED.touches_box_minutes,
      chances_created_sum = EXCLUDED.chances_created_sum, chances_created_count = EXCLUDED.chances_created_count,
      chances_created_minutes = EXCLUDED.chances_created_minutes,
      big_chances_created_sum = EXCLUDED.big_chances_created_sum,
      big_chances_created_count = EXCLUDED.big_chances_created_count,
      big_chances_created_minutes = EXCLUDED.big_chances_created_minutes,
      passes_final_third_sum = EXCLUDED.passes_final_third_sum,
      passes_final_third_count = EXCLUDED.passes_final_third_count,
      passes_final_third_minutes = EXCLUDED.passes_final_third_minutes, dribbles_sum = EXCLUDED.dribbles_sum,
      dribbles_count = EXCLUDED.dribbles_count, dribbles_minutes = EXCLUDED.dribbles_minutes,
      touches_sum = EXCLUDED.touches_sum, touches_count = EXCLUDED.touches_count,
      touches_minutes = EXCLUDED.touches_minutes, passes_accurate_sum = EXCLUDED.passes_accurate_sum,
      passes_accurate_count = EXCLUDED.passes_accurate_count,
      passes_accurate_minutes = EXCLUDED.passes_accurate_minutes, passes_attempted_sum = EXCLUDED.passes_attempted_sum,
      passes_attempted_count = EXCLUDED.passes_attempted_count,
      passes_attempted_minutes = EXCLUDED.passes_attempted_minutes, duels_won_sum = EXCLUDED.duels_won_sum,
      duels_won_count = EXCLUDED.duels_won_count, duels_won_minutes = EXCLUDED.duels_won_minutes,
      duels_lost_sum = EXCLUDED.duels_lost_sum, duels_lost_count = EXCLUDED.duels_lost_count,
      duels_lost_minutes = EXCLUDED.duels_lost_minutes, tackles_sum = EXCLUDED.tackles_sum,
      tackles_count = EXCLUDED.tackles_count, tackles_minutes = EXCLUDED.tackles_minutes,
      interceptions_sum = EXCLUDED.interceptions_sum, interceptions_count = EXCLUDED.interceptions_count,
      interceptions_minutes = EXCLUDED.interceptions_minutes, recoveries_sum = EXCLUDED.recoveries_sum,
      recoveries_count = EXCLUDED.recoveries_count, recoveries_minutes = EXCLUDED.recoveries_minutes,
      clearances_sum = EXCLUDED.clearances_sum, clearances_count = EXCLUDED.clearances_count,
      clearances_minutes = EXCLUDED.clearances_minutes, defensive_actions_sum = EXCLUDED.defensive_actions_sum,
      defensive_actions_count = EXCLUDED.defensive_actions_count,
      defensive_actions_minutes = EXCLUDED.defensive_actions_minutes, blocks_sum = EXCLUDED.blocks_sum,
      blocks_count = EXCLUDED.blocks_count, blocks_minutes = EXCLUDED.blocks_minutes, saves_sum = EXCLUDED.saves_sum,
      saves_count = EXCLUDED.saves_count, saves_minutes = EXCLUDED.saves_minutes,
      goals_prevented_sum = EXCLUDED.goals_prevented_sum, goals_prevented_count = EXCLUDED.goals_prevented_count,
      goals_prevented_minutes = EXCLUDED.goals_prevented_minutes,
      pass_accuracy_numerator = EXCLUDED.pass_accuracy_numerator,
      pass_accuracy_denominator = EXCLUDED.pass_accuracy_denominator,
      pass_accuracy_count = EXCLUDED.pass_accuracy_count, pass_accuracy_minutes = EXCLUDED.pass_accuracy_minutes,
      duel_rate_numerator = EXCLUDED.duel_rate_numerator, duel_rate_denominator = EXCLUDED.duel_rate_denominator,
      duel_rate_count = EXCLUDED.duel_rate_count, duel_rate_minutes = EXCLUDED.duel_rate_minutes
    WHERE (a.season_id, a.matches, a.total_minutes, a.unknown_matches, a.starts, a.known_starts, a.rating_sum,
           a.rating_count, a.identity_match_id, a.identity_date, a.identity_kickoff, a.identity_team_id,
           a.identity_position, a.latest_match_id, a.latest_date, a.latest_kickoff, a.latest_team_id,
           a.latest_position, a.goals_sum, a.goals_count, a.goals_minutes, a.assists_sum, a.assists_count,
           a.assists_minutes, a.xg_sum, a.xg_count, a.xg_minutes, a.npxg_sum, a.npxg_count, a.npxg_minutes, a.xgot_sum,
           a.xgot_count, a.xgot_minutes, a.xa_sum, a.xa_count, a.xa_minutes, a.shots_sum, a.shots_count,
           a.shots_minutes, a.shots_on_target_sum, a.shots_on_target_count, a.shots_on_target_minutes,
           a.touches_box_sum, a.touches_box_count, a.touches_box_minutes, a.chances_created_sum,
           a.chances_created_count, a.chances_created_minutes, a.big_chances_created_sum, a.big_chances_created_count,
           a.big_chances_created_minutes, a.passes_final_third_sum, a.passes_final_third_count,
           a.passes_final_third_minutes, a.dribbles_sum, a.dribbles_count, a.dribbles_minutes, a.touches_sum,
           a.touches_count, a.touches_minutes, a.passes_accurate_sum, a.passes_accurate_count,
           a.passes_accurate_minutes, a.passes_attempted_sum, a.passes_attempted_count, a.passes_attempted_minutes,
           a.duels_won_sum, a.duels_won_count, a.duels_won_minutes, a.duels_lost_sum, a.duels_lost_count,
           a.duels_lost_minutes, a.tackles_sum, a.tackles_count, a.tackles_minutes, a.interceptions_sum,
           a.interceptions_count, a.interceptions_minutes, a.recoveries_sum, a.recoveries_count, a.recoveries_minutes,
           a.clearances_sum, a.clearances_count, a.clearances_minutes, a.defensive_actions_sum,
           a.defensive_actions_count, a.defensive_actions_minutes, a.blocks_sum, a.blocks_count, a.blocks_minutes,
           a.saves_sum, a.saves_count, a.saves_minutes, a.goals_prevented_sum, a.goals_prevented_count,
           a.goals_prevented_minutes, a.pass_accuracy_numerator, a.pass_accuracy_denominator, a.pass_accuracy_count,
           a.pass_accuracy_minutes, a.duel_rate_numerator, a.duel_rate_denominator, a.duel_rate_count,
           a.duel_rate_minutes)
      IS DISTINCT FROM
          (EXCLUDED.season_id, EXCLUDED.matches, EXCLUDED.total_minutes, EXCLUDED.unknown_matches, EXCLUDED.starts,
           EXCLUDED.known_starts, EXCLUDED.rating_sum, EXCLUDED.rating_count, EXCLUDED.identity_match_id,
           EXCLUDED.identity_date, EXCLUDED.identity_kickoff, EXCLUDED.identity_team_id, EXCLUDED.identity_position,
           EXCLUDED.latest_match_id, EXCLUDED.latest_date, EXCLUDED.latest_kickoff, EXCLUDED.latest_team_id,
           EXCLUDED.latest_position, EXCLUDED.goals_sum, EXCLUDED.goals_count, EXCLUDED.goals_minutes,
           EXCLUDED.assists_sum, EXCLUDED.assists_count, EXCLUDED.assists_minutes, EXCLUDED.xg_sum, EXCLUDED.xg_count,
           EXCLUDED.xg_minutes, EXCLUDED.npxg_sum, EXCLUDED.npxg_count, EXCLUDED.npxg_minutes, EXCLUDED.xgot_sum,
           EXCLUDED.xgot_count, EXCLUDED.xgot_minutes, EXCLUDED.xa_sum, EXCLUDED.xa_count, EXCLUDED.xa_minutes,
           EXCLUDED.shots_sum, EXCLUDED.shots_count, EXCLUDED.shots_minutes, EXCLUDED.shots_on_target_sum,
           EXCLUDED.shots_on_target_count, EXCLUDED.shots_on_target_minutes, EXCLUDED.touches_box_sum,
           EXCLUDED.touches_box_count, EXCLUDED.touches_box_minutes, EXCLUDED.chances_created_sum,
           EXCLUDED.chances_created_count, EXCLUDED.chances_created_minutes, EXCLUDED.big_chances_created_sum,
           EXCLUDED.big_chances_created_count, EXCLUDED.big_chances_created_minutes, EXCLUDED.passes_final_third_sum,
           EXCLUDED.passes_final_third_count, EXCLUDED.passes_final_third_minutes, EXCLUDED.dribbles_sum,
           EXCLUDED.dribbles_count, EXCLUDED.dribbles_minutes, EXCLUDED.touches_sum, EXCLUDED.touches_count,
           EXCLUDED.touches_minutes, EXCLUDED.passes_accurate_sum, EXCLUDED.passes_accurate_count,
           EXCLUDED.passes_accurate_minutes, EXCLUDED.passes_attempted_sum, EXCLUDED.passes_attempted_count,
           EXCLUDED.passes_attempted_minutes, EXCLUDED.duels_won_sum, EXCLUDED.duels_won_count,
           EXCLUDED.duels_won_minutes, EXCLUDED.duels_lost_sum, EXCLUDED.duels_lost_count, EXCLUDED.duels_lost_minutes,
           EXCLUDED.tackles_sum, EXCLUDED.tackles_count, EXCLUDED.tackles_minutes, EXCLUDED.interceptions_sum,
           EXCLUDED.interceptions_count, EXCLUDED.interceptions_minutes, EXCLUDED.recoveries_sum,
           EXCLUDED.recoveries_count, EXCLUDED.recoveries_minutes, EXCLUDED.clearances_sum, EXCLUDED.clearances_count,
           EXCLUDED.clearances_minutes, EXCLUDED.defensive_actions_sum, EXCLUDED.defensive_actions_count,
           EXCLUDED.defensive_actions_minutes, EXCLUDED.blocks_sum, EXCLUDED.blocks_count, EXCLUDED.blocks_minutes,
           EXCLUDED.saves_sum, EXCLUDED.saves_count, EXCLUDED.saves_minutes, EXCLUDED.goals_prevented_sum,
           EXCLUDED.goals_prevented_count, EXCLUDED.goals_prevented_minutes, EXCLUDED.pass_accuracy_numerator,
           EXCLUDED.pass_accuracy_denominator, EXCLUDED.pass_accuracy_count, EXCLUDED.pass_accuracy_minutes,
           EXCLUDED.duel_rate_numerator, EXCLUDED.duel_rate_denominator, EXCLUDED.duel_rate_count,
           EXCLUDED.duel_rate_minutes)
    RETURNING 1
  ),
  gone_teams AS (
    DELETE FROM agg.player_list_teams a
    WHERE a.competition_season_id = edition_id
      AND NOT EXISTS (SELECT 1 FROM fresh_teams f WHERE f.player_id = a.player_id AND f.team_id = a.team_id)
    RETURNING 1
  ), written_teams AS (
    INSERT INTO agg.player_list_teams AS a (competition_season_id, player_id, team_id, season_id, first_order)
    SELECT edition_id, f.player_id, f.team_id, edition_season, f.first_order
    FROM fresh_teams f
    ON CONFLICT (competition_season_id, player_id, team_id) DO UPDATE SET
      season_id = EXCLUDED.season_id, first_order = EXCLUDED.first_order
    WHERE (a.season_id, a.first_order)
      IS DISTINCT FROM
          (EXCLUDED.season_id, EXCLUDED.first_order)
    RETURNING 1
  ),
  gone_positions AS (
    DELETE FROM agg.player_list_positions a
    WHERE a.competition_season_id = edition_id
      AND NOT EXISTS (SELECT 1 FROM fresh_positions f WHERE f.player_id = a.player_id AND f.position_number = a.position_number)
    RETURNING 1
  ), written_positions AS (
    INSERT INTO agg.player_list_positions AS a (competition_season_id, player_id, position_number, season_id, minutes, first_order)
    SELECT edition_id, f.player_id, f.position_number, edition_season, f.minutes, f.first_order
    FROM fresh_positions f
    ON CONFLICT (competition_season_id, player_id, position_number) DO UPDATE SET
      season_id = EXCLUDED.season_id, minutes = EXCLUDED.minutes, first_order = EXCLUDED.first_order
    WHERE (a.season_id, a.minutes, a.first_order)
      IS DISTINCT FROM
          (EXCLUDED.season_id, EXCLUDED.minutes, EXCLUDED.first_order)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM gone_editions) + (SELECT count(*) FROM written_editions)
    + (SELECT count(*) FROM gone_teams) + (SELECT count(*) FROM written_teams)
    + (SELECT count(*) FROM gone_positions) + (SELECT count(*) FROM written_positions) INTO changed;
  RETURN changed;
END
$$;

-- Every edition that has a statistics row: its matches' zeros, then its list rows; the
-- editions of the season in progress and of the one before are queued for the
-- calculator, which rewrites their season rows (agg.player_season_stats) with the zeros.
SELECT count(agg.refresh_match_zeros(e.id)) AS editions
FROM (
  SELECT DISTINCT m.competition_season_id AS id FROM core.matches m
  WHERE EXISTS (SELECT 1 FROM core.player_match_stats s WHERE s.season_id = m.season_id AND s.match_id = m.id)
) e;

SELECT count(agg.refresh_player_list(e.id)) AS editions
FROM (SELECT DISTINCT competition_season_id AS id FROM agg.match_zeros) e;

INSERT INTO ops.dirty_scopes(scope_kind, competition_season_id)
SELECT 'competition_season', z.competition_season_id
FROM (SELECT DISTINCT competition_season_id, season_id FROM agg.match_zeros) z
WHERE z.season_id >= (SELECT max(season_id) - 1 FROM agg.match_zeros)
ON CONFLICT (scope_kind, player_id, team_id, competition_season_id, cohort_id)
DO UPDATE SET revision = ops.dirty_scopes.revision + 1, queued_at = now();
