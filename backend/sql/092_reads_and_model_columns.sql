-- Two reads of facts the base already holds, and the columns of the in-play and forecast models' second versions.

-- The pressing and territory figures of a team's match (074): where it won the ball, its
-- recoveries, the opponent's passes per defensive action, its entries into the final third
-- and the penalty area with the share the source gives beside each. The source sends them
-- for some competitions only; a row without any of them is not listed.
CREATE VIEW api.match_team_pressing_rows AS
SELECT s.season_id, s.match_id, s.team_id, s.period::text AS period_name,
  s.poss_won_att_3rd, s.poss_won_mid_3rd, s.poss_won_def_3rd, s.recoveries, s.ppda::numeric::float8 AS ppda,
  s.final_third_entries, s.final_third_entries_pct::numeric::float8 AS final_third_entries_pct,
  s.penalty_area_entries, s.penalty_area_entries_pct::numeric::float8 AS penalty_area_entries_pct
FROM core.team_match_stats s
WHERE coalesce(s.poss_won_att_3rd, s.poss_won_mid_3rd, s.poss_won_def_3rd, s.recoveries, s.final_third_entries, s.penalty_area_entries) IS NOT NULL
   OR s.ppda IS NOT NULL;

-- The shots on target a goalkeeper faced in a season (the source names the keeper of a shot
-- on target): how many, the goals they were expected to give once struck (xGOT), and the
-- goals they gave. An own goal is no shot faced; a blocked shot never reached the goal.
CREATE VIEW api.keeper_shot_totals AS
SELECT s.season_id, s.keeper_id AS keeper_key,
  count(*)::integer AS shots,
  (count(*) FILTER (WHERE s.outcome = 'goal'))::integer AS goals,
  sum(s.xgot)::numeric::float8 AS xgot
FROM core.shots s
WHERE s.keeper_id IS NOT NULL AND s.is_own_goal IS NOT TRUE AND s.is_on_target AND s.is_blocked IS NOT TRUE AND s.xgot IS NOT NULL
GROUP BY s.season_id, s.keeper_id;

GRANT SELECT ON api.match_team_pressing_rows, api.keeper_shot_totals TO vega_read;

-- The in-play model's two factors of the score (vega/inplay.py, version 2): the rate of a
-- side ahead and of a side behind, for the rest of the match. 1 on a model fitted before.
ALTER TABLE agg.inplay_models
  ADD COLUMN ahead double precision NOT NULL DEFAULT 1 CHECK (ahead > 0),
  ADD COLUMN behind double precision NOT NULL DEFAULT 1 CHECK (behind > 0),
  -- The matches the two factors were fitted on (they are searched again once the base has grown).
  ADD COLUMN state_matches integer;
CREATE OR REPLACE VIEW api.inplay_models AS
SELECT m.id, m.version, m.fitted_at, m.matches, m.goals, m.red_matches, m.q1, m.q2, m.q3, m.q4, m.q5, m.q6, m.after_90, m.down, m.up,
  m.ahead, m.behind
FROM agg.inplay_models m;

-- The forecast's two coefficients of a club's recent form (vega/forecast.py, version 2), and
-- the Elo points the form adds to each side of a match about to be played (0 further ahead,
-- and on a forecast made before).
ALTER TABLE agg.forecast_models
  ADD COLUMN form_xg double precision NOT NULL DEFAULT 0,
  ADD COLUMN form_luck double precision NOT NULL DEFAULT 0,
  ADD COLUMN form_matches integer NOT NULL DEFAULT 0 CHECK (form_matches >= 0);
ALTER TABLE agg.match_forecasts
  ADD COLUMN home_form real NOT NULL DEFAULT 0,
  ADD COLUMN away_form real NOT NULL DEFAULT 0;
CREATE OR REPLACE VIEW api.match_forecasts AS
SELECT coalesce(k.provider_key, 'm_v' || lpad(f.match_id::text, 7, '0')) AS match_id, f.season_id,
  f.home_win::numeric::float8 AS home_win, f.draw::numeric::float8 AS draw, f.away_win::numeric::float8 AS away_win,
  f.home_goals::numeric::float8 AS home_goals, f.away_goals::numeric::float8 AS away_goals, f.likely_home, f.likely_away,
  o.version AS model_version, o.fitted_at, o.matches AS model_matches, f.match_id AS match_key,
  f.home_form::numeric::float8 AS home_form, f.away_form::numeric::float8 AS away_form
FROM agg.match_forecasts f
JOIN agg.forecast_models o ON o.id = f.model_id
LEFT JOIN core.provider_ids k ON k.entity_type = 'match' AND k.entity_id = f.match_id AND k.provider = 'pitchapi' AND k.is_current;
-- The strengths a line-up forecast started from (each club's Elo and its form), for the
-- match's minute-by-minute read.
CREATE OR REPLACE VIEW api.match_lineup_forecasts AS
SELECT f.match_id AS match_key, f.season_id,
  f.home_win::numeric::float8 AS home_win, f.draw::numeric::float8 AS draw, f.away_win::numeric::float8 AS away_win,
  f.home_goals::numeric::float8 AS home_goals, f.away_goals::numeric::float8 AS away_goals, f.likely_home, f.likely_away,
  f.home_deviation::numeric::float8 AS home_deviation, f.away_deviation::numeric::float8 AS away_deviation,
  (f.elo_per_unit * f.home_deviation)::numeric::float8 AS home_shift, (f.elo_per_unit * f.away_deviation)::numeric::float8 AS away_shift,
  f.first_computed_at, f.computed_at,
  f.home_elo::numeric::float8 AS home_strength, f.away_elo::numeric::float8 AS away_strength
FROM agg.match_lineup_forecasts f;
