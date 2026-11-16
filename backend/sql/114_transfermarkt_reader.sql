-- The Transfermarkt reader (vega/transfermarkt.py), a process of the worker: what it read, how
-- each of its links was made, and its queue. Typed rows only: a response is never stored.
SET LOCAL lock_timeout = '3s';

-- How a link of core.provider_ids was made, and whether it is doubted. A quarantined link
-- shows nothing of the provider (its values, its facts) until a person looks at it.
CREATE TABLE ops.provider_links (
  entity_type core.entity_type NOT NULL,
  provider core.provider NOT NULL,
  provider_key text NOT NULL,
  entity_id integer NOT NULL,
  rule text NOT NULL CHECK (rule ~ '^[a-z_]{1,40}$'),
  evidence integer NOT NULL DEFAULT 0 CHECK (evidence >= 0),
  linked_at timestamptz NOT NULL DEFAULT now(),
  quarantined_at timestamptz,
  quarantine_reason text CHECK (quarantine_reason IS NULL OR quarantine_reason ~ '^[a-z_]{1,40}$'),
  PRIMARY KEY (entity_type, provider, provider_key)
);
CREATE INDEX provider_links_entity ON ops.provider_links (entity_type, entity_id, provider);

-- A provider club that the votes gave to two of our teams, or a team they gave two provider
-- clubs (a rename, a merge, a reserve side): no link is written, a person decides.
CREATE TABLE ops.provider_link_conflicts (
  entity_type core.entity_type NOT NULL,
  provider core.provider NOT NULL,
  provider_key text NOT NULL,
  entity_id integer NOT NULL,
  reason text NOT NULL CHECK (reason ~ '^[a-z_]{1,40}$'),
  noted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, provider, provider_key, entity_id)
);

-- A provider's player as last read (linked to one of ours or not: the squads name players the
-- base may link later). Birth dates read here never overwrite core.players.
CREATE TABLE core.provider_players (
  provider core.provider NOT NULL,
  provider_key text NOT NULL CHECK (provider_key ~ '^[0-9]{1,10}$'),
  name text,
  birth_date date,
  position text,
  height_cm smallint CHECK (height_cm IS NULL OR height_cm BETWEEN 140 AND 220),
  preferred_foot core.foot,
  contract_until date,
  provider_club text CHECK (provider_club IS NULL OR provider_club ~ '^[0-9]{1,10}$'),
  joined_on date,
  market_value_eur bigint CHECK (market_value_eur IS NULL OR market_value_eur > 0),
  market_value_on date,
  read_on date NOT NULL,
  PRIMARY KEY (provider, provider_key)
);

-- A provider's club: its name (the reserve-side rule reads it), country and whether it is a
-- national team (never a club's vote).
CREATE TABLE core.provider_clubs (
  provider core.provider NOT NULL,
  provider_key text NOT NULL CHECK (provider_key ~ '^[0-9]{1,10}$'),
  name text,
  country_key text,
  is_national boolean,
  read_on date NOT NULL,
  PRIMARY KEY (provider, provider_key)
);

-- A provider club's squad of one season: who it lists.
CREATE TABLE core.provider_squads (
  provider core.provider NOT NULL,
  club_key text NOT NULL CHECK (club_key ~ '^[0-9]{1,10}$'),
  season_year smallint NOT NULL CHECK (season_year BETWEEN 1900 AND 2100),
  player_key text NOT NULL CHECK (player_key ~ '^[0-9]{1,10}$'),
  shirt_number smallint,
  read_on date NOT NULL,
  PRIMARY KEY (provider, club_key, season_year, player_key)
);
CREATE INDEX provider_squads_player ON core.provider_squads (provider, player_key);

-- The values history names the club of each valuation.
ALTER TABLE core.player_market_values
  ADD COLUMN team_id integer REFERENCES core.teams,
  ADD COLUMN provider_club text;

-- A provider's transfers and injuries are replaced whole at each read of the player: the
-- provider edits names and dates, and an injury has no key of its own.
ALTER TABLE core.player_transfers
  ADD COLUMN source_key text,
  ADD COLUMN season_label text,
  ADD COLUMN from_provider_club text,
  ADD COLUMN to_provider_club text,
  ADD COLUMN market_value_eur bigint,
  ADD COLUMN contract_until date,
  ADD COLUMN pending boolean NOT NULL DEFAULT false;
CREATE INDEX player_transfers_player ON core.player_transfers (player_id, source);
ALTER TABLE core.player_injuries
  ADD COLUMN days smallint,
  ADD COLUMN season_year smallint;
CREATE INDEX player_injuries_player ON core.player_injuries (player_id, source);

-- The reader's queue: one row per unit of work (a player's values, transfers, injuries or
-- profile; a club's squad of a season, key club:season; a club's name). The next due first,
-- by priority (1 = a player of the season in progress).
CREATE TABLE ops.transfermarkt_reads (
  kind text NOT NULL CHECK (kind IN ('profile', 'values', 'transfers', 'injuries', 'squad', 'club')),
  provider_key text NOT NULL CHECK (provider_key ~ '^[0-9]{1,10}(:[0-9]{4})?$'),
  priority smallint NOT NULL CHECK (priority BETWEEN 1 AND 9),
  next_due_at timestamptz NOT NULL,
  read_at timestamptz,
  attempts smallint NOT NULL DEFAULT 0,
  last_http_status smallint,
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  rows_written integer NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, provider_key)
);
CREATE INDEX transfermarkt_reads_due ON ops.transfermarkt_reads (priority, next_due_at);

-- The reader's state, one row: a pause after a refusal survives a restart or a deploy.
CREATE TABLE ops.transfermarkt_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  paused_until timestamptz,
  blocked_since timestamptz,
  blocks_in_row smallint NOT NULL DEFAULT 0,
  gave_up_at timestamptz,
  last_request_at timestamptz,
  requests integer NOT NULL DEFAULT 0,
  planned_at timestamptz
);
INSERT INTO ops.transfermarkt_state (id) VALUES (1);

-- Every refusal: when, until when the reader waits, what it was told.
CREATE TABLE ops.transfermarkt_blocks (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  resume_at timestamptz NOT NULL,
  http_status smallint,
  reason text NOT NULL CHECK (reason ~ '^[A-Z][A-Z0-9_]{0,63}$')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON ops.provider_links, ops.provider_link_conflicts, core.provider_players,
  core.provider_clubs, core.provider_squads, ops.transfermarkt_reads, ops.transfermarkt_state, ops.transfermarkt_blocks
  TO vega_collect;

-- The values shown: none of a doubted link.
CREATE OR REPLACE VIEW api.player_market_values AS
SELECT v.player_id, v.valued_at, v.value_eur::float8 AS value_eur
FROM core.player_market_values v
WHERE v.source = 'transfermarkt' AND v.value_eur >= 0
  AND NOT EXISTS (SELECT 1 FROM ops.provider_links l WHERE l.entity_type = 'player' AND l.provider = 'transfermarkt'
                  AND l.entity_id = v.player_id AND l.quarantined_at IS NOT NULL);

-- A player's profile: the contract the reader saw last (its club when that club is one of
-- ours), else the snapshot's; nothing of a doubted link.
CREATE OR REPLACE VIEW api.player_profiles AS
SELECT p.id AS player_id, api.public_id('player', p.id) AS public_id, p.name, p.short_name, p.position_id, p.country_code,
  p.shirt_number, ph.source_url AS image_url, p.birth_date::text AS birth_date, p.height_cm,
  p.preferred_foot::text AS preferred_foot, contract.end_date::text AS contract_until,
  t.name AS contract_team,
  coalesce(live.contract_until, observed.contract_until)::text AS observed_contract_until,
  CASE WHEN live.contract_until IS NOT NULL THEN coalesce(live_team.name, live_club.name) ELSE observed.club_name END AS observed_contract_team,
  CASE WHEN live.contract_until IS NOT NULL THEN live.read_on ELSE observed.observed_on END::text AS observed_contract_on,
  contract.end_season_year AS contract_until_season,
  contract.end_season_competition AS contract_season_competition,
  market.value_eur AS market_value_eur, market.valued_at::text AS market_value_updated_at
FROM core.players p
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN api.confirmed_player_contracts contract ON contract.player_id = p.id
LEFT JOIN core.teams t ON t.id = contract.team_id
LEFT JOIN LATERAL (
  SELECT true AS doubted FROM ops.provider_links d WHERE d.entity_type = 'player' AND d.provider = 'transfermarkt'
    AND d.entity_id = p.id AND d.quarantined_at IS NOT NULL LIMIT 1
) doubt ON true
LEFT JOIN core.player_fact_observations observed
  ON observed.player_id = p.id AND observed.source = 'transfermarkt_snapshot' AND doubt.doubted IS NULL
  AND observed.contract_until IS NOT NULL AND observed.club_name IS NOT NULL
  AND (observed.birth_date IS NULL OR observed.birth_date = p.birth_date)
LEFT JOIN core.provider_ids link ON link.entity_type = 'player' AND link.provider = 'transfermarkt'
  AND link.entity_id = p.id AND link.is_current AND doubt.doubted IS NULL
LEFT JOIN core.provider_players live ON live.provider = 'transfermarkt' AND live.provider_key = link.provider_key
  AND live.contract_until >= current_date
LEFT JOIN core.provider_ids club_link ON club_link.entity_type = 'team' AND club_link.provider = 'transfermarkt'
  AND club_link.provider_key = live.provider_club AND club_link.is_current
LEFT JOIN core.teams live_team ON live_team.id = club_link.entity_id
LEFT JOIN core.provider_clubs live_club ON live_club.provider = 'transfermarkt' AND live_club.provider_key = live.provider_club
LEFT JOIN LATERAL (
  SELECT v.value_eur, v.valued_at FROM api.player_market_values v
  WHERE v.player_id = p.id ORDER BY v.valued_at DESC LIMIT 1
) market ON true;

-- The reader's progress for the status page: units by kind, due, read, failing; its pause.
CREATE VIEW api.provider_reader_progress AS
SELECT r.kind, count(*)::int AS units,
  count(*) FILTER (WHERE r.read_at IS NULL)::int AS never_read,
  count(*) FILTER (WHERE r.next_due_at <= now())::int AS due,
  count(*) FILTER (WHERE r.error_code IS NOT NULL)::int AS failing,
  max(r.read_at) AS last_read_at,
  (SELECT paused_until FROM ops.transfermarkt_state) AS paused_until,
  (SELECT gave_up_at FROM ops.transfermarkt_state) AS gave_up_at
FROM ops.transfermarkt_reads r GROUP BY r.kind;
GRANT SELECT ON api.provider_reader_progress TO vega_read;
