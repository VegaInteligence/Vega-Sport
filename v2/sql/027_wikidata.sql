-- Club, stadium and coach facts from Wikidata and Wikimedia Commons (doc, Référentiel:
-- "fondation, stade, entraîneur … Wikidata"), read by main's own readers
-- (v2/sources/bridge.mjs) and written as typed facts (vega_v2/sources/wikidata.py).

-- Wikidata partial dates are kept as written ("1972", "1998-01", "1998-01-28").
ALTER TABLE core.venues
  ADD COLUMN capacity_observed text CHECK (capacity_observed ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  ADD COLUMN opened text CHECK (opened ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  ADD COLUMN created text CHECK (created ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  ADD COLUMN wikidata_fetched_at timestamptz;
ALTER TABLE core.teams ADD COLUMN wikidata_fetched_at timestamptz;
-- A coach portrait search (main's lookup version 3): when, and with which version.
ALTER TABLE core.coaches
  ADD COLUMN portrait_checked_at timestamptz,
  ADD COLUMN portrait_lookup_version smallint;
ALTER TABLE core.venue_plans ADD COLUMN detail text;

-- Reads (legacy /api/club-wikidata, /api/coach-portrait, /api/stadium).
CREATE VIEW api.club_facts AS
SELECT t.id AS team_id, api.public_id('team', t.id) AS public_id, t.name, t.country_code,
  u.provider_key AS uefa_id, w.provider_key AS wikidata_id, t.founded_year, t.wikidata_fetched_at AS fetched_at,
  v.name AS stadium, vw.provider_key AS stadium_id,
  (SELECT n.name FROM core.entity_names n WHERE n.entity_type = 'venue' AND n.entity_id = v.id AND n.kind = 'alias' AND n.source = 'wikidata'
   ORDER BY n.name LIMIT 1) AS stadium_alias,
  c.name AS coach, ph.source_url AS coach_photo_url, ph.author AS coach_photo_author, ph.license AS coach_photo_license,
  ph.source_page_url AS coach_photo_source
FROM core.teams t
LEFT JOIN core.provider_ids u ON u.entity_type = 'team' AND u.entity_id = t.id AND u.provider = 'uefa' AND u.is_current
LEFT JOIN core.provider_ids w ON w.entity_type = 'team' AND w.entity_id = t.id AND w.provider = 'wikidata' AND w.is_current
LEFT JOIN core.venues v ON v.id = t.home_venue_id
LEFT JOIN core.provider_ids vw ON vw.entity_type = 'venue' AND vw.entity_id = v.id AND vw.provider = 'wikidata' AND vw.is_current
LEFT JOIN LATERAL (
  SELECT k.coach_id FROM core.team_coach_tenures k WHERE k.team_id = t.id AND k.end_date IS NULL AND k.source = 'wikidata'
  ORDER BY k.start_date DESC LIMIT 1
) tenure ON true
LEFT JOIN core.coaches c ON c.id = tenure.coach_id
LEFT JOIN core.assets ph ON ph.id = c.photo_asset_id
WHERE t.wikidata_fetched_at IS NOT NULL AND w.provider_key IS NOT NULL;

CREATE VIEW api.coach_portraits AS
SELECT c.name, lower(c.name) AS lowered, c.portrait_lookup_version AS lookup_version, c.portrait_checked_at,
  ph.source_url AS photo_url, ph.author, ph.license, ph.source_page_url
FROM core.coaches c LEFT JOIN core.assets ph ON ph.id = c.photo_asset_id
WHERE c.portrait_checked_at IS NOT NULL;

CREATE VIEW api.stadiums AS
SELECT w.provider_key AS id, v.id AS venue_id, v.name, v.capacity, v.capacity_observed, v.latitude, v.longitude,
  v.created, v.opened, v.wikidata_fetched_at AS fetched_at
FROM core.venues v
JOIN core.provider_ids w ON w.entity_type = 'venue' AND w.entity_id = v.id AND w.provider = 'wikidata' AND w.is_current
WHERE v.wikidata_fetched_at IS NOT NULL;

CREATE VIEW api.stadium_plans AS
SELECT p.venue_id, p.seq, p.title, p.url, a.source_url AS image_url, p.source, p.detail, p.format, p.is_embedded, p.allow_geolocation
FROM core.venue_plans p LEFT JOIN core.assets a ON a.id = p.image_asset_id;
