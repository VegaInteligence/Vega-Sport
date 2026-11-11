-- The power views name a player or a club by its public id, which is computed for each
-- row. A read that named twenty players computed it for every player of the season
-- before finding them: 0.7 s for the roles of twenty players and 0.4 s for the first
-- thirty of the ranking on 11 November 2026, against 3 ms each through the key.
--
-- Each view also gives the season's id and the row's own key (the columns of its
-- table's primary key), for the reads to filter on. The other columns are as they were.

CREATE OR REPLACE VIEW api.power_clubs AS
SELECT se.label AS season, p.scope, p.rank, api.public_id('team', p.team_id) AS team_id, t.name, cr.source_url AS image_url,
  t.country_code AS country, p.elo::numeric::float8 AS elo, p.elo_change::numeric::float8 AS elo_change, p.matches,
  p.last_match_at, r.finished_at AS computed_at, r.method_version,
  p.elo_start::numeric::float8 AS elo_start, p.elo_peak::numeric::float8 AS elo_peak, p.elo_low::numeric::float8 AS elo_low,
  p.wins, p.draws, p.losses, p.result_sum::numeric::float8 AS result_sum, p.expected_sum::numeric::float8 AS expected_sum,
  p.season_id, p.team_id AS team_key
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
  p.distribution_percentile::numeric::float8 AS distribution_percentile,
  p.season_id, p.player_id AS player_key
FROM agg.player_power p
JOIN core.seasons se ON se.id = p.season_id
JOIN core.players pl ON pl.id = p.player_id
LEFT JOIN core.assets ph ON ph.id = pl.photo_asset_id
LEFT JOIN core.teams t ON t.id = p.team_id
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id
JOIN agg.power_runs r ON r.id = p.run_id
WHERE p.eligible;

CREATE OR REPLACE VIEW api.power_player_roles AS
SELECT se.label AS season, api.public_id('player', x.player_id) AS player_id, x.role, x.matches, x.minutes,
  x.total::numeric::float8 AS total, x.rate::numeric::float8 AS rate,
  x.season_id, x.player_id AS player_key
FROM agg.player_power_roles x
JOIN core.seasons se ON se.id = x.season_id;
