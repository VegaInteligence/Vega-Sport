-- Planner statistics of the season-partitioned tables.
--
-- Autovacuum analyses each partition, never the partitioned table itself: a table that
-- was only ever filled through its partitions keeps no statistics of its own, and every
-- read that cannot be pruned to one season at plan time is costed on defaults (the reads
-- measured at 34 s and 93 s on 10 November 2026 were such plans). ANALYZE ONLY (PG 18)
-- samples the partitions and stores the parent's statistics without analysing each
-- partition again, which autovacuum already does.
--
-- The worker calls it once a day (Worker.daily); it runs as the owner because ANALYZE
-- needs the table's owner, and returns the number of tables analysed.
CREATE FUNCTION ops.analyze_partitioned() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  parent regclass;
  analysed integer := 0;
BEGIN
  FOR parent IN
    SELECT c.oid::regclass FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE c.relkind = 'p' AND ns.nspname IN ('core', 'agg', 'ops')
    ORDER BY ns.nspname, c.relname
  LOOP
    EXECUTE format('ANALYZE ONLY %s', parent);
    analysed := analysed + 1;
  END LOOP;
  RETURN analysed;
END
$$;
REVOKE ALL ON FUNCTION ops.analyze_partitioned() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.analyze_partitioned() TO vega_collect, vega_calc;

SELECT ops.analyze_partitioned() AS tables;
