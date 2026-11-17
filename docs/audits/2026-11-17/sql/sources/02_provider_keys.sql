WITH targets(kind,id) AS (
 SELECT 'team',id FROM core.teams UNION ALL SELECT 'player',id FROM core.players
 UNION ALL SELECT 'competition',id FROM core.competitions UNION ALL SELECT 'match',id FROM core.matches
 UNION ALL SELECT 'asset',id FROM core.assets UNION ALL SELECT 'venue',id FROM core.venues
 UNION ALL SELECT 'coach',id FROM core.coaches UNION ALL SELECT 'referee',id FROM core.referees
), by_entity AS (
 SELECT entity_type::text AS kind,provider::text AS provider,entity_id,count(*) AS keys,
 count(*) FILTER (WHERE is_current) AS current_keys FROM core.provider_ids GROUP BY 1,2,3
)
SELECT p.kind,p.provider,sum(p.keys) AS provider_keys,count(*) AS distinct_entity_ids,
 count(*) FILTER (WHERE current_keys>1) AS multiple_current_keys,
 count(*) FILTER (WHERE current_keys=0) AS historical_keys_only,
 coalesce(sum(p.keys) FILTER (WHERE t.id IS NULL),0) AS missing_target_keys
FROM by_entity p LEFT JOIN targets t ON t.kind=p.kind AND t.id=p.entity_id GROUP BY 1,2 ORDER BY 1,2
