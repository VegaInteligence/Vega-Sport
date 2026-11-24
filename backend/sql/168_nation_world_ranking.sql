-- 23 Nov 2026 (#70, VI-49; FAILURE_MODES.md §51): the national teams' Elo from 2021/22 (friendlies and qualifiers, a
-- FIFA seed) and their world ranking. A nation of a season's ranking from 2021/22 is listed when it played a counted
-- match in the two years up to the season's reference date; `provisional` when it played fewer than 8 in four years
-- (false for the clubs and the seasons before). Each Elo run keeps the national pass's settings in its own row of
-- agg.nation_elo_runs, so that the worker runs it again once when they change (worker.elo_due) without re-ranking the
-- players (METHOD_VERSION unchanged). agg.power_runs keeps its columns: the Open Matchday restore compares a reviewed
-- run's whole row (open_matchday_restore.verify_elo; FAILURE_MODES.md §53).
SET LOCAL lock_timeout = '3s';

ALTER TABLE agg.team_power ADD COLUMN provisional boolean NOT NULL DEFAULT false;

-- One row per Elo run of the national pass, written with the run (power.refresh_elo). A run without one (before this
-- migration) is of another national method. A run deleted takes its row with it.
CREATE TABLE agg.nation_elo_runs (
  run_id integer PRIMARY KEY REFERENCES agg.power_runs ON DELETE CASCADE,
  version text NOT NULL,
  k real NOT NULL,
  start_date date NOT NULL,
  seed_edition text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.nation_elo_runs TO vega_calc;

-- 064's view, with the row's provisional flag last.
CREATE OR REPLACE VIEW api.power_clubs AS
SELECT se.label AS season, p.scope, p.rank, api.public_id('team', p.team_id) AS team_id, t.name, cr.source_url AS image_url,
  t.country_code AS country, p.elo::numeric::float8 AS elo, p.elo_change::numeric::float8 AS elo_change, p.matches,
  p.last_match_at, r.finished_at AS computed_at, r.method_version,
  p.elo_start::numeric::float8 AS elo_start, p.elo_peak::numeric::float8 AS elo_peak, p.elo_low::numeric::float8 AS elo_low,
  p.wins, p.draws, p.losses, p.result_sum::numeric::float8 AS result_sum, p.expected_sum::numeric::float8 AS expected_sum,
  p.season_id, p.team_id AS team_key, p.provisional
FROM agg.team_power p
JOIN core.seasons se ON se.id = p.season_id
JOIN core.teams t ON t.id = p.team_id
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id
JOIN agg.power_runs r ON r.id = p.run_id;
