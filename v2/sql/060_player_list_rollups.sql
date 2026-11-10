-- The player list (GET /api/read/players), precomputed per edition and player.
--
-- The list of a season ranks every player on his totals over the season. Read from the
-- appearances (api.player_appearances), the whole season is aggregated on every request:
-- on 10 November 2026 the 2026/2027 list took 75 s for 131,500 appearances and timed out
-- at 8 s, with a tenth of the season collected; a full season holds about a million. The
-- doc allows the precomputation ("Ce qui change en v2": a block that stays slow is
-- precomputed in a typed agg table).
--
-- Three tables, written together per edition by agg.refresh_player_list:
--  - agg.player_list_editions: one row per edition and player who has a statistics row
--    or a line-up row in it: his played matches (minutes > 0), minutes, starts, rating
--    and, per list metric, the sum over the played matches that give it, how many do and
--    their minutes; the matches whose minutes are unknown (a line-up row of a match
--    whose player statistics are not collected); his most recent row (identity) and his
--    most recent played row (latest);
--  - agg.player_list_teams: the clubs he played for in the edition;
--  - agg.player_list_positions: his minutes per position played.
-- first_order is the rank of the first such match among his rows of the edition (date,
-- kick-off, match): the list orders a player's clubs and settles his main role with it.
--
-- The rows hold the definitions of api.player_appearances (039), read from core: the
-- calculator has no access to the api schema. A sum of whole numbers is an integer, a
-- sum of real statistics a double precision that keeps only finite values, as the list
-- does. The route reads these tables when no appearance filter is asked (no match,
-- period, role, venue or result), which is every list of the site by default; a filtered
-- list still reads the appearances.
--
-- The calculator refreshes an edition's rows with its aggregates, in the same
-- transaction (refresh_competition_season), and the daily pass recounts the season's
-- editions (refresh_daily), so one missed refresh never outlives the day.
CREATE TABLE agg.player_list_editions(
  competition_season_id integer NOT NULL REFERENCES core.competition_seasons ON DELETE CASCADE,
  player_id integer NOT NULL REFERENCES core.players,
  season_id smallint NOT NULL,
  matches integer NOT NULL, total_minutes integer NOT NULL, unknown_matches integer NOT NULL, starts integer NOT NULL,
  known_starts integer NOT NULL, rating_sum double precision, rating_count integer NOT NULL,
  identity_match_id integer NOT NULL, identity_date date, identity_kickoff timestamptz, identity_team_id integer,
  identity_position smallint, latest_match_id integer, latest_date date, latest_kickoff timestamptz,
  latest_team_id integer, latest_position smallint,
  goals_sum integer, goals_count integer NOT NULL, goals_minutes integer,
  assists_sum integer, assists_count integer NOT NULL, assists_minutes integer,
  xg_sum double precision, xg_count integer NOT NULL, xg_minutes integer,
  npxg_sum double precision, npxg_count integer NOT NULL, npxg_minutes integer,
  xgot_sum double precision, xgot_count integer NOT NULL, xgot_minutes integer,
  xa_sum double precision, xa_count integer NOT NULL, xa_minutes integer,
  shots_sum integer, shots_count integer NOT NULL, shots_minutes integer,
  shots_on_target_sum integer, shots_on_target_count integer NOT NULL, shots_on_target_minutes integer,
  touches_box_sum integer, touches_box_count integer NOT NULL, touches_box_minutes integer,
  chances_created_sum integer, chances_created_count integer NOT NULL, chances_created_minutes integer,
  big_chances_created_sum integer, big_chances_created_count integer NOT NULL, big_chances_created_minutes integer,
  passes_final_third_sum integer, passes_final_third_count integer NOT NULL, passes_final_third_minutes integer,
  dribbles_sum integer, dribbles_count integer NOT NULL, dribbles_minutes integer,
  touches_sum integer, touches_count integer NOT NULL, touches_minutes integer,
  passes_accurate_sum integer, passes_accurate_count integer NOT NULL, passes_accurate_minutes integer,
  passes_attempted_sum integer, passes_attempted_count integer NOT NULL, passes_attempted_minutes integer,
  duels_won_sum integer, duels_won_count integer NOT NULL, duels_won_minutes integer,
  duels_lost_sum integer, duels_lost_count integer NOT NULL, duels_lost_minutes integer,
  tackles_sum integer, tackles_count integer NOT NULL, tackles_minutes integer,
  interceptions_sum integer, interceptions_count integer NOT NULL, interceptions_minutes integer,
  recoveries_sum integer, recoveries_count integer NOT NULL, recoveries_minutes integer,
  clearances_sum integer, clearances_count integer NOT NULL, clearances_minutes integer,
  defensive_actions_sum integer, defensive_actions_count integer NOT NULL, defensive_actions_minutes integer,
  blocks_sum integer, blocks_count integer NOT NULL, blocks_minutes integer,
  saves_sum integer, saves_count integer NOT NULL, saves_minutes integer,
  goals_prevented_sum double precision, goals_prevented_count integer NOT NULL, goals_prevented_minutes integer,
  pass_accuracy_numerator integer, pass_accuracy_denominator integer, pass_accuracy_count integer NOT NULL, pass_accuracy_minutes integer,
  duel_rate_numerator integer, duel_rate_denominator integer, duel_rate_count integer NOT NULL, duel_rate_minutes integer,
  PRIMARY KEY (competition_season_id, player_id)
);
-- The page's players are read by season and player.
CREATE INDEX player_list_editions_season_player ON agg.player_list_editions(season_id, player_id);

-- A club that is merged into another is deleted (identity.merge_teams): its rows go with
-- it and the next refresh writes the club that keeps its matches.
CREATE TABLE agg.player_list_teams(
  competition_season_id integer NOT NULL REFERENCES core.competition_seasons ON DELETE CASCADE,
  player_id integer NOT NULL REFERENCES core.players,
  team_id integer NOT NULL REFERENCES core.teams ON DELETE CASCADE,
  season_id smallint NOT NULL,
  first_order integer NOT NULL,
  PRIMARY KEY (competition_season_id, player_id, team_id)
);
CREATE INDEX player_list_teams_season_player ON agg.player_list_teams(season_id, player_id);

CREATE TABLE agg.player_list_positions(
  competition_season_id integer NOT NULL REFERENCES core.competition_seasons ON DELETE CASCADE,
  player_id integer NOT NULL REFERENCES core.players,
  position_number smallint NOT NULL,
  season_id smallint NOT NULL,
  minutes integer NOT NULL,
  first_order integer NOT NULL,
  PRIMARY KEY (competition_season_id, player_id, position_number)
);
CREATE INDEX player_list_positions_season_player ON agg.player_list_positions(season_id, player_id);

-- Rewrites only the rows of the edition that changed; returns how many.
CREATE FUNCTION agg.refresh_player_list(edition_id integer) RETURNS integer
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
        s.goals, s.assists, nullif(nullif(nullif(s.xg::numeric::float8, 'NaN'), 'Infinity'), '-Infinity') AS xg,
        nullif(nullif(nullif(s.npxg::numeric::float8, 'NaN'), 'Infinity'), '-Infinity') AS npxg,
        nullif(nullif(nullif(s.xgot::numeric::float8, 'NaN'), 'Infinity'), '-Infinity') AS xgot,
        nullif(nullif(nullif(s.xa::numeric::float8, 'NaN'), 'Infinity'), '-Infinity') AS xa, s.total_shots AS shots,
        s.shots_on_target, s.touches_opp_box AS touches_box, s.chances_created, s.big_chances_created,
        s.passes_into_final_third AS passes_final_third, s.dribbles_succeeded AS dribbles, s.touches,
        s.accurate_passes AS passes_accurate, s.accurate_passes_total AS passes_attempted, s.duels_won, s.duels_lost,
        s.tackles, s.interceptions, s.recoveries, s.clearances, s.defensive_actions, s.shot_blocks AS blocks, s.saves,
        nullif(nullif(nullif(s.goals_prevented::numeric::float8, 'NaN'), 'Infinity'), '-Infinity') AS goals_prevented
      FROM (SELECT * FROM core.player_match_stats s
            WHERE s.season_id = edition_season AND s.match_id IN (SELECT id FROM m)) s
      FULL JOIN (SELECT * FROM core.lineup_players l
                 WHERE l.season_id = edition_season AND l.match_id IN (SELECT id FROM m)) lp
        ON lp.match_id = s.match_id AND lp.player_id = s.player_id
      JOIN m ON m.id = coalesce(s.match_id, lp.match_id)
      LEFT JOIN core.match_coverage mc ON mc.season_id = edition_season AND mc.match_id = m.id
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
REVOKE ALL ON FUNCTION agg.refresh_player_list(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agg.refresh_player_list(integer) TO vega_calc;
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.player_list_editions, agg.player_list_teams, agg.player_list_positions TO vega_calc;

-- The api views give the tables as they are, the season and the edition visible.
CREATE VIEW api.player_list_editions AS
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
  r.duel_rate_numerator, r.duel_rate_denominator, r.duel_rate_count, r.duel_rate_minutes
FROM agg.player_list_editions r;

CREATE VIEW api.player_list_teams AS
SELECT r.season_id, r.competition_season_id, r.player_id, r.team_id, r.first_order
FROM agg.player_list_teams r;

CREATE VIEW api.player_list_positions AS
SELECT r.season_id, r.competition_season_id, r.player_id, r.position_number, r.minutes, r.first_order
FROM agg.player_list_positions r;

GRANT SELECT ON api.player_list_editions, api.player_list_teams, api.player_list_positions TO vega_read;

-- Every edition that has a statistics row or a line-up row.
SELECT count(agg.refresh_player_list(e.id)) AS editions
FROM (
  SELECT DISTINCT m.competition_season_id AS id FROM core.matches m
  WHERE EXISTS (SELECT 1 FROM core.player_match_stats s WHERE s.season_id = m.season_id AND s.match_id = m.id)
     OR EXISTS (SELECT 1 FROM core.lineup_players l WHERE l.season_id = m.season_id AND l.match_id = m.id)
) e;
