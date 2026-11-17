-- Bounded catalogue: current native keys, byte digest of the linked logo, and per-edition signed archive identity.
WITH editions AS (
 SELECT cs.competition_id,min(cs.season_id) AS first_season,max(cs.season_id) AS last_season,
    count(*) AS editions, jsonb_agg(jsonb_build_array(cs.season_id,cs.archive_name,cs.archive_country,cs.archive_key) ORDER BY cs.season_id) FILTER(WHERE cs.archive_key IS NOT NULL) AS archive_labels
 FROM core.competition_seasons cs GROUP BY cs.competition_id
), keys AS (
 SELECT entity_id, jsonb_object_agg(provider,provider_key) AS native_keys FROM core.provider_ids WHERE entity_type='competition' AND is_current GROUP BY entity_id
)
SELECT c.id,c.name,c.country_code,c.tier,c.kind,keys.native_keys,editions.first_season,editions.last_season,editions.editions,editions.archive_labels,
       a.id AS logo_asset_id,a.source_url,a.s3_key,encode(a.sha256,'hex') AS sha256,a.author,a.license,a.source_page_url
FROM core.competitions c LEFT JOIN keys ON keys.entity_id=c.id LEFT JOIN editions ON editions.competition_id=c.id LEFT JOIN core.assets a ON a.id=c.logo_asset_id ORDER BY c.id
