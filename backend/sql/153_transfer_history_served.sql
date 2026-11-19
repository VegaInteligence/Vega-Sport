-- Transfermarkt transfers served from their last accepted read (VI-31, docs/calculs/09-audit-2026-11/FAILURE_MODES.md
-- §35, 35w–35z). 135 named a player read only while his last attempt had no error: one refused or failed refresh
-- (HISTORY_MISSING, HISTORY_EMPTY, SCHEMA_CHANGED, transport) turned his accepted list into a 404. A read is now known
-- once one was accepted (read_at: the reader never sets it on a refusal), whatever the last attempt gave; a first read
-- refused stays unknown. A move the last accepted history omits is served with the first day it was missed
-- (absent_since, 139); listed again, it loses the mark and its absence is kept in core.player_transfer_absences.
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE VIEW api.player_transfer_reads AS
SELECT i.entity_id AS player_key, r.read_at
FROM core.provider_ids i
JOIN ops.transfermarkt_reads r ON r.kind = 'transfers' AND r.provider_key = i.provider_key AND r.read_at IS NOT NULL
WHERE i.entity_type = 'player' AND i.provider = 'transfermarkt' AND i.is_current
  AND NOT EXISTS (SELECT 1 FROM ops.provider_links l WHERE l.entity_type = 'player' AND l.provider = 'transfermarkt'
                  AND l.provider_key = i.provider_key AND l.quarantined_at IS NOT NULL);

-- The same columns as 135, then the day the move was first missed (NULL: listed at the last accepted read).
CREATE OR REPLACE VIEW api.player_transfers AS
SELECT x.player_id AS player_key, x.transfer_date, x.kind::text AS kind, x.fee_eur::float8 AS fee_eur, x.source_key,
  api.public_id('team', x.from_team_id) AS from_id, coalesce(ft.name, fc.name) AS from_name, fa.source_url AS from_image_url,
  api.public_id('team', x.to_team_id) AS to_id, coalesce(tt.name, tc.name) AS to_name, ta.source_url AS to_image_url,
  x.absent_since
FROM core.player_transfers x
LEFT JOIN core.teams ft ON ft.id = x.from_team_id
LEFT JOIN core.assets fa ON fa.id = ft.crest_asset_id
LEFT JOIN core.provider_clubs fc ON fc.provider = 'transfermarkt' AND fc.provider_key = x.from_provider_club
LEFT JOIN core.teams tt ON tt.id = x.to_team_id
LEFT JOIN core.assets ta ON ta.id = tt.crest_asset_id
LEFT JOIN core.provider_clubs tc ON tc.provider = 'transfermarkt' AND tc.provider_key = x.to_provider_club
WHERE x.source = 'transfermarkt' AND NOT x.pending AND x.transfer_date IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ops.provider_links l WHERE l.entity_type = 'player' AND l.provider = 'transfermarkt'
                  AND l.entity_id = x.player_id AND l.quarantined_at IS NOT NULL);

-- Each absence a later accepted history ended: the move, its key then, the first day it was missed and the day it was
-- listed again. Written by the reader in the transaction that clears absent_since; an authorized deletion of the move
-- (139) takes its absences with it.
CREATE TABLE core.player_transfer_absences (
  transfer_id integer NOT NULL REFERENCES core.player_transfers(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  absent_since date NOT NULL,
  seen_again_on date NOT NULL CHECK (seen_again_on >= absent_since),
  PRIMARY KEY (transfer_id, absent_since)
);
COMMENT ON TABLE core.player_transfer_absences IS
  'Absences of Transfermarkt moves that a later accepted history listed again (VI-31, FAILURE_MODES.md §35).';
-- A proof, as 142, 143 and 146's: read and added to, never changed or removed but with its move. 017's default
-- privileges give the collection role UPDATE and DELETE on every new table of core (FAILURE_MODES.md §36, 36d).
REVOKE ALL ON core.player_transfer_absences FROM PUBLIC, vega_collect, vega_read;
GRANT SELECT, INSERT ON core.player_transfer_absences TO vega_collect;
