-- A cup-only competition's verified logo in the cup catalogue (VI-27, docs/calculs/09-audit-2026-11/FAILURE_MODES.md
-- §22, C6): the logo of the edition's own competition (its FK), as the asset's reference, which the site resolves
-- through /api/assets or the media sidecar. Additive: the view keeps its columns and gains logo_url at the end.
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE VIEW api.cup_editions AS
SELECT cs.id AS competition_season_id, split_part(cs.cup_key, ':', 1) AS kind, split_part(cs.cup_key, ':', 2) AS competition,
  cs.native_label AS season, cs.cup_name AS name, cs.cup_source_url AS source_url, cs.cup_data_url AS data_url,
  cs.cup_checked_at AS checked_at, cs.cup_updated_at AS updated_at,
  api.public_id('competition', cs.competition_id) AS competition_id,
  CASE split_part(cs.cup_key, ':', 1) WHEN 'open-cups' THEN 'matches-v1' WHEN 'openligadb' THEN 'rounds-v1'
    WHEN 'open-matchday' THEN 'table-v1' ELSE 'results-v1' END AS format,
  cs.competition_id AS internal_competition_id,
  la.source_url AS logo_url
FROM core.competition_seasons cs
LEFT JOIN core.competitions c ON c.id = cs.competition_id
LEFT JOIN core.assets la ON la.id = c.logo_asset_id
WHERE cs.cup_key IS NOT NULL;
