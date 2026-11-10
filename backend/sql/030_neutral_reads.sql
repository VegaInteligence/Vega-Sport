-- The read routes name what they serve, never where it comes from: a source can change
-- without changing a route or one of its parameters. Sources stay in the core tables
-- (core.provider, provider_ids, cup_key) and in the bodies' attribution fields.

-- Ranking editions are keyed by what they cover: the season's ending year for the UEFA
-- coefficients ("2026" = 2025/2026), the publication date otherwise ("2026-10-07"). When
-- two sources hold the same edition, the official one is served.
CREATE OR REPLACE VIEW api.ranking_editions AS
SELECT DISTINCT ON (kind, edition) * FROM (
  SELECT e.id AS edition_id,
    replace(e.kind::text, '_', '-') AS kind,
    CASE e.provider WHEN 'uefa' THEN 'UEFA' WHEN 'fifa' THEN 'FIFA' WHEN 'sportsapi' THEN 'SportsAPI' ELSE e.provider::text END AS provider,
    CASE WHEN e.provider = 'uefa' THEN right(e.label, 4) ELSE e.label END AS edition,
    e.label, e.period, e.published_on, e.is_current, e.source_url, e.source_updated_at, e.updated_at AS retrieved_at,
    e.provider IN ('uefa', 'fifa') AS official_edition,
    (SELECT count(*) FROM core.ranking_rows r WHERE r.edition_id = e.id)::int AS rows
  FROM core.ranking_editions e
) e
ORDER BY kind, edition, official_edition DESC, retrieved_at DESC, edition_id;

-- Cup editions of the complementary sources are addressed by their Vega competition id;
-- `format` names the body layout the site reads (one per source today, not a source name).
CREATE OR REPLACE VIEW api.cup_editions AS
SELECT cs.id AS competition_season_id, split_part(cs.cup_key, ':', 1) AS kind, split_part(cs.cup_key, ':', 2) AS competition,
  cs.native_label AS season, cs.cup_name AS name, cs.cup_source_url AS source_url, cs.cup_data_url AS data_url,
  cs.cup_checked_at AS checked_at, cs.cup_updated_at AS updated_at,
  api.public_id('competition', cs.competition_id) AS competition_id,
  CASE split_part(cs.cup_key, ':', 1) WHEN 'open-cups' THEN 'matches-v1' WHEN 'openligadb' THEN 'rounds-v1' ELSE 'results-v1' END AS format,
  cs.competition_id AS internal_competition_id
FROM core.competition_seasons cs WHERE cs.cup_key IS NOT NULL;
