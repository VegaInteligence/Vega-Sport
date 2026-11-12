-- Players' whole statistical profile as a short vector (vega/embedding.py): the axes
-- learnt from a season's players, each player's place on them, and the reads behind
-- "players like him" on a player's page.
CREATE TABLE agg.embedding_models (
  season_id smallint PRIMARY KEY REFERENCES core.seasons,
  version text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  players integer NOT NULL CHECK (players > 0),
  statistics smallint NOT NULL CHECK (statistics > 0),
  variance_kept real NOT NULL CHECK (variance_kept >= 0 AND variance_kept <= 1)
);

CREATE TABLE agg.player_embeddings (
  season_id smallint NOT NULL REFERENCES agg.embedding_models ON DELETE CASCADE,
  player_id integer NOT NULL REFERENCES core.players ON DELETE CASCADE,
  minutes integer NOT NULL CHECK (minutes >= 0),
  women boolean NOT NULL,
  e1 real NOT NULL, e2 real NOT NULL, e3 real NOT NULL, e4 real NOT NULL, e5 real NOT NULL, e6 real NOT NULL, e7 real NOT NULL, e8 real NOT NULL, e9 real NOT NULL, e10 real NOT NULL,
  PRIMARY KEY (season_id, player_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.embedding_models, agg.player_embeddings TO vega_calc;

-- The vectors alone: the distances are computed on these rows, nothing else is read.
CREATE VIEW api.player_embedding_vectors AS
SELECT e.season_id, e.player_id AS player_key, e.women, e.e1::float8 AS e1, e.e2::float8 AS e2, e.e3::float8 AS e3, e.e4::float8 AS e4, e.e5::float8 AS e5, e.e6::float8 AS e6, e.e7::float8 AS e7, e.e8::float8 AS e8, e.e9::float8 AS e9, e.e10::float8 AS e10
FROM agg.player_embeddings e;

-- Who a placed player is: his name, his season's club and role (power ranking), his score.
CREATE VIEW api.player_embedding_people AS
SELECT e.season_id, e.player_id AS player_key, api.public_id('player', e.player_id) AS player_id, p.name,
  ph.source_url AS image_url, e.minutes, w.role, api.public_id('team', w.team_id) AS team_id, t.name AS team,
  w.score::numeric::float8 AS score
FROM agg.player_embeddings e
JOIN core.players p ON p.id = e.player_id
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN agg.player_power w ON w.season_id = e.season_id AND w.player_id = e.player_id
LEFT JOIN core.teams t ON t.id = w.team_id;

CREATE VIEW api.embedding_models AS
SELECT m.season_id, m.version, m.computed_at, m.players, m.statistics, m.variance_kept::numeric::float8 AS variance_kept
FROM agg.embedding_models m;

GRANT SELECT ON api.player_embedding_vectors, api.player_embedding_people, api.embedding_models TO vega_read;
