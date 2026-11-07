-- Installation is additive: it never drops a table or invokes the finalizer.
-- Physical retirement is an explicit, owner-only operation after external
-- snapshot restoration and recovery-evidence review. No CASCADE is used.

CREATE OR REPLACE FUNCTION statarena_app.consolidation_retirement_contracts()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $contracts$
 SELECT encode(sha256(convert_to(jsonb_build_object(
   'relations',(SELECT jsonb_agg(jsonb_build_object(
     'oid',c.oid::text,'schema',n.nspname,'name',c.relname,'kind',c.relkind,
     'owner',c.relowner::text,'acl',c.relacl::text,'options',c.reloptions,
     'columns',(SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid::text,
       a.atttypmod,a.attcollation::text,a.attnotnull,a.attidentity,a.attgenerated)
       ORDER BY a.attnum) FROM pg_attribute a
       WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
     'view',CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) END)
     ORDER BY n.nspname,c.relname)
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname IN ('statarena_app','statarena_next') AND c.relkind IN ('r','p','v')),
   'functions',(SELECT jsonb_agg(jsonb_build_object(
     'oid',p.oid::text,'schema',n.nspname,'name',p.proname,
     'owner',p.proowner::text,'acl',p.proacl::text,
     'definition',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'))
     ORDER BY p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname IN ('statarena_app','statarena_next') AND p.prokind='f')
 )::text,'UTF8')),'hex');
$contracts$;

CREATE OR REPLACE FUNCTION statarena_app.consolidation_retirement_plan()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $plan$
DECLARE
  c jsonb; saved jsonb; final_receipt jsonb; p jsonb; item jsonb;
  names text[]; actual_names text[]; name_digest text; owner_id oid;
  relation_ids oid[]; type_ids oid[]; function_ids oid[]; public_function_ids oid[];
  relation_row record; function_row record; app_function oid; expected_function jsonb;
  tables jsonb := '[]'::jsonb; functions jsonb := '[]'::jsonb;
  blockers jsonb := '[]'::jsonb; found_blockers jsonb; structure jsonb;
  original_columns text[]; actual_columns text[]; publication jsonb; manifest jsonb;
  journal_digest text; active_count integer; relation_bytes bigint;
BEGIN
  SELECT value INTO STRICT c FROM statarena_app.consolidation_state WHERE key='control';
  SELECT relowner INTO STRICT owner_id FROM pg_class WHERE oid='statarena_app.catalog_records'::regclass;
  IF owner_id IS DISTINCT FROM current_user::regrole::oid OR EXISTS(
    SELECT 1 FROM pg_class WHERE oid=ANY(ARRAY['statarena_app.support_records'::regclass,
      'statarena_app.detail_records'::regclass,'statarena_app.consolidation_state'::regclass])
      AND relowner<>owner_id) THEN
    RAISE EXCEPTION 'Physical retirement requires the current record-store owner' USING ERRCODE='42501';
  END IF;
  IF c->'physical_retirement_finalized'='true'::jsonb THEN
    SELECT value INTO STRICT final_receipt FROM statarena_app.consolidation_state WHERE key='physical_retirement';
    RETURN jsonb_build_object('format','vega.provider-retirement.plan.v1','ready',false,
      'status','finalized','receipt',final_receipt-'manifest'-'recovery_proof',
      'blockers',jsonb_build_array(jsonb_build_object('kind','physical_retirement_finalized',
        'recovery','restore_snapshot_then_replay')));
  END IF;
  IF c->>'mode' IS DISTINCT FROM 'active'
    OR c->>'model_digest' IS DISTINCT FROM '395de5ecf4c7e0546561c612559b2448bb78d36205d62b0f78ab33202bcfb9a4'
    OR c->>'cursor_version' IS DISTINCT FROM 'null-start-v1'
    OR c->'retired_tables' IS DISTINCT FROM '112'::jsonb THEN
    RAISE EXCEPTION 'Verified active provider storage with the complete retained copy is required';
  END IF;
  SELECT array_agg(value->>'table' ORDER BY value->>'table'),
    encode(sha256(convert_to(jsonb_agg(value->>'table' ORDER BY value->>'table')::text,'UTF8')),'hex')
    INTO names,name_digest FROM jsonb_array_elements(statarena_app.consolidation_plan());
  IF cardinality(names)<>112 OR name_digest IS DISTINCT FROM
    'd4348800c60862d5c55df4096c73093f142d21bf0516ba4597556fe7c72eda5a' THEN
    RAISE EXCEPTION 'The installed mapping is not the reviewed exact 112-table set';
  END IF;
  SELECT value INTO STRICT saved FROM statarena_app.consolidation_state WHERE key='retirement_manifest';
  IF jsonb_typeof(saved->'relations') IS DISTINCT FROM 'array'
    OR jsonb_typeof(saved->'functions') IS DISTINCT FROM 'array'
    OR jsonb_array_length(saved->'relations')<>112
    OR jsonb_array_length(saved->'functions')<>62
    OR saved->'revision' IS DISTINCT FROM c->'revision' THEN
    RAISE EXCEPTION 'The original exact cutover manifest is required';
  END IF;
  SELECT array_agg(value->>'name' ORDER BY value->>'name') INTO actual_names
    FROM jsonb_array_elements(saved->'relations');
  IF actual_names IS DISTINCT FROM names THEN RAISE EXCEPTION 'Original cutover table manifest differs'; END IF;
  SELECT array_agg(cl.relname::text ORDER BY cl.relname) INTO actual_names
    FROM pg_class cl JOIN pg_namespace ns ON ns.oid=cl.relnamespace
    WHERE ns.nspname='statarena_retired_v1' AND cl.relkind IN ('r','p');
  IF actual_names IS DISTINCT FROM names THEN
    RAISE EXCEPTION 'Retirement requires all and only the 112 expected physical tables';
  END IF;
  PERFORM statarena_app.consolidation_preflight('statarena_retired_v1');
  SELECT array_agg(cl.oid ORDER BY cl.relname),array_agg(cl.reltype ORDER BY cl.relname)
    INTO relation_ids,type_ids FROM pg_class cl JOIN pg_namespace ns ON ns.oid=cl.relnamespace
    WHERE ns.nspname='statarena_retired_v1' AND cl.relname=ANY(names) AND cl.relkind='r';
  SELECT type_ids||coalesce(array_agg(t.typarray) FILTER(WHERE t.typarray<>0),'{}'::oid[])
    INTO type_ids FROM pg_type t WHERE t.oid=ANY(type_ids);

  FOR relation_row IN SELECT cl.*,ty.typarray FROM pg_class cl JOIN pg_type ty ON ty.oid=cl.reltype
      WHERE cl.oid=ANY(relation_ids) ORDER BY cl.relname LOOP
    IF relation_row.relowner<>owner_id OR relation_row.relispartition
      OR relation_row.relrowsecurity OR relation_row.relforcerowsecurity
      OR relation_row.relpersistence<>'p' THEN
      RAISE EXCEPTION 'Retired relation ownership or ordinary-table contract differs: %',relation_row.relname;
    END IF;
    SELECT value INTO STRICT item FROM jsonb_array_elements(saved->'relations')
      WHERE value->>'name'=relation_row.relname;
    SELECT array_agg(value ORDER BY ordinal) INTO original_columns
      FROM jsonb_array_elements_text(item->'columns') WITH ORDINALITY x(value,ordinal);
    SELECT array_agg(attname::text ORDER BY attnum) INTO actual_columns FROM pg_attribute
      WHERE attrelid=relation_row.oid AND attnum>0 AND NOT attisdropped;
    IF original_columns IS DISTINCT FROM actual_columns OR item->>'owner' IS DISTINCT FROM current_user THEN
      RAISE EXCEPTION 'Retired relation no longer matches the saved cutover columns/owner: %',relation_row.relname;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_class v WHERE v.oid=to_regclass(format('statarena_app.%I',relation_row.relname))
        AND v.relkind='v' AND v.relowner=owner_id)
      OR NOT EXISTS(SELECT 1 FROM pg_class v WHERE v.oid=to_regclass(format('statarena_next.%I',relation_row.relname))
        AND v.relkind='v' AND v.relowner=owner_id) THEN
      RAISE EXCEPTION 'An active typed adapter is missing or has changed owner: %',relation_row.relname;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_rewrite rw JOIN pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=rw.oid
        WHERE rw.ev_class=to_regclass(format('statarena_app.%I',relation_row.relname))
          AND d.refclassid='pg_class'::regclass
          AND d.refobjid=to_regclass(format('statarena_next.%I',relation_row.relname))) THEN
      RAISE EXCEPTION 'The active adapter is not bound to its consolidated preview: %',relation_row.relname;
    END IF;
    structure=jsonb_build_object(
      'columns',(SELECT jsonb_agg(to_jsonb(a)-'attrelid' ORDER BY a.attnum) FROM pg_attribute a
        WHERE a.attrelid=relation_row.oid AND a.attnum>0),
      'defaults',(SELECT jsonb_agg(jsonb_build_array(a.adnum,pg_get_expr(a.adbin,a.adrelid)) ORDER BY a.adnum)
        FROM pg_attrdef a WHERE a.adrelid=relation_row.oid),
      'constraints',(SELECT jsonb_agg(jsonb_build_array(k.oid::text,k.conname,pg_get_constraintdef(k.oid)) ORDER BY k.oid)
        FROM pg_constraint k WHERE k.conrelid=relation_row.oid),
      'indexes',(SELECT jsonb_agg(jsonb_build_array(i.indexrelid::text,pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid)
        FROM pg_index i WHERE i.indrelid=relation_row.oid),
      'options',relation_row.reloptions,'access_method',relation_row.relam::text,
      'filenode',relation_row.relfilenode::text);
    tables=tables||jsonb_build_array(jsonb_build_object('name',relation_row.relname,'oid',relation_row.oid::text,
      'row_type_oid',relation_row.reltype::text,'owner',current_user,'acl',relation_row.relacl::text,
      'column_count',cardinality(actual_columns),'structure_sha256',encode(sha256(convert_to(structure::text,'UTF8')),'hex')));
  END LOOP;

  -- Saved argument text uses the former app schema. Resolve actual OIDs first;
  -- normalizing for comparison must never select the new public-view overload.
  FOR function_row IN SELECT f.* FROM pg_proc f WHERE f.pronamespace='statarena_retired_v1'::regnamespace
      ORDER BY f.proname,pg_get_function_identity_arguments(f.oid) LOOP
    SELECT value INTO expected_function FROM jsonb_array_elements(saved->'functions')
      WHERE value->>'name'=function_row.proname
        AND value->>'args'=replace(pg_get_function_identity_arguments(function_row.oid),
          'statarena_retired_v1.','statarena_app.');
    IF expected_function IS NULL OR function_row.prokind<>'f' OR function_row.proowner<>owner_id
      OR function_row.pronargs<>1 OR function_row.prorettype<>'jsonb'::regtype
      OR NOT EXISTS(SELECT 1 FROM pg_type t JOIN pg_class cl ON cl.oid=t.typrelid
        WHERE t.oid=function_row.proargtypes[0] AND cl.oid=ANY(relation_ids)
          AND function_row.proname=left('read_'||cl.relname,63))
      OR replace(pg_get_functiondef(function_row.oid),'statarena_retired_v1.','statarena_app.')
        IS DISTINCT FROM expected_function->>'ddl' THEN
      RAISE EXCEPTION 'Unexpected retired function; expand neither the manifest nor DROP scope implicitly: %',function_row.proname;
    END IF;
    SELECT f.oid INTO app_function FROM pg_proc f
      WHERE f.pronamespace='statarena_app'::regnamespace AND f.proname=function_row.proname
        AND pg_get_function_identity_arguments(f.oid)=expected_function->>'args'
        AND f.proowner=owner_id AND f.prokind='f';
    IF app_function IS NULL OR pg_get_functiondef(app_function) IS DISTINCT FROM expected_function->>'ddl' THEN
      RAISE EXCEPTION 'An active row-type function no longer matches the accepted cutover contract: %',function_row.proname;
    END IF;
    function_ids=array_append(function_ids,function_row.oid);
    public_function_ids=array_append(public_function_ids,app_function);
    functions=functions||jsonb_build_array(jsonb_build_object('name',function_row.proname,
      'oid',function_row.oid::text,'arguments',pg_get_function_identity_arguments(function_row.oid),
      'owner',current_user,'acl',function_row.proacl::text,'active_oid',app_function::text,
      'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(function_row.oid),'UTF8')),'hex')));
  END LOOP;
  IF cardinality(function_ids) IS DISTINCT FROM 62 OR cardinality(public_function_ids) IS DISTINCT FROM 62 THEN
    RAISE EXCEPTION 'All 62 archived row-type functions and their active counterparts are required';
  END IF;

  -- Automatic table-owned objects are expected. Every other incoming relation,
  -- composite-type, array-type or function dependency is a blocker. RESTRICT is
  -- still the final database-level safety net, inside the same transaction.
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('kind','external_dependency',
    'object',pg_describe_object(d.classid,d.objid,d.objsubid))), '[]'::jsonb) INTO found_blockers
    FROM pg_depend d WHERE (
      (d.refclassid='pg_class'::regclass AND d.refobjid=ANY(relation_ids)) OR
      (d.refclassid='pg_type'::regclass AND d.refobjid=ANY(type_ids)) OR
      (d.refclassid='pg_proc'::regclass AND d.refobjid=ANY(function_ids)))
    AND NOT (
      (d.classid='pg_type'::regclass AND d.objid=ANY(type_ids) AND d.deptype='i') OR
      (d.classid='pg_proc'::regclass AND d.objid=ANY(function_ids)) OR
      (d.classid='pg_class'::regclass AND (d.objid=ANY(relation_ids) OR EXISTS(
        SELECT 1 FROM pg_class cl WHERE cl.oid=ANY(relation_ids) AND cl.reltoastrelid=d.objid)
        OR EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=d.objid AND i.indrelid=ANY(relation_ids)))) OR
      (d.classid='pg_constraint'::regclass AND EXISTS(SELECT 1 FROM pg_constraint k
        WHERE k.oid=d.objid AND k.conrelid=ANY(relation_ids))) OR
      (d.classid='pg_attrdef'::regclass AND EXISTS(SELECT 1 FROM pg_attrdef a
        WHERE a.oid=d.objid AND a.adrelid=ANY(relation_ids))) OR
      (d.classid='pg_trigger'::regclass AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.oid=d.objid
        AND (t.tgrelid=ANY(relation_ids) OR (t.tgisinternal AND EXISTS(SELECT 1 FROM pg_constraint k
          WHERE k.oid=t.tgconstraint AND k.conrelid=ANY(relation_ids)))))));
  blockers=blockers||found_blockers;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind','unexpected_trigger','object',pg_describe_object('pg_trigger'::regclass,t.oid,0))),
    '[]'::jsonb) INTO found_blockers FROM pg_trigger t WHERE t.tgrelid=ANY(relation_ids) AND NOT t.tgisinternal
      AND NOT (t.tgname='consolidation_revision' AND t.tgfoid='statarena_app.consolidation_changed()'::regprocedure
        AND t.tgenabled='O' AND t.tgnargs=0);
  blockers=blockers||found_blockers;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind','table_rule','object',pg_describe_object('pg_rewrite'::regclass,r.oid,0))),
    '[]'::jsonb) INTO found_blockers FROM pg_rewrite r WHERE r.ev_class=ANY(relation_ids);
  blockers=blockers||found_blockers;
  IF EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=ANY(relation_ids) OR inhparent=ANY(relation_ids)) THEN
    blockers=blockers||jsonb_build_array(jsonb_build_object('kind','inheritance'));
  END IF;
  IF EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=ANY(relation_ids)) THEN
    blockers=blockers||jsonb_build_array(jsonb_build_object('kind','row_policy'));
  END IF;
  IF EXISTS(SELECT 1 FROM pg_depend WHERE deptype='e' AND
    ((classid='pg_class'::regclass AND objid=ANY(relation_ids)) OR (classid='pg_proc'::regclass AND objid=ANY(function_ids)))) THEN
    blockers=blockers||jsonb_build_array(jsonb_build_object('kind','extension_membership'));
  END IF;
  IF EXISTS(SELECT 1 FROM pg_publication p WHERE p.puballtables OR
    EXISTS(SELECT 1 FROM pg_publication_rel r WHERE r.prpubid=p.oid AND r.prrelid=ANY(relation_ids)) OR
    EXISTS(SELECT 1 FROM pg_publication_namespace n WHERE n.pnpubid=p.oid AND n.pnnspid='statarena_retired_v1'::regnamespace)) THEN
    blockers=blockers||jsonb_build_array(jsonb_build_object('kind','logical_publication'));
  END IF;
  -- String-body functions and configured search paths are not fully tracked by
  -- pg_depend. Only the known migration helpers may retain these old names.
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind','retired_schema_function_reference',
    'object',pg_describe_object('pg_proc'::regclass,f.oid,0)) ORDER BY f.oid),'[]'::jsonb)
    INTO found_blockers FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND NOT f.oid=ANY(function_ids)
      AND (strpos(f.prosrc,'statarena_retired_v1')>0 OR strpos(coalesce(f.proconfig::text,''),'statarena_retired_v1')>0)
      AND NOT f.oid=ANY(ARRAY[
        'statarena_app.consolidation_preflight(text)'::regprocedure,
        'statarena_app.consolidation_begin(text)'::regprocedure,
        'statarena_app.consolidation_copy_batch(text,integer)'::regprocedure,
        'statarena_app.consolidation_verify_batch(text,integer)'::regprocedure,
        'statarena_app.consolidation_activate()'::regprocedure,
        'statarena_app.consolidation_rollback()'::regprocedure,
        'statarena_app.consolidation_status()'::regprocedure,
        'statarena_app.consolidation_retirement_plan()'::regprocedure,
        'statarena_app.consolidation_finalize_retirement(jsonb,jsonb,text)'::regprocedure]);
  blockers=blockers||found_blockers;

  SELECT jsonb_build_object('generation',generation::text,'published_at',published_at) INTO STRICT publication
    FROM statarena_app.publications;
  SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(version,digest) ORDER BY version),'[]'::jsonb)::text,'UTF8')),'hex')
    INTO journal_digest FROM statarena_app.worker_schema;
  IF NOT EXISTS(SELECT 1 FROM statarena_app.worker_schema WHERE version='036_finalize_provider_retirement.sql') THEN
    RAISE EXCEPTION 'Migration 036 must be journaled before producing a retirement plan';
  END IF;
  SELECT count(*) INTO active_count FROM pg_class cl JOIN pg_namespace n ON n.oid=cl.relnamespace
    WHERE n.nspname='statarena_app' AND cl.relkind IN ('r','p');
  SELECT sum(pg_total_relation_size(oid)) INTO relation_bytes FROM pg_class WHERE oid=ANY(relation_ids);
  manifest=jsonb_build_object('format','vega.provider-retirement.manifest.v1',
    'database',current_database(),'database_oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
    'actor',current_user,'model_digest',c->'model_digest','revision',c->'revision','activated_at',c->'activated_at',
    'publication',publication,'original_manifest_sha256',encode(sha256(convert_to(saved::text,'UTF8')),'hex'),
    'tables',tables,'functions',functions,'active_physical_tables',active_count,
    'active_contracts_sha256',statarena_app.consolidation_retirement_contracts(),
    'migration_journal_sha256',journal_digest);
  RETURN jsonb_build_object('format','vega.provider-retirement.plan.v1','ready',blockers='[]'::jsonb,
    'manifest',manifest,'manifest_sha256',encode(sha256(convert_to(manifest::text,'UTF8')),'hex'),
    'blockers',blockers,'observations',jsonb_build_object('retired_relation_bytes',relation_bytes::text,
      'row_counts_measured',false,'recovery_after_finalization','restore_snapshot_then_replay'));
END
$plan$;

CREATE OR REPLACE FUNCTION statarena_app.consolidation_finalize_retirement(
  reviewed_plan jsonb,recovery_proof jsonb,confirmed_manifest_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog SET lock_timeout = '5s' AS $finalize$
DECLARE
  c jsonb; previous jsonb; observed jsonb; manifest jsonb; proof_digest text;
  item jsonb; hash_value text; names text; receipt jsonb; publication_after jsonb;
  active_after integer; retired_after integer; snapshot_at timestamptz; restored_at timestamptz;
BEGIN
  IF reviewed_plan->>'format' IS DISTINCT FROM 'vega.provider-retirement.plan.v1'
    OR reviewed_plan->'ready' IS DISTINCT FROM 'true'::jsonb
    OR reviewed_plan->'blockers' IS DISTINCT FROM '[]'::jsonb
    OR jsonb_typeof(reviewed_plan->'manifest') IS DISTINCT FROM 'object'
    OR confirmed_manifest_sha256 IS NULL OR confirmed_manifest_sha256 !~ '^[0-9a-f]{64}$'
    OR reviewed_plan->>'manifest_sha256' IS DISTINCT FROM confirmed_manifest_sha256
    OR encode(sha256(convert_to((reviewed_plan->'manifest')::text,'UTF8')),'hex') IS DISTINCT FROM confirmed_manifest_sha256 THEN
    RAISE EXCEPTION 'A complete reviewed retirement plan and its explicit matching confirmation are required';
  END IF;
  manifest=reviewed_plan->'manifest';
  IF recovery_proof->>'format' IS DISTINCT FROM 'vega.provider-retirement.recovery.v1'
    OR recovery_proof->>'database' IS DISTINCT FROM manifest->>'database'
    OR recovery_proof->>'model_digest' IS DISTINCT FROM manifest->>'model_digest'
    OR recovery_proof->>'manifest_sha256' IS DISTINCT FROM confirmed_manifest_sha256
    OR recovery_proof#>>'{snapshot,status}' IS DISTINCT FROM 'available'
    OR coalesce(length(recovery_proof#>>'{snapshot,identifier}'),0) NOT BETWEEN 1 AND 256
    OR recovery_proof#>>'{restore,snapshot_identifier}' IS DISTINCT FROM recovery_proof#>>'{snapshot,identifier}'
    OR recovery_proof#>>'{restore,status}' IS DISTINCT FROM 'verified'
    OR recovery_proof#>'{restore,retired_table_count}' IS DISTINCT FROM '112'::jsonb
    OR recovery_proof#>'{restore,active_contracts_passed}' IS DISTINCT FROM 'true'::jsonb
    OR recovery_proof#>>'{preservation,status}' IS DISTINCT FROM 'verified'
    OR recovery_proof#>'{preservation,full_readback_verified}' IS DISTINCT FROM 'true'::jsonb
    OR recovery_proof#>>'{recovery,strategy}' IS DISTINCT FROM 'restore_snapshot_then_replay'
    OR recovery_proof#>'{recovery,post_snapshot_publication_replay_reviewed}' IS DISTINCT FROM 'true'::jsonb
    OR recovery_proof#>>'{approval,action}' IS DISTINCT FROM 'retire_exact_112_provider_tables'
    OR recovery_proof#>'{approval,loss_of_in_place_rollback_accepted}' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'Reviewed available snapshot, verified restore, durable evidence and explicit recovery-only approval are required';
  END IF;
  FOREACH hash_value IN ARRAY ARRAY[recovery_proof#>>'{snapshot,receipt_sha256}',
      recovery_proof#>>'{restore,receipt_sha256}',recovery_proof#>>'{preservation,receipt_sha256}',
      recovery_proof#>>'{preservation,artifact_sha256}',recovery_proof#>>'{recovery,plan_sha256}'] LOOP
    IF hash_value IS NULL OR hash_value !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Each external recovery-evidence digest must be a SHA-256 value';
    END IF;
  END LOOP;
  BEGIN
    IF recovery_proof#>>'{snapshot,captured_at}' IS NULL OR recovery_proof#>>'{restore,verified_at}' IS NULL
      OR recovery_proof#>>'{snapshot,captured_at}' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      OR recovery_proof#>>'{restore,verified_at}' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      RAISE EXCEPTION 'Recovery timestamps need explicit time zones';
    END IF;
    snapshot_at=(recovery_proof#>>'{snapshot,captured_at}')::timestamptz;
    restored_at=(recovery_proof#>>'{restore,verified_at}')::timestamptz;
    IF NOT isfinite(snapshot_at) OR NOT isfinite(restored_at) OR restored_at<snapshot_at THEN
      RAISE EXCEPTION 'Restore verification must follow the snapshot recovery point';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Valid zoned and chronological snapshot/restore timestamps are required';
  END;
  proof_digest=encode(sha256(convert_to(recovery_proof::text,'UTF8')),'hex');
  IF NOT pg_try_advisory_xact_lock(97813003::bigint) THEN
    RAISE EXCEPTION 'Publication lease is busy; finish the publisher before physical retirement' USING ERRCODE='55P03';
  END IF;
  SELECT value INTO STRICT c FROM statarena_app.consolidation_state WHERE key='control';
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='statarena_app.catalog_records'::regclass
      AND relowner=current_user::regrole::oid) THEN
    RAISE EXCEPTION 'Physical retirement requires the current record-store owner' USING ERRCODE='42501';
  END IF;
  IF c->'physical_retirement_finalized'='true'::jsonb THEN
    SELECT value INTO STRICT previous FROM statarena_app.consolidation_state WHERE key='physical_retirement';
    IF previous->>'manifest_sha256' IS DISTINCT FROM confirmed_manifest_sha256
      OR previous->>'recovery_proof_sha256' IS DISTINCT FROM proof_digest
      OR previous->'manifest' IS DISTINCT FROM manifest THEN
      RAISE EXCEPTION 'Physical retirement already finalized with different evidence';
    END IF;
    RETURN previous;
  END IF;
  IF c->>'mode' IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'Only active consolidated storage may be finalized'; END IF;
  -- Lock catalog-verified names, never interpolated operator input. NOWAIT
  -- avoids waiting behind a writer holding a header or old provider relation.
  observed=statarena_app.consolidation_retirement_plan();
  IF observed->'ready' IS DISTINCT FROM 'true'::jsonb OR observed->'manifest' IS DISTINCT FROM manifest
    OR observed->>'manifest_sha256' IS DISTINCT FROM confirmed_manifest_sha256 THEN
    RAISE EXCEPTION 'Retirement plan is stale or dependencies block the exact reviewed scope';
  END IF;
  SELECT string_agg(format('statarena_retired_v1.%I',value->>'name'),',' ORDER BY value->>'name')
    INTO names FROM jsonb_array_elements(observed#>'{manifest,tables}');
  EXECUTE 'LOCK TABLE '||names||' IN ACCESS EXCLUSIVE MODE NOWAIT';
  LOCK TABLE statarena_app.catalog_records,statarena_app.support_records,statarena_app.detail_records,
    statarena_app.catalog_editions,statarena_app.support_projection,statarena_app.match_families,
    statarena_app.publications IN SHARE MODE NOWAIT;
  c=statarena_app.consolidation_lock();
  observed=statarena_app.consolidation_retirement_plan();
  IF observed->'ready' IS DISTINCT FROM 'true'::jsonb OR observed->'manifest' IS DISTINCT FROM manifest
    OR observed->>'manifest_sha256' IS DISTINCT FROM confirmed_manifest_sha256 THEN
    RAISE EXCEPTION 'Retirement manifest or publication fence changed while locking';
  END IF;
  SELECT string_agg(format('statarena_retired_v1.%I(%s)',value->>'name',value->>'arguments'),',' ORDER BY value->>'name')
    INTO names FROM jsonb_array_elements(observed#>'{manifest,functions}');
  EXECUTE 'DROP FUNCTION '||names||' RESTRICT';
  SELECT string_agg(format('statarena_retired_v1.%I',value->>'name'),',' ORDER BY value->>'name')
    INTO names FROM jsonb_array_elements(observed#>'{manifest,tables}');
  EXECUTE 'DROP TABLE '||names||' RESTRICT';
  SELECT count(*) INTO active_after FROM pg_class cl JOIN pg_namespace n ON n.oid=cl.relnamespace
    WHERE n.nspname='statarena_app' AND cl.relkind IN ('r','p');
  SELECT count(*) INTO retired_after FROM pg_class cl JOIN pg_namespace n ON n.oid=cl.relnamespace
    WHERE n.nspname='statarena_retired_v1' AND cl.relkind IN ('r','p');
  SELECT jsonb_build_object('generation',generation::text,'published_at',published_at) INTO STRICT publication_after
    FROM statarena_app.publications;
  IF retired_after<>0 OR to_jsonb(active_after) IS DISTINCT FROM manifest->'active_physical_tables'
    OR publication_after IS DISTINCT FROM manifest->'publication'
    OR statarena_app.consolidation_retirement_contracts() IS DISTINCT FROM manifest->>'active_contracts_sha256' THEN
    RAISE EXCEPTION 'Retirement postcondition failed; every DROP is rolled back';
  END IF;
  receipt=jsonb_build_object('format','vega.provider-retirement.receipt.v1','status','finalized',
    'database',current_database(),'actor',current_user,'finalized_at',clock_timestamp(),
    'model_digest',c->'model_digest','revision',c->'revision',
    'manifest_sha256',confirmed_manifest_sha256,'recovery_proof_sha256',proof_digest,
    'dropped_tables',112,'dropped_functions',62,'active_physical_tables_before',manifest->'active_physical_tables',
    'active_physical_tables_after',active_after,'retired_physical_tables_after',retired_after,
    'publication_before',manifest->'publication','publication_after',publication_after,
    'rollback_available',false,'recovery_strategy','restore_snapshot_then_replay',
    'manifest',manifest,'recovery_proof',recovery_proof);
  INSERT INTO statarena_app.consolidation_state(key,value) VALUES('physical_retirement',receipt);
  UPDATE statarena_app.consolidation_state SET value=c||jsonb_build_object(
    'physical_retirement_finalized',true,'physical_retired_at',receipt->'finalized_at',
    'retired_tables',0,'finalized_retired_tables',112,'rollback_available',false,
    'recovery_strategy','restore_snapshot_then_replay') WHERE key='control';
  RETURN receipt;
END
$finalize$;

-- Patch only the known operation boundaries; preserve their identities, owners,
-- grants and execution attributes. Reapplication neither changes state nor drops data.
DO $guards$
DECLARE patch record; definition text; old_count integer; new_count integer;
BEGIN
  PERFORM statarena_app.consolidation_lock();
  FOR patch IN SELECT * FROM (VALUES
    ('statarena_app.consolidation_begin(text)',
      $old$ c=statarena_app.consolidation_lock();
 IF action NOT IN$old$,
      $new$ c=statarena_app.consolidation_lock();
 IF c->'physical_retirement_finalized'='true'::jsonb THEN
   RAISE EXCEPTION 'Physical provider tables were finalized; recovery requires the verified snapshot and publication replay';
 END IF;
 IF action NOT IN$new$),
    ('statarena_app.consolidation_rollback()',
      $old$ SELECT value INTO c FROM statarena_app.consolidation_state WHERE key='control';
 IF c->>'mode'='legacy'$old$,
      $new$ SELECT value INTO c FROM statarena_app.consolidation_state WHERE key='control';
 IF c->'physical_retirement_finalized'='true'::jsonb THEN
   RAISE EXCEPTION 'Physical provider tables were finalized; recovery requires the verified snapshot and publication replay';
 END IF;
 IF c->>'mode'='legacy'$new$),
    ('statarena_app.consolidation_status()',
      $old$WHERE n.nspname='statarena_retired_v1' AND c.relkind IN ('r','p')));$old$,
      $new$WHERE n.nspname='statarena_retired_v1' AND c.relkind IN ('r','p')),
 'physical_retirement',(SELECT value-'manifest'-'recovery_proof' FROM statarena_app.consolidation_state WHERE key='physical_retirement'),
 'rollback_available',coalesce((SELECT value->>'mode' IN ('active','rollback')
   AND value->'physical_retirement_finalized' IS DISTINCT FROM 'true'::jsonb
   FROM statarena_app.consolidation_state WHERE key='control'),false),
 'recovery_strategy',(SELECT CASE WHEN value->'physical_retirement_finalized'='true'::jsonb
   THEN 'restore_snapshot_then_replay' WHEN value->>'mode' IN ('active','rollback') THEN 'in_place_reverse_copy'
   ELSE 'legacy' END FROM statarena_app.consolidation_state WHERE key='control'));$new$)
  ) AS p(signature,old_text,new_text) LOOP
    definition=pg_get_functiondef(patch.signature::regprocedure);
    old_count=(length(definition)-length(replace(definition,patch.old_text,'')))/length(patch.old_text);
    new_count=(length(definition)-length(replace(definition,patch.new_text,'')))/length(patch.new_text);
    IF old_count=1 AND new_count=0 THEN EXECUTE replace(definition,patch.old_text,patch.new_text);
    ELSIF old_count<>0 OR new_count<>1 THEN RAISE EXCEPTION 'Unexpected retirement guard boundary for %',patch.signature;
    END IF;
  END LOOP;
END
$guards$;

REVOKE EXECUTE ON FUNCTION statarena_app.consolidation_retirement_contracts(),
  statarena_app.consolidation_retirement_plan(),
  statarena_app.consolidation_finalize_retirement(jsonb,jsonb,text) FROM PUBLIC;
