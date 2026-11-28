-- 27 Nov 2026 (FAILURE_MODES.md § 89.1; the user, after the review of the models in service: « Outils de mesure »): the
-- forecasts kept once published. forecast.refresh empties agg.match_forecasts of a season and writes the matches still
-- to play: once a match was played, nothing said what had been forecast for it, and no forecast could be judged on what
-- was played. One row per match: the last forecast written before its kick-off, with what rebuilds its score grid
-- (both expected goals, rho), both strengths and forms, the model's version, when it was first and last written and
-- the kick-off it was written for. The forecast read again with the confirmed line-ups keeps its own table (091).
-- Additive: one table, one view, their grants; no other table or column changes, no row is written here.
-- vega:online
SET LOCAL lock_timeout = '3s';

-- Written by forecast.refresh, in the transaction that writes the season's forecasts: a row only for a match that
-- kicks off after the writing and within the form's horizon (forecast.FORM_HORIZON). kickoff_at is the kick-off the
-- row was written for (the match's day at 00:00 UTC when the base has no hour), which a postponement leaves behind.
-- A match deleted takes its row with it; a source's withdrawal is not held by it (snapshot.LAPSING).
CREATE TABLE agg.match_forecast_log (
  match_id integer PRIMARY KEY,
  season_id smallint NOT NULL REFERENCES core.seasons,
  home_win real NOT NULL,
  draw real NOT NULL,
  away_win real NOT NULL,
  home_goals real NOT NULL,
  away_goals real NOT NULL,
  rho real NOT NULL,
  home_elo real NOT NULL,
  away_elo real NOT NULL,
  home_form real NOT NULL,
  away_form real NOT NULL,
  model_version text NOT NULL,
  kickoff_at timestamptz NOT NULL,
  first_computed_at timestamptz NOT NULL,
  computed_at timestamptz NOT NULL,
  CHECK (computed_at < kickoff_at),
  FOREIGN KEY (match_id, season_id) REFERENCES core.matches (id, season_id) ON DELETE CASCADE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.match_forecast_log TO vega_calc;

-- The row beside what judges it: the match under its public id, its state, its kick-off as the base holds it today,
-- its score after ninety minutes (the one the model is fitted on), its competition and its two sides. No route serves
-- it yet: backend/tools/evaluate_forecast.py reads it (from-log).
CREATE VIEW api.match_forecast_log AS
SELECT api.public_id('match', l.match_id) AS match_id, l.match_id AS match_key, l.season_id,
  l.home_win::numeric::float8 AS home_win, l.draw::numeric::float8 AS draw, l.away_win::numeric::float8 AS away_win,
  l.home_goals::numeric::float8 AS home_goals, l.away_goals::numeric::float8 AS away_goals, l.rho::numeric::float8 AS rho,
  l.home_elo::numeric::float8 AS home_elo, l.away_elo::numeric::float8 AS away_elo,
  l.home_form::numeric::float8 AS home_form, l.away_form::numeric::float8 AS away_form,
  l.model_version, l.kickoff_at AS forecast_kickoff_at, l.first_computed_at, l.computed_at,
  m.status::text AS status, coalesce(m.kickoff_at, m.match_date::timestamp AT TIME ZONE 'UTC') AS kickoff_at,
  coalesce(m.home_score_90, m.home_score) AS home_score, coalesce(m.away_score_90, m.away_score) AS away_score,
  c.name AS competition, c.country_code, ht.name AS home_name, at.name AS away_name
FROM agg.match_forecast_log l
JOIN core.matches m ON m.id = l.match_id AND m.season_id = l.season_id
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
JOIN core.competitions c ON c.id = cs.competition_id
JOIN core.teams ht ON ht.id = m.home_team_id
JOIN core.teams at ON at.id = m.away_team_id;
GRANT SELECT ON api.match_forecast_log TO vega_read;
