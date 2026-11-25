-- 25 Nov 2026 (FAILURE_MODES.md §61; hugo: method and mock-up validated): our probable eleven of each club before the
-- provider's line-ups (vega/probable.py, method probable-v1), for the « Compositions » tab of a match not started.
-- Display only: nothing of the forecast, the line-up model, the rankings or core.lineups reads or is changed by these
-- tables. Additive: two tables, two reads, two read grants for the calculation role. The rows of a match are written
-- again by each run of the worker's step and deleted once the match is out of its scope (started, finished, postponed,
-- beyond 7 days), so a match withdrawn by its edition takes them (ON DELETE CASCADE).
SET LOCAL lock_timeout = '3s';

-- One row per match and side computed: the method, when, the window the eleven was guessed from (its complete
-- confirmed elevens, how many and their first and last days) and the template's formation.
CREATE TABLE agg.match_probable_lineups (
  match_id integer NOT NULL REFERENCES core.matches(id) ON DELETE CASCADE,
  season_id smallint NOT NULL REFERENCES core.seasons,
  team_id integer NOT NULL REFERENCES core.teams,
  side core.side NOT NULL,
  method text NOT NULL,
  computed_at timestamptz NOT NULL,
  basis_lineups smallint NOT NULL CHECK (basis_lineups > 0),
  basis_from date NOT NULL,
  basis_to date NOT NULL,
  formation text,
  PRIMARY KEY (match_id, team_id),
  UNIQUE (match_id, side)
);

-- Its players: the guessed starters (role 'starter', in the template's order, with the template slot they take, the
-- share of the window's elevens they started and the absent player they replace) and the absent players removed from
-- it (role 'absent', with the episode that removed them: kind, label, expected return, matches remaining).
CREATE TABLE agg.match_probable_lineup_players (
  match_id integer NOT NULL REFERENCES core.matches(id) ON DELETE CASCADE,
  team_id integer NOT NULL,
  player_id integer NOT NULL REFERENCES core.players,
  role text NOT NULL CHECK (role IN ('starter', 'absent')),
  ord smallint NOT NULL,
  shirt_number smallint,
  position_id smallint,
  pitch_x real,
  pitch_y real,
  share real CHECK (share BETWEEN 0 AND 1),
  replaces_player_id integer REFERENCES core.players,
  absence_kind text CHECK (absence_kind IN ('injury', 'illness', 'suspension')),
  absence_label text,
  expected_return date,
  matches_remaining smallint CHECK (matches_remaining >= 0),
  PRIMARY KEY (match_id, team_id, player_id),
  FOREIGN KEY (match_id, team_id) REFERENCES agg.match_probable_lineups ON DELETE CASCADE,
  CHECK ((role = 'starter') = (share IS NOT NULL))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.match_probable_lineups, agg.match_probable_lineup_players TO vega_calc;
-- The step reads which player links are in quarantine and when a player's suspensions were last read, as
-- api.team_absence_players does (174).
GRANT SELECT ON ops.provider_links, ops.transfermarkt_reads TO vega_calc;

-- Reads (GET /api/matches/{id}/lineups/probable): public ids beside the internal keys the route filters on.
CREATE VIEW api.match_probable_lineups AS
SELECT l.match_id AS match_key, api.public_id('match', l.match_id) AS match_id, l.season_id, l.team_id AS team_key,
  api.public_id('team', l.team_id) AS team_id, l.side::text AS side, l.method, l.computed_at, l.basis_lineups, l.basis_from,
  l.basis_to, l.formation
FROM agg.match_probable_lineups l;

CREATE VIEW api.match_probable_lineup_players AS
SELECT x.match_id AS match_key, x.team_id AS team_key, x.role, x.ord, api.public_id('player', x.player_id) AS player_id, p.name,
  ph.source_url AS image_url, x.shirt_number, x.position_id, x.pitch_x, x.pitch_y, x.share,
  CASE WHEN x.replaces_player_id IS NOT NULL THEN api.public_id('player', x.replaces_player_id) END AS replaces_id,
  r.name AS replaces_name, x.absence_kind, x.absence_label, x.expected_return, x.matches_remaining
FROM agg.match_probable_lineup_players x
JOIN core.players p ON p.id = x.player_id
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN core.players r ON r.id = x.replaces_player_id;

GRANT SELECT ON api.match_probable_lineups, api.match_probable_lineup_players TO vega_read;
