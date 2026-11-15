-- Bookmakers' odds of the coming matches (vega/sources/odds.py): each bookmaker's latest
-- full-time result prices of a match (decimal odds), with the first ones read (the opening
-- line), when it updated them and when they were read. Typed rows only, no response kept.
ALTER TYPE core.provider ADD VALUE IF NOT EXISTS 'oddsapi';
SET LOCAL lock_timeout = '3s';
CREATE TABLE core.match_odds (
  season_id smallint NOT NULL,
  match_id integer NOT NULL,
  bookmaker text NOT NULL,
  title text NOT NULL,
  home real NOT NULL CHECK (home > 1),
  draw real NOT NULL CHECK (draw > 1),
  away real NOT NULL CHECK (away > 1),
  first_home real NOT NULL,
  first_draw real NOT NULL,
  first_away real NOT NULL,
  updated_at timestamptz,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (season_id, match_id, bookmaker),
  FOREIGN KEY (match_id, season_id) REFERENCES core.matches (id, season_id) ON DELETE CASCADE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON core.match_odds TO vega_collect;
GRANT SELECT ON core.match_odds TO vega_calc;

-- A match's odds by bookmaker, with each one's implied chances: 1 / odds, divided by their
-- sum (the bookmaker's margin taken out).
CREATE VIEW api.match_odds AS
SELECT o.season_id, o.match_id AS match_key, o.bookmaker, o.title, o.home::float8 AS home, o.draw::float8 AS draw, o.away::float8 AS away,
  o.first_home::float8 AS first_home, o.first_draw::float8 AS first_draw, o.first_away::float8 AS first_away,
  (1 / o.home + 1 / o.draw + 1 / o.away)::float8 AS overround,
  ((1 / o.home) / (1 / o.home + 1 / o.draw + 1 / o.away))::float8 AS home_chance,
  ((1 / o.draw) / (1 / o.home + 1 / o.draw + 1 / o.away))::float8 AS draw_chance,
  ((1 / o.away) / (1 / o.home + 1 / o.draw + 1 / o.away))::float8 AS away_chance,
  o.updated_at, o.fetched_at
FROM core.match_odds o;
GRANT SELECT ON api.match_odds TO vega_read;
