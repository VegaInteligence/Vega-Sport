SELECT n.nspname AS schema,c.contype::text AS constraint_type,count(*) AS constraints,
 count(*) FILTER (WHERE NOT c.convalidated) AS unvalidated
FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
WHERE n.nspname IN ('core','agg','ops','live','api') AND c.conparentid=0
GROUP BY 1,2 ORDER BY 1,2
