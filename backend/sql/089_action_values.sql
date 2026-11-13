-- The source's action values of a player's league season, set among the players of his
-- role in that league (vega/actions.py): each season's run and its players, with the read
-- behind the player page's card.
CREATE TABLE agg.action_value_runs (
  season_id smallint PRIMARY KEY REFERENCES core.seasons,
  version text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  players integer NOT NULL CHECK (players >= 0),
  placed integer NOT NULL CHECK (placed >= 0 AND placed <= players)
);

-- Values per 90 minutes of the league; a rank (1 is the highest value) and a percentile
-- among `peers`, blank when the role has too few players in the league to place anyone.
CREATE TABLE agg.player_action_values (
  season_id smallint NOT NULL REFERENCES core.seasons,
  player_id integer NOT NULL REFERENCES core.players ON DELETE CASCADE,
  competition_id integer NOT NULL REFERENCES core.competitions,
  role text NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0),
  vaep real NOT NULL,
  vaep_offensive real,
  vaep_defensive real,
  pv real NOT NULL,
  pv_offensive real,
  pv_defensive real,
  xt real NOT NULL,
  peers integer NOT NULL CHECK (peers > 0),
  vaep_rank integer CHECK (vaep_rank >= 1),
  vaep_percentile real CHECK (vaep_percentile >= 0 AND vaep_percentile <= 100),
  pv_rank integer CHECK (pv_rank >= 1),
  pv_percentile real CHECK (pv_percentile >= 0 AND pv_percentile <= 100),
  xt_rank integer CHECK (xt_rank >= 1),
  xt_percentile real CHECK (xt_percentile >= 0 AND xt_percentile <= 100),
  PRIMARY KEY (season_id, player_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.action_value_runs, agg.player_action_values TO vega_calc;

CREATE VIEW api.player_action_values AS
SELECT a.season_id, a.player_id AS player_key, api.public_id('competition', a.competition_id) AS competition_id, c.name AS competition,
  a.role, a.minutes, a.peers,
  a.vaep::numeric::float8 AS vaep, a.vaep_offensive::numeric::float8 AS vaep_offensive, a.vaep_defensive::numeric::float8 AS vaep_defensive,
  a.pv::numeric::float8 AS pv, a.pv_offensive::numeric::float8 AS pv_offensive, a.pv_defensive::numeric::float8 AS pv_defensive,
  a.xt::numeric::float8 AS xt,
  a.vaep_rank, a.vaep_percentile::numeric::float8 AS vaep_percentile,
  a.pv_rank, a.pv_percentile::numeric::float8 AS pv_percentile,
  a.xt_rank, a.xt_percentile::numeric::float8 AS xt_percentile,
  r.version, r.computed_at
FROM agg.player_action_values a
JOIN core.competitions c ON c.id = a.competition_id
JOIN agg.action_value_runs r ON r.season_id = a.season_id;

GRANT SELECT ON api.player_action_values TO vega_read;
