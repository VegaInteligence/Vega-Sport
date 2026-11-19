-- Transfermarkt values, injuries and squads keep what an answer omits; the injuries stay served from their last accepted
-- read; a FIFA edition knows when it was last read (lot « garanties », docs/calculs/09-audit-2026-11/FAILURE_MODES.md
-- §44, 40b–40k, 40o). Additive: three marks and one date, three views with one more column or one condition less.
-- No row is changed here.
SET LOCAL lock_timeout = '3s';

-- The first day an accepted answer no longer listed the row (NULL: listed at the last accepted read). The reader never
-- deletes these rows any more; listed again, the mark goes (as core.player_transfers.absent_since, 139 and 153).
ALTER TABLE core.player_market_values ADD COLUMN absent_since date;
ALTER TABLE core.player_injuries ADD COLUMN absent_since date;
ALTER TABLE core.provider_squads ADD COLUMN absent_since date;

-- When the FIFA reader last read the edition (fifa.py re-reads the latest one weekly while it is the catalogue's latest).
ALTER TABLE core.ranking_editions ADD COLUMN checked_at timestamptz;

-- 135's columns, then the day the point was first missed.
CREATE OR REPLACE VIEW api.player_market_values AS
SELECT v.player_id, v.valued_at, v.value_eur::float8 AS value_eur,
  api.public_id('team', v.team_id) AS club_id, coalesce(t.name, c.name) AS club_name, a.source_url AS club_image_url,
  v.absent_since
FROM core.player_market_values v
LEFT JOIN core.teams t ON t.id = v.team_id
LEFT JOIN core.assets a ON a.id = t.crest_asset_id
LEFT JOIN core.provider_clubs c ON c.provider = 'transfermarkt' AND c.provider_key = v.provider_club
WHERE v.source = 'transfermarkt' AND v.value_eur >= 0
  AND NOT EXISTS (SELECT 1 FROM ops.provider_links l WHERE l.entity_type = 'player' AND l.provider = 'transfermarkt'
                  AND l.entity_id = v.player_id AND l.quarantined_at IS NOT NULL);

-- 116's columns, then the day the episode was first missed.
CREATE OR REPLACE VIEW api.player_injuries AS
SELECT i.player_id AS player_key, api.public_id('player', i.player_id) AS player_id, i.kind::text AS kind, i.label,
  i.start_date, i.end_date, i.days, i.matches_missed, i.season_year, i.absent_since
FROM core.player_injuries i
WHERE i.source = 'transfermarkt'
  AND NOT EXISTS (SELECT 1 FROM ops.provider_links l WHERE l.entity_type = 'player' AND l.provider = 'transfermarkt'
                  AND l.entity_id = i.player_id AND l.quarantined_at IS NOT NULL);

-- Known once a read was accepted (read_at: the reader sets it only on an accepted read), whatever the last attempt gave:
-- a refused or failed refresh no longer turns the accepted list into a 404 (as 153 for the transfers).
CREATE OR REPLACE VIEW api.player_injury_reads AS
SELECT i.entity_id AS player_key, r.read_at
FROM core.provider_ids i
JOIN ops.transfermarkt_reads r ON r.kind = 'injuries' AND r.provider_key = i.provider_key AND r.read_at IS NOT NULL
WHERE i.entity_type = 'player' AND i.provider = 'transfermarkt' AND i.is_current
  AND NOT EXISTS (SELECT 1 FROM ops.provider_links l WHERE l.entity_type = 'player' AND l.provider = 'transfermarkt'
                  AND l.provider_key = i.provider_key AND l.quarantined_at IS NOT NULL);
