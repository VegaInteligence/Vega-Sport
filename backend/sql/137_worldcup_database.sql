-- The Fjelstul World Cup Database (github.com/jfjelstul/worldcup, CC-BY-SA 4.0), read by vega/sources/worldcup.py
-- (the user's decision of 18 November 2026): what the base lacks of the World Cups it archives. The archives give a
-- match its day, teams and score; this database gives its stadium, referee, managers and scorers (1930 to 2022) and,
-- from 1970, its line-ups, cards and substitutions; the squads; the awards. Typed rows only, keyed by the database's
-- own identifiers; a file's row is never stored as it is.
--
-- Its people are its own: nothing is written to core.players, a name alone links nobody. The one link to the base
-- is a match's (worldcup_matches.match_id): the archived match of the same edition, day and teams. An archive that
-- replaces that match clears the link (ON DELETE SET NULL), and the reader pairs it again at its next round.
--
-- The licence's credit is a row of core.source_revisions ('fjelstul-worldcup'), as the other sources'.
SET LOCAL lock_timeout = '3s';

CREATE TABLE core.worldcup_tournaments (
  tournament_key text PRIMARY KEY CHECK (tournament_key ~ '^WC-[0-9]{4}$'),
  name text NOT NULL,
  year smallint NOT NULL CHECK (year BETWEEN 1930 AND 2100),
  women boolean NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  host_country text,
  winner text,
  teams smallint NOT NULL CHECK (teams BETWEEN 2 AND 64)
);

CREATE TABLE core.worldcup_teams (
  team_key text PRIMARY KEY CHECK (team_key ~ '^T-[0-9]{2,3}$'),
  name text NOT NULL,
  code text,
  confederation text
);

CREATE TABLE core.worldcup_stadiums (
  stadium_key text PRIMARY KEY CHECK (stadium_key ~ '^S-[0-9]{3}$'),
  name text NOT NULL,
  city text,
  country text,
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  wikipedia_url text
);

-- The players, managers and referees of the database, each under its own key (P-, M-, R-). A birth date the
-- database does not know and a single-name player's given name are absent, not a placeholder.
CREATE TABLE core.worldcup_people (
  person_key text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('player', 'manager', 'referee')),
  family_name text NOT NULL,
  given_name text,
  birth_date date,
  country text,
  female boolean NOT NULL,
  goalkeeper boolean,
  defender boolean,
  midfielder boolean,
  forward boolean,
  wikipedia_url text,
  CHECK ((role = 'player' AND person_key ~ '^P-[0-9]{5}$') OR (role = 'manager' AND person_key ~ '^M-[0-9]{3}$')
      OR (role = 'referee' AND person_key ~ '^R-[0-9]{3}$'))
);

-- A match as the database gives it. Its score is kept to check the pair (the two sources agreed on every one of the
-- 964 men's matches on 18 November 2026); the site reads the base's own score.
CREATE TABLE core.worldcup_matches (
  match_key text PRIMARY KEY CHECK (match_key ~ '^M-[0-9]{4}-[0-9]{2,3}$'),
  tournament_key text NOT NULL REFERENCES core.worldcup_tournaments,
  stage text NOT NULL,
  group_name text,
  replayed boolean NOT NULL,
  replay boolean NOT NULL,
  match_date date NOT NULL,
  match_time time,
  stadium_key text NOT NULL REFERENCES core.worldcup_stadiums,
  home_team_key text NOT NULL REFERENCES core.worldcup_teams,
  away_team_key text NOT NULL REFERENCES core.worldcup_teams,
  home_score smallint NOT NULL CHECK (home_score >= 0),
  away_score smallint NOT NULL CHECK (away_score >= 0),
  extra_time boolean NOT NULL,
  shootout boolean NOT NULL,
  home_penalties smallint CHECK (home_penalties >= 0),
  away_penalties smallint CHECK (away_penalties >= 0),
  -- The base's archived match, when exactly one has the same edition, day and teams.
  match_id integer UNIQUE REFERENCES core.matches(id) ON DELETE SET NULL,
  CHECK (home_team_key <> away_team_key),
  CHECK (shootout = (home_penalties IS NOT NULL) AND shootout = (away_penalties IS NOT NULL))
);
CREATE INDEX worldcup_matches_tournament ON core.worldcup_matches (tournament_key, match_date);

CREATE TABLE core.worldcup_squads (
  tournament_key text NOT NULL REFERENCES core.worldcup_tournaments,
  team_key text NOT NULL REFERENCES core.worldcup_teams,
  player_key text NOT NULL REFERENCES core.worldcup_people,
  shirt_number smallint CHECK (shirt_number BETWEEN 1 AND 99),
  position text,
  PRIMARY KEY (tournament_key, team_key, player_key)
);

-- Who was at a match: the players who played it (from 1970: the starters and those who came on), each team's manager,
-- the referee. A referee has no team; shirt number, position and starter are a player's.
CREATE TABLE core.worldcup_appearances (
  match_key text NOT NULL REFERENCES core.worldcup_matches,
  person_key text NOT NULL REFERENCES core.worldcup_people,
  role text NOT NULL CHECK (role IN ('player', 'manager', 'referee')),
  team_key text REFERENCES core.worldcup_teams,
  shirt_number smallint CHECK (shirt_number BETWEEN 1 AND 99),
  position text,
  starter boolean,
  PRIMARY KEY (match_key, person_key),
  CHECK ((role = 'referee') = (team_key IS NULL)),
  CHECK (role = 'player' OR (shirt_number IS NULL AND position IS NULL AND starter IS NULL)),
  CHECK (role <> 'player' OR starter IS NOT NULL)
);
CREATE INDEX worldcup_appearances_person ON core.worldcup_appearances (person_key);

-- A goal: the team it counts for, its scorer and the scorer's team (the other one for an own goal).
CREATE TABLE core.worldcup_goals (
  goal_key text PRIMARY KEY CHECK (goal_key ~ '^G-[0-9]{4,5}$'),
  match_key text NOT NULL REFERENCES core.worldcup_matches,
  team_key text NOT NULL REFERENCES core.worldcup_teams,
  player_key text NOT NULL REFERENCES core.worldcup_people,
  player_team_key text NOT NULL REFERENCES core.worldcup_teams,
  minute smallint NOT NULL CHECK (minute BETWEEN 0 AND 130),
  stoppage smallint NOT NULL CHECK (stoppage BETWEEN 0 AND 60),
  period text,
  own_goal boolean NOT NULL,
  penalty boolean NOT NULL,
  CHECK (own_goal = (team_key <> player_team_key))
);
CREATE INDEX worldcup_goals_match ON core.worldcup_goals (match_key);

-- A card, as the database flags it: a yellow, a second yellow (sending off), a red.
CREATE TABLE core.worldcup_bookings (
  booking_key text PRIMARY KEY CHECK (booking_key ~ '^B-[0-9]{4,5}$'),
  match_key text NOT NULL REFERENCES core.worldcup_matches,
  team_key text NOT NULL REFERENCES core.worldcup_teams,
  player_key text NOT NULL REFERENCES core.worldcup_people,
  minute smallint NOT NULL CHECK (minute BETWEEN 0 AND 130),
  stoppage smallint NOT NULL CHECK (stoppage BETWEEN 0 AND 60),
  period text,
  yellow boolean NOT NULL,
  red boolean NOT NULL,
  second_yellow boolean NOT NULL,
  sending_off boolean NOT NULL
);
CREATE INDEX worldcup_bookings_match ON core.worldcup_bookings (match_key);

-- A substitution is two rows of the database: the player going off and the player coming on. They are kept as they
-- are: two changes of one minute are not paired here.
CREATE TABLE core.worldcup_substitutions (
  substitution_key text PRIMARY KEY CHECK (substitution_key ~ '^S-[0-9]{4,5}$'),
  match_key text NOT NULL REFERENCES core.worldcup_matches,
  team_key text NOT NULL REFERENCES core.worldcup_teams,
  player_key text NOT NULL REFERENCES core.worldcup_people,
  minute smallint NOT NULL CHECK (minute BETWEEN 0 AND 130),
  stoppage smallint NOT NULL CHECK (stoppage BETWEEN 0 AND 60),
  period text,
  going_off boolean NOT NULL
);
CREATE INDEX worldcup_substitutions_match ON core.worldcup_substitutions (match_key);

-- The kicks of a shoot-out (from 1982), in the order taken.
CREATE TABLE core.worldcup_shootout_kicks (
  kick_key text PRIMARY KEY CHECK (kick_key ~ '^PK-[0-9]{3,4}$'),
  match_key text NOT NULL REFERENCES core.worldcup_matches,
  team_key text NOT NULL REFERENCES core.worldcup_teams,
  player_key text NOT NULL REFERENCES core.worldcup_people,
  converted boolean NOT NULL,
  position smallint NOT NULL CHECK (position > 0),
  UNIQUE (match_key, position)
);

CREATE TABLE core.worldcup_awards (
  tournament_key text NOT NULL REFERENCES core.worldcup_tournaments,
  award text NOT NULL,
  player_key text NOT NULL REFERENCES core.worldcup_people,
  team_key text NOT NULL REFERENCES core.worldcup_teams,
  shared boolean NOT NULL,
  PRIMARY KEY (tournament_key, award, player_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON core.worldcup_tournaments, core.worldcup_teams, core.worldcup_stadiums, core.worldcup_people,
  core.worldcup_matches, core.worldcup_squads, core.worldcup_appearances, core.worldcup_goals, core.worldcup_bookings,
  core.worldcup_substitutions, core.worldcup_shootout_kicks, core.worldcup_awards TO vega_collect;
