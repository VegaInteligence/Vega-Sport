WITH f AS (
 SELECT date_trunc('minute',fetched_at) AS minute,family,entity_type,entity_id,target_date,competition_season_id,global_key,
 count(*) AS requests,count(DISTINCT job_id) AS distinct_jobs,count(*) FILTER (WHERE http_status BETWEEN 200 AND 299) AS successes
 FROM ops.fetch_log WHERE fetched_at>=now()-interval '24 hours'
 GROUP BY 1,2,3,4,5,6,7
)
SELECT family,sum(requests) AS requests_last_24h,sum(successes) AS successful_requests,
 count(*) FILTER (WHERE requests>1) AS repeated_target_minutes,
 count(*) FILTER (WHERE successes>1 AND distinct_jobs>1) AS multi_success_multi_job_minutes,
 sum(requests-1) FILTER (WHERE successes>1 AND distinct_jobs>1) AS additional_calls_in_multi_success_multi_job_minutes
FROM f GROUP BY family ORDER BY requests_last_24h DESC
