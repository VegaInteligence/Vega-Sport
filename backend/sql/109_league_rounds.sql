-- The leagues' matchweeks (vega/rounds.py): each round of a league edition, open or closed
-- (or amended, when a late match of a closed round was played), its matches, its Team of
-- the Round and the league's Player of the Season race at its closure, both frozen. A
-- round's key is « r » and its core.rounds id, or « w » and the date of the Tuesday that
-- starts its week for a league whose matches carry no round.
SET LOCAL lock_timeout = '3s';
CREATE TABLE agg.league_rounds (
  competition_season_id integer NOT NULL REFERENCES core.competition_seasons ON DELETE CASCADE,
  round_key text NOT NULL,
  season_id smallint NOT NULL,
  round_id integer REFERENCES core.rounds ON DELETE SET NULL,
  label text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  matches integer NOT NULL,
  played integer NOT NULL,
  excused integer NOT NULL,
  last_match_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'closed', 'amended')),
  closed_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_season_id, round_key)
);
CREATE INDEX league_rounds_season ON agg.league_rounds (season_id, status);
CREATE TABLE agg.league_round_matches (
  competition_season_id integer NOT NULL,
  round_key text NOT NULL,
  match_id integer NOT NULL,
  PRIMARY KEY (competition_season_id, round_key, match_id),
  FOREIGN KEY (competition_season_id, round_key) REFERENCES agg.league_rounds ON DELETE CASCADE
);
CREATE INDEX league_round_matches_match ON agg.league_round_matches (match_id);
CREATE TABLE agg.round_teams (
  competition_season_id integer NOT NULL,
  round_key text NOT NULL,
  slot smallint NOT NULL,
  line smallint NOT NULL,
  slot_role text NOT NULL,
  formation text NOT NULL,
  player_id integer NOT NULL REFERENCES core.players,
  team_id integer REFERENCES core.teams,
  match_id integer NOT NULL,
  season_id smallint NOT NULL,
  role text NOT NULL,
  minutes smallint NOT NULL,
  z real NOT NULL,
  PRIMARY KEY (competition_season_id, round_key, slot),
  FOREIGN KEY (competition_season_id, round_key) REFERENCES agg.league_rounds ON DELETE CASCADE
);
CREATE TABLE agg.round_season_race (
  competition_season_id integer NOT NULL,
  round_key text NOT NULL,
  rank smallint NOT NULL,
  player_id integer NOT NULL REFERENCES core.players,
  team_id integer REFERENCES core.teams,
  z real NOT NULL,
  matches integer NOT NULL,
  minutes integer NOT NULL,
  PRIMARY KEY (competition_season_id, round_key, rank),
  FOREIGN KEY (competition_season_id, round_key) REFERENCES agg.league_rounds ON DELETE CASCADE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.league_rounds, agg.league_round_matches, agg.round_teams, agg.round_season_race TO vega_calc;

-- The rounds of a league edition, in order.
CREATE VIEW api.league_rounds AS
SELECT r.competition_season_id, r.round_key, r.season_id, r.label, r.window_start, r.window_end, r.matches, r.played, r.excused,
  r.status, r.closed_at, r.revision
FROM agg.league_rounds r;

-- A closed round's Team of the Round, slot by slot, with its players' grades.
CREATE VIEW api.round_teams AS
SELECT t.competition_season_id, t.round_key, t.slot, t.line, t.slot_role, t.formation,
  api.public_id('player', t.player_id) AS player_id, p.name AS player_name, ph.source_url AS image_url,
  api.public_id('team', t.team_id) AS team_id, tm.name AS team, cr.source_url AS team_image_url,
  api.public_id('match', t.match_id) AS match_id, t.role, t.minutes, t.z::float8 AS z,
  (100 / (1 + power(10, -t.z / 4.0)))::float8 AS grade
FROM agg.round_teams t
JOIN core.players p ON p.id = t.player_id
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN core.teams tm ON tm.id = t.team_id
LEFT JOIN core.assets cr ON cr.id = tm.crest_asset_id;

-- The league's Player of the Season race after a round: the shrunk mean grade of the season.
CREATE VIEW api.round_season_race AS
SELECT s.competition_season_id, s.round_key, s.rank, api.public_id('player', s.player_id) AS player_id, p.name AS player_name,
  ph.source_url AS image_url, api.public_id('team', s.team_id) AS team_id, tm.name AS team, cr.source_url AS team_image_url,
  s.z::float8 AS z, (100 / (1 + power(10, -s.z / 4.0)))::float8 AS grade, s.matches, s.minutes
FROM agg.round_season_race s
JOIN core.players p ON p.id = s.player_id
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN core.teams tm ON tm.id = s.team_id
LEFT JOIN core.assets cr ON cr.id = tm.crest_asset_id;
GRANT SELECT ON api.league_rounds, api.round_teams, api.round_season_race TO vega_read;
