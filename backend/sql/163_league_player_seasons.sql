-- The five big leagues' player seasons of 2012/13 to 2020/21 (Premier League, LaLiga, Bundesliga, Serie A, Ligue 1),
-- from transfermarkt-datasets (github.com/dcaribou/transfermarkt-datasets, CC0-1.0), read by
-- vega/sources/tm_history.py: one row per league, season, player and club, the totals of his league appearances
-- for that club (a player of two clubs in a season is two rows). Typed totals only; a file's row is never stored.
--
-- Keyed by Transfermarkt's own player and club ids (player_key, club_key) with the names the files give. The links to
-- the base are the Transfermarkt process's (core.provider_ids, provider transfermarkt, current links): player_id and
-- team_id, NULL when no link exists, made again at each run of the reader. A player or a team removed from the base
-- leaves the row unlinked (ON DELETE SET NULL). competition_id is the league's PitchAPI competition of the base.
-- season_id is the start year, as core.seasons' ids; no foreign key, as core.footballdata_matches: a season of the
-- archives is in core.seasons only once its archive is loaded.
--
-- The credit is a row of core.source_revisions ('transfermarkt-datasets'), as the other sources'. The reads (api) are
-- views of their own; the API schema's owner, the migration role, owns this table.
SET LOCAL lock_timeout = '3s';

CREATE TABLE core.league_player_seasons (
  competition_id integer NOT NULL REFERENCES core.competitions,
  season_id smallint NOT NULL CHECK (season_id BETWEEN 2012 AND 2020),
  player_key text NOT NULL CHECK (player_key ~ '^[0-9]{1,10}$'),
  player_name text NOT NULL CHECK (btrim(player_name) <> ''),
  club_key text NOT NULL CHECK (club_key ~ '^[0-9]{1,10}$'),
  club_name text NOT NULL CHECK (btrim(club_name) <> ''),
  player_id integer REFERENCES core.players ON DELETE SET NULL,
  team_id integer REFERENCES core.teams ON DELETE SET NULL,
  matches smallint NOT NULL CHECK (matches > 0),
  minutes integer NOT NULL CHECK (minutes >= 0),
  goals smallint NOT NULL CHECK (goals >= 0),
  assists smallint NOT NULL CHECK (assists >= 0),
  yellow_cards smallint NOT NULL CHECK (yellow_cards >= 0),
  red_cards smallint NOT NULL CHECK (red_cards >= 0),
  PRIMARY KEY (competition_id, season_id, player_key, club_key)
);
CREATE INDEX league_player_seasons_player ON core.league_player_seasons (player_id) WHERE player_id IS NOT NULL;
CREATE INDEX league_player_seasons_team ON core.league_player_seasons (team_id, season_id) WHERE team_id IS NOT NULL;
COMMENT ON TABLE core.league_player_seasons IS
  'transfermarkt-datasets (CC0-1.0): a player''s league totals for one club, five big leagues, 2012/13 to 2020/21 (vega/sources/tm_history.py).';

GRANT SELECT, INSERT, UPDATE, DELETE ON core.league_player_seasons TO vega_collect;
GRANT SELECT ON core.league_player_seasons TO vega_calc;
