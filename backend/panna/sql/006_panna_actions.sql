-- 28 Nov 2026 (GitHub #278, VI-177), S3 (backend/panna/FAILURE_MODES.md section 10, the dictionary Hugo approved):
-- Opta's detailed actions stored once in core (backend/sql/187_match_action_sets.sql) by the login vega_v2_panna,
-- through the functions below only. Here: the rare exact exceptions of an action's cell
-- (panna.action_field_exceptions), each publication's subjects with their source rows (panna.source_set_memberships),
-- two staging tables the login fills by COPY within one transaction, and the entry points:
--   panna.action_batch       the object version's core.observation_batches row and this run's activation instant;
--   panna.put_action_sets    the staged sets stored once (rows, header, exceptions), each verified by the server's
--                            own digest of what it stored before the transaction may commit (VERIFY_MISMATCH);
--   panna.place_action_sets  each subject's membership (differential) and revision (dated, A->B->A kept);
--   panna.action_set_encoding, panna.action_set_digest: the canonical encoding of a stored set, rebuilt from core and
--                            the exceptions (verify, review).
-- Functions are SECURITY DEFINER with qualified names and a fixed search_path; PUBLIC executes none of them. The login
-- reads these relations and inserts into the staging tables only; it has no INSERT, UPDATE, DELETE or TRUNCATE on
-- the stored relations. Once panna.action_field_exceptions or panna.source_set_memberships hold a row, ROLLBACK.sql
-- refuses (their rows are the only copy of their values).
SET LOCAL lock_timeout = '3s';

-- A cell the common format of core.match_actions cannot hold exactly: a double code that is not a finite integer
-- within [-2^63, 2^63) or is -0.0, a NaN coordinate (its own 8 IEEE bytes, big-endian), a label varying within its set.
CREATE TABLE panna.action_field_exceptions (
  set_id bigint NOT NULL,
  ordinal integer NOT NULL,
  source_column text NOT NULL CHECK (source_column IN ('event_id', 'type_id', 'minute', 'second', 'outcome', 'period_id',
                                                       'x', 'y', 'end_x', 'end_y', 'competition', 'season')),
  source_type text NOT NULL CHECK (source_type IN ('int64', 'double', 'string', 'large_string')),
  integer_value bigint,
  float_bits bytea CHECK (float_bits IS NULL OR octet_length(float_bits) = 8),
  text_value text,
  PRIMARY KEY (set_id, ordinal, source_column),
  FOREIGN KEY (set_id, ordinal) REFERENCES core.match_actions (set_id, ordinal) ON DELETE RESTRICT,
  CHECK (num_nonnulls(integer_value, float_bits, text_value) = 1)
);

-- The rows a half-open multirange covers.
CREATE FUNCTION panna.multirange_rows(p int8multirange)
RETURNS bigint LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT coalesce(sum(upper(r) - lower(r)), 0)::bigint FROM unnest(p) AS r
$$;

-- A subject in one publication (batch): its set and where its rows were in the object (physical row numbers,
-- half-open ranges); ordinal_map NULL when the set's ordinals follow those rows in order (always for actions).
-- Differential: a row when the subject is new in the stream, its set changed or its rows moved.
CREATE TABLE panna.source_set_memberships (
  batch_id bigint NOT NULL REFERENCES core.observation_batches(id) ON DELETE RESTRICT,
  product text NOT NULL,
  subject_key text NOT NULL,
  set_id bigint REFERENCES core.observation_sets(id) ON DELETE RESTRICT,
  source_runs int8multirange NOT NULL,
  row_count integer NOT NULL CHECK (row_count >= 0),
  ordinal_map bigint[],
  PRIMARY KEY (batch_id, product, subject_key),
  CHECK (isempty(source_runs) OR lower(source_runs) >= 0),
  CHECK (panna.multirange_rows(source_runs) = row_count),
  CHECK (set_id IS NOT NULL OR (row_count = 0 AND isempty(source_runs) AND ordinal_map IS NULL)),
  CHECK (ordinal_map IS NULL OR cardinality(ordinal_map) = row_count)
);
CREATE INDEX source_set_memberships_subject ON panna.source_set_memberships (product, subject_key);
CREATE INDEX source_set_memberships_set ON panna.source_set_memberships (set_id);

-- Staging, filled by COPY and emptied by panna.put_action_sets in the same transaction (never kept).
CREATE UNLOGGED TABLE panna.action_stage_sets (
  stage_id bigint NOT NULL,
  set_no integer NOT NULL,
  subject_key text NOT NULL,
  schema_key text NOT NULL,
  content_sha256 bytea NOT NULL,
  row_count integer NOT NULL,
  PRIMARY KEY (stage_id, set_no)
);
CREATE UNLOGGED TABLE panna.action_stage (
  stage_id bigint NOT NULL,
  set_no integer NOT NULL,
  ordinal integer NOT NULL,
  source_event_id bigint, type_code bigint, period_code bigint, minute bigint, second bigint, outcome_code bigint,
  x double precision, y double precision, end_x double precision, end_y double precision,
  source_team_key text, source_player_key text, source_player_name text, qualifiers text,
  competition text, season text,
  event_id_bits bytea, type_id_bits bytea, period_id_bits bytea, minute_bits bytea, second_bits bytea, outcome_bits bytea,
  x_bits bytea, y_bits bytea, end_x_bits bytea, end_y_bits bytea
);
CREATE INDEX action_stage_set ON panna.action_stage (stage_id, set_no, ordinal);
-- Emptied after each unit: vacuumed by the loader after each chunk (MAINTAIN below), and by autovacuum within 10,000 dead
-- rows, so that the staging stays at about one chunk (measured: without, 1,060 MB of dead rows for 3.5 M actions).
ALTER TABLE panna.action_stage SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 10000);
ALTER TABLE panna.action_stage_sets SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 1000);

-- The Arrow type a schema_key gives a column (NULL if absent).
CREATE FUNCTION panna.action_source_type(p_schema_key text, p_column text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT rtrim(split_part(f, ':', 2), '!') FROM unnest(string_to_array(substr(p_schema_key, 7), ',')) AS f
  WHERE split_part(f, ':', 1) = p_column LIMIT 1
$$;

-- The SQL expression of one stored row's canonical encoding (backend/panna/encode.py: T<octets>:<text>, I<integer>,
-- D<IEEE bits as a signed 64-bit integer>, N; each value then '|', a newline), in the schema's column order and the
-- source's types. Only the 17 known columns and types are accepted (SCHEMA_KEY), so the text is never injected.
CREATE FUNCTION panna.action_row_sql(p_schema_key text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  dest constant jsonb := '{"event_id": "source_event_id", "type_id": "type_code", "period_id": "period_code",
    "minute": "minute", "second": "second", "outcome": "outcome_code", "x": "x", "y": "y", "end_x": "end_x",
    "end_y": "end_y", "team_id": "source_team_key", "player_id": "source_player_key",
    "player_name": "source_player_name", "qualifier_json": "qualifiers"}';
  all17 constant text[] := ARRAY['match_id', 'event_id', 'type_id', 'player_id', 'player_name', 'team_id', 'minute',
    'second', 'x', 'y', 'end_x', 'end_y', 'outcome', 'period_id', 'qualifier_json', 'competition', 'season'];
  spec text;
  field text;
  kind text;
  expr text;
  seen text[] := '{}';
  parts text[] := '{}';
  bits_of constant text := '(''D'' || ((''x'' || encode(%s, ''hex''))::bit(64)::bigint)::text)';
BEGIN
  IF p_schema_key IS NULL OR left(p_schema_key, 6) <> 'arrow:' THEN
    RAISE EXCEPTION 'SCHEMA_KEY: %', p_schema_key;
  END IF;
  FOREACH spec IN ARRAY string_to_array(substr(p_schema_key, 7), ',') LOOP
    field := split_part(spec, ':', 1);
    kind := split_part(spec, ':', 2);
    IF spec <> field || ':' || kind OR field = ANY (seen) OR NOT (field = ANY (all17)) THEN
      RAISE EXCEPTION 'SCHEMA_KEY: %', spec;
    END IF;
    kind := CASE WHEN right(kind, 1) = '!' THEN left(kind, -1) ELSE kind END;
    seen := seen || field;
    expr := CASE
      WHEN kind NOT IN ('string', 'large_string', 'int64', 'double') THEN NULL
      WHEN field = 'match_id' AND kind IN ('string', 'large_string') THEN
        'coalesce(''T'' || octet_length($2)::text || '':'' || $2, ''N'')'
      WHEN field IN ('competition', 'season') AND kind IN ('string', 'large_string') THEN
        format('coalesce(''T'' || octet_length(coalesce(x.t_%1$s, $%2$s))::text || '':'' || coalesce(x.t_%1$s, $%2$s), ''N'')',
               field, CASE field WHEN 'competition' THEN 3 ELSE 4 END)
      WHEN field IN ('team_id', 'player_id', 'player_name', 'qualifier_json') AND kind IN ('string', 'large_string') THEN
        format('coalesce(''T'' || octet_length(a.%1$I)::text || '':'' || a.%1$I, ''N'')', dest->>field)
      WHEN field IN ('event_id', 'type_id', 'minute', 'second', 'outcome', 'period_id') AND kind = 'int64' THEN
        format('coalesce(''I'' || coalesce(a.%1$I, x.i_%2$s)::text, ''N'')', dest->>field, field)
      WHEN field IN ('event_id', 'type_id', 'minute', 'second', 'outcome', 'period_id') AND kind = 'double' THEN
        format('CASE WHEN a.%1$I IS NOT NULL THEN %3$s WHEN x.b_%2$s IS NOT NULL THEN %4$s ELSE ''N'' END', dest->>field,
               field, format(bits_of, format('float8send(a.%I::float8)', dest->>field)), format(bits_of, 'x.b_' || field))
      WHEN field IN ('x', 'y', 'end_x', 'end_y') AND kind = 'double' THEN
        format('CASE WHEN x.b_%2$s IS NOT NULL THEN %4$s WHEN a.%1$I IS NOT NULL THEN %3$s ELSE ''N'' END', dest->>field,
               field, format(bits_of, format('float8send(a.%I)', dest->>field)), format(bits_of, 'x.b_' || field))
    END;
    IF expr IS NULL THEN
      RAISE EXCEPTION 'SCHEMA_KEY: %', spec;
    END IF;
    parts := parts || (expr || ' || ''|''');
  END LOOP;
  IF cardinality(seen) <> 17 THEN
    RAISE EXCEPTION 'SCHEMA_KEY: % columns', cardinality(seen);
  END IF;
  RETURN array_to_string(parts, ' || ') || ' || E''\n''';
END $$;

-- Each stored row of a set and its canonical encoding, rebuilt from core and the exceptions alone.
CREATE FUNCTION panna.action_set_encoding(p_set bigint)
RETURNS TABLE (ordinal integer, encoding text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  s record;
BEGIN
  SELECT o.subject_key, o.schema_key, h.source_competition_label AS competition, h.source_season_label AS season INTO s
    FROM core.observation_sets o JOIN core.match_action_sets h ON h.set_id = o.id
   WHERE o.id = p_set AND o.product = 'match_actions';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SET_UNKNOWN: %', p_set;
  END IF;
  RETURN QUERY EXECUTE format(
    'WITH x AS (
       SELECT e.ordinal,
              (array_agg(e.float_bits) FILTER (WHERE e.source_column = ''event_id''))[1] AS b_event_id,
              (array_agg(e.float_bits) FILTER (WHERE e.source_column = ''type_id''))[1] AS b_type_id,
              (array_agg(e.float_bits) FILTER (WHERE e.source_column = ''minute''))[1] AS b_minute,
              (array_agg(e.float_bits) FILTER (WHERE e.source_column = ''second''))[1] AS b_second,
              (array_agg(e.float_bits) FILTER (WHERE e.source_column = ''outcome''))[1] AS b_outcome,
              (array_agg(e.float_bits) FILTER (WHERE e.source_column = ''period_id''))[1] AS b_period_id,
              (array_agg(e.float_bits) FILTER (WHERE e.source_column = ''x''))[1] AS b_x,
              (array_agg(e.float_bits) FILTER (WHERE e.source_column = ''y''))[1] AS b_y,
              (array_agg(e.float_bits) FILTER (WHERE e.source_column = ''end_x''))[1] AS b_end_x,
              (array_agg(e.float_bits) FILTER (WHERE e.source_column = ''end_y''))[1] AS b_end_y,
              (array_agg(e.integer_value) FILTER (WHERE e.source_column = ''event_id''))[1] AS i_event_id,
              (array_agg(e.integer_value) FILTER (WHERE e.source_column = ''type_id''))[1] AS i_type_id,
              (array_agg(e.integer_value) FILTER (WHERE e.source_column = ''minute''))[1] AS i_minute,
              (array_agg(e.integer_value) FILTER (WHERE e.source_column = ''second''))[1] AS i_second,
              (array_agg(e.integer_value) FILTER (WHERE e.source_column = ''outcome''))[1] AS i_outcome,
              (array_agg(e.integer_value) FILTER (WHERE e.source_column = ''period_id''))[1] AS i_period_id,
              (array_agg(e.text_value) FILTER (WHERE e.source_column = ''competition''))[1] AS t_competition,
              (array_agg(e.text_value) FILTER (WHERE e.source_column = ''season''))[1] AS t_season
         FROM panna.action_field_exceptions e WHERE e.set_id = $1 GROUP BY e.ordinal)
     SELECT a.ordinal, %s FROM core.match_actions a LEFT JOIN x ON x.ordinal = a.ordinal
      WHERE a.set_id = $1 ORDER BY a.ordinal', panna.action_row_sql(s.schema_key))
    USING p_set, substr(s.subject_key, 8 + length(split_part(s.subject_key, ':', 2))), s.competition, s.season;
END $$;

CREATE FUNCTION panna.action_set_digest(p_set bigint)
RETURNS bytea LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT sha256(convert_to(coalesce(string_agg(e.encoding, '' ORDER BY e.ordinal), ''), 'UTF8'))
  FROM panna.action_set_encoding(p_set) AS e
$$;

-- The object version of an events load (one row per distributor, name and SHA-256: the first activation's instant
-- is its issued_at) and this run's activation instant of it, read from the run's own plan (S1's rule, review M2).
CREATE FUNCTION panna.action_batch(p_load bigint, p_schema_key text)
RETURNS TABLE (batch_id bigint, effective_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  src record;
  entry jsonb;
  activation timestamptz;
  found_id bigint;
BEGIN
  SELECT l.run_id, s.dataset, s.container, s.name, r.asset_id, r.sha256, r.updated_at INTO src
    FROM panna.loads l JOIN panna.streams s ON s.stream_id = l.stream_id JOIN panna.receipts r ON r.receipt_id = l.receipt_id
   WHERE l.load_id = p_load;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOAD_NOT_EVENTS: %', p_load;
  END IF;
  IF src.dataset <> 'opta_events' THEN
    RAISE EXCEPTION 'LOAD_NOT_EVENTS: %', p_load;
  END IF;
  PERFORM panna.action_row_sql(p_schema_key);
  SELECT a.value INTO entry FROM panna.runs u CROSS JOIN LATERAL jsonb_array_elements(u.plan->'assets') AS a
   WHERE u.run_id = src.run_id AND a.value->>'name' = src.name AND coalesce(a.value->>'container', '') = src.container
     AND a.value->>'sha256' = encode(src.sha256, 'hex')
   LIMIT 1;
  activation := coalesce((entry->>'updated_at')::timestamptz, src.updated_at);
  IF activation > pg_catalog.now() THEN
    RAISE EXCEPTION 'FUTURE_INSTANT: %', activation;
  END IF;
  INSERT INTO core.observation_batches (distributor, object_name, member_path, content_sha256, publisher_version, issued_at,
                                        first_seen_at, source_url, schema_sha256)
  VALUES ('pannadata', src.name, NULL, src.sha256, CASE WHEN src.asset_id IS NOT NULL THEN src.container || '#' || src.asset_id END,
          activation, pg_catalog.now(), entry->>'url', sha256(convert_to(p_schema_key, 'UTF8')))
  ON CONFLICT ON CONSTRAINT observation_batches_version DO NOTHING;
  SELECT b.id INTO found_id FROM core.observation_batches b
   WHERE b.distributor = 'pannadata' AND b.object_name = src.name AND b.member_path IS NULL AND b.content_sha256 = src.sha256;
  RETURN QUERY SELECT found_id, activation;
END $$;

-- The staged sets of one stage stored once: a set whose (origin, product, subject, schema, digest) exists is that
-- set (created false, nothing written); a new one gets its header (each label kept when constant over the set,
-- NULL otherwise), its rows and its exceptions, then the server's digest of what it stored must equal the declared
-- one, else the whole transaction fails (VERIFY_MISMATCH). The stage is emptied.
CREATE FUNCTION panna.put_action_sets(p_stage bigint)
RETURNS TABLE (set_no integer, set_id bigint, created boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  bad record;
  made bigint[];
  made_no integer[];
  i integer;
  spec text;
BEGIN
  SELECT s.set_no, s.subject_key INTO bad FROM panna.action_stage_sets s
   WHERE s.stage_id = p_stage AND NOT (
     s.subject_key ~ '^match:[0-9]{1,4}:'
     AND split_part(s.subject_key, ':', 2)::integer = octet_length(substr(s.subject_key, 8 + length(split_part(s.subject_key, ':', 2))))
     AND octet_length(s.content_sha256) = 32 AND s.row_count >= 1
     AND s.row_count = (SELECT count(*) FROM panna.action_stage t WHERE t.stage_id = p_stage AND t.set_no = s.set_no)
     AND s.row_count = (SELECT max(t.ordinal) + 1 FROM panna.action_stage t WHERE t.stage_id = p_stage AND t.set_no = s.set_no))
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'STAGE_INVALID: set % (%)', bad.set_no, bad.subject_key;
  END IF;
  FOR spec IN SELECT DISTINCT s.schema_key FROM panna.action_stage_sets s WHERE s.stage_id = p_stage LOOP
    PERFORM panna.action_row_sql(spec);
  END LOOP;
  -- A set already stored under the same digest must have the same count.
  SELECT s.set_no, s.subject_key INTO bad FROM panna.action_stage_sets s JOIN core.observation_sets o
      ON o.origin = 'opta' AND o.product = 'match_actions' AND o.subject_key = s.subject_key AND o.schema_key = s.schema_key
     AND o.content_sha256 = s.content_sha256
   WHERE s.stage_id = p_stage AND o.row_count <> s.row_count LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'SET_DIFFERS: set % (%)', bad.set_no, bad.subject_key;
  END IF;
  WITH ins AS (
    INSERT INTO core.observation_sets AS o (origin, product, subject_key, schema_key, content_sha256, row_count, first_seen_at)
    SELECT 'opta', 'match_actions', s.subject_key, s.schema_key, s.content_sha256, s.row_count, pg_catalog.now()
      FROM panna.action_stage_sets s WHERE s.stage_id = p_stage ORDER BY s.set_no
    ON CONFLICT ON CONSTRAINT observation_sets_content DO NOTHING
    RETURNING o.id, o.subject_key, o.schema_key, o.content_sha256)
  SELECT array_agg(s.set_no ORDER BY s.set_no), array_agg(ins.id ORDER BY s.set_no) INTO made_no, made
    FROM ins JOIN panna.action_stage_sets s ON s.stage_id = p_stage AND s.subject_key = ins.subject_key
     AND s.schema_key = ins.schema_key AND s.content_sha256 = ins.content_sha256;
  made := coalesce(made, '{}');
  made_no := coalesce(made_no, '{}');
  INSERT INTO core.match_action_sets (set_id, source_competition_label, source_season_label)
  SELECT m.id, CASE WHEN l.c_const THEN l.c_value END, CASE WHEN l.s_const THEN l.s_value END
    FROM unnest(made_no, made) AS m (sno, id)
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE t.competition IS NULL) IN (0, count(*)) AND count(DISTINCT t.competition) <= 1 AS c_const,
             min(t.competition) AS c_value,
             count(*) FILTER (WHERE t.season IS NULL) IN (0, count(*)) AND count(DISTINCT t.season) <= 1 AS s_const,
             min(t.season) AS s_value
        FROM panna.action_stage t WHERE t.stage_id = p_stage AND t.set_no = m.sno) AS l;
  INSERT INTO core.match_actions (set_id, ordinal, source_event_id, type_code, period_code, minute, second, outcome_code,
                                  x, y, end_x, end_y, source_team_key, source_player_key, source_player_name, qualifiers)
  SELECT m.id, t.ordinal, t.source_event_id, t.type_code, t.period_code, t.minute, t.second, t.outcome_code,
         t.x, t.y, t.end_x, t.end_y, t.source_team_key, t.source_player_key, t.source_player_name, t.qualifiers
    FROM unnest(made_no, made) AS m (sno, id)
    JOIN panna.action_stage t ON t.stage_id = p_stage AND t.set_no = m.sno
   ORDER BY m.id, t.ordinal;
  INSERT INTO panna.action_field_exceptions (set_id, ordinal, source_column, source_type, float_bits)
  SELECT m.id, t.ordinal, v.col, panna.action_source_type(s.schema_key, v.col), v.b
    FROM unnest(made_no, made) AS m (sno, id)
    JOIN panna.action_stage_sets s ON s.stage_id = p_stage AND s.set_no = m.sno
    JOIN panna.action_stage t ON t.stage_id = p_stage AND t.set_no = m.sno
    CROSS JOIN LATERAL (VALUES ('event_id', t.event_id_bits), ('type_id', t.type_id_bits), ('minute', t.minute_bits),
                               ('second', t.second_bits), ('outcome', t.outcome_bits), ('period_id', t.period_id_bits),
                               ('x', t.x_bits), ('y', t.y_bits), ('end_x', t.end_x_bits), ('end_y', t.end_y_bits)) AS v (col, b)
   WHERE v.b IS NOT NULL;
  INSERT INTO panna.action_field_exceptions (set_id, ordinal, source_column, source_type, text_value)
  SELECT m.id, t.ordinal, v.col, panna.action_source_type(s.schema_key, v.col), v.val
    FROM unnest(made_no, made) AS m (sno, id)
    JOIN core.match_action_sets h ON h.set_id = m.id
    JOIN panna.action_stage_sets s ON s.stage_id = p_stage AND s.set_no = m.sno
    JOIN panna.action_stage t ON t.stage_id = p_stage AND t.set_no = m.sno
    CROSS JOIN LATERAL (VALUES ('competition', t.competition, h.source_competition_label),
                               ('season', t.season, h.source_season_label)) AS v (col, val, header)
   WHERE v.val IS NOT NULL AND v.header IS NULL;
  FOR i IN 1 .. coalesce(array_length(made, 1), 0) LOOP
    SELECT s.set_no, s.subject_key, s.content_sha256 INTO bad FROM panna.action_stage_sets s
     WHERE s.stage_id = p_stage AND s.set_no = made_no[i];
    IF panna.action_set_digest(made[i]) IS DISTINCT FROM bad.content_sha256 THEN
      RAISE EXCEPTION 'VERIFY_MISMATCH: set % (%)', made[i], bad.subject_key;
    END IF;
  END LOOP;
  RETURN QUERY
  SELECT s.set_no, o.id, o.id = ANY (made)
    FROM panna.action_stage_sets s JOIN core.observation_sets o
      ON o.origin = 'opta' AND o.product = 'match_actions' AND o.subject_key = s.subject_key AND o.schema_key = s.schema_key
     AND o.content_sha256 = s.content_sha256
   WHERE s.stage_id = p_stage ORDER BY s.set_no;
  DELETE FROM panna.action_stage t WHERE t.stage_id = p_stage;
  DELETE FROM panna.action_stage_sets s WHERE s.stage_id = p_stage;
END $$;

-- Each subject of an events load placed in its batch: its membership when it is new in the stream, its set changed
-- or its rows moved (else nothing), and its revision: first, revised (a later activation of another set), unchanged
-- (the current set), historical (an earlier activation of another set: kept, not current) or conflict (the same or
-- an unknown instant from another object: nothing written in the revisions). One subject at a time, under its lock.
CREATE FUNCTION panna.place_action_sets(p_load bigint, p_batch bigint, p_effective timestamptz, p_subjects text[],
                                        p_sets bigint[], p_runs text[], p_rows integer[])
RETURNS TABLE (subject_key text, membership boolean, revision text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_variable
DECLARE
  src record;
  b record;
  i integer;
  runs int8multirange;
  cur record;
  mine record;
  prev record;
  status text;
  wrote boolean;
  next_no integer;
BEGIN
  IF p_subjects IS NULL OR cardinality(p_subjects) <> cardinality(p_sets) OR cardinality(p_subjects) <> cardinality(p_runs)
     OR cardinality(p_subjects) <> cardinality(p_rows) THEN
    RAISE EXCEPTION 'PLACE_ARGUMENTS';
  END IF;
  SELECT s.name, r.sha256 INTO src
    FROM panna.loads l JOIN panna.streams s ON s.stream_id = l.stream_id JOIN panna.receipts r ON r.receipt_id = l.receipt_id
   WHERE l.load_id = p_load AND s.dataset = 'opta_events';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_LOAD_MISMATCH: load % batch %', p_load, p_batch;
  END IF;
  SELECT o.* INTO b FROM core.observation_batches o WHERE o.id = p_batch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_LOAD_MISMATCH: load % batch %', p_load, p_batch;
  END IF;
  IF b.distributor <> 'pannadata' OR b.object_name <> src.name OR b.content_sha256 <> src.sha256
     OR b.member_path IS NOT NULL THEN
    RAISE EXCEPTION 'BATCH_LOAD_MISMATCH: load % batch %', p_load, p_batch;
  END IF;
  IF p_effective > pg_catalog.now() THEN
    RAISE EXCEPTION 'FUTURE_INSTANT: %', p_effective;
  END IF;
  FOR i IN 1 .. cardinality(p_subjects) LOOP
    runs := p_runs[i]::int8multirange;
    PERFORM 1 FROM core.observation_sets o
     WHERE o.id = p_sets[i] AND o.origin = 'opta' AND o.product = 'match_actions' AND o.subject_key = p_subjects[i]
       AND o.row_count = p_rows[i];
    IF NOT FOUND OR panna.multirange_rows(runs) <> p_rows[i] THEN
      RAISE EXCEPTION 'SET_SUBJECT_MISMATCH: %', p_subjects[i];
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('panna-subject:match_actions:' || p_subjects[i], 0));
    wrote := false;
    SELECT m.set_id, m.source_runs, m.row_count INTO mine FROM panna.source_set_memberships m
     WHERE m.batch_id = p_batch AND m.product = 'match_actions' AND m.subject_key = p_subjects[i];
    IF FOUND THEN
      IF mine.set_id IS DISTINCT FROM p_sets[i] OR mine.source_runs <> runs OR mine.row_count <> p_rows[i] THEN
        RAISE EXCEPTION 'MEMBERSHIP_DIFFERS: batch % subject %', p_batch, p_subjects[i];
      END IF;
    ELSE
      SELECT m.set_id, m.source_runs INTO prev FROM panna.source_set_memberships m
        JOIN core.observation_batches pb ON pb.id = m.batch_id
       WHERE m.product = 'match_actions' AND m.subject_key = p_subjects[i] AND pb.distributor = b.distributor
         AND pb.object_name = b.object_name
       ORDER BY pb.issued_at DESC NULLS LAST, pb.id DESC LIMIT 1;
      IF NOT FOUND THEN
        wrote := true;
      ELSIF prev.set_id IS DISTINCT FROM p_sets[i] OR prev.source_runs <> runs THEN
        wrote := true;
      END IF;
      IF wrote THEN
        INSERT INTO panna.source_set_memberships (batch_id, product, subject_key, set_id, source_runs, row_count, ordinal_map)
        VALUES (p_batch, 'match_actions', p_subjects[i], p_sets[i], runs, p_rows[i], NULL);
      END IF;
    END IF;
    SELECT coalesce(max(r.revision_no), 0) + 1 INTO next_no FROM core.observation_set_revisions r
     WHERE r.origin = 'opta' AND r.product = 'match_actions' AND r.subject_key = p_subjects[i];
    SELECT r.id, r.set_id, r.effective_at, r.batch_id INTO cur FROM core.observation_set_revisions r
     WHERE r.origin = 'opta' AND r.product = 'match_actions' AND r.subject_key = p_subjects[i] AND r.is_current;
    IF NOT FOUND THEN
      INSERT INTO core.observation_set_revisions (origin, product, subject_key, revision_no, set_id, batch_id, effective_at,
                                                  observed_at, is_current)
      VALUES ('opta', 'match_actions', p_subjects[i], next_no, p_sets[i], p_batch, p_effective, pg_catalog.now(), true);
      status := 'first';
    ELSIF cur.set_id = p_sets[i] THEN
      status := 'unchanged';
    ELSIF p_effective IS NOT NULL AND cur.effective_at IS NOT NULL AND p_effective > cur.effective_at THEN
      UPDATE core.observation_set_revisions SET is_current = false WHERE id = cur.id;
      INSERT INTO core.observation_set_revisions (origin, product, subject_key, revision_no, set_id, batch_id, effective_at,
                                                  observed_at, is_current)
      VALUES ('opta', 'match_actions', p_subjects[i], next_no, p_sets[i], p_batch, p_effective, pg_catalog.now(), true);
      status := 'revised';
    ELSIF p_effective IS NOT NULL AND cur.effective_at IS NOT NULL AND p_effective < cur.effective_at THEN
      IF EXISTS (SELECT 1 FROM core.observation_set_revisions r
                  WHERE r.origin = 'opta' AND r.product = 'match_actions' AND r.subject_key = p_subjects[i]
                    AND r.set_id = p_sets[i] AND r.batch_id = p_batch AND r.effective_at = p_effective) THEN
        status := 'unchanged';
      ELSE
        INSERT INTO core.observation_set_revisions (origin, product, subject_key, revision_no, set_id, batch_id, effective_at,
                                                    observed_at, is_current)
        VALUES ('opta', 'match_actions', p_subjects[i], next_no, p_sets[i], p_batch, p_effective, pg_catalog.now(), false);
        status := 'historical';
      END IF;
    ELSE
      status := 'conflict';
    END IF;
    subject_key := p_subjects[i];
    membership := wrote;
    revision := status;
    RETURN NEXT;
  END LOOP;
END $$;

-- The events objects' batches, for the login (it reads no core.observation_batches itself, GH278-ai).
CREATE VIEW panna.action_batches AS
SELECT b.id, b.object_name, b.content_sha256, b.publisher_version, b.issued_at, b.first_seen_at, b.source_url, b.schema_sha256
FROM core.observation_batches b
WHERE b.distributor = 'pannadata' AND b.member_path IS NULL AND b.object_name ~ '^events_[A-Za-z0-9_]+\.parquet$';

REVOKE ALL ON FUNCTION panna.action_source_type(text, text), panna.action_row_sql(text),
  panna.action_set_encoding(bigint), panna.action_set_digest(bigint), panna.action_batch(bigint, text),
  panna.put_action_sets(bigint),
  panna.place_action_sets(bigint, bigint, timestamptz, text[], bigint[], text[], integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION panna.action_set_encoding(bigint), panna.action_set_digest(bigint),
  panna.action_batch(bigint, text), panna.put_action_sets(bigint),
  panna.place_action_sets(bigint, bigint, timestamptz, text[], bigint[], text[], integer[]) TO vega_panna;
GRANT SELECT ON panna.action_field_exceptions, panna.source_set_memberships TO vega_panna;
GRANT SELECT, INSERT, MAINTAIN ON panna.action_stage, panna.action_stage_sets TO vega_panna;
GRANT SELECT ON panna.action_batches TO vega_panna;
GRANT SELECT ON core.observation_sets, core.observation_set_revisions, core.match_action_sets,
  core.match_actions, core.match_action_qualifiers, core.current_match_action_sets TO vega_panna;
