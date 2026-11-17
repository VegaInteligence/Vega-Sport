SELECT source::text AS source,split_part(scope,':',1) AS scope_family,status,
 count(*) AS scopes, min(last_success_at) AS earliest_success, max(last_success_at) AS latest_success,
 count(*) FILTER (WHERE last_success_at IS NULL) AS never_succeeded,sum(rows_written) AS last_run_rows,sum(unmatched) AS last_run_unmatched
FROM ops.source_runs GROUP BY 1,2,3 ORDER BY 1,2,3
