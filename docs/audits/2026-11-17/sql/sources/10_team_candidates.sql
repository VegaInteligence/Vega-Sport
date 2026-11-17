WITH keys AS (
 SELECT country_code, is_national,lower(btrim(name)) AS folded,count(*) AS candidates
 FROM core.teams WHERE merged_into IS NULL AND country_code IS NOT NULL AND nullif(btrim(name),'') IS NOT NULL
 GROUP BY 1,2,3 HAVING count(*)>1
)
SELECT k.country_code,k.is_national,k.folded,k.candidates,t.id,t.name,t.short_name,
 (SELECT string_agg(p.provider::text||':'||p.provider_key,', ' ORDER BY p.provider,p.provider_key) FROM core.provider_ids p WHERE p.entity_type='team' AND p.entity_id=t.id) AS provider_evidence
FROM keys k JOIN core.teams t ON t.country_code=k.country_code AND t.is_national IS NOT DISTINCT FROM k.is_national AND lower(btrim(t.name))=k.folded AND t.merged_into IS NULL
ORDER BY k.country_code,k.folded,t.id LIMIT 250
