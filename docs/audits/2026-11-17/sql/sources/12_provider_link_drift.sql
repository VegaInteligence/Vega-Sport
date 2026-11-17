SELECT l.entity_type,l.provider,count(*) AS link_evidence_rows,
 count(*) FILTER(WHERE p.entity_id IS NULL) AS absent_provider_key,
 count(*) FILTER(WHERE p.entity_id IS NOT NULL AND p.entity_id<>l.entity_id) AS canonical_entity_mismatch,
 count(*) FILTER(WHERE l.quarantined_at IS NOT NULL) AS quarantined
FROM ops.provider_links l LEFT JOIN core.provider_ids p USING(entity_type,provider,provider_key)
GROUP BY l.entity_type,l.provider ORDER BY l.entity_type,l.provider
