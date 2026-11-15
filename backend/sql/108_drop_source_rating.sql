-- The source's player rating is removed from the base (15 November 2026): Vega's own match
-- grade (agg.player_match_grades, 107) replaced it everywhere and was checked in production
-- before. The views that read it are recreated without it (their definitions as the base held
-- them, the rating's columns left out; CREATE OR REPLACE cannot drop a column), the player
-- list's refresh no longer sums it, then its columns go: core.player_match_stats.rating
-- (every partition), agg.player_season_stats' four rating columns, agg.player_list_editions'
-- two, and its row of agg.metric_definitions. agg.agg_rule keeps its value 'rating' (an enum
-- value cannot be dropped); nothing uses it any more.
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION agg.refresh_player_list(edition_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
        nullif(nullif(nullif(coalesce(s.goals_prevented, CASE WHEN s.touches IS NOT NULL AND lp.position_id = 11 AND coalesce(s.saves, 0) = 0 AND coalesce(s.goals_conceded, 0) = 0
          AND z.goals_prevented THEN 0 END)::numeric::float8, 'NaN'), 'Infinity'), '-Infinity') AS goals_prevented
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
      identity_match_id, identity_date, identity_kickoff, identity_team_id,
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
      f.identity_match_id, f.identity_date, f.identity_kickoff, f.identity_team_id,
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
    WHERE (a.season_id, a.matches, a.total_minutes, a.unknown_matches, a.starts, a.known_starts,
           a.identity_match_id, a.identity_date, a.identity_kickoff, a.identity_team_id,
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
           EXCLUDED.known_starts, EXCLUDED.identity_match_id,
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
$function$;

DROP VIEW api.home_player_matches;
CREATE VIEW api.home_player_matches AS
 SELECT s.season_id,
    s.match_id,
    s.player_id,
    s.team_id,
    t.name AS team,
    t.is_national AS team_is_national,
    p.name AS player_name,
    ph.source_url AS image_url,
    s.minutes_played::double precision AS minutes,
    COALESCE(s.goals::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.goals THEN 0
            ELSE NULL::integer
        END)::double precision AS goals,
    COALESCE(s.assists::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.assists THEN 0
            ELSE NULL::integer
        END)::double precision AS assists,
    COALESCE(s.xg,
        CASE
            WHEN s.touches IS NOT NULL AND z.xg THEN 0
            ELSE NULL::integer
        END::real)::numeric::double precision AS xg,
    COALESCE(s.xa,
        CASE
            WHEN s.touches IS NOT NULL AND z.xa THEN 0
            ELSE NULL::integer
        END::real)::numeric::double precision AS xa,
    g.z::double precision AS grade_z,
        CASE
            WHEN g.minutes >= 20 OR abs(g.z) >= 1::double precision THEN 100::double precision / (1::double precision + power(10::double precision, (- g.z) / 4.0::double precision))
            ELSE NULL::double precision
        END AS grade
   FROM core.player_match_stats s
     JOIN core.players p ON p.id = s.player_id
     LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
     LEFT JOIN core.teams t ON t.id = s.team_id
     LEFT JOIN agg.match_zeros z ON z.season_id = s.season_id AND z.match_id = s.match_id
     LEFT JOIN agg.player_match_grades g ON g.season_id = s.season_id AND g.match_id = s.match_id AND g.player_id = s.player_id;
GRANT SELECT ON api.home_player_matches TO vega_read;

DROP VIEW api.home_season_players;
CREATE VIEW api.home_season_players AS
 SELECT competition_season_id,
    season_id,
    player_id,
    team_id,
    appearances,
    minutes,
    COALESCE(goals_sum, 0) AS goals,
    COALESCE(assists_sum, 0) AS assists,
    xg_sum AS xg,
    COALESCE(xg_n, 0) AS xg_matches,
    xa_sum AS xa,
    COALESCE(xa_n, 0) AS xa_matches
   FROM agg.player_season_stats s;
GRANT SELECT ON api.home_season_players TO vega_read;

DROP VIEW api.match_player_stat_rows;
CREATE VIEW api.match_player_stat_rows AS
 SELECT s.season_id,
    s.match_id,
    s.team_id,
    s.player_id,
    s.position_id,
    s.minutes_played,
    s.goals,
    s.assists,
    s.own_goals,
    s.total_shots,
    s.shots_on_target,
    s.shots_off_target,
    s.blocked_shots,
    s.shots_woodwork,
    s.big_chances_created,
    s.big_chances_missed,
    s.penalties_won,
    s.penalties_missed,
    s.accurate_passes,
    s.accurate_passes_total,
    s.passes_into_final_third,
    s.chances_created,
    s.crosses,
    s.accurate_crosses,
    s.accurate_crosses_total,
    s.long_balls_accurate,
    s.long_balls_total,
    s.line_breaking_passes,
    s.corners,
    s.throw_ins,
    s.touches,
    s.touches_opp_box,
    s.dribbles_succeeded,
    s.dribbles_total,
    s.dispossessed,
    s.offsides,
    s.was_fouled,
    s.tackles,
    s.last_man_tackles,
    s.interceptions,
    s.clearances,
    s.headed_clearances,
    s.clearances_off_line,
    s.shot_blocks,
    s.recoveries,
    s.defensive_actions,
    s.dribbled_past,
    s.errors_led_to_goal,
    s.penalties_conceded,
    s.fouls,
    s.duels_won,
    s.duels_lost,
    s.ground_duels_won,
    s.ground_duels_total,
    s.aerials_won,
    s.aerials_total,
    s.saves,
    s.saves_inside_box,
    s.diving_saves,
    s.high_claims,
    s.punches,
    s.sweeper_actions,
    s.goals_conceded,
    s.penalties_saved,
    s.shootout_penalties_saved,
    s.sprints,
    s.fantasy_points,
    s.xg,
    s.npxg,
    s.xgot,
    s.xa,
    s.goals_prevented,
    s.xgot_faced,
    s.distance_m,
    s.running_m,
    s.sprinting_m,
    s.top_speed_kmh,
    s.updated_at,
    api.public_id('player'::core.entity_type, s.player_id) AS player_public_id,
    p.name AS player_name,
    ph.source_url AS player_image_url,
    api.public_id('team'::core.entity_type, s.team_id) AS team_public_id,
    (EXISTS ( SELECT 1
           FROM core.shots x
          WHERE x.season_id = s.season_id AND x.match_id = s.match_id AND (s.player_id = x.player_id OR s.player_id = x.keeper_id))) AS has_shot
   FROM core.player_match_stats s
     JOIN core.players p ON p.id = s.player_id
     LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id;
GRANT SELECT ON api.match_player_stat_rows TO vega_read;

DROP VIEW api.match_player_stats;
CREATE VIEW api.match_player_stats AS
 SELECT s.season_id,
    s.match_id,
    s.team_id,
    s.player_id,
    s.position_id,
    s.minutes_played,
    s.goals,
    s.assists,
    s.own_goals,
    s.total_shots,
    s.shots_on_target,
    s.shots_off_target,
    s.blocked_shots,
    s.shots_woodwork,
    s.big_chances_created,
    s.big_chances_missed,
    s.penalties_won,
    s.penalties_missed,
    s.accurate_passes,
    s.accurate_passes_total,
    s.passes_into_final_third,
    s.chances_created,
    s.crosses,
    s.accurate_crosses,
    s.accurate_crosses_total,
    s.long_balls_accurate,
    s.long_balls_total,
    s.line_breaking_passes,
    s.corners,
    s.throw_ins,
    s.touches,
    s.touches_opp_box,
    s.dribbles_succeeded,
    s.dribbles_total,
    s.dispossessed,
    s.offsides,
    s.was_fouled,
    s.tackles,
    s.last_man_tackles,
    s.interceptions,
    s.clearances,
    s.headed_clearances,
    s.clearances_off_line,
    s.shot_blocks,
    s.recoveries,
    s.defensive_actions,
    s.dribbled_past,
    s.errors_led_to_goal,
    s.penalties_conceded,
    s.fouls,
    s.duels_won,
    s.duels_lost,
    s.ground_duels_won,
    s.ground_duels_total,
    s.aerials_won,
    s.aerials_total,
    s.saves,
    s.saves_inside_box,
    s.diving_saves,
    s.high_claims,
    s.punches,
    s.sweeper_actions,
    s.goals_conceded,
    s.penalties_saved,
    s.shootout_penalties_saved,
    s.sprints,
    s.fantasy_points,
    s.xg,
    s.npxg,
    s.xgot,
    s.xa,
    s.goals_prevented,
    s.xgot_faced,
    s.distance_m,
    s.running_m,
    s.sprinting_m,
    s.top_speed_kmh,
    s.updated_at,
    api.public_id('player'::core.entity_type, s.player_id) AS player_public_id,
    p.name AS player_name,
    core.pct(s.accurate_passes::double precision, s.accurate_passes_total::double precision) AS pass_completion_pct,
    core.pct(s.duels_won::double precision, (s.duels_won + s.duels_lost)::double precision) AS duel_success_pct,
    core.pct(s.aerials_won::double precision, s.aerials_total::double precision) AS aerial_success_pct,
    core.pct(s.dribbles_succeeded::double precision, s.dribbles_total::double precision) AS dribble_success_pct,
    a.xt_total AS adv_xt_total,
    a.progressive_passes AS adv_progressive_passes,
    a.progressive_carries AS adv_progressive_carries,
    a.sca AS adv_sca,
    a.gca AS adv_gca,
    a.xg_chain AS adv_xg_chain,
    a.xg_buildup AS adv_xg_buildup
   FROM core.player_match_stats s
     JOIN core.players p ON p.id = s.player_id
     LEFT JOIN core.player_match_advanced a ON a.season_id = s.season_id AND a.match_id = s.match_id AND a.player_id = s.player_id;
GRANT SELECT ON api.match_player_stats TO vega_read;

DROP VIEW api.player_appearances;
CREATE VIEW api.player_appearances AS
 SELECT k.season_id,
    se.label AS season,
    k.match_id,
    m.competition_season_id,
    COALESCE(cp.provider_key, 'l_v'::text || lpad(cs.competition_id::text, 7, '0'::text)) AS league_id,
    c.name AS league,
    c.country_code AS country,
    m.match_date AS date,
    m.kickoff_at,
    m.status::text AS status,
    m.home_team_id,
    m.away_team_id,
    m.home_score,
    m.away_score,
    k.player_id,
    COALESCE(s.team_id, lp.team_id) AS team_id,
    t.name AS team,
    t.is_national AS team_is_national,
    p.name AS player_name,
    ph.source_url AS image_url,
    COALESCE(s.position_id, lp.position_id) AS position_number,
    lp.is_starter AS starter,
    lp.is_captain,
    lp.shirt_number::double precision AS shirt_number,
    lp.pitch_x::numeric::double precision AS raw_pitch_x,
    lp.pitch_y::numeric::double precision AS raw_pitch_y,
        CASE
            WHEN s.player_id IS NOT NULL THEN s.minutes_played::double precision
            WHEN mc.player_stats = 'ok'::core.coverage_status THEN 0::double precision
            ELSE NULL::double precision
        END AS minutes,
    COALESCE(s.goals::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.goals THEN 0
            ELSE NULL::integer
        END)::double precision AS goals,
    COALESCE(s.assists::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.assists THEN 0
            ELSE NULL::integer
        END)::double precision AS assists,
    COALESCE(s.xg,
        CASE
            WHEN s.touches IS NOT NULL AND z.xg THEN 0
            ELSE NULL::integer
        END::real)::numeric::double precision AS xg,
    COALESCE(s.npxg,
        CASE
            WHEN s.touches IS NOT NULL AND z.npxg THEN 0
            ELSE NULL::integer
        END::real)::numeric::double precision AS npxg,
    COALESCE(s.xa,
        CASE
            WHEN s.touches IS NOT NULL AND z.xa THEN 0
            ELSE NULL::integer
        END::real)::numeric::double precision AS xa,
    COALESCE(s.xgot,
        CASE
            WHEN s.touches IS NOT NULL AND z.xgot THEN 0
            ELSE NULL::integer
        END::real)::numeric::double precision AS xgot,
    COALESCE(s.total_shots::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.total_shots THEN 0
            ELSE NULL::integer
        END)::double precision AS shots,
    COALESCE(s.shots_on_target::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.shots_on_target THEN 0
            ELSE NULL::integer
        END)::double precision AS shots_on_target,
    COALESCE(s.chances_created::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.chances_created THEN 0
            ELSE NULL::integer
        END)::double precision AS chances_created,
    COALESCE(s.big_chances_created::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.big_chances_created THEN 0
            ELSE NULL::integer
        END)::double precision AS big_chances_created,
    s.accurate_passes::double precision AS passes_accurate,
    s.defensive_actions::double precision AS defensive_actions,
    s.interceptions::double precision AS interceptions,
    s.tackles::double precision AS tackles,
    s.recoveries::double precision AS recoveries,
    COALESCE(s.duels_won::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.duels_won THEN 0
            ELSE NULL::integer
        END)::double precision AS duels_won,
    COALESCE(s.duels_lost::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.duels_lost THEN 0
            ELSE NULL::integer
        END)::double precision AS duels_lost,
    s.touches::double precision AS touches,
    COALESCE(s.touches_opp_box::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.touches_opp_box THEN 0
            ELSE NULL::integer
        END)::double precision AS touches_box,
    COALESCE(s.passes_into_final_third::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.passes_into_final_third THEN 0
            ELSE NULL::integer
        END)::double precision AS passes_final_third,
    s.clearances::double precision AS clearances,
    COALESCE(s.shot_blocks::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.shot_blocks THEN 0
            ELSE NULL::integer
        END)::double precision AS blocks,
    COALESCE(s.dribbles_succeeded::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.dribbles_succeeded THEN 0
            ELSE NULL::integer
        END)::double precision AS dribbles,
    s.saves::double precision AS saves,
    COALESCE(s.goals_prevented,
        CASE
            WHEN s.touches IS NOT NULL AND lp.position_id = 11 AND COALESCE(s.saves::integer, 0) = 0 AND COALESCE(s.goals_conceded::integer, 0) = 0 AND z.goals_prevented THEN 0
            ELSE NULL::integer
        END::real)::numeric::double precision AS goals_prevented,
    COALESCE(s.shots_off_target::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.shots_off_target THEN 0
            ELSE NULL::integer
        END)::double precision AS shots_off_target,
    COALESCE(s.blocked_shots::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.blocked_shots THEN 0
            ELSE NULL::integer
        END)::double precision AS blocked_shots,
    COALESCE(s.shots_woodwork::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.shots_woodwork THEN 0
            ELSE NULL::integer
        END)::double precision AS shots_woodwork,
    COALESCE(s.big_chances_missed::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.big_chances_missed THEN 0
            ELSE NULL::integer
        END)::double precision AS big_chances_missed,
    COALESCE(s.long_balls_accurate::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.long_balls_accurate THEN 0
            ELSE NULL::integer
        END)::double precision AS long_balls_accurate,
    s.line_breaking_passes::double precision AS line_breaking_passes,
    COALESCE(s.accurate_crosses::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.accurate_crosses THEN 0
            ELSE NULL::integer
        END)::double precision AS accurate_crosses,
    COALESCE(s.corners::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.corners THEN 0
            ELSE NULL::integer
        END)::double precision AS corners,
    COALESCE(s.throw_ins::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.throw_ins THEN 0
            ELSE NULL::integer
        END)::double precision AS throws,
    COALESCE(s.offsides::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.offsides THEN 0
            ELSE NULL::integer
        END)::double precision AS offsides,
    COALESCE(s.dispossessed::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.dispossessed THEN 0
            ELSE NULL::integer
        END)::double precision AS dispossessed,
    COALESCE(s.dribbled_past::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.dribbled_past THEN 0
            ELSE NULL::integer
        END)::double precision AS dribbled_past,
    COALESCE(s.headed_clearances::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.headed_clearances THEN 0
            ELSE NULL::integer
        END)::double precision AS headed_clearances,
    COALESCE(s.aerials_won::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.aerials_won THEN 0
            ELSE NULL::integer
        END)::double precision AS aerials_won,
    COALESCE(s.ground_duels_won::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.ground_duels_won THEN 0
            ELSE NULL::integer
        END)::double precision AS ground_duels_won,
    s.fouls::double precision AS fouls,
    COALESCE(s.was_fouled::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.was_fouled THEN 0
            ELSE NULL::integer
        END)::double precision AS was_fouled,
    COALESCE(s.errors_led_to_goal::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.errors_led_to_goal THEN 0
            ELSE NULL::integer
        END)::double precision AS errors_led_to_goal,
    s.goals_conceded::double precision AS goals_conceded,
    s.saves_inside_box::double precision AS saves_inside_box,
    s.diving_saves::double precision AS dive_saves,
    s.sweeper_actions::double precision AS sweeper_actions,
    s.high_claims::double precision AS high_claims,
    s.punches::double precision AS punches,
    COALESCE(s.xgot_faced,
        CASE
            WHEN s.touches IS NOT NULL AND lp.position_id = 11 AND COALESCE(s.saves::integer, 0) = 0 AND COALESCE(s.goals_conceded::integer, 0) = 0 AND z.xgot_faced THEN 0
            ELSE NULL::integer
        END::real)::numeric::double precision AS xgot_faced,
    s.distance_m::numeric::double precision AS distance_covered,
    s.top_speed_kmh::numeric::double precision AS top_speed,
    s.sprints::double precision AS sprints,
    s.running_m::numeric::double precision AS running_distance,
    s.sprinting_m::numeric::double precision AS sprinting_distance,
    s.fantasy_points::numeric::double precision AS fantasy_points,
    s.accurate_passes_total::double precision AS passes_attempted,
    COALESCE(s.long_balls_total::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.long_balls_total THEN 0
            ELSE NULL::integer
        END)::double precision AS long_balls_attempted,
    COALESCE(s.accurate_crosses_total::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.accurate_crosses_total THEN 0
            ELSE NULL::integer
        END)::double precision AS crosses_attempted,
    COALESCE(s.ground_duels_total::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.ground_duels_total THEN 0
            ELSE NULL::integer
        END)::double precision AS ground_duels,
    COALESCE(s.aerials_total::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.aerials_total THEN 0
            ELSE NULL::integer
        END)::double precision AS aerial_duels,
    COALESCE(s.dribbles_total::integer,
        CASE
            WHEN s.touches IS NOT NULL AND z.dribbles_total THEN 0
            ELSE NULL::integer
        END)::double precision AS dribbles_attempted,
        CASE
            WHEN COALESCE(s.xg,
            CASE
                WHEN s.touches IS NOT NULL AND z.xg THEN 0
                ELSE NULL::integer
            END::real) IS NOT NULL AND COALESCE(s.xa,
            CASE
                WHEN s.touches IS NOT NULL AND z.xa THEN 0
                ELSE NULL::integer
            END::real) IS NOT NULL THEN (COALESCE(s.xg,
            CASE
                WHEN s.touches IS NOT NULL AND z.xg THEN 0
                ELSE NULL::integer
            END::real)::numeric + COALESCE(s.xa,
            CASE
                WHEN s.touches IS NOT NULL AND z.xa THEN 0
                ELSE NULL::integer
            END::real)::numeric)::double precision
            ELSE NULL::double precision
        END AS xg_plus_xa,
    s.player_id IS NOT NULL AS has_stats,
    g.z::double precision AS grade_z,
        CASE
            WHEN g.minutes >= 20 OR abs(g.z) >= 1::double precision THEN 100::double precision / (1::double precision + power(10::double precision, (- g.z) / 4.0::double precision))
            ELSE NULL::double precision
        END AS grade
   FROM ( SELECT player_match_stats.season_id,
            player_match_stats.match_id,
            player_match_stats.player_id
           FROM core.player_match_stats
        UNION ALL
         SELECT l.season_id,
            l.match_id,
            l.player_id
           FROM core.lineup_players l
          WHERE NOT (EXISTS ( SELECT 1
                   FROM core.player_match_stats x
                  WHERE x.season_id = l.season_id AND x.match_id = l.match_id AND x.player_id = l.player_id))) k
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
     LEFT JOIN core.teams t ON t.id = COALESCE(s.team_id, lp.team_id)
     LEFT JOIN core.provider_ids cp ON cp.entity_type = 'competition'::core.entity_type AND cp.entity_id = cs.competition_id AND cp.provider = 'pitchapi'::core.provider AND cp.is_current;
GRANT SELECT ON api.player_appearances TO vega_read;

DROP VIEW api.player_list_editions;
CREATE VIEW api.player_list_editions AS
 SELECT r.season_id,
    r.competition_season_id,
    r.player_id,
    r.matches,
    r.total_minutes,
    r.unknown_matches,
    r.starts,
    r.known_starts,
    r.identity_match_id,
    r.identity_date,
    r.identity_kickoff,
    r.identity_team_id,
    r.identity_position,
    r.latest_match_id,
    r.latest_date,
    r.latest_kickoff,
    r.latest_team_id,
    r.latest_position,
    r.goals_sum,
    r.goals_count,
    r.goals_minutes,
    r.assists_sum,
    r.assists_count,
    r.assists_minutes,
    r.xg_sum,
    r.xg_count,
    r.xg_minutes,
    r.npxg_sum,
    r.npxg_count,
    r.npxg_minutes,
    r.xgot_sum,
    r.xgot_count,
    r.xgot_minutes,
    r.xa_sum,
    r.xa_count,
    r.xa_minutes,
    r.shots_sum,
    r.shots_count,
    r.shots_minutes,
    r.shots_on_target_sum,
    r.shots_on_target_count,
    r.shots_on_target_minutes,
    r.touches_box_sum,
    r.touches_box_count,
    r.touches_box_minutes,
    r.chances_created_sum,
    r.chances_created_count,
    r.chances_created_minutes,
    r.big_chances_created_sum,
    r.big_chances_created_count,
    r.big_chances_created_minutes,
    r.passes_final_third_sum,
    r.passes_final_third_count,
    r.passes_final_third_minutes,
    r.dribbles_sum,
    r.dribbles_count,
    r.dribbles_minutes,
    r.touches_sum,
    r.touches_count,
    r.touches_minutes,
    r.passes_accurate_sum,
    r.passes_accurate_count,
    r.passes_accurate_minutes,
    r.passes_attempted_sum,
    r.passes_attempted_count,
    r.passes_attempted_minutes,
    r.duels_won_sum,
    r.duels_won_count,
    r.duels_won_minutes,
    r.duels_lost_sum,
    r.duels_lost_count,
    r.duels_lost_minutes,
    r.tackles_sum,
    r.tackles_count,
    r.tackles_minutes,
    r.interceptions_sum,
    r.interceptions_count,
    r.interceptions_minutes,
    r.recoveries_sum,
    r.recoveries_count,
    r.recoveries_minutes,
    r.clearances_sum,
    r.clearances_count,
    r.clearances_minutes,
    r.defensive_actions_sum,
    r.defensive_actions_count,
    r.defensive_actions_minutes,
    r.blocks_sum,
    r.blocks_count,
    r.blocks_minutes,
    r.saves_sum,
    r.saves_count,
    r.saves_minutes,
    r.goals_prevented_sum,
    r.goals_prevented_count,
    r.goals_prevented_minutes,
    r.pass_accuracy_numerator,
    r.pass_accuracy_denominator,
    r.pass_accuracy_count,
    r.pass_accuracy_minutes,
    r.duel_rate_numerator,
    r.duel_rate_denominator,
    r.duel_rate_count,
    r.duel_rate_minutes,
    g.grade_count,
    g.grade_minutes,
    g.zm_sum AS grade_zm
   FROM agg.player_list_editions r
     LEFT JOIN agg.player_grade_editions g ON g.season_id = r.season_id AND g.competition_season_id = r.competition_season_id AND g.player_id = r.player_id;
GRANT SELECT ON api.player_list_editions TO vega_read;

DROP VIEW api.player_match_log;
CREATE VIEW api.player_match_log AS
 SELECT s.season_id,
    s.match_id,
    api.public_id('match'::core.entity_type, s.match_id) AS match_public_id,
    m.competition_season_id,
    m.kickoff_at,
    s.player_id,
    s.team_id,
        CASE
            WHEN m.home_team_id = s.team_id THEN m.away_team_id
            ELSE m.home_team_id
        END AS opponent_id,
    m.home_team_id = s.team_id AS is_home,
        CASE
            WHEN m.home_team_id = s.team_id THEN m.home_score
            ELSE m.away_score
        END AS goals_for,
        CASE
            WHEN m.home_team_id = s.team_id THEN m.away_score
            ELSE m.home_score
        END AS goals_against,
    lp.is_starter,
    s.minutes_played,
    s.goals,
    s.assists,
    s.xg,
    s.xa,
    s.total_shots,
    core.pct(s.accurate_passes::double precision, s.accurate_passes_total::double precision) AS pass_completion_pct
   FROM core.player_match_stats s
     JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id
     LEFT JOIN core.lineup_players lp ON lp.season_id = s.season_id AND lp.match_id = s.match_id AND lp.player_id = s.player_id;
GRANT SELECT ON api.player_match_log TO vega_read;

DROP VIEW api.player_season;
CREATE VIEW api.player_season AS
 SELECT s.player_id,
    s.team_id,
    s.competition_season_id,
    s.season_id,
    s.appearances,
    s.starts,
    s.minutes,
    s.goals_sum,
    s.goals_n,
    s.goals_min,
    s.assists_sum,
    s.assists_n,
    s.assists_min,
    s.own_goals_sum,
    s.own_goals_n,
    s.own_goals_min,
    s.total_shots_sum,
    s.total_shots_n,
    s.total_shots_min,
    s.shots_on_target_sum,
    s.shots_on_target_n,
    s.shots_on_target_min,
    s.shots_off_target_sum,
    s.shots_off_target_n,
    s.shots_off_target_min,
    s.blocked_shots_sum,
    s.blocked_shots_n,
    s.blocked_shots_min,
    s.shots_woodwork_sum,
    s.shots_woodwork_n,
    s.shots_woodwork_min,
    s.big_chances_created_sum,
    s.big_chances_created_n,
    s.big_chances_created_min,
    s.big_chances_missed_sum,
    s.big_chances_missed_n,
    s.big_chances_missed_min,
    s.penalties_won_sum,
    s.penalties_won_n,
    s.penalties_won_min,
    s.penalties_missed_sum,
    s.penalties_missed_n,
    s.penalties_missed_min,
    s.accurate_passes_sum,
    s.accurate_passes_n,
    s.accurate_passes_min,
    s.accurate_passes_total_sum,
    s.accurate_passes_total_n,
    s.accurate_passes_total_min,
    s.passes_into_final_third_sum,
    s.passes_into_final_third_n,
    s.passes_into_final_third_min,
    s.chances_created_sum,
    s.chances_created_n,
    s.chances_created_min,
    s.crosses_sum,
    s.crosses_n,
    s.crosses_min,
    s.accurate_crosses_sum,
    s.accurate_crosses_n,
    s.accurate_crosses_min,
    s.accurate_crosses_total_sum,
    s.accurate_crosses_total_n,
    s.accurate_crosses_total_min,
    s.long_balls_accurate_sum,
    s.long_balls_accurate_n,
    s.long_balls_accurate_min,
    s.long_balls_total_sum,
    s.long_balls_total_n,
    s.long_balls_total_min,
    s.line_breaking_passes_sum,
    s.line_breaking_passes_n,
    s.line_breaking_passes_min,
    s.corners_sum,
    s.corners_n,
    s.corners_min,
    s.throw_ins_sum,
    s.throw_ins_n,
    s.throw_ins_min,
    s.touches_sum,
    s.touches_n,
    s.touches_min,
    s.touches_opp_box_sum,
    s.touches_opp_box_n,
    s.touches_opp_box_min,
    s.dribbles_succeeded_sum,
    s.dribbles_succeeded_n,
    s.dribbles_succeeded_min,
    s.dribbles_total_sum,
    s.dribbles_total_n,
    s.dribbles_total_min,
    s.dispossessed_sum,
    s.dispossessed_n,
    s.dispossessed_min,
    s.offsides_sum,
    s.offsides_n,
    s.offsides_min,
    s.was_fouled_sum,
    s.was_fouled_n,
    s.was_fouled_min,
    s.tackles_sum,
    s.tackles_n,
    s.tackles_min,
    s.last_man_tackles_sum,
    s.last_man_tackles_n,
    s.last_man_tackles_min,
    s.interceptions_sum,
    s.interceptions_n,
    s.interceptions_min,
    s.clearances_sum,
    s.clearances_n,
    s.clearances_min,
    s.headed_clearances_sum,
    s.headed_clearances_n,
    s.headed_clearances_min,
    s.clearances_off_line_sum,
    s.clearances_off_line_n,
    s.clearances_off_line_min,
    s.shot_blocks_sum,
    s.shot_blocks_n,
    s.shot_blocks_min,
    s.recoveries_sum,
    s.recoveries_n,
    s.recoveries_min,
    s.defensive_actions_sum,
    s.defensive_actions_n,
    s.defensive_actions_min,
    s.dribbled_past_sum,
    s.dribbled_past_n,
    s.dribbled_past_min,
    s.errors_led_to_goal_sum,
    s.errors_led_to_goal_n,
    s.errors_led_to_goal_min,
    s.penalties_conceded_sum,
    s.penalties_conceded_n,
    s.penalties_conceded_min,
    s.fouls_sum,
    s.fouls_n,
    s.fouls_min,
    s.duels_won_sum,
    s.duels_won_n,
    s.duels_won_min,
    s.duels_lost_sum,
    s.duels_lost_n,
    s.duels_lost_min,
    s.ground_duels_won_sum,
    s.ground_duels_won_n,
    s.ground_duels_won_min,
    s.ground_duels_total_sum,
    s.ground_duels_total_n,
    s.ground_duels_total_min,
    s.aerials_won_sum,
    s.aerials_won_n,
    s.aerials_won_min,
    s.aerials_total_sum,
    s.aerials_total_n,
    s.aerials_total_min,
    s.saves_sum,
    s.saves_n,
    s.saves_min,
    s.saves_inside_box_sum,
    s.saves_inside_box_n,
    s.saves_inside_box_min,
    s.diving_saves_sum,
    s.diving_saves_n,
    s.diving_saves_min,
    s.high_claims_sum,
    s.high_claims_n,
    s.high_claims_min,
    s.punches_sum,
    s.punches_n,
    s.punches_min,
    s.sweeper_actions_sum,
    s.sweeper_actions_n,
    s.sweeper_actions_min,
    s.goals_conceded_sum,
    s.goals_conceded_n,
    s.goals_conceded_min,
    s.penalties_saved_sum,
    s.penalties_saved_n,
    s.penalties_saved_min,
    s.shootout_penalties_saved_sum,
    s.shootout_penalties_saved_n,
    s.shootout_penalties_saved_min,
    s.sprints_sum,
    s.sprints_n,
    s.sprints_min,
    s.fantasy_points_sum,
    s.fantasy_points_n,
    s.fantasy_points_min,
    s.xg_sum,
    s.xg_n,
    s.xg_min,
    s.npxg_sum,
    s.npxg_n,
    s.npxg_min,
    s.xgot_sum,
    s.xgot_n,
    s.xgot_min,
    s.xa_sum,
    s.xa_n,
    s.xa_min,
    s.goals_prevented_sum,
    s.goals_prevented_n,
    s.goals_prevented_min,
    s.xgot_faced_sum,
    s.xgot_faced_n,
    s.xgot_faced_min,
    s.distance_m_sum,
    s.distance_m_n,
    s.distance_m_min,
    s.running_m_sum,
    s.running_m_n,
    s.running_m_min,
    s.sprinting_m_sum,
    s.sprinting_m_n,
    s.sprinting_m_min,
    s.top_speed_kmh_max,
    s.top_speed_kmh_n,
    s.top_speed_kmh_min,
    s.adv_actions_sum,
    s.adv_actions_n,
    s.adv_actions_min,
    s.adv_passes_sum,
    s.adv_passes_n,
    s.adv_passes_min,
    s.adv_progressive_passes_sum,
    s.adv_progressive_passes_n,
    s.adv_progressive_passes_min,
    s.adv_passes_into_box_sum,
    s.adv_passes_into_box_n,
    s.adv_passes_into_box_min,
    s.adv_key_passes_sum,
    s.adv_key_passes_n,
    s.adv_key_passes_min,
    s.adv_assists_sum,
    s.adv_assists_n,
    s.adv_assists_min,
    s.adv_through_balls_sum,
    s.adv_through_balls_n,
    s.adv_through_balls_min,
    s.adv_crosses_sum,
    s.adv_crosses_n,
    s.adv_crosses_min,
    s.adv_switches_sum,
    s.adv_switches_n,
    s.adv_switches_min,
    s.adv_carries_sum,
    s.adv_carries_n,
    s.adv_carries_min,
    s.adv_progressive_carries_sum,
    s.adv_progressive_carries_n,
    s.adv_progressive_carries_min,
    s.adv_carries_into_final_third_sum,
    s.adv_carries_into_final_third_n,
    s.adv_carries_into_final_third_min,
    s.adv_carries_into_box_sum,
    s.adv_carries_into_box_n,
    s.adv_carries_into_box_min,
    s.adv_take_ons_sum,
    s.adv_take_ons_n,
    s.adv_take_ons_min,
    s.adv_take_ons_won_sum,
    s.adv_take_ons_won_n,
    s.adv_take_ons_won_min,
    s.adv_miscontrols_sum,
    s.adv_miscontrols_n,
    s.adv_miscontrols_min,
    s.adv_dispossessed_sum,
    s.adv_dispossessed_n,
    s.adv_dispossessed_min,
    s.adv_sca_sum,
    s.adv_sca_n,
    s.adv_sca_min,
    s.adv_gca_sum,
    s.adv_gca_n,
    s.adv_gca_min,
    s.adv_second_assists_sum,
    s.adv_second_assists_n,
    s.adv_second_assists_min,
    s.adv_sca_pass_live_sum,
    s.adv_sca_pass_live_n,
    s.adv_sca_pass_live_min,
    s.adv_sca_pass_dead_sum,
    s.adv_sca_pass_dead_n,
    s.adv_sca_pass_dead_min,
    s.adv_sca_take_on_sum,
    s.adv_sca_take_on_n,
    s.adv_sca_take_on_min,
    s.adv_sca_shot_sum,
    s.adv_sca_shot_n,
    s.adv_sca_shot_min,
    s.adv_sca_defensive_sum,
    s.adv_sca_defensive_n,
    s.adv_sca_defensive_min,
    s.adv_tackles_sum,
    s.adv_tackles_n,
    s.adv_tackles_min,
    s.adv_interceptions_sum,
    s.adv_interceptions_n,
    s.adv_interceptions_min,
    s.adv_blocks_sum,
    s.adv_blocks_n,
    s.adv_blocks_min,
    s.adv_clearances_sum,
    s.adv_clearances_n,
    s.adv_clearances_min,
    s.adv_duels_won_sum,
    s.adv_duels_won_n,
    s.adv_duels_won_min,
    s.adv_aerials_sum,
    s.adv_aerials_n,
    s.adv_aerials_min,
    s.adv_aerials_won_sum,
    s.adv_aerials_won_n,
    s.adv_aerials_won_min,
    s.adv_claims_sum,
    s.adv_claims_n,
    s.adv_claims_min,
    s.adv_claims_won_sum,
    s.adv_claims_won_n,
    s.adv_claims_won_min,
    s.adv_sweeper_actions_sum,
    s.adv_sweeper_actions_n,
    s.adv_sweeper_actions_min,
    s.adv_distributions_sum,
    s.adv_distributions_n,
    s.adv_distributions_min,
    s.adv_launches_sum,
    s.adv_launches_n,
    s.adv_launches_min,
    s.adv_xt_total_sum,
    s.adv_xt_total_n,
    s.adv_xt_total_min,
    s.adv_vaep_total_sum,
    s.adv_vaep_total_n,
    s.adv_vaep_total_min,
    s.adv_vaep_offensive_sum,
    s.adv_vaep_offensive_n,
    s.adv_vaep_offensive_min,
    s.adv_vaep_defensive_sum,
    s.adv_vaep_defensive_n,
    s.adv_vaep_defensive_min,
    s.adv_pv_total_sum,
    s.adv_pv_total_n,
    s.adv_pv_total_min,
    s.adv_pv_offensive_sum,
    s.adv_pv_offensive_n,
    s.adv_pv_offensive_min,
    s.adv_pv_defensive_sum,
    s.adv_pv_defensive_n,
    s.adv_pv_defensive_min,
    s.adv_pass_accuracy_wsum,
    s.adv_pass_accuracy_w,
    s.adv_pass_accuracy_n,
    s.adv_pass_accuracy_min,
    s.adv_progressive_pass_distance_sum,
    s.adv_progressive_pass_distance_n,
    s.adv_progressive_pass_distance_min,
    s.adv_carry_distance_sum,
    s.adv_carry_distance_n,
    s.adv_carry_distance_min,
    s.adv_progressive_carry_distance_sum,
    s.adv_progressive_carry_distance_n,
    s.adv_progressive_carry_distance_min,
    s.adv_xag_sum,
    s.adv_xag_n,
    s.adv_xag_min,
    s.adv_xg_chain_sum,
    s.adv_xg_chain_n,
    s.adv_xg_chain_min,
    s.adv_xg_buildup_sum,
    s.adv_xg_buildup_n,
    s.adv_xg_buildup_min,
    s.adv_claim_rate_wsum,
    s.adv_claim_rate_w,
    s.adv_claim_rate_n,
    s.adv_claim_rate_min,
    s.adv_launch_pct_wsum,
    s.adv_launch_pct_w,
    s.adv_launch_pct_n,
    s.adv_launch_pct_min,
    s.adv_avg_pass_length_wsum,
    s.adv_avg_pass_length_w,
    s.adv_avg_pass_length_n,
    s.adv_avg_pass_length_min,
    s.adv_distribution_accuracy_wsum,
    s.adv_distribution_accuracy_w,
    s.adv_distribution_accuracy_n,
    s.adv_distribution_accuracy_min,
    s.pass_completion_num,
    s.pass_completion_den,
    s.pass_completion_n,
    s.cross_completion_num,
    s.cross_completion_den,
    s.cross_completion_n,
    s.long_ball_completion_num,
    s.long_ball_completion_den,
    s.long_ball_completion_n,
    s.dribble_success_num,
    s.dribble_success_den,
    s.dribble_success_n,
    s.ground_duel_success_num,
    s.ground_duel_success_den,
    s.ground_duel_success_n,
    s.aerial_success_num,
    s.aerial_success_den,
    s.aerial_success_n,
    s.duel_success_num,
    s.duel_success_den,
    s.duel_success_n,
    s.shot_accuracy_num,
    s.shot_accuracy_den,
    s.shot_accuracy_n,
    s.adv_take_on_success_num,
    s.adv_take_on_success_den,
    s.adv_take_on_success_n,
    s.adv_aerial_success_num,
    s.adv_aerial_success_den,
    s.adv_aerial_success_n,
    s.adv_claim_success_num,
    s.adv_claim_success_den,
    s.adv_claim_success_n,
    s.adv_launch_share_num,
    s.adv_launch_share_den,
    s.adv_launch_share_n,
    s.updated_at,
    api.public_id('player'::core.entity_type, s.player_id) AS player_public_id,
    p.name AS player_name,
    core.age_on(p.birth_date, CURRENT_DATE) AS age,
    core.per90(s.goals_sum::double precision, s.goals_min::double precision) AS goals_p90,
    core.per90(s.assists_sum::double precision, s.assists_min::double precision) AS assists_p90,
    core.per90(s.own_goals_sum::double precision, s.own_goals_min::double precision) AS own_goals_p90,
    core.per90(s.total_shots_sum::double precision, s.total_shots_min::double precision) AS total_shots_p90,
    core.per90(s.shots_on_target_sum::double precision, s.shots_on_target_min::double precision) AS shots_on_target_p90,
    core.per90(s.shots_off_target_sum::double precision, s.shots_off_target_min::double precision) AS shots_off_target_p90,
    core.per90(s.blocked_shots_sum::double precision, s.blocked_shots_min::double precision) AS blocked_shots_p90,
    core.per90(s.shots_woodwork_sum::double precision, s.shots_woodwork_min::double precision) AS shots_woodwork_p90,
    core.per90(s.big_chances_created_sum::double precision, s.big_chances_created_min::double precision) AS big_chances_created_p90,
    core.per90(s.big_chances_missed_sum::double precision, s.big_chances_missed_min::double precision) AS big_chances_missed_p90,
    core.per90(s.penalties_won_sum::double precision, s.penalties_won_min::double precision) AS penalties_won_p90,
    core.per90(s.penalties_missed_sum::double precision, s.penalties_missed_min::double precision) AS penalties_missed_p90,
    core.per90(s.accurate_passes_sum::double precision, s.accurate_passes_min::double precision) AS accurate_passes_p90,
    core.per90(s.accurate_passes_total_sum::double precision, s.accurate_passes_total_min::double precision) AS accurate_passes_total_p90,
    core.per90(s.passes_into_final_third_sum::double precision, s.passes_into_final_third_min::double precision) AS passes_into_final_third_p90,
    core.per90(s.chances_created_sum::double precision, s.chances_created_min::double precision) AS chances_created_p90,
    core.per90(s.crosses_sum::double precision, s.crosses_min::double precision) AS crosses_p90,
    core.per90(s.accurate_crosses_sum::double precision, s.accurate_crosses_min::double precision) AS accurate_crosses_p90,
    core.per90(s.accurate_crosses_total_sum::double precision, s.accurate_crosses_total_min::double precision) AS accurate_crosses_total_p90,
    core.per90(s.long_balls_accurate_sum::double precision, s.long_balls_accurate_min::double precision) AS long_balls_accurate_p90,
    core.per90(s.long_balls_total_sum::double precision, s.long_balls_total_min::double precision) AS long_balls_total_p90,
    core.per90(s.line_breaking_passes_sum::double precision, s.line_breaking_passes_min::double precision) AS line_breaking_passes_p90,
    core.per90(s.corners_sum::double precision, s.corners_min::double precision) AS corners_p90,
    core.per90(s.throw_ins_sum::double precision, s.throw_ins_min::double precision) AS throw_ins_p90,
    core.per90(s.touches_sum::double precision, s.touches_min::double precision) AS touches_p90,
    core.per90(s.touches_opp_box_sum::double precision, s.touches_opp_box_min::double precision) AS touches_opp_box_p90,
    core.per90(s.dribbles_succeeded_sum::double precision, s.dribbles_succeeded_min::double precision) AS dribbles_succeeded_p90,
    core.per90(s.dribbles_total_sum::double precision, s.dribbles_total_min::double precision) AS dribbles_total_p90,
    core.per90(s.dispossessed_sum::double precision, s.dispossessed_min::double precision) AS dispossessed_p90,
    core.per90(s.offsides_sum::double precision, s.offsides_min::double precision) AS offsides_p90,
    core.per90(s.was_fouled_sum::double precision, s.was_fouled_min::double precision) AS was_fouled_p90,
    core.per90(s.tackles_sum::double precision, s.tackles_min::double precision) AS tackles_p90,
    core.per90(s.last_man_tackles_sum::double precision, s.last_man_tackles_min::double precision) AS last_man_tackles_p90,
    core.per90(s.interceptions_sum::double precision, s.interceptions_min::double precision) AS interceptions_p90,
    core.per90(s.clearances_sum::double precision, s.clearances_min::double precision) AS clearances_p90,
    core.per90(s.headed_clearances_sum::double precision, s.headed_clearances_min::double precision) AS headed_clearances_p90,
    core.per90(s.clearances_off_line_sum::double precision, s.clearances_off_line_min::double precision) AS clearances_off_line_p90,
    core.per90(s.shot_blocks_sum::double precision, s.shot_blocks_min::double precision) AS shot_blocks_p90,
    core.per90(s.recoveries_sum::double precision, s.recoveries_min::double precision) AS recoveries_p90,
    core.per90(s.defensive_actions_sum::double precision, s.defensive_actions_min::double precision) AS defensive_actions_p90,
    core.per90(s.dribbled_past_sum::double precision, s.dribbled_past_min::double precision) AS dribbled_past_p90,
    core.per90(s.errors_led_to_goal_sum::double precision, s.errors_led_to_goal_min::double precision) AS errors_led_to_goal_p90,
    core.per90(s.penalties_conceded_sum::double precision, s.penalties_conceded_min::double precision) AS penalties_conceded_p90,
    core.per90(s.fouls_sum::double precision, s.fouls_min::double precision) AS fouls_p90,
    core.per90(s.duels_won_sum::double precision, s.duels_won_min::double precision) AS duels_won_p90,
    core.per90(s.duels_lost_sum::double precision, s.duels_lost_min::double precision) AS duels_lost_p90,
    core.per90(s.ground_duels_won_sum::double precision, s.ground_duels_won_min::double precision) AS ground_duels_won_p90,
    core.per90(s.ground_duels_total_sum::double precision, s.ground_duels_total_min::double precision) AS ground_duels_total_p90,
    core.per90(s.aerials_won_sum::double precision, s.aerials_won_min::double precision) AS aerials_won_p90,
    core.per90(s.aerials_total_sum::double precision, s.aerials_total_min::double precision) AS aerials_total_p90,
    core.per90(s.saves_sum::double precision, s.saves_min::double precision) AS saves_p90,
    core.per90(s.saves_inside_box_sum::double precision, s.saves_inside_box_min::double precision) AS saves_inside_box_p90,
    core.per90(s.diving_saves_sum::double precision, s.diving_saves_min::double precision) AS diving_saves_p90,
    core.per90(s.high_claims_sum::double precision, s.high_claims_min::double precision) AS high_claims_p90,
    core.per90(s.punches_sum::double precision, s.punches_min::double precision) AS punches_p90,
    core.per90(s.sweeper_actions_sum::double precision, s.sweeper_actions_min::double precision) AS sweeper_actions_p90,
    core.per90(s.goals_conceded_sum::double precision, s.goals_conceded_min::double precision) AS goals_conceded_p90,
    core.per90(s.penalties_saved_sum::double precision, s.penalties_saved_min::double precision) AS penalties_saved_p90,
    core.per90(s.shootout_penalties_saved_sum::double precision, s.shootout_penalties_saved_min::double precision) AS shootout_penalties_saved_p90,
    core.per90(s.sprints_sum::double precision, s.sprints_min::double precision) AS sprints_p90,
    core.per90(s.fantasy_points_sum::double precision, s.fantasy_points_min::double precision) AS fantasy_points_p90,
    core.per90(s.xg_sum::double precision, s.xg_min::double precision) AS xg_p90,
    core.per90(s.npxg_sum::double precision, s.npxg_min::double precision) AS npxg_p90,
    core.per90(s.xgot_sum::double precision, s.xgot_min::double precision) AS xgot_p90,
    core.per90(s.xa_sum::double precision, s.xa_min::double precision) AS xa_p90,
    core.per90(s.goals_prevented_sum::double precision, s.goals_prevented_min::double precision) AS goals_prevented_p90,
    core.per90(s.xgot_faced_sum::double precision, s.xgot_faced_min::double precision) AS xgot_faced_p90,
    core.per90(s.distance_m_sum::double precision, s.distance_m_min::double precision) AS distance_m_p90,
    core.per90(s.running_m_sum::double precision, s.running_m_min::double precision) AS running_m_p90,
    core.per90(s.sprinting_m_sum::double precision, s.sprinting_m_min::double precision) AS sprinting_m_p90,
    core.per90(s.adv_actions_sum::double precision, s.adv_actions_min::double precision) AS adv_actions_p90,
    core.per90(s.adv_passes_sum::double precision, s.adv_passes_min::double precision) AS adv_passes_p90,
    core.per90(s.adv_progressive_passes_sum::double precision, s.adv_progressive_passes_min::double precision) AS adv_progressive_passes_p90,
    core.per90(s.adv_passes_into_box_sum::double precision, s.adv_passes_into_box_min::double precision) AS adv_passes_into_box_p90,
    core.per90(s.adv_key_passes_sum::double precision, s.adv_key_passes_min::double precision) AS adv_key_passes_p90,
    core.per90(s.adv_assists_sum::double precision, s.adv_assists_min::double precision) AS adv_assists_p90,
    core.per90(s.adv_through_balls_sum::double precision, s.adv_through_balls_min::double precision) AS adv_through_balls_p90,
    core.per90(s.adv_crosses_sum::double precision, s.adv_crosses_min::double precision) AS adv_crosses_p90,
    core.per90(s.adv_switches_sum::double precision, s.adv_switches_min::double precision) AS adv_switches_p90,
    core.per90(s.adv_carries_sum::double precision, s.adv_carries_min::double precision) AS adv_carries_p90,
    core.per90(s.adv_progressive_carries_sum::double precision, s.adv_progressive_carries_min::double precision) AS adv_progressive_carries_p90,
    core.per90(s.adv_carries_into_final_third_sum::double precision, s.adv_carries_into_final_third_min::double precision) AS adv_carries_into_final_third_p90,
    core.per90(s.adv_carries_into_box_sum::double precision, s.adv_carries_into_box_min::double precision) AS adv_carries_into_box_p90,
    core.per90(s.adv_take_ons_sum::double precision, s.adv_take_ons_min::double precision) AS adv_take_ons_p90,
    core.per90(s.adv_take_ons_won_sum::double precision, s.adv_take_ons_won_min::double precision) AS adv_take_ons_won_p90,
    core.per90(s.adv_miscontrols_sum::double precision, s.adv_miscontrols_min::double precision) AS adv_miscontrols_p90,
    core.per90(s.adv_dispossessed_sum::double precision, s.adv_dispossessed_min::double precision) AS adv_dispossessed_p90,
    core.per90(s.adv_sca_sum::double precision, s.adv_sca_min::double precision) AS adv_sca_p90,
    core.per90(s.adv_gca_sum::double precision, s.adv_gca_min::double precision) AS adv_gca_p90,
    core.per90(s.adv_second_assists_sum::double precision, s.adv_second_assists_min::double precision) AS adv_second_assists_p90,
    core.per90(s.adv_sca_pass_live_sum::double precision, s.adv_sca_pass_live_min::double precision) AS adv_sca_pass_live_p90,
    core.per90(s.adv_sca_pass_dead_sum::double precision, s.adv_sca_pass_dead_min::double precision) AS adv_sca_pass_dead_p90,
    core.per90(s.adv_sca_take_on_sum::double precision, s.adv_sca_take_on_min::double precision) AS adv_sca_take_on_p90,
    core.per90(s.adv_sca_shot_sum::double precision, s.adv_sca_shot_min::double precision) AS adv_sca_shot_p90,
    core.per90(s.adv_sca_defensive_sum::double precision, s.adv_sca_defensive_min::double precision) AS adv_sca_defensive_p90,
    core.per90(s.adv_tackles_sum::double precision, s.adv_tackles_min::double precision) AS adv_tackles_p90,
    core.per90(s.adv_interceptions_sum::double precision, s.adv_interceptions_min::double precision) AS adv_interceptions_p90,
    core.per90(s.adv_blocks_sum::double precision, s.adv_blocks_min::double precision) AS adv_blocks_p90,
    core.per90(s.adv_clearances_sum::double precision, s.adv_clearances_min::double precision) AS adv_clearances_p90,
    core.per90(s.adv_duels_won_sum::double precision, s.adv_duels_won_min::double precision) AS adv_duels_won_p90,
    core.per90(s.adv_aerials_sum::double precision, s.adv_aerials_min::double precision) AS adv_aerials_p90,
    core.per90(s.adv_aerials_won_sum::double precision, s.adv_aerials_won_min::double precision) AS adv_aerials_won_p90,
    core.per90(s.adv_claims_sum::double precision, s.adv_claims_min::double precision) AS adv_claims_p90,
    core.per90(s.adv_claims_won_sum::double precision, s.adv_claims_won_min::double precision) AS adv_claims_won_p90,
    core.per90(s.adv_sweeper_actions_sum::double precision, s.adv_sweeper_actions_min::double precision) AS adv_sweeper_actions_p90,
    core.per90(s.adv_distributions_sum::double precision, s.adv_distributions_min::double precision) AS adv_distributions_p90,
    core.per90(s.adv_launches_sum::double precision, s.adv_launches_min::double precision) AS adv_launches_p90,
    core.per90(s.adv_xt_total_sum::double precision, s.adv_xt_total_min::double precision) AS adv_xt_total_p90,
    core.per90(s.adv_vaep_total_sum::double precision, s.adv_vaep_total_min::double precision) AS adv_vaep_total_p90,
    core.per90(s.adv_vaep_offensive_sum::double precision, s.adv_vaep_offensive_min::double precision) AS adv_vaep_offensive_p90,
    core.per90(s.adv_vaep_defensive_sum::double precision, s.adv_vaep_defensive_min::double precision) AS adv_vaep_defensive_p90,
    core.per90(s.adv_pv_total_sum::double precision, s.adv_pv_total_min::double precision) AS adv_pv_total_p90,
    core.per90(s.adv_pv_offensive_sum::double precision, s.adv_pv_offensive_min::double precision) AS adv_pv_offensive_p90,
    core.per90(s.adv_pv_defensive_sum::double precision, s.adv_pv_defensive_min::double precision) AS adv_pv_defensive_p90,
    s.adv_pass_accuracy_wsum / NULLIF(s.adv_pass_accuracy_w, 0::double precision) AS adv_pass_accuracy_avg,
    core.per90(s.adv_progressive_pass_distance_sum::double precision, s.adv_progressive_pass_distance_min::double precision) AS adv_progressive_pass_distance_p90,
    core.per90(s.adv_carry_distance_sum::double precision, s.adv_carry_distance_min::double precision) AS adv_carry_distance_p90,
    core.per90(s.adv_progressive_carry_distance_sum::double precision, s.adv_progressive_carry_distance_min::double precision) AS adv_progressive_carry_distance_p90,
    core.per90(s.adv_xag_sum::double precision, s.adv_xag_min::double precision) AS adv_xag_p90,
    core.per90(s.adv_xg_chain_sum::double precision, s.adv_xg_chain_min::double precision) AS adv_xg_chain_p90,
    core.per90(s.adv_xg_buildup_sum::double precision, s.adv_xg_buildup_min::double precision) AS adv_xg_buildup_p90,
    s.adv_claim_rate_wsum / NULLIF(s.adv_claim_rate_w, 0::double precision) AS adv_claim_rate_avg,
    s.adv_launch_pct_wsum / NULLIF(s.adv_launch_pct_w, 0::double precision) AS adv_launch_pct_avg,
    s.adv_avg_pass_length_wsum / NULLIF(s.adv_avg_pass_length_w, 0::double precision) AS adv_avg_pass_length_avg,
    s.adv_distribution_accuracy_wsum / NULLIF(s.adv_distribution_accuracy_w, 0::double precision) AS adv_distribution_accuracy_avg,
    core.pct(s.pass_completion_num::double precision, s.pass_completion_den::double precision) AS pass_completion_pct,
    core.pct(s.cross_completion_num::double precision, s.cross_completion_den::double precision) AS cross_completion_pct,
    core.pct(s.long_ball_completion_num::double precision, s.long_ball_completion_den::double precision) AS long_ball_completion_pct,
    core.pct(s.dribble_success_num::double precision, s.dribble_success_den::double precision) AS dribble_success_pct,
    core.pct(s.ground_duel_success_num::double precision, s.ground_duel_success_den::double precision) AS ground_duel_success_pct,
    core.pct(s.aerial_success_num::double precision, s.aerial_success_den::double precision) AS aerial_success_pct,
    core.pct(s.duel_success_num::double precision, s.duel_success_den::double precision) AS duel_success_pct,
    core.pct(s.shot_accuracy_num::double precision, s.shot_accuracy_den::double precision) AS shot_accuracy_pct,
    core.pct(s.adv_take_on_success_num::double precision, s.adv_take_on_success_den::double precision) AS adv_take_on_success_pct,
    core.pct(s.adv_aerial_success_num::double precision, s.adv_aerial_success_den::double precision) AS adv_aerial_success_pct,
    core.pct(s.adv_claim_success_num::double precision, s.adv_claim_success_den::double precision) AS adv_claim_success_pct,
    core.pct(s.adv_launch_share_num::double precision, s.adv_launch_share_den::double precision) AS adv_launch_share_pct
   FROM agg.player_season_stats s
     JOIN core.players p ON p.id = s.player_id;
GRANT SELECT ON api.player_season TO vega_read;

DROP VIEW api.team_squad;
CREATE VIEW api.team_squad AS
 SELECT s.team_id,
    s.competition_season_id,
    s.season_id,
    s.player_id,
    api.public_id('player'::core.entity_type, s.player_id) AS player_public_id,
    p.name,
    core.age_on(p.birth_date, CURRENT_DATE) AS age,
    s.appearances,
    s.starts,
    s.minutes,
    core.pct(s.minutes::double precision, (90 * t.matches)::double precision) AS minutes_share_pct,
    s.goals_sum AS goals,
    s.assists_sum AS assists,
    s.xg_sum AS xg,
    s.xa_sum AS xa
   FROM agg.player_season_stats s
     JOIN core.players p ON p.id = s.player_id
     LEFT JOIN agg.team_season_stats t ON t.team_id = s.team_id AND t.competition_season_id = s.competition_season_id;
GRANT SELECT ON api.team_squad TO vega_read;

ALTER TABLE core.player_match_stats DROP COLUMN rating;
ALTER TABLE agg.player_season_stats DROP COLUMN rating_sum, DROP COLUMN rating_minutes, DROP COLUMN rating_n, DROP COLUMN rating_min;
ALTER TABLE agg.player_list_editions DROP COLUMN rating_sum, DROP COLUMN rating_count;
DELETE FROM agg.metric_definitions WHERE entity_type = 'player' AND key = 'rating';
