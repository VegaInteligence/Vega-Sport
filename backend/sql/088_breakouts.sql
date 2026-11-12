-- Players below the ranking's minutes who already play like its regulars (vega/breakout.py):
-- each season's run and its flagged players, with the read behind the ranking page's list.
CREATE TABLE agg.breakout_runs (
  season_id smallint PRIMARY KEY REFERENCES core.seasons,
  version text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  candidates integer NOT NULL CHECK (candidates >= 0),
  flagged integer NOT NULL CHECK (flagged >= 0)
);

CREATE TABLE agg.player_breakouts (
  season_id smallint NOT NULL REFERENCES core.seasons,
  player_id integer NOT NULL REFERENCES core.players ON DELETE CASCADE,
  role text NOT NULL,
  team_id integer REFERENCES core.teams,
  minutes integer NOT NULL,
  rate real NOT NULL,
  percentile real NOT NULL CHECK (percentile >= 0 AND percentile <= 100),
  regulars integer NOT NULL CHECK (regulars > 0),
  rank integer NOT NULL CHECK (rank >= 1),
  PRIMARY KEY (season_id, player_id)
);
CREATE INDEX player_breakouts_rank ON agg.player_breakouts(season_id, rank);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.breakout_runs, agg.player_breakouts TO vega_calc;

CREATE VIEW api.breakout_runs AS
SELECT r.season_id, r.version, r.computed_at, r.candidates, r.flagged FROM agg.breakout_runs r;

CREATE VIEW api.player_breakouts AS
SELECT b.season_id, b.player_id AS player_key, api.public_id('player', b.player_id) AS player_id, p.name, ph.source_url AS image_url,
  b.role, api.public_id('team', b.team_id) AS team_id, t.name AS team, cr.source_url AS team_image_url,
  b.minutes, b.rate::numeric::float8 AS rate, b.percentile::numeric::float8 AS percentile, b.regulars, b.rank
FROM agg.player_breakouts b
JOIN core.players p ON p.id = b.player_id
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN core.teams t ON t.id = b.team_id
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id;

GRANT SELECT ON api.breakout_runs, api.player_breakouts TO vega_read;
