-- The power rankings in detail (docs/METHODE_CLASSEMENT_BALLON_D_OR.md), next to the
-- single score: a club's season in Elo terms (§ 3), what each block brings to a player's
-- season (§§ 6, 8), and a player's contribution in each role played (§ 8: "conserver les
-- contributions par rôle"). Filled by vega_v2/power.py.

-- Club: the Elo it started the season with, its highest and lowest Elo after a match of
-- the season, its record, and the sum of its results (1, ½, 0) against the sum of the
-- results the Elo expected before each match.
ALTER TABLE agg.team_power
  ADD COLUMN elo_start real,
  ADD COLUMN elo_peak real,
  ADD COLUMN elo_low real,
  ADD COLUMN wins integer,
  ADD COLUMN draws integer,
  ADD COLUMN losses integer,
  ADD COLUMN result_sum real,
  ADD COLUMN expected_sum real;

-- Player: each block's share of T (the block shares of all matches add up to T), and the
-- player's percentile within his main role for each block of that role (eligible players).
ALTER TABLE agg.player_power
  ADD COLUMN finishing_total real, ADD COLUMN creation_total real, ADD COLUMN progression_total real,
  ADD COLUMN defence_total real, ADD COLUMN retention_total real, ADD COLUMN shot_stopping_total real,
  ADD COLUMN aerial_total real, ADD COLUMN depth_total real, ADD COLUMN distribution_total real,
  ADD COLUMN finishing_percentile real, ADD COLUMN creation_percentile real, ADD COLUMN progression_percentile real,
  ADD COLUMN defence_percentile real, ADD COLUMN retention_percentile real, ADD COLUMN shot_stopping_percentile real,
  ADD COLUMN aerial_percentile real, ADD COLUMN depth_percentile real, ADD COLUMN distribution_percentile real;

-- Player: one row per role played in the season (the main role is agg.player_power.role).
CREATE TABLE agg.player_power_roles (
  season_id smallint NOT NULL REFERENCES core.seasons,
  player_id integer NOT NULL REFERENCES core.players,
  role text NOT NULL,
  matches integer NOT NULL,
  minutes integer NOT NULL,
  total real NOT NULL,   -- T in this role
  rate real NOT NULL,    -- R* in this role
  run_id integer NOT NULL REFERENCES agg.power_runs,
  PRIMARY KEY (season_id, player_id, role)
);

CREATE OR REPLACE VIEW api.power_clubs AS
SELECT se.label AS season, p.scope, p.rank, api.public_id('team', p.team_id) AS team_id, t.name, cr.source_url AS image_url,
  t.country_code AS country, p.elo::numeric::float8 AS elo, p.elo_change::numeric::float8 AS elo_change, p.matches,
  p.last_match_at, r.finished_at AS computed_at, r.method_version,
  p.elo_start::numeric::float8 AS elo_start, p.elo_peak::numeric::float8 AS elo_peak, p.elo_low::numeric::float8 AS elo_low,
  p.wins, p.draws, p.losses, p.result_sum::numeric::float8 AS result_sum, p.expected_sum::numeric::float8 AS expected_sum
FROM agg.team_power p
JOIN core.seasons se ON se.id = p.season_id
JOIN core.teams t ON t.id = p.team_id
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id
JOIN agg.power_runs r ON r.id = p.run_id;

CREATE OR REPLACE VIEW api.power_players AS
SELECT se.label AS season, p.rank, p.role_rank, p.role, api.public_id('player', p.player_id) AS player_id, pl.name,
  ph.source_url AS image_url, api.public_id('team', p.team_id) AS team_id, t.name AS team, cr.source_url AS team_image_url,
  p.matches, p.minutes, p.total::numeric::float8 AS total, p.rate::numeric::float8 AS rate,
  p.total_percentile::numeric::float8 AS total_percentile, p.rate_percentile::numeric::float8 AS rate_percentile,
  p.score::numeric::float8 AS score, r.finished_at AS computed_at, r.method_version,
  p.finishing_total::numeric::float8 AS finishing_total, p.creation_total::numeric::float8 AS creation_total,
  p.progression_total::numeric::float8 AS progression_total, p.defence_total::numeric::float8 AS defence_total,
  p.retention_total::numeric::float8 AS retention_total, p.shot_stopping_total::numeric::float8 AS shot_stopping_total,
  p.aerial_total::numeric::float8 AS aerial_total, p.depth_total::numeric::float8 AS depth_total,
  p.distribution_total::numeric::float8 AS distribution_total,
  p.finishing_percentile::numeric::float8 AS finishing_percentile, p.creation_percentile::numeric::float8 AS creation_percentile,
  p.progression_percentile::numeric::float8 AS progression_percentile, p.defence_percentile::numeric::float8 AS defence_percentile,
  p.retention_percentile::numeric::float8 AS retention_percentile, p.shot_stopping_percentile::numeric::float8 AS shot_stopping_percentile,
  p.aerial_percentile::numeric::float8 AS aerial_percentile, p.depth_percentile::numeric::float8 AS depth_percentile,
  p.distribution_percentile::numeric::float8 AS distribution_percentile
FROM agg.player_power p
JOIN core.seasons se ON se.id = p.season_id
JOIN core.players pl ON pl.id = p.player_id
LEFT JOIN core.assets ph ON ph.id = pl.photo_asset_id
LEFT JOIN core.teams t ON t.id = p.team_id
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id
JOIN agg.power_runs r ON r.id = p.run_id
WHERE p.eligible;

CREATE VIEW api.power_player_roles AS
SELECT se.label AS season, api.public_id('player', x.player_id) AS player_id, x.role, x.matches, x.minutes,
  x.total::numeric::float8 AS total, x.rate::numeric::float8 AS rate
FROM agg.player_power_roles x
JOIN core.seasons se ON se.id = x.season_id;
