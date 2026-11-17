-- Every canonical club, nation and competition. Counts a URL separately from a recorded object key.
-- HTTP availability, a valid visual identity and display fallbacks require separate checks.
WITH entities AS (
 SELECT CASE WHEN t.is_national IS TRUE THEN 'national team' ELSE 'club' END AS entity_type,
        t.id,t.crest_asset_id AS asset_id
 FROM core.teams t WHERE t.merged_into IS NULL
 UNION ALL SELECT 'competition',c.id,c.logo_asset_id FROM core.competitions c
)
SELECT e.entity_type,count(*) AS entities,count(*) FILTER (WHERE e.asset_id IS NULL) AS no_asset_link,
 count(*) FILTER (WHERE e.asset_id IS NOT NULL AND a.id IS NULL) AS broken_asset_fk,
 count(*) FILTER (WHERE a.id IS NOT NULL AND nullif(btrim(a.source_url),'') IS NULL AND nullif(btrim(a.s3_key),'') IS NULL) AS asset_without_location,
 count(*) FILTER (WHERE nullif(btrim(a.source_url),'') IS NOT NULL) AS source_url,
 count(*) FILTER (WHERE nullif(btrim(a.s3_key),'') IS NOT NULL) AS recorded_object_key,
 count(*) FILTER (WHERE nullif(btrim(a.source_url),'') IS NOT NULL AND nullif(btrim(a.s3_key),'') IS NULL) AS source_url_only,
 count(*) FILTER (WHERE am.asset_id IS NOT NULL AND nullif(btrim(a.s3_key),'') IS NULL) AS mirror_retry_state,
 count(*) FILTER (WHERE a.kind IS NOT NULL AND ((e.entity_type='club' AND a.kind::text NOT IN ('crest','logo')) OR (e.entity_type='competition' AND a.kind::text NOT IN ('logo','crest')))) AS kind_review
FROM entities e LEFT JOIN core.assets a ON a.id=e.asset_id LEFT JOIN ops.asset_mirror am ON am.asset_id=a.id
GROUP BY e.entity_type ORDER BY e.entity_type
