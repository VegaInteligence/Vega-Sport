-- Removes PannaData's schemas, every row they hold and, when no other database of the server uses them, the loader's
-- two roles (backend/panna/README.md, Rollback). Run as the owner once the loader is stopped and SSM
-- /vega/v2/panna-deploy is off. Nothing of core, agg, ops, api or account references these schemas; the next migrate
-- task with V2_PANNA_PASSWORD applies backend/panna/sql again. Roles belong to the whole server: on a server where
-- another database still grants to vega_panna (a second installation), both roles are kept and a notice says so.
-- S1 (FAILURE_MODES.md GH278-al, amended): the group's rights on core (the schema's usage, the score functions of
-- 186) are revoked first, so that the roles can go. The S1 business tables, their rows, the published pair, the Opta
-- key of core.provider_ids and the provider value opta stay: business data does not live in panna.
DO $$
BEGIN
  -- A base of this server without core (another database, the roles existing) has nothing to revoke (review, m7).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vega_panna') AND pg_catalog.to_regnamespace('core') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA core FROM vega_panna';
    EXECUTE 'REVOKE ALL ON SCHEMA core FROM vega_panna';
  END IF;
END $$;
DROP SCHEMA IF EXISTS panna_data, panna, panna_admin CASCADE;
DO $$
DECLARE
  elsewhere text;
BEGIN
  SELECT string_agg(DISTINCT d.datname, ', ') INTO elsewhere
  FROM pg_catalog.pg_shdepend s JOIN pg_catalog.pg_database d ON d.oid = s.dbid
  WHERE s.refclassid = 'pg_catalog.pg_authid'::regclass
    AND s.refobjid = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'vega_panna')
    AND d.datname <> current_database();
  IF elsewhere IS NOT NULL THEN
    RAISE NOTICE 'vega_panna and vega_v2_panna kept: the database(s) % of this server still use them', elsewhere;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vega_v2_panna') THEN DROP ROLE vega_v2_panna; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vega_panna') THEN DROP ROLE vega_panna; END IF;
END $$;
