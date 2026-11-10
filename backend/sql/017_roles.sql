-- Database roles of the v2 backend (doc "Rôles en base"). The migration role (whoever
-- applies these files) owns every schema and is the only one to change structure.
-- These are group roles without login: the infrastructure creates the login users
-- (passwords in Secrets Manager) and grants them one group each.
--   vega_collect  writes core and ops; no access to agg
--   vega_calc     reads core, writes agg and the recalculation/version tables of ops
--   vega_read     reads the api schema only; its views read the rest as their owner

-- Partitions are created by the owner of their parent table, through these functions,
-- so the collect role never owns a table.
CREATE FUNCTION core.ensure_season_partitions(season integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  archive boolean := season <= 2020;
  suffix text := CASE WHEN season <= 2020 THEN 'archive' ELSE 's' || season END;
  bound text := CASE WHEN season <= 2020 THEN (SELECT string_agg(y::text, ',') FROM generate_series(1850, 2020) y) ELSE season::text END;
  parent record;
BEGIN
  IF season < 1850 OR season > 2100 THEN
    RAISE EXCEPTION 'season out of range';
  END IF;
  PERFORM pg_advisory_xact_lock(92001, CASE WHEN archive THEN 0 ELSE season END);
  FOR parent IN
    SELECT c.relname FROM pg_partitioned_table p JOIN pg_class c ON c.oid = p.partrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'core' ORDER BY c.relname
  LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS core.%I PARTITION OF core.%I FOR VALUES IN (%s)',
                   parent.relname || '_' || suffix, parent.relname, bound);
  END LOOP;
END $$;

CREATE FUNCTION ops.ensure_fetch_log_partition(at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  first date := date_trunc('month', at AT TIME ZONE 'UTC')::date;
BEGIN
  PERFORM pg_advisory_xact_lock(92002, extract(year FROM first)::integer * 100 + extract(month FROM first)::integer);
  EXECUTE format('CREATE TABLE IF NOT EXISTS ops.%I PARTITION OF ops.fetch_log FOR VALUES FROM (%L) TO (%L)',
                 'fetch_log_' || to_char(first, 'YYYYMM'), first, (first + interval '1 month')::date);
END $$;

-- A function called by a view runs with the reader's rights, not the view owner's:
-- the public id lookup reads core.provider_ids, so it runs as its owner.
ALTER FUNCTION api.public_id(core.entity_type, integer) SECURITY DEFINER SET search_path = pg_catalog;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vega_collect') THEN CREATE ROLE vega_collect NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vega_calc') THEN CREATE ROLE vega_calc NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vega_read') THEN CREATE ROLE vega_read NOLOGIN; END IF;
END $$;

REVOKE ALL ON FUNCTION core.ensure_season_partitions(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.ensure_fetch_log_partition(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.ensure_season_partitions(integer) TO vega_collect;
GRANT EXECUTE ON FUNCTION ops.ensure_fetch_log_partition(timestamptz) TO vega_collect;

-- Collect: core and ops, read and write; never agg.
GRANT USAGE ON SCHEMA core, ops TO vega_collect;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core, ops TO vega_collect;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA core, ops TO vega_collect;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA core TO vega_collect;
ALTER DEFAULT PRIVILEGES IN SCHEMA core, ops GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vega_collect;
ALTER DEFAULT PRIVILEGES IN SCHEMA core, ops GRANT USAGE, SELECT ON SEQUENCES TO vega_collect;

-- Calc: reads core, writes agg, and the ops tables of recalculation and publication.
GRANT USAGE ON SCHEMA core, agg, ops TO vega_calc;
GRANT SELECT ON ALL TABLES IN SCHEMA core TO vega_calc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agg TO vega_calc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA agg TO vega_calc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ops.dirty_scopes, ops.resource_versions TO vega_calc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ops TO vega_calc;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA core, agg TO vega_calc;
ALTER DEFAULT PRIVILEGES IN SCHEMA core GRANT SELECT ON TABLES TO vega_calc;
ALTER DEFAULT PRIVILEGES IN SCHEMA agg GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vega_calc;
ALTER DEFAULT PRIVILEGES IN SCHEMA agg GRANT USAGE, SELECT ON SEQUENCES TO vega_calc;

-- Read: the api schema only. Views run with their owner's rights (security_invoker off).
GRANT USAGE ON SCHEMA api TO vega_read;
GRANT SELECT ON ALL TABLES IN SCHEMA api TO vega_read;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA api TO vega_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA api GRANT SELECT ON TABLES TO vega_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA api GRANT EXECUTE ON FUNCTIONS TO vega_read;
