-- Last season's index as a prior (power-ranking-v8, vega/power.py PRIOR_*): the index and the
-- score shown blend last season's own index in, with a weight that fades out with the minutes
-- played; the year's own index stays in index_season, which the award race reads. 103's view,
-- one column added at its end.
SET LOCAL lock_timeout = '3s';
ALTER TABLE agg.player_power ADD COLUMN index_season real;

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
  p.season_id, p.player_id AS player_key,
  p.index::numeric::float8 AS index, p.own_total::numeric::float8 AS own_total, p.level_total::numeric::float8 AS level_total,
  p.linked, p.top_division, p.eligible, p.universe, p.in_league, t.is_national IS TRUE AS team_is_national,
  p.index_season::numeric::float8 AS index_season
FROM agg.player_power p
JOIN core.seasons se ON se.id = p.season_id
JOIN core.players pl ON pl.id = p.player_id
LEFT JOIN core.assets ph ON ph.id = pl.photo_asset_id
LEFT JOIN core.teams t ON t.id = p.team_id
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id
JOIN agg.power_runs r ON r.id = p.run_id
WHERE p.eligible OR p.rank IS NOT NULL;
