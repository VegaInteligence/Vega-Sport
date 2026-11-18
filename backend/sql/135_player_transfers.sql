-- A linked player's transfers for the site, and the club of each of his valuations
-- (vega/transfermarkt.py writes both): the value curve of the player page shows the club he
-- joins at the date of each transfer. None of a doubted link, as for the values (114) and
-- the injuries (116).
SET LOCAL lock_timeout = '3s';

-- A club is named the same way in both views: one of ours (its public id, our name, its
-- crest) when the provider's club is linked to a team, else the provider's name alone.
-- Columns are added at the end: the profiles (114) and the facts' coverage (106) read the
-- first three.
CREATE OR REPLACE VIEW api.player_market_values AS
SELECT v.player_id, v.valued_at, v.value_eur::float8 AS value_eur,
  api.public_id('team', v.team_id) AS club_id, coalesce(t.name, c.name) AS club_name, a.source_url AS club_image_url
FROM core.player_market_values v
LEFT JOIN core.teams t ON t.id = v.team_id
LEFT JOIN core.assets a ON a.id = t.crest_asset_id
LEFT JOIN core.provider_clubs c ON c.provider = 'transfermarkt' AND c.provider_key = v.provider_club
WHERE v.source = 'transfermarkt' AND v.value_eur >= 0
  AND NOT EXISTS (SELECT 1 FROM ops.provider_links l WHERE l.entity_type = 'player' AND l.provider = 'transfermarkt'
                  AND l.entity_id = v.player_id AND l.quarantined_at IS NOT NULL);

-- The transfers made: a pending one (agreed, not yet made) and one without a date are not
-- shown. Every kind is, moves inside a club (youth and reserve sides) included: the kind tells.
CREATE VIEW api.player_transfers AS
SELECT x.player_id AS player_key, x.transfer_date, x.kind::text AS kind, x.fee_eur::float8 AS fee_eur, x.source_key,
  api.public_id('team', x.from_team_id) AS from_id, coalesce(ft.name, fc.name) AS from_name, fa.source_url AS from_image_url,
  api.public_id('team', x.to_team_id) AS to_id, coalesce(tt.name, tc.name) AS to_name, ta.source_url AS to_image_url
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
GRANT SELECT ON api.player_transfers TO vega_read;

-- Whose transfers were read: a player without a row there is not « never transferred » but not known.
CREATE VIEW api.player_transfer_reads AS
SELECT i.entity_id AS player_key, r.read_at
FROM core.provider_ids i
JOIN ops.transfermarkt_reads r ON r.kind = 'transfers' AND r.provider_key = i.provider_key AND r.read_at IS NOT NULL AND r.error_code IS NULL
WHERE i.entity_type = 'player' AND i.provider = 'transfermarkt' AND i.is_current
  AND NOT EXISTS (SELECT 1 FROM ops.provider_links l WHERE l.entity_type = 'player' AND l.provider = 'transfermarkt'
                  AND l.provider_key = i.provider_key AND l.quarantined_at IS NOT NULL);
GRANT SELECT ON api.player_transfer_reads TO vega_read;
