-- All missing canonical club crests and competition logos; linked provider resources fit an exact ID lookup.
-- The complete manifest includes unmapped archives. Names support audit and must not be used as sole identity.
WITH missing AS (
 SELECT 'team' AS kind,t.id,t.name,t.country_code FROM core.teams t WHERE t.merged_into IS NULL AND t.is_national IS NOT TRUE AND t.crest_asset_id IS NULL
 UNION ALL SELECT 'competition',c.id,c.name,c.country_code FROM core.competitions c WHERE c.logo_asset_id IS NULL
)
SELECT m.kind,m.id,m.name,m.country_code,
 array_remove(array_agg(DISTINCT p.provider::text ORDER BY p.provider::text),NULL) AS current_providers,
 array_remove(array_agg(DISTINCT p.provider_key ORDER BY p.provider_key) FILTER(WHERE p.provider='wikidata'),NULL) AS wikidata,
 array_remove(array_agg(DISTINCT p.provider_key ORDER BY p.provider_key) FILTER(WHERE p.provider='uefa'),NULL) AS uefa,
 array_remove(array_agg(DISTINCT p.provider_key ORDER BY p.provider_key) FILTER(WHERE p.provider='pitchapi'),NULL) AS pitchapi,
 array_remove(array_agg(DISTINCT p.provider_key ORDER BY p.provider_key) FILTER(WHERE p.provider='transfermarkt'),NULL) AS transfermarkt,
 array_remove(array_agg(DISTINCT p.provider_key ORDER BY p.provider_key) FILTER(WHERE p.provider='openligadb'),NULL) AS openligadb,
 array_remove(array_agg(DISTINCT p.provider_key ORDER BY p.provider_key) FILTER(WHERE p.provider='sportscore'),NULL) AS sportscore,
 array_remove(array_agg(DISTINCT p.provider_key ORDER BY p.provider_key) FILTER(WHERE p.provider='vega' AND m.kind='competition'),NULL) AS vega_competition
FROM missing m LEFT JOIN core.provider_ids p ON p.entity_type::text=m.kind AND p.entity_id=m.id AND p.is_current
GROUP BY m.kind,m.id,m.name,m.country_code ORDER BY m.kind,m.id
