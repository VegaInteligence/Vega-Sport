-- 23 Nov 2026 (#70, VI-49; FAILURE_MODES.md §51): the national teams' Elo from 2021/22 (friendlies and qualifiers, a
-- FIFA seed) and their world ranking. A nation of a season's ranking from 2021/22 is listed when it played a counted
-- match in the two years up to the season's reference date; `provisional` when it played fewer than 8 in four years
-- (false for the clubs and the seasons before). The Elo run records the national pass's settings, so that the worker
-- runs it again once when they change (worker.elo_due) without re-ranking the players (METHOD_VERSION unchanged).
SET LOCAL lock_timeout = '3s';

ALTER TABLE agg.team_power ADD COLUMN provisional boolean NOT NULL DEFAULT false;
ALTER TABLE agg.power_runs
  ADD COLUMN nation_elo_version text,
  ADD COLUMN nation_k real,
  ADD COLUMN nation_start date,
  ADD COLUMN nation_seed_edition text;

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
