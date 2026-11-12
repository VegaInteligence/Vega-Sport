-- The power ranking's second version (vega/power.py, METHOD_VERSION power-ranking-v2;
-- docs/calculs/05-joueurs/08-audit-classement-puissance.md gives what the first one
-- produced on the base and what each change answers).
--
-- 1. The settings a run adds to its row, one typed column each: the passes that settled
--    the leagues' levels, the matches that put a league on the common scale, the weight a
--    level drawn from few matches keeps, the share of the eligibility threshold while the
--    year is young, the share of the spread given to the club level and the weight it
--    gave, the scale of the score, and the award year's first and last day.
ALTER TABLE agg.power_runs
  ADD COLUMN seed_rounds integer, ADD COLUMN link_matches integer, ADD COLUMN level_prior_matches integer,
  ADD COLUMN eligibility_share real, ADD COLUMN level_share real, ADD COLUMN level_weight real,
  ADD COLUMN score_scale real, ADD COLUMN year_start date, ADD COLUMN year_end date;

-- 2. A player's total in its two parts (what he does against what is expected of his
--    role in his club's situation, and the level of his club), the standardised index
--    that ranks him among every role, whether his league is on the common scale (no rank
--    without it) and whether his club plays in a top division (the award race).
ALTER TABLE agg.player_power
  ADD COLUMN own_total real, ADD COLUMN level_total real, ADD COLUMN index real,
  ADD COLUMN linked boolean NOT NULL DEFAULT true, ADD COLUMN top_division boolean NOT NULL DEFAULT true;
ALTER TABLE agg.player_power_matches ADD COLUMN level real;

-- 3. Each league's place on the common scale: the level its clubs enter the Elo at, the
--    mean strength of its clubs after their last match, the matches its clubs played
--    against clubs of other leagues, and whether that puts it on the common scale.
CREATE TABLE agg.league_levels (
  competition_id integer PRIMARY KEY REFERENCES core.competitions,
  entry_level real NOT NULL,
  level real NOT NULL,
  teams integer NOT NULL,
  links integer NOT NULL,
  linked boolean NOT NULL,
  run_id integer NOT NULL REFERENCES agg.power_runs
);

-- 4. The ranking's read gives the new columns (064's view, five columns added at its end).
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
  p.linked, p.top_division
FROM agg.player_power p
JOIN core.seasons se ON se.id = p.season_id
JOIN core.players pl ON pl.id = p.player_id
LEFT JOIN core.assets ph ON ph.id = pl.photo_asset_id
LEFT JOIN core.teams t ON t.id = p.team_id
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id
JOIN agg.power_runs r ON r.id = p.run_id
WHERE p.eligible;
