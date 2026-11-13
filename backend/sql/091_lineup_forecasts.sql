-- A match's forecast read again once both clubs have confirmed their eleven (vega/lineup.py):
-- each club's usual line-up of the award year, and the forecast with each side's strength
-- moved by what its eleven is worth against that usual one.

-- A club's line-ups of an award year so far: how many, and their sums added up (a line-up's
-- sum: its outfield starters' own rates, as known before its match).
CREATE TABLE agg.lineup_usuals (
  season_id smallint NOT NULL REFERENCES core.seasons,
  team_id integer NOT NULL REFERENCES core.teams,
  lineups integer NOT NULL CHECK (lineups > 0),
  total double precision NOT NULL,
  PRIMARY KEY (season_id, team_id)
);
-- When an award year's usual line-ups were last written: they follow each ranking of the year.
CREATE TABLE agg.lineup_usual_runs (
  season_id smallint PRIMARY KEY REFERENCES core.seasons,
  computed_at timestamptz NOT NULL DEFAULT now(),
  clubs integer NOT NULL CHECK (clubs >= 0)
);

-- The forecast with the line-ups. home_elo and away_elo are the strengths the forecast read
-- before them; a deviation is a side's sum less its club's usual one. A row is kept after
-- the match, so that these forecasts can be judged on what was played.
CREATE TABLE agg.match_lineup_forecasts (
  match_id integer PRIMARY KEY,
  season_id smallint NOT NULL REFERENCES core.seasons,
  home_win real NOT NULL,
  draw real NOT NULL,
  away_win real NOT NULL,
  home_goals real NOT NULL,
  away_goals real NOT NULL,
  likely_home smallint NOT NULL,
  likely_away smallint NOT NULL,
  home_elo real NOT NULL,
  away_elo real NOT NULL,
  home_deviation real NOT NULL,
  away_deviation real NOT NULL,
  elo_per_unit real NOT NULL,
  first_computed_at timestamptz NOT NULL DEFAULT now(),
  computed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (match_id, season_id) REFERENCES core.matches(id, season_id) ON DELETE CASCADE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.lineup_usuals, agg.lineup_usual_runs, agg.match_lineup_forecasts TO vega_calc;

CREATE VIEW api.match_lineup_forecasts AS
SELECT f.match_id AS match_key, f.season_id,
  f.home_win::numeric::float8 AS home_win, f.draw::numeric::float8 AS draw, f.away_win::numeric::float8 AS away_win,
  f.home_goals::numeric::float8 AS home_goals, f.away_goals::numeric::float8 AS away_goals, f.likely_home, f.likely_away,
  f.home_deviation::numeric::float8 AS home_deviation, f.away_deviation::numeric::float8 AS away_deviation,
  (f.elo_per_unit * f.home_deviation)::numeric::float8 AS home_shift, (f.elo_per_unit * f.away_deviation)::numeric::float8 AS away_shift,
  f.first_computed_at, f.computed_at
FROM agg.match_lineup_forecasts f;

GRANT SELECT ON api.match_lineup_forecasts TO vega_read;
