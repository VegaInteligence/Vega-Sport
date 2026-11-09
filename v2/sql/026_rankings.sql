-- Ranking facts the site shows beyond position and points (legacy ranking catalogue):
-- the ranked entity as the source names it, its id there, its logo, earned points,
-- clubs still in competition, and, for the UEFA coefficients, each season's points
-- (the European performance places are read from them).
ALTER TABLE core.ranking_rows
  ADD COLUMN provider_key text,
  ADD COLUMN entity_name text,
  ADD COLUMN earned_points real,
  ADD COLUMN teams_still_playing smallint,
  ADD COLUMN confederation text,
  ADD COLUMN image_asset_id integer REFERENCES core.assets;

ALTER TABLE core.ranking_editions
  ADD COLUMN source_url text,
  ADD COLUMN source_updated_at timestamptz;

CREATE TABLE core.ranking_season_points(
  edition_id integer NOT NULL,
  row_no smallint NOT NULL,
  season_year smallint NOT NULL,
  points real,
  association_points real,
  teams_still_playing smallint,
  PRIMARY KEY (edition_id, row_no, season_year),
  FOREIGN KEY (edition_id, row_no) REFERENCES core.ranking_rows ON DELETE CASCADE
);

-- Reads (legacy /api/rankings/*, /api/club-links): editions under their legacy keys
-- ("2026.uefa" = season 2025/2026, "2026-10-07.fifa"), and their rows.
CREATE VIEW api.ranking_editions AS
SELECT e.id AS edition_id,
  replace(e.kind::text, '_', '-') AS kind,
  CASE e.provider WHEN 'uefa' THEN 'UEFA' WHEN 'fifa' THEN 'FIFA' WHEN 'sportsapi' THEN 'SportsAPI' ELSE e.provider::text END AS provider,
  CASE WHEN e.provider = 'uefa' THEN right(e.label, 4) || '.uefa' ELSE e.label || '.' || e.provider::text END AS edition,
  e.label, e.period, e.published_on, e.is_current, e.source_url, e.source_updated_at, e.updated_at AS retrieved_at,
  e.provider IN ('uefa', 'fifa') AS official_edition,
  (SELECT count(*) FROM core.ranking_rows r WHERE r.edition_id = e.id)::int AS rows
FROM core.ranking_editions e;

CREATE VIEW api.ranking_entries AS
SELECT r.edition_id, r.row_no, r.provider_key, r.entity_name, r.position, r.previous_position, r.points, r.earned_points,
  r.teams_still_playing, r.confederation, coalesce(r.country_code, t.country_code) AS country_code,
  r.team_id AS internal_team_id, api.public_id('team', r.team_id) AS team_id, a.source_url AS image_url
FROM core.ranking_rows r
LEFT JOIN core.teams t ON t.id = r.team_id
LEFT JOIN core.assets a ON a.id = r.image_asset_id;

CREATE VIEW api.ranking_season_points AS SELECT * FROM core.ranking_season_points;

-- A club's UEFA identity, as the ranking names it (legacy club-links).
CREATE VIEW api.club_links AS
SELECT DISTINCT ON (p.entity_id) p.entity_id AS internal_team_id, api.public_id('team', p.entity_id) AS team_id,
  'uefa:' || p.provider_key AS entity_id, t.name AS club_name, r.entity_name AS ranking_name, t.country_code,
  CASE WHEN lower(t.name) = lower(r.entity_name) THEN 'unambiguous-name-and-country' ELSE 'reviewed-alias-and-country' END AS method
FROM core.provider_ids p
JOIN core.teams t ON t.id = p.entity_id
LEFT JOIN core.ranking_rows r ON r.team_id = p.entity_id AND r.provider_key = p.provider_key
LEFT JOIN core.ranking_editions e ON e.id = r.edition_id
WHERE p.entity_type = 'team' AND p.provider = 'uefa'
  AND EXISTS (SELECT 1 FROM core.provider_ids x WHERE x.entity_type = 'team' AND x.entity_id = p.entity_id AND x.provider = 'pitchapi')
ORDER BY p.entity_id, e.is_current DESC NULLS LAST, e.published_on DESC NULLS LAST, e.id DESC;
