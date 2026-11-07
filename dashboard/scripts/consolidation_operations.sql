-- Included verbatim in generated migration 023. Every data operation is bounded.
-- All mutation functions are SECURITY INVOKER and unavailable to PUBLIC.
CREATE OR REPLACE FUNCTION statarena_app.consolidation_changed() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
 UPDATE statarena_app.consolidation_state
 SET value=jsonb_set(value,'{revision}',to_jsonb((value->>'revision')::bigint+1))
 WHERE key='control' AND value->>'mode' IN ('backfill','rollback');
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION statarena_app.consolidation_lock() RETURNS jsonb
LANGUAGE plpgsql AS $$ DECLARE c jsonb; BEGIN
 IF NOT pg_try_advisory_xact_lock(97813003) THEN
   RAISE EXCEPTION 'Publication lease is busy; retry after the publisher completes' USING ERRCODE='55P03';
 END IF;
 SELECT value INTO STRICT c FROM statarena_app.consolidation_state WHERE key='control' FOR UPDATE;
 RETURN c;
END $$;

CREATE OR REPLACE FUNCTION statarena_app.consolidation_status() RETURNS jsonb
LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object(
 'control',(SELECT value FROM statarena_app.consolidation_state WHERE key='control'),
 'targets',statarena_app.consolidation_plan(),
 'progress',coalesce((SELECT jsonb_object_agg(key,value) FROM statarena_app.consolidation_state
   WHERE key LIKE 'copy:%' OR key LIKE 'verify:%' OR key LIKE 'resources:%'),'{}'::jsonb),
 'active_physical_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='statarena_app' AND c.relkind IN ('r','p')),
 'retired_physical_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='statarena_retired_v1' AND c.relkind IN ('r','p'))); $$;

CREATE OR REPLACE FUNCTION statarena_app.consolidation_preflight(source_schema text) RETURNS void
LANGUAGE plpgsql AS $$ DECLARE p jsonb; rel oid; actual text[]; expected text[]; owner_id oid; BEGIN
 IF source_schema NOT IN ('statarena_app','statarena_retired_v1') THEN RAISE EXCEPTION 'Invalid source schema'; END IF;
 SELECT relowner INTO STRICT owner_id FROM pg_class WHERE oid='statarena_app.catalog_records'::regclass;
 FOR p IN SELECT * FROM jsonb_array_elements(statarena_app.consolidation_plan()) LOOP
   rel=to_regclass(format('%I.%I',source_schema,p->>'table'));
   IF rel IS NULL OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=rel AND relkind='r'
       AND NOT relrowsecurity AND relowner=owner_id AND pg_has_role(current_user,relowner,'USAGE')) THEN
     RAISE EXCEPTION 'Source % must be an ordinary table owned by the record-store owner, without RLS',p->>'table';
   END IF;
   SELECT array_agg(attname::text ORDER BY attname) INTO actual FROM pg_attribute
     WHERE attrelid=rel AND attnum>0 AND NOT attisdropped;
   SELECT array_agg(v ORDER BY v) INTO expected FROM jsonb_array_elements_text(p->'columns') v;
   IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Unmapped source columns in %',p->>'table'; END IF;
   IF EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attribute b ON b.attrelid=to_regclass('statarena_next.'||(p->>'table'))
       AND b.attname=a.attname AND b.attnum>0 AND NOT b.attisdropped
       WHERE a.attrelid=rel AND a.attnum>0 AND NOT a.attisdropped
       AND (a.atttypid<>b.atttypid OR a.atttypmod<>b.atttypmod)) THEN
     RAISE EXCEPTION 'Source type differs from typed adapter: %',p->>'table';
   END IF;
   IF EXISTS(SELECT 1 FROM pg_constraint fk WHERE fk.contype='f' AND fk.confrelid=rel
      AND fk.conrelid NOT IN (SELECT to_regclass(format('%I.%I',source_schema,t->>'table'))
           FROM jsonb_array_elements(statarena_app.consolidation_plan()) t)) THEN
     RAISE EXCEPTION 'Unmapped foreign key references %; extend the explicit migration manifest',p->>'table';
   END IF;
   IF EXISTS(SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid
       JOIN pg_class v ON v.oid=r.ev_class JOIN pg_namespace ns ON ns.oid=v.relnamespace
       WHERE d.refobjid=rel AND d.classid='pg_rewrite'::regclass AND v.relkind='v'
       AND ns.nspname NOT IN ('statarena_app','statarena_next','statarena_retired_v1')) THEN
     RAISE EXCEPTION 'External view depends on %; extend the explicit migration manifest',p->>'table';
   END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION statarena_app.consolidation_begin(action text) RETURNS jsonb
LANGUAGE plpgsql AS $$ DECLARE c jsonb; expected text; BEGIN
 c=statarena_app.consolidation_lock();
 IF action NOT IN ('backfill','rollback') THEN RAISE EXCEPTION 'Expected backfill or rollback'; END IF;
 IF c->>'mode'=action THEN RETURN c; END IF;
 expected=CASE action WHEN 'backfill' THEN 'legacy' ELSE 'active' END;
 IF c->>'mode'<>expected THEN RAISE EXCEPTION 'Cannot begin % from %',action,c->>'mode'; END IF;
 PERFORM statarena_app.consolidation_preflight(CASE action WHEN 'backfill' THEN 'statarena_app' ELSE 'statarena_retired_v1' END);
 DELETE FROM statarena_app.consolidation_state WHERE key LIKE 'copy:%' OR key LIKE 'verify:%' OR key LIKE 'resources:%';
 c=c||jsonb_build_object('mode',action,'started_at',clock_timestamp(),'revision',(c->>'revision')::bigint+1);
 UPDATE statarena_app.consolidation_state SET value=c WHERE key='control';
 RETURN c;
END $$;

CREATE OR REPLACE FUNCTION statarena_app.consolidation_restart() RETURNS jsonb
LANGUAGE plpgsql AS $$ DECLARE c jsonb; BEGIN
 c=statarena_app.consolidation_lock();
 IF c->>'mode' NOT IN ('backfill','rollback') THEN RAISE EXCEPTION 'No migration to restart'; END IF;
 DELETE FROM statarena_app.consolidation_state WHERE key LIKE 'copy:%' OR key LIKE 'verify:%' OR key LIKE 'resources:%';
 RETURN c;
END $$;

CREATE OR REPLACE FUNCTION statarena_app.consolidation_copy_batch(target text,batch_limit integer DEFAULT 2000) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE c jsonb; p jsonb; progress jsonb; result jsonb; q text; source_schema text;
 after_id bigint; after_path integer[]; affected bigint; reverse_copy boolean;
BEGIN
 c=statarena_app.consolidation_lock();
 IF c->>'mode' NOT IN ('backfill','rollback') OR batch_limit NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid migration phase or row budget'; END IF;
 reverse_copy=c->>'mode'='rollback';
 SELECT value INTO p FROM jsonb_array_elements(statarena_app.consolidation_plan()) WHERE value->>'table'=target;
 IF p IS NULL THEN RAISE EXCEPTION 'Unknown consolidation target %',target; END IF;
 IF p->>'parent' IS NOT NULL AND NOT coalesce((SELECT (value->>'complete')::boolean
     FROM statarena_app.consolidation_state WHERE key='copy:'||(p->>'parent')),false) THEN
   RAISE EXCEPTION 'Copy parent % before %',p->>'parent',target;
 END IF;
 SELECT value INTO progress FROM statarena_app.consolidation_state WHERE key='copy:'||target;
 progress=coalesce(progress,'{"phase":"purge","resource":0,"path":[],"rows":0,"pruned":0,"complete":false}'::jsonb);
 IF (progress->>'complete')::boolean THEN RETURN progress; END IF;
 source_schema=CASE WHEN reverse_copy THEN 'statarena_retired_v1' ELSE 'statarena_app' END;
 IF progress->>'phase'='purge' THEN
   IF reverse_copy THEN
     q=format('WITH obsolete AS (SELECT t.ctid FROM statarena_retired_v1.%I t WHERE NOT EXISTS '
       '(SELECT 1 FROM statarena_app.%I r WHERE r.record_kind=%L AND %s) LIMIT $1) '
       'DELETE FROM statarena_retired_v1.%I t USING obsolete x WHERE t.ctid=x.ctid',target,p->>'store',target,p->>'lookup',target);
   ELSE
     q=format('WITH obsolete AS (SELECT r.ctid FROM statarena_app.%I r WHERE r.record_kind=%L AND NOT EXISTS '
       '(SELECT 1 FROM statarena_app.%I t WHERE %s) LIMIT $1) '
       'DELETE FROM statarena_app.%I r USING obsolete x WHERE r.ctid=x.ctid',p->>'store',target,target,p->>'lookup',p->>'store');
   END IF;
   EXECUTE q USING batch_limit;
   GET DIAGNOSTICS affected=ROW_COUNT;
   progress=progress||jsonb_build_object('pruned',(progress->>'pruned')::bigint+affected,
      'phase',CASE WHEN affected<batch_limit THEN 'copy' ELSE 'purge' END);
 ELSE
   after_id=(progress->>'resource')::bigint;
   SELECT coalesce(array_agg(v::integer),'{}'::integer[]) INTO after_path FROM jsonb_array_elements_text(progress->'path') v;
   q=format('WITH picked AS MATERIALIZED (SELECT t.* FROM %I.%I t WHERE %s ORDER BY %s LIMIT $3), written AS (',
       CASE WHEN reverse_copy THEN 'statarena_next' ELSE 'statarena_app' END,target,p->>'cursor',p->>'order');
   IF reverse_copy THEN
     q=q||format('INSERT INTO statarena_retired_v1.%I (%s) SELECT %s FROM picked t '
       'ON CONFLICT (%s) DO UPDATE SET %s RETURNING 1)',target,p->>'column_sql',p->>'select_columns',p->>'conflict',p->>'assignments');
   ELSE
     q=q||format('INSERT INTO statarena_app.%I (resource_id,record_kind,path,parent_kind,parent_path,position,metric_label,missing,null_groups,negative_zero,attributes) '
       'SELECT %s FROM picked t ON CONFLICT(resource_id,record_kind,path) DO UPDATE SET '
       'parent_kind=excluded.parent_kind,parent_path=excluded.parent_path,position=excluded.position,metric_label=excluded.metric_label,'
       'missing=excluded.missing,null_groups=excluded.null_groups,negative_zero=excluded.negative_zero,attributes=excluded.attributes RETURNING 1)',p->>'store',p->>'select');
   END IF;
   q=q||format(' SELECT jsonb_build_object(''rows'',(SELECT count(*) FROM picked),''last'', '
       '(SELECT jsonb_build_array(t.%I,%s) FROM picked t ORDER BY %s LIMIT 1))',
       p->>'resource',p->>'path',replace(p->>'order',',',' DESC,')||' DESC');
   EXECUTE q INTO result USING after_id,after_path,batch_limit;
   progress=progress||jsonb_build_object('rows',(progress->>'rows')::bigint+(result->>'rows')::bigint,
       'complete',(result->>'rows')::bigint<batch_limit,
       'resource',coalesce(result#>'{last,0}',progress->'resource'),
       'path',coalesce(result#>'{last,1}',progress->'path'));
 END IF;
 INSERT INTO statarena_app.consolidation_state VALUES('copy:'||target,progress)
   ON CONFLICT(key) DO UPDATE SET value=excluded.value;
 RETURN progress;
END $$;

CREATE OR REPLACE FUNCTION statarena_app.consolidation_verify_batch(target text,batch_limit integer DEFAULT 2000) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE c jsonb; p jsonb; progress jsonb; boundary jsonb; result jsonb; q text; source_schema text;
 after_id bigint; after_path integer[]; last_id bigint; last_path integer[];
BEGIN
 c=statarena_app.consolidation_lock();
 IF c->>'mode' NOT IN ('backfill','rollback') OR batch_limit NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid migration phase or row budget'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(statarena_app.consolidation_plan()) t
     LEFT JOIN statarena_app.consolidation_state s ON s.key='copy:'||(t->>'table')
     WHERE NOT coalesce((s.value->>'complete')::boolean,false)) THEN RAISE EXCEPTION 'Finish every copy before parity verification'; END IF;
 SELECT value INTO p FROM jsonb_array_elements(statarena_app.consolidation_plan()) WHERE value->>'table'=target;
 IF p IS NULL THEN RAISE EXCEPTION 'Unknown consolidation target %',target; END IF;
 SELECT value INTO progress FROM statarena_app.consolidation_state WHERE key='verify:'||target;
 progress=coalesce(progress,jsonb_build_object('revision',c->'revision','resource',0,'path','[]'::jsonb,'rows',0,'complete',false));
 IF progress->'revision' IS DISTINCT FROM c->'revision' THEN RAISE EXCEPTION 'Storage changed during verification; restart and recopy before cutover'; END IF;
 IF (progress->>'complete')::boolean THEN RETURN progress; END IF;
 after_id=(progress->>'resource')::bigint;
 SELECT coalesce(array_agg(v::integer),'{}'::integer[]) INTO after_path FROM jsonb_array_elements_text(progress->'path') v;
 source_schema=CASE WHEN c->>'mode'='rollback' THEN 'statarena_retired_v1' ELSE 'statarena_app' END;
 q=format('WITH candidates AS ((SELECT t.%I AS resource_id,%s AS path FROM %I.%I t WHERE %s ORDER BY %s LIMIT $3) '
   'UNION (SELECT resource_id,path FROM statarena_app.%I WHERE record_kind=%L AND ROW(resource_id,path)>ROW($1,$2) '
   'ORDER BY resource_id,path LIMIT $3)), bounded_keys AS (SELECT * FROM candidates ORDER BY resource_id,path LIMIT $3) '
   'SELECT jsonb_build_object(''count'',count(*),''last'',(jsonb_agg(jsonb_build_array(resource_id,path) ORDER BY resource_id,path)->-1)) FROM bounded_keys',
   p->>'resource',p->>'path',source_schema,target,p->>'cursor',p->>'order',p->>'store',target);
 EXECUTE q INTO boundary USING after_id,after_path,batch_limit;
 IF (boundary->>'count')::bigint=0 THEN
   progress=progress||'{"complete":true}'::jsonb;
 ELSE
   last_id=(boundary#>>'{last,0}')::bigint;
   SELECT coalesce(array_agg(v::integer),'{}'::integer[]) INTO last_path FROM jsonb_array_elements_text(boundary#>'{last,1}') v;
   q=format('WITH old_rows AS (SELECT t.%I AS resource_id,%s AS path,%s AS body FROM %I.%I t WHERE %s AND %s), '
     'new_rows AS (SELECT t.%I AS resource_id,%s AS path,%s AS body FROM statarena_next.%I t WHERE %s AND %s) '
     'SELECT jsonb_build_object(''mismatches'',count(*) FILTER(WHERE a.body IS DISTINCT FROM b.body),''rows'',count(a.body)) '
     'FROM old_rows a FULL JOIN new_rows b USING(resource_id,path)',p->>'resource',p->>'path',p->>'evidence',source_schema,target,p->>'cursor',p->>'upper',
     p->>'resource',p->>'path',p->>'evidence',target,p->>'cursor',p->>'upper');
   EXECUTE q INTO result USING after_id,after_path,last_id,last_path;
   IF (result->>'mismatches')::bigint<>0 THEN RAISE EXCEPTION 'Exact row parity failed for % between resources % and % (% mismatches)',target,after_id,last_id,result->>'mismatches'; END IF;
   progress=progress||jsonb_build_object('resource',last_id,'path',last_path,'rows',(progress->>'rows')::bigint+(result->>'rows')::bigint);
 END IF;
 INSERT INTO statarena_app.consolidation_state VALUES('verify:'||target,progress)
   ON CONFLICT(key) DO UPDATE SET value=excluded.value;
 RETURN progress;
END $$;

CREATE OR REPLACE FUNCTION statarena_app.consolidation_support_rows(pid bigint,preview boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$ DECLARE p jsonb; rows jsonb; result jsonb='{}'; BEGIN
 FOR p IN SELECT value FROM jsonb_array_elements(statarena_app.consolidation_plan()) WHERE value->>'domain'='support' LOOP
   EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY %s),''[]''::jsonb) FROM %I.%I t WHERE projection_id=$1',
     p->>'order',CASE WHEN preview THEN 'statarena_next' ELSE 'statarena_app' END,p->>'table') INTO rows USING pid;
   result=result||jsonb_build_object(p->>'table',rows);
 END LOOP;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION statarena_app.consolidation_verify_resources(family text,batch_limit integer DEFAULT 32) RETURNS jsonb
LANGUAGE plpgsql AS $$ DECLARE c jsonb; progress jsonb; result jsonb; head text; id_col text; old_read text; new_read text; BEGIN
 c=statarena_app.consolidation_lock();
 IF c->>'mode'<>'backfill' OR batch_limit NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'Invalid resource verification phase or budget'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(statarena_app.consolidation_plan()) t
     LEFT JOIN statarena_app.consolidation_state s ON s.key='verify:'||(t->>'table')
     WHERE NOT coalesce((s.value->>'complete')::boolean,false) OR s.value->'revision' IS DISTINCT FROM c->'revision') THEN
   RAISE EXCEPTION 'Complete current-revision row parity before resource parity';
 END IF;
 CASE family
 WHEN 'catalog' THEN head='catalog_editions';id_col='resource_id';old_read='statarena_app.catalog_response(t)';new_read='statarena_next.catalog_response(t)';
 WHEN 'detail' THEN head='match_families';id_col='resource_id';old_read='statarena_app.detail_response(t)';new_read='statarena_next.detail_response(t)';
 WHEN 'support' THEN head='support_projection';id_col='id';old_read='statarena_app.consolidation_support_rows(t.id,false)';new_read='statarena_app.consolidation_support_rows(t.id,true)';
 ELSE RAISE EXCEPTION 'Unknown resource family %',family;
 END CASE;
 SELECT value INTO progress FROM statarena_app.consolidation_state WHERE key='resources:'||family;
 progress=coalesce(progress,jsonb_build_object('revision',c->'revision','resource',0,'rows',0,'complete',false));
 IF progress->'revision' IS DISTINCT FROM c->'revision' THEN RAISE EXCEPTION 'Storage changed during resource verification'; END IF;
 IF (progress->>'complete')::boolean THEN RETURN progress; END IF;
 EXECUTE format('WITH selected AS MATERIALIZED (SELECT * FROM statarena_app.%I WHERE %I>$1 ORDER BY %I LIMIT $2) '
   'SELECT jsonb_build_object(''rows'',count(*),''last'',max(t.%I),''mismatches'',count(*) FILTER(WHERE %s IS DISTINCT FROM %s)) FROM selected t',
   head,id_col,id_col,id_col,old_read,new_read) INTO result USING (progress->>'resource')::bigint,batch_limit;
 IF (result->>'mismatches')::bigint<>0 THEN RAISE EXCEPTION 'Native resource parity failed for % after resource %',family,progress->>'resource'; END IF;
 progress=progress||jsonb_build_object('resource',coalesce(nullif(result->'last','null'::jsonb),progress->'resource'),
   'rows',(progress->>'rows')::bigint+(result->>'rows')::bigint,'complete',(result->>'rows')::bigint<batch_limit);
 INSERT INTO statarena_app.consolidation_state VALUES('resources:'||family,progress) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
 RETURN progress;
END $$;

CREATE OR REPLACE FUNCTION statarena_app.consolidation_acl(acl jsonb,object_type text,object_name text) RETURNS void
LANGUAGE plpgsql AS $$ DECLARE a jsonb; grantee text; BEGIN
 IF object_type NOT IN ('TABLE','FUNCTION') THEN RAISE EXCEPTION 'Invalid ACL object'; END IF;
 EXECUTE 'REVOKE ALL ON '||object_type||' '||object_name||' FROM PUBLIC';
 FOR a IN SELECT * FROM jsonb_array_elements(acl) LOOP
   grantee=CASE WHEN a->>'grantee'='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(a->>'grantee') END;
   EXECUTE 'GRANT '||(a->>'privilege')||' ON '||object_type||' '||object_name||' TO '||grantee||
     CASE WHEN (a->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION statarena_app.consolidation_activate() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE c jsonb; p jsonb; item jsonb; relations jsonb; functions jsonb; views jsonb; names text;
BEGIN
 IF NOT pg_try_advisory_xact_lock(97813003) THEN RAISE EXCEPTION 'Publication lease is busy' USING ERRCODE='55P03'; END IF;
 SELECT value INTO c FROM statarena_app.consolidation_state WHERE key='control';
 IF c->>'mode'='active' THEN RETURN c; END IF;
 IF c->>'mode'<>'backfill' THEN RAISE EXCEPTION 'Backfill and verification are required'; END IF;
 -- Lock source relations before the revision row, avoiding a lock-order inversion
 -- with an old writer's AFTER STATEMENT revision trigger.
 SELECT string_agg(format('statarena_app.%I',value->>'table'),',') INTO names FROM jsonb_array_elements(statarena_app.consolidation_plan());
 EXECUTE 'LOCK TABLE '||names||',statarena_app.catalog_records,statarena_app.support_records,statarena_app.detail_records,statarena_app.catalog_editions,statarena_app.support_projection,statarena_app.match_families IN SHARE MODE';
 c=statarena_app.consolidation_lock();
 PERFORM statarena_app.consolidation_preflight('statarena_app');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(statarena_app.consolidation_plan()) t
     LEFT JOIN statarena_app.consolidation_state s ON s.key='verify:'||(t->>'table')
     WHERE NOT coalesce((s.value->>'complete')::boolean,false) OR s.value->'revision' IS DISTINCT FROM c->'revision')
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['catalog','support','detail']) t
     LEFT JOIN statarena_app.consolidation_state s ON s.key='resources:'||t
     WHERE NOT coalesce((s.value->>'complete')::boolean,false) OR s.value->'revision' IS DISTINCT FROM c->'revision') THEN
   RAISE EXCEPTION 'Complete, current-revision row and resource parity required';
 END IF;
 PERFORM set_config('search_path','pg_catalog',true);
 SELECT jsonb_agg(jsonb_build_object('name',cl.relname,'owner',pg_get_userbyid(cl.relowner),
   'columns',(SELECT jsonb_agg(attname ORDER BY attnum) FROM pg_attribute WHERE attrelid=cl.oid AND attnum>0 AND NOT attisdropped),
   'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable)) FROM aclexplode(coalesce(cl.relacl,acldefault('r',cl.relowner))) a))) INTO relations
 FROM pg_class cl WHERE cl.oid IN (SELECT to_regclass('statarena_app.'||(value->>'table')) FROM jsonb_array_elements(statarena_app.consolidation_plan()));
 SELECT coalesce(jsonb_agg(jsonb_build_object('name',f.proname,'args',pg_get_function_identity_arguments(f.oid),'ddl',pg_get_functiondef(f.oid),
   'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable)) FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a))),'[]'::jsonb) INTO functions
 FROM pg_proc f WHERE f.pronamespace='statarena_app'::regnamespace AND EXISTS(SELECT 1 FROM pg_type ty WHERE ty.oid=ANY(f.proargtypes)
   AND ty.typrelid IN (SELECT to_regclass('statarena_app.'||(value->>'table')) FROM jsonb_array_elements(statarena_app.consolidation_plan())));
 SELECT coalesce(jsonb_agg(jsonb_build_object('name',cl.relname,'ddl',pg_get_viewdef(cl.oid,true))),'[]'::jsonb) INTO views
 FROM pg_class cl WHERE cl.relnamespace='statarena_app'::regnamespace AND cl.relkind='v';
 INSERT INTO statarena_app.consolidation_state VALUES('retirement_manifest',jsonb_build_object('relations',relations,'functions',functions,'views',views,'revision',c->'revision','created_at',clock_timestamp()))
   ON CONFLICT(key) DO UPDATE SET value=excluded.value;
 FOR item IN SELECT * FROM jsonb_array_elements(functions) LOOP
   EXECUTE format('ALTER FUNCTION statarena_app.%I(%s) SET SCHEMA statarena_retired_v1',item->>'name',item->>'args');
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(relations) LOOP
   EXECUTE format('ALTER TABLE statarena_app.%I SET SCHEMA statarena_retired_v1',item->>'name');
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(relations) LOOP
   SELECT string_agg(quote_ident(v),',') INTO names FROM jsonb_array_elements_text(item->'columns') v;
   EXECUTE format('CREATE VIEW statarena_app.%I AS SELECT %s FROM statarena_next.%I',item->>'name',names,item->>'name');
   EXECUTE format('ALTER VIEW statarena_app.%I OWNER TO %I',item->>'name',item->>'owner');
   PERFORM statarena_app.consolidation_acl(item->'acl','TABLE',format('statarena_app.%I',item->>'name'));
   EXECUTE format('COMMENT ON VIEW statarena_app.%I IS %L',item->>'name','Typed compatibility adapter over consolidated provider records; no independent storage.');
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(functions) LOOP
   EXECUTE item->>'ddl';
   PERFORM statarena_app.consolidation_acl(item->'acl','FUNCTION',format('statarena_app.%I(%s)',item->>'name',item->>'args'));
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(views) LOOP
   EXECUTE format('CREATE OR REPLACE VIEW statarena_app.%I AS %s',item->>'name',item->>'ddl');
 END LOOP;
 UPDATE statarena_app.publications SET generation=generation+1,published_at=clock_timestamp();
 c=c||jsonb_build_object('mode','active','activated_at',clock_timestamp(),'retired_tables',jsonb_array_length(relations));
 UPDATE statarena_app.consolidation_state SET value=c WHERE key='control';
 RETURN c;
END $$;

CREATE OR REPLACE FUNCTION statarena_app.consolidation_rollback() RETURNS jsonb
LANGUAGE plpgsql AS $$ DECLARE c jsonb; saved jsonb; item jsonb; p jsonb; names text; definition text; BEGIN
 IF NOT pg_try_advisory_xact_lock(97813003) THEN RAISE EXCEPTION 'Publication lease is busy' USING ERRCODE='55P03'; END IF;
 SELECT value INTO c FROM statarena_app.consolidation_state WHERE key='control';
 IF c->>'mode'='legacy' THEN RETURN c; END IF;
 IF c->>'mode'<>'rollback' THEN RAISE EXCEPTION 'Prepare and verify a reverse copy before rollback'; END IF;
 SELECT string_agg(format('statarena_retired_v1.%I',value->>'table'),',') INTO names FROM jsonb_array_elements(statarena_app.consolidation_plan());
 EXECUTE 'LOCK TABLE '||names||',statarena_app.catalog_records,statarena_app.support_records,statarena_app.detail_records,statarena_app.catalog_editions,statarena_app.support_projection,statarena_app.match_families IN SHARE MODE';
 c=statarena_app.consolidation_lock();
 PERFORM statarena_app.consolidation_preflight('statarena_retired_v1');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(statarena_app.consolidation_plan()) t
     LEFT JOIN statarena_app.consolidation_state s ON s.key='verify:'||(t->>'table')
     WHERE NOT coalesce((s.value->>'complete')::boolean,false) OR s.value->'revision' IS DISTINCT FROM c->'revision') THEN
   RAISE EXCEPTION 'Reverse copy must include every post-cutover row, with exact current parity';
 END IF;
 SELECT value INTO STRICT saved FROM statarena_app.consolidation_state WHERE key='retirement_manifest';
 -- Rebind existing views before removing the temporary typed adapters. No CASCADE.
 FOR item IN SELECT * FROM jsonb_array_elements(saved->'views') LOOP
   definition=item->>'ddl';
   FOR p IN SELECT * FROM jsonb_array_elements(statarena_app.consolidation_plan()) LOOP
     definition=replace(definition,'statarena_app.'||(p->>'table')||' ','statarena_retired_v1.'||(p->>'table')||' ');
     definition=replace(definition,'statarena_app.'||(p->>'table')||E'\n','statarena_retired_v1.'||(p->>'table')||E'\n');
   END LOOP;
   EXECUTE format('CREATE OR REPLACE VIEW statarena_app.%I AS %s',item->>'name',definition);
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(saved->'functions') LOOP
   EXECUTE format('DROP FUNCTION statarena_app.%I(%s)',item->>'name',item->>'args');
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(saved->'relations') LOOP
   EXECUTE format('DROP VIEW statarena_app.%I',item->>'name');
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(saved->'relations') LOOP
   EXECUTE format('ALTER TABLE statarena_retired_v1.%I SET SCHEMA statarena_app',item->>'name');
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(saved->'functions') LOOP
   EXECUTE format('ALTER FUNCTION statarena_retired_v1.%I(%s) SET SCHEMA statarena_app',item->>'name',item->>'args');
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(saved->'views') LOOP
   EXECUTE format('CREATE OR REPLACE VIEW statarena_app.%I AS %s',item->>'name',item->>'ddl');
 END LOOP;
 UPDATE statarena_app.publications SET generation=generation+1,published_at=clock_timestamp();
 c=c||jsonb_build_object('mode','legacy','rolled_back_at',clock_timestamp());
 UPDATE statarena_app.consolidation_state SET value=c WHERE key='control';
 RETURN c;
END $$;

-- Cancel only a pre-cutover maintenance window; old physical storage is still authoritative.
CREATE OR REPLACE FUNCTION statarena_app.consolidation_cancel() RETURNS jsonb
LANGUAGE plpgsql AS $$ DECLARE c jsonb; BEGIN
 c=statarena_app.consolidation_lock();
 IF c->>'mode' NOT IN ('backfill','rollback') THEN RAISE EXCEPTION 'No maintenance phase to cancel'; END IF;
 c=c||jsonb_build_object('mode',CASE c->>'mode' WHEN 'backfill' THEN 'legacy' ELSE 'active' END,'cancelled_at',clock_timestamp());
 UPDATE statarena_app.consolidation_state SET value=c WHERE key='control';
 RETURN c;
END $$;

REVOKE EXECUTE ON FUNCTION statarena_app.consolidation_changed(),statarena_app.consolidation_lock(),
 statarena_app.consolidation_preflight(text),statarena_app.consolidation_begin(text),statarena_app.consolidation_restart(),
 statarena_app.consolidation_copy_batch(text,integer),statarena_app.consolidation_verify_batch(text,integer),
 statarena_app.consolidation_verify_resources(text,integer),statarena_app.consolidation_activate(),
 statarena_app.consolidation_rollback(),statarena_app.consolidation_cancel(),statarena_app.consolidation_acl(jsonb,text,text)
 FROM PUBLIC;
