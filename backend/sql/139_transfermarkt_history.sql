-- Transfermarkt refreshes keep what was accepted (VI-31, FAILURE_MODES.md §20). The reader updates
-- a player's transfers by their native key and deletes none; a move the provider no longer lists
-- keeps its facts and the first day it was missed. A contract the provider no longer names as its
-- current one keeps its observed expiry and is set aside from the day of the change, never ended at
-- an invented date. Nothing here changes a stored row.
SET LOCAL lock_timeout = '3s';

-- The first day an accepted history did not list the move (NULL: listed at the last accepted
-- read). Never a cancellation: the provider does not say one.
ALTER TABLE core.player_transfers ADD COLUMN IF NOT EXISTS absent_since date;
-- The day from which a contract is no longer its source's current claim (NULL: it still is).
ALTER TABLE core.player_contracts ADD COLUMN IF NOT EXISTS superseded_on date;

-- One row per player and Transfermarkt transfer key. Rows without a key, and every other source,
-- are not concerned. A base already holding a repeated key stops here with the first pair: no row
-- is removed by choice, a person decides which one is the move.
DO $$
DECLARE
  repeated integer;
  first_pair text;
BEGIN
  SELECT count(*)::int, (array_agg(format('player %s, key %s, %s rows', player_id, source_key, n) ORDER BY player_id, source_key))[1]
  INTO repeated, first_pair
  FROM (SELECT player_id, source_key, count(*) AS n FROM core.player_transfers
        WHERE source = 'transfermarkt' AND source_key IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) d;
  IF repeated > 0 THEN
    RAISE EXCEPTION 'TRANSFER_KEYS_NOT_UNIQUE: % Transfermarkt player/key pairs hold more than one transfer (first: %); nothing was changed', repeated, first_pair;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS player_transfers_transfermarkt_key ON core.player_transfers (player_id, source_key)
  WHERE source = 'transfermarkt' AND source_key IS NOT NULL;

-- A refresh never deletes a Transfermarkt transfer or contract. The reader before VI-31 deleted
-- them at every read: rolled back to it, its deletions fail here and its process restarts; nothing
-- is lost. A person's deletion says so in its transaction: SET LOCAL vega.allow_history_delete = 'on'.
CREATE OR REPLACE FUNCTION core.keep_transfermarkt_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source = 'transfermarkt' AND coalesce(current_setting('vega.allow_history_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION 'TRANSFERMARKT_HISTORY_KEPT: a Transfermarkt row of % (player %) is kept; an authorized deletion sets vega.allow_history_delete to on in its transaction',
      TG_TABLE_NAME, OLD.player_id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE OR REPLACE TRIGGER keep_transfermarkt_history BEFORE DELETE ON core.player_transfers
  FOR EACH ROW EXECUTE FUNCTION core.keep_transfermarkt_history();
CREATE OR REPLACE TRIGGER keep_transfermarkt_history BEFORE DELETE ON core.player_contracts
  FOR EACH ROW EXECUTE FUNCTION core.keep_transfermarkt_history();

-- A contract is confirmed while no later claim of its source set it aside, and none of a doubted
-- Transfermarkt link. A link is doubted when a quarantined ops.provider_links row names the player,
-- or names the key of his current link (a merge may have moved that link to him). Same columns.
CREATE OR REPLACE VIEW api.confirmed_player_contracts AS
SELECT c.player_id, min(c.team_id) AS team_id, min(c.end_date) AS end_date,
  min(c.end_season_year) AS end_season_year, min(c.end_season_competition) AS end_season_competition
FROM core.player_contracts c
WHERE c.as_of <= current_date AND c.start_date <= current_date
  AND CASE WHEN c.end_date IS NOT NULL THEN c.end_date >= current_date
           WHEN c.end_season_year IS NOT NULL THEN c.end_season_year >= extract(year FROM current_date)
           ELSE true END
  AND (c.superseded_on IS NULL OR c.superseded_on > current_date)
  AND NOT (c.source = 'transfermarkt' AND EXISTS (
    SELECT 1 FROM ops.provider_links d
    WHERE d.entity_type = 'player' AND d.provider = 'transfermarkt' AND d.quarantined_at IS NOT NULL
      AND (d.entity_id = c.player_id OR d.provider_key IN (
        SELECT i.provider_key FROM core.provider_ids i
        WHERE i.entity_type = 'player' AND i.provider = 'transfermarkt' AND i.entity_id = c.player_id AND i.is_current))))
GROUP BY c.player_id
HAVING count(DISTINCT c.team_id) = 1
  AND count(DISTINCT (c.end_date, c.end_season_year, c.end_season_competition)) = 1
  AND bool_and(c.end_date IS NOT NULL OR c.end_season_year IS NOT NULL);

-- The profile (114) with the same doubt: by the player, or by the key of his current link.
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
    AND d.quarantined_at IS NOT NULL
    AND (d.entity_id = p.id OR d.provider_key IN (
      SELECT i.provider_key FROM core.provider_ids i
      WHERE i.entity_type = 'player' AND i.provider = 'transfermarkt' AND i.entity_id = p.id AND i.is_current))
  LIMIT 1
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
