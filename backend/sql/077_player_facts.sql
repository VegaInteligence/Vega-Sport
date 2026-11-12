-- Players' birth dates and heights read from Wikidata club by club
-- (vega/sources/player_facts.py): when each club's players were last read, and the two
-- facts on the player profile.
ALTER TABLE core.teams ADD COLUMN wikidata_players_at timestamptz;

CREATE OR REPLACE VIEW api.player_profiles AS
SELECT p.id AS player_id, api.public_id('player', p.id) AS public_id, p.name, p.short_name, p.position_id, p.country_code,
  p.shirt_number, ph.source_url AS image_url, p.birth_date::text AS birth_date, p.height_cm
FROM core.players p LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id;
