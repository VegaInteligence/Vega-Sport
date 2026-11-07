-- Resuming a full-range copy must still visit and certify every source row, but
-- an unchanged destination need not be inserted again. Filter before INSERT so
-- its constraints, triggers and WAL are paid only for new or changed records.
-- Keep the sealed 023/027 migrations and all copy/parity checkpoints unchanged.
DO $migration$
DECLARE
  function_id oid;
  definition text;
  patch record;
  old_count integer;
  new_count integer;
BEGIN
  PERFORM statarena_app.consolidation_lock();
  function_id := 'statarena_app.consolidation_copy_batch(text,integer)'::regprocedure;
  definition := pg_get_functiondef(function_id);
  IF strpos(definition,'"phase":"purge","resource":null,')=0 THEN
    RAISE EXCEPTION 'Nullable consolidation cursors must be installed before migration 028';
  END IF;
  FOR patch IN SELECT * FROM (VALUES
    ($old$ after_id bigint; after_path integer[]; affected bigint; reverse_copy boolean;
BEGIN$old$,
     $new$ after_id bigint; after_path integer[]; affected bigint; reverse_copy boolean;
 destination_columns text; destination_keys text; binary_floats text;
BEGIN$new$),
    ($old$   IF reverse_copy THEN
     q=q||format('INSERT INTO statarena_retired_v1.%I (%s) SELECT %s FROM picked t '
       'ON CONFLICT (%s) DO UPDATE SET %s RETURNING 1)',target,p->>'column_sql',p->>'select_columns',p->>'conflict',p->>'assignments');$old$,
     $new$   IF reverse_copy THEN
     SELECT string_agg(format('d.%I',value),',' ORDER BY ordinal)
       INTO destination_columns FROM jsonb_array_elements_text(p->'columns') WITH ORDINALITY x(value,ordinal);
     SELECT string_agg(format('d.%1$I=t.%1$I',value),' AND ' ORDER BY ordinal)
       INTO destination_keys FROM jsonb_array_elements_text(p->'keys') WITH ORDINALITY x(value,ordinal);
     -- Typed row equality retains array dimensions/lower bounds. Float equality
     -- alone treats -0 as +0, so additionally compare each float's wire bytes.
     SELECT coalesce(string_agg(format('float8send(d.%1$I) IS NOT DISTINCT FROM float8send(t.%1$I)',a.attname),
         ' AND ' ORDER BY a.attnum),'true') INTO binary_floats
       FROM pg_attribute a WHERE a.attrelid=format('statarena_retired_v1.%I',target)::regclass
         AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='double precision'::regtype
         AND p->'columns' ? a.attname;
     q=q||format('INSERT INTO statarena_retired_v1.%I (%s) SELECT %s FROM picked t '
       'WHERE NOT EXISTS (SELECT 1 FROM statarena_retired_v1.%I d WHERE %s '
       'AND ROW(%s) IS NOT DISTINCT FROM ROW(%s) AND %s) '
       'ON CONFLICT (%s) DO UPDATE SET %s RETURNING 1)',target,p->>'column_sql',p->>'select_columns',
       target,destination_keys,destination_columns,p->>'select_columns',binary_floats,p->>'conflict',p->>'assignments');$new$),
    ($old$     q=q||format('INSERT INTO statarena_app.%I (resource_id,record_kind,path,parent_kind,parent_path,position,metric_label,missing,null_groups,negative_zero,attributes) '
       'SELECT %s FROM picked t ON CONFLICT(resource_id,record_kind,path) DO UPDATE SET '
       'parent_kind=excluded.parent_kind,parent_path=excluded.parent_path,position=excluded.position,metric_label=excluded.metric_label,'
       'missing=excluded.missing,null_groups=excluded.null_groups,negative_zero=excluded.negative_zero,attributes=excluded.attributes RETURNING 1)',p->>'store',p->>'select');$old$,
     $new$     q=q||format('INSERT INTO statarena_app.%I (resource_id,record_kind,path,parent_kind,parent_path,position,metric_label,missing,null_groups,negative_zero,attributes) '
       'SELECT %s FROM picked t WHERE NOT EXISTS (SELECT 1 FROM statarena_app.%I r '
       'WHERE r.resource_id=t.%I AND r.record_kind=%L AND r.path=%s '
       'AND ROW(r.resource_id,r.record_kind,r.path,r.parent_kind,r.parent_path,r.position,r.metric_label,'
       'r.missing,r.null_groups,r.negative_zero,r.attributes) IS NOT DISTINCT FROM ROW(%s)) '
       'ON CONFLICT(resource_id,record_kind,path) DO UPDATE SET '
       'parent_kind=excluded.parent_kind,parent_path=excluded.parent_path,position=excluded.position,metric_label=excluded.metric_label,'
       'missing=excluded.missing,null_groups=excluded.null_groups,negative_zero=excluded.negative_zero,attributes=excluded.attributes RETURNING 1)',
       p->>'store',p->>'select',p->>'store',p->>'resource',target,p->>'path',p->>'select');$new$)
  ) AS changes(old_text,new_text) LOOP
    old_count := (length(definition)-length(replace(definition,patch.old_text,'')))/length(patch.old_text);
    new_count := (length(definition)-length(replace(definition,patch.new_text,'')))/length(patch.new_text);
    IF old_count=1 AND new_count=0 THEN
      definition := replace(definition,patch.old_text,patch.new_text);
    ELSIF old_count<>0 OR new_count<>1 THEN
      RAISE EXCEPTION 'Unexpected consolidation copy function body for migration 028';
    END IF;
  END LOOP;
  -- Replacing the installed definition preserves OID, owner, ACLs and attributes.
  EXECUTE definition;
END
$migration$;
