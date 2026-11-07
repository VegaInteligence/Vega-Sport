-- Install explicit, reversible archival operations. Installation moves no data.
-- Only the ten retained Neon transfer captures are in this fixed allowlist.
-- The ordinary collector, active staging tables and neon_auth are out of scope.

CREATE OR REPLACE FUNCTION statarena_app.legacy_transfer_preflight(archived boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $preflight$
DECLARE
  names constant text[] := ARRAY[
    'neon_asset_delta', 'neon_asset_job_delta', 'neon_delta_documents',
    'neon_delta_queue', 'neon_dirty_partition_delta', 'neon_ingest_failure_delta',
    'neon_job_delta', 'neon_projection_delta', 'neon_resource_delta', 'neon_state_delta'
  ];
  source_schema text := CASE WHEN archived THEN 'statarena_legacy_transfer' ELSE 'statarena' END;
  name text;
  rel record;
  other_owner oid;
  rows bigint;
  blockers jsonb;
  structure jsonb;
  tables jsonb := '{}'::jsonb;
BEGIN
  IF to_regnamespace(source_schema) IS NULL THEN
    RAISE EXCEPTION 'Legacy transfer source schema % is missing', source_schema;
  END IF;
  FOREACH name IN ARRAY names LOOP
    SELECT c.*, t.typarray INTO rel
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_type t ON t.oid=c.reltype
      WHERE n.nspname=source_schema AND c.relname=name;
    IF NOT FOUND THEN
      SELECT c.relowner INTO other_owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=CASE WHEN archived THEN 'statarena' ELSE 'statarena_legacy_transfer' END AND c.relname=name;
      IF FOUND AND other_owner<>current_user::regrole THEN CONTINUE; END IF;
      RAISE EXCEPTION 'Expected legacy transfer table %.%', source_schema, name;
    END IF;
    -- Mixed-owner batches need no membership changes or cross-owner SELECT.
    IF rel.relowner<>current_user::regrole THEN CONTINUE; END IF;
    IF rel.relkind <> 'r' OR rel.relispartition THEN
      RAISE EXCEPTION 'Expected ordinary legacy transfer table %.%', source_schema, name;
    END IF;
    EXECUTE format('SELECT count(*) FROM %I.%I', source_schema, name) INTO rows;
    blockers := jsonb_build_object(
      'foreign_keys', (SELECT count(*) FROM pg_constraint WHERE contype='f' AND (conrelid=rel.oid OR confrelid=rel.oid)),
      'triggers', (SELECT count(*) FROM pg_trigger WHERE tgrelid=rel.oid),
      'rules', (SELECT count(*) FROM pg_rewrite WHERE ev_class=rel.oid),
      'inheritance', (SELECT count(*) FROM pg_inherits WHERE inhrelid=rel.oid OR inhparent=rel.oid),
      'policies', (SELECT count(*) FROM pg_policy WHERE polrelid=rel.oid),
      'row_security', CASE WHEN rel.relrowsecurity OR rel.relforcerowsecurity THEN 1 ELSE 0 END,
      'publications', (SELECT count(*) FROM pg_publication p WHERE p.puballtables OR
        EXISTS(SELECT 1 FROM pg_publication_rel r WHERE r.prpubid=p.oid AND r.prrelid=rel.oid) OR
        EXISTS(SELECT 1 FROM pg_publication_namespace n WHERE n.pnpubid=p.oid AND n.pnnspid=rel.relnamespace)),
      'extension_membership', (SELECT count(*) FROM pg_depend WHERE classid='pg_class'::regclass AND objid=rel.oid AND deptype='e'),
      'external_dependencies', (SELECT count(*) FROM pg_depend d
        WHERE ((d.refclassid='pg_class'::regclass AND d.refobjid=rel.oid) OR
               (d.refclassid='pg_type'::regclass AND d.refobjid IN (rel.reltype,rel.typarray)))
        AND NOT (
          (d.classid='pg_type'::regclass AND d.deptype='i' AND d.objid IN (rel.reltype,rel.typarray)) OR
          (d.classid='pg_class'::regclass AND d.objid=rel.reltoastrelid AND d.deptype='i') OR
          (d.classid='pg_class'::regclass AND EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=d.objid AND i.indrelid=rel.oid)) OR
          (d.classid='pg_constraint'::regclass AND EXISTS(SELECT 1 FROM pg_constraint k WHERE k.oid=d.objid AND k.conrelid=rel.oid AND k.contype IN ('p','u','c','n'))) OR
          (d.classid='pg_attrdef'::regclass AND EXISTS(SELECT 1 FROM pg_attrdef a WHERE a.oid=d.objid AND a.adrelid=rel.oid))
        )),
      -- String-body functions are not reliably represented by pg_depend.
      'function_text_references', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND strpos(p.prosrc,name)>0
        AND NOT (n.nspname='statarena_app' AND p.proname IN
          ('legacy_transfer_preflight','legacy_transfer_authorize','legacy_transfer_archive','legacy_transfer_rollback')))
    );
    structure := jsonb_build_object(
      'columns', (SELECT jsonb_agg(to_jsonb(a)-'attrelid' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=rel.oid AND a.attnum>0),
      'defaults', (SELECT jsonb_agg(jsonb_build_array(a.oid,a.adnum,a.adbin::text) ORDER BY a.adnum) FROM pg_attrdef a WHERE a.adrelid=rel.oid),
      'constraints', (SELECT jsonb_agg(to_jsonb(k)-'connamespace' ORDER BY k.oid) FROM pg_constraint k WHERE k.conrelid=rel.oid),
      'indexes', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=rel.oid),
      'options', rel.reloptions, 'access_method', rel.relam, 'persistence', rel.relpersistence
    );
    tables := tables || jsonb_build_object(name,jsonb_build_object(
      'oid',rel.oid::text, 'rows',rows::text, 'owner',pg_get_userbyid(rel.relowner),
      'acl',rel.relacl::text, 'catalog_md5',md5(structure::text), 'blockers',blockers
    ));
  END LOOP;
  IF tables='{}'::jsonb THEN RAISE EXCEPTION 'Current actor owns no legacy transfer tables'; END IF;
  RETURN jsonb_build_object('format','vega.legacy-transfer.v1','database',current_database(),
    'owner',current_user,'schema',source_schema,'schema_owner',(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname=source_schema),
    'tables',tables);
END
$preflight$;

-- This explicit call must use the existing source-schema owner. It grants only
-- schema access to reviewed existing table owners, never role memberships or
-- table privileges. Source CREATE also makes the reverse move possible.
CREATE OR REPLACE FUNCTION statarena_app.legacy_transfer_authorize(approved_owners text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $authorize$
DECLARE
  source_owner oid;
  actual_owners text[];
  owner_name text;
  relation_count integer;
  name_count integer;
BEGIN
  SELECT nspowner INTO source_owner FROM pg_namespace WHERE nspname='statarena';
  IF source_owner IS DISTINCT FROM current_user::regrole::oid THEN
    RAISE EXCEPTION 'Legacy transfer authorization requires the source-schema owner' USING ERRCODE='42501';
  END IF;
  SELECT array_agg(DISTINCT pg_get_userbyid(c.relowner)::text ORDER BY pg_get_userbyid(c.relowner)::text),count(*),count(DISTINCT c.relname)
    INTO actual_owners,relation_count,name_count
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('statarena','statarena_legacy_transfer') AND c.relkind='r' AND c.relname=ANY(ARRAY[
      'neon_asset_delta','neon_asset_job_delta','neon_delta_documents','neon_delta_queue',
      'neon_dirty_partition_delta','neon_ingest_failure_delta','neon_job_delta',
      'neon_projection_delta','neon_resource_delta','neon_state_delta']);
  IF relation_count<>10 OR name_count<>10 OR actual_owners IS DISTINCT FROM
    (SELECT array_agg(owner ORDER BY owner) FROM unnest(approved_owners) owner) THEN
    RAISE EXCEPTION 'The ten transfer tables and their exact reviewed owners are required';
  END IF;
  IF to_regnamespace('statarena_legacy_transfer') IS NULL THEN
    EXECUTE format('CREATE SCHEMA statarena_legacy_transfer AUTHORIZATION %I',current_user);
  ELSIF (SELECT nspowner FROM pg_namespace WHERE nspname='statarena_legacy_transfer')<>source_owner THEN
    RAISE EXCEPTION 'Legacy transfer destination schema has a different owner';
  END IF;
  REVOKE ALL ON SCHEMA statarena_legacy_transfer FROM PUBLIC;
  FOREACH owner_name IN ARRAY actual_owners LOOP
    EXECUTE format('GRANT USAGE,CREATE ON SCHEMA statarena,statarena_legacy_transfer TO %I',owner_name);
  END LOOP;
  RETURN jsonb_build_object('schema','statarena_legacy_transfer','authorized_by',current_user,'owners',actual_owners);
END
$authorize$;

CREATE OR REPLACE FUNCTION statarena_app.legacy_transfer_archive(expected jsonb, restore boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
SET lock_timeout = '5s' AS $archive$
DECLARE
  names constant text[] := ARRAY[
    'neon_asset_delta','neon_asset_job_delta','neon_delta_documents','neon_delta_queue',
    'neon_dirty_partition_delta','neon_ingest_failure_delta','neon_job_delta',
    'neon_projection_delta','neon_resource_delta','neon_state_delta'
  ];
  source_owner oid;
  from_schema text := CASE WHEN restore THEN 'statarena_legacy_transfer' ELSE 'statarena' END;
  to_schema text := CASE WHEN restore THEN 'statarena' ELSE 'statarena_legacy_transfer' END;
  name text;
  expected_names text[];
  owned_names text[];
  from_count integer;
  to_count integer;
  original jsonb;
  archived jsonb;
  observed jsonb;
  after_move jsonb;
  repeated boolean;
BEGIN
  IF restore THEN
    IF expected->>'format' IS DISTINCT FROM 'vega.legacy-transfer.receipt.v1'
      OR NOT coalesce(expected->>'status' IN ('archived','restored'),false) THEN
      RAISE EXCEPTION 'The owner archival receipt is required for rollback';
    END IF;
    original := expected->'before';
    archived := expected->'after';
  ELSE
    original := expected;
    archived := expected || jsonb_build_object('schema','statarena_legacy_transfer');
  END IF;
  IF original IS NULL OR original->>'format' IS DISTINCT FROM 'vega.legacy-transfer.v1'
    OR original->>'database' IS DISTINCT FROM current_database()
    OR original->>'schema' IS DISTINCT FROM 'statarena'
    OR original->>'owner' IS DISTINCT FROM current_user
    OR archived IS DISTINCT FROM (original || jsonb_build_object('schema','statarena_legacy_transfer')) THEN
    RAISE EXCEPTION 'A complete preflight receipt for this database and current table owner is required';
  END IF;
  SELECT nspowner INTO source_owner FROM pg_namespace WHERE nspname='statarena';
  IF to_regnamespace('statarena_legacy_transfer') IS NULL
    OR (SELECT nspowner FROM pg_namespace WHERE nspname='statarena_legacy_transfer') IS DISTINCT FROM source_owner
    OR NOT has_schema_privilege(current_user,'statarena','USAGE')
    OR NOT has_schema_privilege(current_user,'statarena','CREATE')
    OR NOT has_schema_privilege(current_user,'statarena_legacy_transfer','USAGE')
    OR NOT has_schema_privilege(current_user,'statarena_legacy_transfer','CREATE') THEN
    RAISE EXCEPTION 'Legacy transfer archival requires explicit source-schema owner authorization' USING ERRCODE='42501';
  END IF;
  IF NOT pg_try_advisory_xact_lock(97813003::bigint) THEN
    RAISE EXCEPTION 'The AWS writer lease is busy';
  END IF;
  SELECT array_agg(key ORDER BY key) INTO expected_names FROM jsonb_object_keys(original->'tables') key;
  IF expected_names IS NULL OR NOT expected_names <@ names THEN
    RAISE EXCEPTION 'Unexpected legacy transfer table set';
  END IF;
  SELECT array_agg(DISTINCT c.relname::text ORDER BY c.relname::text) INTO owned_names
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('statarena','statarena_legacy_transfer') AND c.relname=ANY(names) AND c.relowner=current_user::regrole;
  IF expected_names IS DISTINCT FROM owned_names THEN
    RAISE EXCEPTION 'The receipt must include every allowlisted table owned by the current actor';
  END IF;
  SELECT count(*) FILTER(WHERE n.nspname=from_schema),count(*) FILTER(WHERE n.nspname=to_schema)
    INTO from_count,to_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname=ANY(expected_names) AND n.nspname IN (from_schema,to_schema);
  repeated := from_count=0 AND to_count=cardinality(expected_names);
  IF NOT repeated AND (from_count<>cardinality(expected_names) OR to_count<>0) THEN
    RAISE EXCEPTION 'Legacy transfer owner batch is partial or its destination is occupied';
  END IF;
  IF repeated THEN from_schema := to_schema; END IF;
  FOR name IN SELECT unnest(expected_names) LOOP
    IF (SELECT relowner FROM pg_class WHERE oid=to_regclass(format('%I.%I',from_schema,name))) IS DISTINCT FROM current_user::regrole::oid THEN
      RAISE EXCEPTION 'Current actor does not own %.%',from_schema,name USING ERRCODE='42501';
    END IF;
    EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',from_schema,name);
  END LOOP;
  observed := statarena_app.legacy_transfer_preflight(from_schema='statarena_legacy_transfer');
  IF observed IS DISTINCT FROM (CASE WHEN from_schema='statarena' THEN original ELSE archived END) THEN
    RAISE EXCEPTION 'Legacy transfer preflight changed; exact counts, identities, ACLs and catalogue must be reviewed again';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(observed->'tables') t,
    LATERAL jsonb_each_text(t.value->'blockers') b WHERE b.value::bigint<>0) THEN
    RAISE EXCEPTION 'Legacy transfer dependencies, triggers or policies prevent archival';
  END IF;
  IF NOT repeated THEN
    FOR name IN SELECT unnest(expected_names) LOOP
      EXECUTE format('ALTER TABLE %I.%I SET SCHEMA %I',from_schema,name,to_schema);
    END LOOP;
    after_move := statarena_app.legacy_transfer_preflight(to_schema='statarena_legacy_transfer');
    IF after_move IS DISTINCT FROM (CASE WHEN restore THEN original ELSE archived END) THEN
      RAISE EXCEPTION 'Legacy transfer archival changed table identities, counts or catalogue';
    END IF;
  END IF;
  -- Receipts are held by the private operator. Neither owner needs privileges
  -- on the other's data or on the serving model's consolidation_state table.
  RETURN jsonb_build_object('format','vega.legacy-transfer.receipt.v1','owner',current_user,
    'status',CASE WHEN restore THEN 'restored' ELSE 'archived' END,'before',original,'after',archived);
END
$archive$;

CREATE OR REPLACE FUNCTION statarena_app.legacy_transfer_rollback(receipt jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog AS $rollback$
  SELECT statarena_app.legacy_transfer_archive(receipt,true)
$rollback$;

REVOKE ALL ON FUNCTION statarena_app.legacy_transfer_preflight(boolean),
  statarena_app.legacy_transfer_authorize(text[]),statarena_app.legacy_transfer_archive(jsonb,boolean),
  statarena_app.legacy_transfer_rollback(jsonb) FROM PUBLIC;

-- These are the two existing native owners reviewed for the operation. No role
-- is created, inherited or assumed. The migration installer owns these helpers.
DO $grants$
DECLARE owner_name text;
BEGIN
  FOR owner_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('statarena_admin','statarena_ingest') LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA statarena_app TO %I',owner_name);
    EXECUTE format('GRANT EXECUTE ON FUNCTION statarena_app.legacy_transfer_preflight(boolean),statarena_app.legacy_transfer_authorize(text[]),statarena_app.legacy_transfer_archive(jsonb,boolean),statarena_app.legacy_transfer_rollback(jsonb) TO %I',owner_name);
  END LOOP;
END
$grants$;

