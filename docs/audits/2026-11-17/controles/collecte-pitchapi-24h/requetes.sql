WITH attempts AS MATERIALIZED (
  SELECT id,(extract(epoch FROM (fetched_at - timestamptz '2026-11-17 08:00 UTC'))*1000000)::bigint AS us,
         family::text,entity_type,entity_id,target_date,competition_season_id,global_key,http_status,error_code,
         job_id,request_id,encode(response_sha256,'hex') AS body_sha,parser_version,rows_written,is_empty,duration_ms
  FROM ops.fetch_log
  WHERE fetched_at >= timestamptz '2026-11-17 08:00 UTC'
    AND fetched_at < timestamptz '2026-11-18 08:00 UTC'
), repeated_entity AS (
  SELECT DISTINCT entity_type,entity_id FROM (
    SELECT family,entity_type,entity_id FROM attempts WHERE entity_type IS NOT NULL AND entity_id IS NOT NULL
    GROUP BY family,entity_type,entity_id HAVING count(*)>1
  ) repeated
), repeated_edition AS (
  SELECT competition_season_id FROM attempts WHERE family='league_matches' AND competition_season_id IS NOT NULL
  GROUP BY 1 HAVING count(*)>1
)
SELECT 'attempt' AS kind, jsonb_build_array(id,us,family,entity_type,entity_id,target_date,competition_season_id,
       global_key,http_status,error_code,job_id,request_id,body_sha,parser_version,rows_written,is_empty,duration_ms) AS value
FROM attempts
UNION ALL
SELECT 'entity',jsonb_build_array(r.entity_type,r.entity_id,p.keys,m.kickoff_at,m.status,m.competition_season_id)
FROM repeated_entity r
LEFT JOIN core.matches m ON r.entity_type='match' AND m.id=r.entity_id
LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_array(i.provider_key,i.is_current) ORDER BY i.provider_key) keys
                   FROM core.provider_ids i WHERE i.provider='pitchapi' AND i.entity_type=r.entity_type AND i.entity_id=r.entity_id) p ON true
UNION ALL
SELECT 'edition',jsonb_build_array(e.id,e.competition_id,e.native_label,p.keys)
FROM repeated_edition r JOIN core.competition_seasons e ON e.id=r.competition_season_id
LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_array(i.provider_key,i.is_current) ORDER BY i.provider_key) keys
                   FROM core.provider_ids i WHERE i.provider='pitchapi' AND i.entity_type='competition' AND i.entity_id=e.competition_id) p ON true
