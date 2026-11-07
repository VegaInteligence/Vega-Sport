-- Preserve every typed/binary equality predicate and all source checkpoints.
-- A correlated lookup avoids a misestimated wide destination materialization
-- followed by an O(source batch * destination rows) nested anti-join.
DO $migration$
DECLARE
  function_id oid;
  definition text;
  old_fragment text := $old$   END IF;
   q=q||format(' SELECT jsonb_build_object$old$;
  new_fragment text := $new$   END IF;
   -- Keep the selected source batch intact. Fence only the exact destination
   -- lookup, so PostgreSQL can probe its complete primary key per source row.
   -- Apply this after both guarded 028 templates have constructed their SQL;
   -- the templates stay intact for safe reapplication of earlier migrations.
   IF (length(q)-length(replace(q,') ON CONFLICT','')))/length(') ON CONFLICT')<>1 THEN
     RAISE EXCEPTION 'Unexpected unchanged-row lookup boundary';
   END IF;
   q=replace(q,') ON CONFLICT',' OFFSET 0) ON CONFLICT');
   q=q||format(' SELECT jsonb_build_object$new$;
  old_count integer;
  new_count integer;
BEGIN
  PERFORM statarena_app.consolidation_lock();
  function_id := 'statarena_app.consolidation_copy_batch(text,integer)'::regprocedure;
  definition := pg_get_functiondef(function_id);
  IF strpos(definition,'WHERE NOT EXISTS (SELECT 1 FROM statarena_retired_v1.%I d WHERE %s ')=0
     OR strpos(definition,'SELECT %s FROM picked t WHERE NOT EXISTS (SELECT 1 FROM statarena_app.%I r ')=0 THEN
    RAISE EXCEPTION 'Migration 028 must precede bounded consolidation lookups';
  END IF;
  old_count := (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
  new_count := (length(definition)-length(replace(definition,new_fragment,'')))/length(new_fragment);
  IF old_count=1 AND new_count=0 THEN
    -- CREATE OR REPLACE retains OID, owner, ACLs and execution attributes.
    EXECUTE replace(definition,old_fragment,new_fragment);
  ELSIF old_count<>0 OR new_count<>1 THEN
    RAISE EXCEPTION 'Unexpected consolidation copy definition for migration 033';
  END IF;
END
$migration$;
