-- Coming back from an absence (vega/returns.py): the curve of minutes by match back and by
-- length of absence, learnt from the line-ups, and the players in the middle of a return.
CREATE TABLE agg.return_curves (
  bucket text NOT NULL CHECK (bucket IN ('30_59', '60_119', '120_plus')),
  match_no smallint NOT NULL CHECK (match_no >= 1),
  returns integer NOT NULL CHECK (returns > 0),
  minutes real NOT NULL,
  usual_minutes real NOT NULL,
  version text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, match_no)
);

CREATE TABLE agg.player_returns (
  player_id integer PRIMARY KEY REFERENCES core.players ON DELETE CASCADE,
  team_id integer NOT NULL REFERENCES core.teams ON DELETE CASCADE,
  absent_from date NOT NULL,
  returned_on date NOT NULL,
  days integer NOT NULL CHECK (days > 0),
  matches_missed integer NOT NULL CHECK (matches_missed > 0),
  matches_back smallint NOT NULL CHECK (matches_back >= 1),
  bucket text NOT NULL,
  usual_minutes real NOT NULL,
  minutes_back real NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.return_curves, agg.player_returns TO vega_calc;

CREATE VIEW api.return_curves AS
SELECT c.bucket, c.match_no, c.returns, c.minutes::numeric::float8 AS minutes, c.usual_minutes::numeric::float8 AS usual_minutes,
  c.version, c.computed_at
FROM agg.return_curves c;

CREATE VIEW api.player_returns AS
SELECT r.player_id AS player_key, api.public_id('team', r.team_id) AS team_id, t.name AS team, r.absent_from::text AS absent_from,
  r.returned_on::text AS returned_on, r.days, r.matches_missed, r.matches_back, r.bucket,
  r.usual_minutes::numeric::float8 AS usual_minutes, r.minutes_back::numeric::float8 AS minutes_back
FROM agg.player_returns r
JOIN core.teams t ON t.id = r.team_id;

GRANT SELECT ON api.return_curves, api.player_returns TO vega_read;
