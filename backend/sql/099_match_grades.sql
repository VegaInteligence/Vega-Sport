-- Match grades (vega/power.py, « Match grades »): each player-match's grade index, the normal
-- score of its contribution among its role's matches of the reference year, and that
-- reference, kept by year: the role's mean and spread over its full matches, each
-- competition's spread drawn to the role's, and the role's distribution in steps.
SET LOCAL lock_timeout = '3s';
ALTER TABLE agg.player_power_matches ADD COLUMN match_index real;

CREATE TABLE agg.match_grade_roles (
  ref_season smallint NOT NULL REFERENCES core.seasons,
  role text NOT NULL,
  matches integer NOT NULL,
  mean real NOT NULL,
  spread real NOT NULL CHECK (spread > 0),
  PRIMARY KEY (ref_season, role)
);
CREATE TABLE agg.match_grade_spreads (
  ref_season smallint NOT NULL,
  role text NOT NULL,
  competition_id integer NOT NULL REFERENCES core.competitions ON DELETE CASCADE,
  matches integer NOT NULL,
  spread real NOT NULL CHECK (spread > 0),
  PRIMARY KEY (ref_season, role, competition_id),
  FOREIGN KEY (ref_season, role) REFERENCES agg.match_grade_roles ON DELETE CASCADE
);
CREATE TABLE agg.match_grade_quantiles (
  ref_season smallint NOT NULL,
  role text NOT NULL,
  step smallint NOT NULL CHECK (step >= 0),
  value real NOT NULL,
  PRIMARY KEY (ref_season, role, step),
  FOREIGN KEY (ref_season, role) REFERENCES agg.match_grade_roles ON DELETE CASCADE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.match_grade_roles, agg.match_grade_spreads, agg.match_grade_quantiles TO vega_calc;

-- A match's grades, for its page: the grade on the season's 0-100 curve (50 an ordinary match
-- of the role), the minutes beside it, and the competition's stakes kept apart.
CREATE VIEW api.match_grades AS
SELECT p.season_id, p.match_id AS match_key, api.public_id('match', p.match_id) AS match_id,
  api.public_id('player', p.player_id) AS player_id, api.public_id('team', p.team_id) AS team_id,
  p.role, p.minutes, p.match_index::numeric::float8 AS match_index,
  (100 / (1 + power(10, -p.match_index / 4.0)))::numeric::float8 AS grade
FROM agg.player_power_matches p
WHERE p.match_index IS NOT NULL;
GRANT SELECT ON api.match_grades TO vega_read;
