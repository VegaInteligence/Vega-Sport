-- Clubs absent from the current UEFA edition can still have an exact club-specific logo source named in
-- previous UEFA ranking editions. Distinguish same stable URL across recorded ranks vs changes/ambiguity.
WITH candidates AS (
 SELECT t.id,t.name,p.provider_key,e.label,e.is_current,a.source_url
 FROM core.teams t JOIN core.provider_ids p ON p.entity_type='team' AND p.entity_id=t.id AND p.provider='uefa' AND p.is_current
 JOIN core.ranking_rows rr ON rr.team_id=t.id AND rr.provider_key=p.provider_key
 JOIN core.ranking_editions e ON e.id=rr.edition_id AND e.provider='uefa' AND e.kind::text='uefa_clubs'
 JOIN core.assets a ON a.id=rr.image_asset_id
 WHERE t.is_national IS NOT TRUE AND t.merged_into IS NULL AND t.crest_asset_id IS NULL
)
SELECT id,name,provider_key,bool_or(is_current) AS in_current_edition,array_agg(DISTINCT source_url ORDER BY source_url) AS exact_official_urls,
 min(label) AS first_edition,max(label) AS latest_edition
FROM candidates GROUP BY id,name,provider_key ORDER BY id
