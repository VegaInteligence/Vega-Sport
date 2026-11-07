-- Resource identifiers are bigint identities, not strictly positive integers.
-- NULL means "before the first row", including bigint minimum, negative and
-- zero identifiers. Do not amend the sealed 023 migration or its generator.
-- The caller journals this migration in the same transaction as installation.
DO $migration$
DECLARE
  control jsonb;
  original_plan jsonb;
  corrected_plan jsonb := '[]'::jsonb;
  node jsonb;
  cursor_text text;
  function_id oid;
  function_body text;
  definition text;
  replacement text;
  patch record;
  old_count integer;
  new_count integer;
BEGIN
  control := statarena_app.consolidation_lock();
  original_plan := statarena_app.consolidation_plan();
  IF jsonb_typeof(original_plan)<>'array' OR jsonb_array_length(original_plan)=0 THEN
    RAISE EXCEPTION 'Consolidation plan must be installed before migration 027';
  END IF;
  FOR node IN SELECT value FROM jsonb_array_elements(original_plan) LOOP
    cursor_text := node->>'cursor';
    IF left(cursor_text,length('($1 IS NULL OR ('))='($1 IS NULL OR (' THEN
      corrected_plan := corrected_plan || jsonb_build_array(node);
    ELSIF left(cursor_text,4)='ROW(' AND strpos(cursor_text,' > ROW($1')>0 THEN
      corrected_plan := corrected_plan || jsonb_build_array(jsonb_set(node,'{cursor}',
        to_jsonb('($1 IS NULL OR (' || cursor_text || '))')));
    ELSE
      RAISE EXCEPTION 'Unexpected consolidation cursor for %',node->>'table';
    END IF;
  END LOOP;
  IF corrected_plan IS DISTINCT FROM original_plan THEN
    function_id := 'statarena_app.consolidation_plan()'::regprocedure;
    SELECT prosrc INTO STRICT function_body FROM pg_proc WHERE oid=function_id;
    definition := pg_get_functiondef(function_id);
    IF (length(definition)-length(replace(definition,function_body,'')))/length(function_body)<>1 THEN
      RAISE EXCEPTION 'Unexpected consolidation plan definition';
    END IF;
    replacement := format(' SELECT %L::jsonb; ',corrected_plan::text);
    EXECUTE replace(definition,function_body,replacement);
  END IF;
  -- Guard every exact replacement. CREATE OR REPLACE keeps function identity,
  -- owner and existing EXECUTE ACLs; pg_get_functiondef preserves attributes.
  FOR patch IN SELECT * FROM (VALUES
    ('statarena_app.consolidation_copy_batch(text,integer)',
      $old$"phase":"purge","resource":0,$old$,
      $new$"phase":"purge","resource":null,$new$),
    ('statarena_app.consolidation_verify_batch(text,integer)',
      $old$'resource',0,'path'$old$,
      $new$'resource',NULL,'path'$new$),
    ('statarena_app.consolidation_verify_batch(text,integer)',
      $old$AND ROW(resource_id,path)>ROW($1,$2)$old$,
      $new$AND ($1 IS NULL OR ROW(resource_id,path)>ROW($1,$2))$new$),
    ('statarena_app.consolidation_verify_resources(text,integer)',
      $old$'resource',0,'rows'$old$,
      $new$'resource',NULL,'rows'$new$),
    ('statarena_app.consolidation_verify_resources(text,integer)',
      $old$WHERE %I>$1 ORDER BY$old$,
      $new$WHERE ($1 IS NULL OR %I>$1) ORDER BY$new$)
  ) AS changes(signature,old_text,new_text) LOOP
    function_id := patch.signature::regprocedure;
    definition := pg_get_functiondef(function_id);
    old_count := (length(definition)-length(replace(definition,patch.old_text,'')))/length(patch.old_text);
    new_count := (length(definition)-length(replace(definition,patch.new_text,'')))/length(patch.new_text);
    IF old_count=1 AND new_count=0 THEN
      EXECUTE replace(definition,patch.old_text,patch.new_text);
    ELSIF old_count<>0 OR new_count<>1 THEN
      RAISE EXCEPTION 'Unexpected consolidation function body for %',patch.signature;
    END IF;
  END LOOP;
  IF control->>'cursor_version' IS DISTINCT FROM 'null-start-v1' THEN
    -- Old zero-start proofs cannot authorize cutover. Recopy is idempotent and
    -- traverses the complete key range; no source or consolidated row is deleted.
    DELETE FROM statarena_app.consolidation_state
      WHERE key LIKE 'copy:%' OR key LIKE 'verify:%' OR key LIKE 'resources:%';
    UPDATE statarena_app.consolidation_state
      SET value=control || jsonb_build_object('cursor_version','null-start-v1',
        'revision',(control->>'revision')::bigint+1,'cursor_corrected_at',clock_timestamp())
      WHERE key='control';
  END IF;
END
$migration$;
