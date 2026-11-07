-- Keep every typed predicate from sealed migration 023, but dispatch to one
-- cached PL/pgSQL branch instead of evaluating its giant SQL CASE per row.
-- Existing CHECK constraints, function identities, owners and grants remain.
DO $migration$
DECLARE
  item record;
  function_id oid;
  source text;
  language_name text;
  source_digest text;
  definition text;
  branches text;
  branch_count integer;
  replacement text;
BEGIN
  PERFORM statarena_app.consolidation_lock();
  FOR item IN SELECT * FROM (VALUES
    ('catalog',62,'2fff784ffdc6f8b216d2ba63eb33ec41f812ded981be0a237797f8e1aa5bceda','8bb37383a2ffccfefbcfe2fb85c2c12a85e7a9e3dc706d0c6f3dc800ca200d00'),
    ('support',18,'45e85af99baf39a984756ffe8170af31441ff0f537c581589716b58a20c787f2','e840d2f907607e9a38304eeeaa3e1a8850bdac95204dd7f5d155afcffd11ce32'),
    ('detail',32,'c95b6ec76b652522232e53e697772ee42c733109c0d2b597dac6016d6571e540','a6c552fee238a30154e821d8cdc1bfd76d13671d2f785b6a714080b09f382cc8')
  ) AS expected(domain,node_count,old_digest,new_digest) LOOP
    function_id := format('statarena_app.%I(text,jsonb)',item.domain||'_attributes_valid')::regprocedure;
    SELECT f.prosrc,l.lanname INTO STRICT source,language_name
      FROM pg_proc f JOIN pg_language l ON l.oid=f.prolang WHERE f.oid=function_id;
    source_digest := encode(sha256(convert_to(source,'UTF8')),'hex');
    IF language_name='plpgsql' AND source_digest=item.new_digest THEN CONTINUE; END IF;
    IF language_name<>'sql' OR source_digest<>item.old_digest THEN
      RAISE EXCEPTION 'Unexpected % attribute validator body before migration 029',item.domain;
    END IF;
    -- The guarded body has one complete predicate per line. Only dispatch and
    -- return syntax change; each expression is retained byte for byte.
    SELECT string_agg('    '||regexp_replace(line,' THEN [(]',' THEN RETURN coalesce((')||',false);',
                     E'\n' ORDER BY ordinal),count(*)
      INTO branches,branch_count
      FROM regexp_split_to_table(source,E'\n') WITH ORDINALITY rows(line,ordinal)
      WHERE left(line,5)='WHEN ';
    replacement := E'BEGIN\n  CASE kind\n'||branches||E'\n    ELSE RETURN false;\n  END CASE;\nEND;';
    IF branch_count<>item.node_count OR encode(sha256(convert_to(replacement,'UTF8')),'hex')<>item.new_digest THEN
      RAISE EXCEPTION 'Attribute validator expression mismatch for migration 029: %',item.domain;
    END IF;
    definition := pg_get_functiondef(function_id);
    IF (length(definition)-length(replace(definition,source,'')))/length(source)<>1
       OR (length(definition)-length(replace(definition,'LANGUAGE sql','')))/length('LANGUAGE sql')<>1 THEN
      RAISE EXCEPTION 'Unexpected % attribute validator definition before migration 029',item.domain;
    END IF;
    EXECUTE replace(replace(definition,source,replacement),'LANGUAGE sql','LANGUAGE plpgsql');
  END LOOP;
END
$migration$;
