-- 28 Nov 2026 (GitHub #278, VI-177), S1 of PannaData in Vega's model (backend/panna/FAILURE_MODES.md section 8, the
-- dictionary Hugo approved): the receipts of an application of a stored segment to a business relation, and the
-- versioned identity decisions on a source key. After 001-003; it adds and changes nothing of H1's tables or rows.
--
-- The loader's login (group vega_panna) reads these two tables and writes them only through the two functions below
-- (SECURITY DEFINER, qualified names, fixed search_path), which call core's score functions
-- (backend/sql/186_match_score_observations.sql) as their owner. On core it gets the schema's usage and the read
-- core.score_pair_verdict, nothing of its tables, and never core's two writing functions themselves: no lexeme, key,
-- match, batch or instant of its own reaches them (FAILURE_MODES.md GH278-ai, Fable's review M1).
SET LOCAL lock_timeout = '3s';

CREATE TABLE panna.canonical_applications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  segment_id integer NOT NULL REFERENCES panna.segments(segment_id),
  batch_id bigint NOT NULL REFERENCES core.observation_batches(id),
  rule_version text NOT NULL,
  target_relation text NOT NULL,
  target_match_id integer,
  status text NOT NULL
    CHECK (status IN ('published', 'unchanged', 'observed', 'pending_identity', 'quarantined', 'conflict', 'superseded', 'reverted')),
  reason_code text,
  source_rows bigint NOT NULL CHECK (source_rows >= 0),
  target_rows bigint NOT NULL CHECK (target_rows >= 0),
  as_of date NOT NULL,
  applied_at timestamptz NOT NULL,
  published_at timestamptz,
  UNIQUE (segment_id, rule_version, target_relation)
);

CREATE TABLE panna.identity_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_kind core.entity_type NOT NULL,
  origin core.provider NOT NULL,
  source_key text NOT NULL,
  candidate_ids integer[] NOT NULL,
  decision text NOT NULL CHECK (decision IN ('linked', 'ambiguous', 'no_candidate', 'rejected')),
  chosen_id integer,
  evidence_code text NOT NULL,
  evidence jsonb NOT NULL,
  evidence_sha256 bytea NOT NULL CHECK (octet_length(evidence_sha256) = 32),
  reviewer text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  is_current boolean NOT NULL,
  CHECK ((decision = 'linked') = (chosen_id IS NOT NULL)),
  CHECK (chosen_id IS NULL OR chosen_id = ANY (candidate_ids))
);
CREATE UNIQUE INDEX identity_reviews_current ON panna.identity_reviews (entity_kind, origin, source_key) WHERE is_current;

-- An application of the half-time pair of `p_key`, as the fixtures load `p_load` holds it, to the Vega match
-- `p_match_id` (S1: opta_fixtures only). Reads the stored segment, never values from the caller; one receipt per
-- (segment, rule, relation), updated in place; a review row only when the decision or its evidence changes.
CREATE FUNCTION panna.apply_score_segment(p_load bigint, p_key text, p_match_id integer, p_expected jsonb,
                                          p_rule_version text, p_reviewer text, p_source_url text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  target constant text := 'core.matches(home_score_ht,away_score_ht)';
  source record;
  segment integer;
  rows_n integer;
  ht_home text[];
  ht_away text[];
  ft_home text[];
  ft_away text[];
  day text;
  home_name text;
  away_name text;
  activation timestamptz;
  verdict jsonb;
  identity jsonb;
  current_review record;
  evidence_sha bytea;
  status text;
  previous record;
  application bigint;
BEGIN
  IF p_load IS NULL OR p_key IS NULL OR p_match_id IS NULL OR p_rule_version IS NULL OR p_reviewer IS NULL
     OR char_length(p_reviewer) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value', MESSAGE = 'panna.apply_score_segment: invalid arguments';
  END IF;
  SELECT l.load_id, l.run_id, l.as_of, l.status, s.dataset, s.origin, s.container, s.name, r.asset_id, r.sha256,
         r.updated_at, r.received_at, r.schema
    INTO source
    FROM panna.loads l JOIN panna.streams s ON s.stream_id = l.stream_id JOIN panna.receipts r ON r.receipt_id = l.receipt_id
   WHERE l.load_id = p_load;
  IF source.load_id IS NULL OR source.dataset <> 'opta_fixtures' OR source.status <> 'complete' THEN
    RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value',
      MESSAGE = 'panna.apply_score_segment: the load is not a complete opta_fixtures load';
  END IF;
  SELECT a.segment_id INTO segment FROM panna.segments_as_of(p_load) a WHERE a.key = p_key;
  IF segment IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value', MESSAGE = 'panna.apply_score_segment: the key has no segment in that load';
  END IF;
  SELECT count(*), array_agg(d.home_score_ht ORDER BY d.ordinal), array_agg(d.away_score_ht ORDER BY d.ordinal),
         array_agg(d.home_score ORDER BY d.ordinal), array_agg(d.away_score ORDER BY d.ordinal),
         (array_agg(d.match_date ORDER BY d.ordinal))[1], (array_agg(d.home_team ORDER BY d.ordinal))[1],
         (array_agg(d.away_team ORDER BY d.ordinal))[1]
    INTO rows_n, ht_home, ht_away, ft_home, ft_away, day, home_name, away_name
    FROM panna_data.opta_fixtures d WHERE d.segment_id = segment;
  -- This activation's issue instant, as its own run's plan read it (Fable's review, M2): the receipt and the batch keep
  -- the first one of these bytes, which a later re-publication of the same object must not inherit.
  SELECT (a.value->>'updated_at')::timestamptz INTO activation
    FROM panna.runs u CROSS JOIN LATERAL jsonb_array_elements(u.plan->'assets') a
   WHERE u.run_id = source.run_id AND a.value->>'name' = source.name AND coalesce(a.value->>'container', '') = source.container
     AND a.value->>'sha256' = encode(source.sha256, 'hex')
   LIMIT 1;
  verdict := core.publish_score_pair(
    'opta', p_key, 'opta_fixtures', ht_home, ht_away, ft_home, ft_away,
    CASE WHEN day ~ '^\d{4}-\d{2}-\d{2}' THEN substr(day, 1, 10)::date END, home_name, away_name,
    'pannadata', source.name, NULL, source.sha256,
    CASE WHEN source.asset_id IS NOT NULL THEN source.container || '#' || source.asset_id END,
    activation, source.received_at, p_source_url, sha256(convert_to(source.schema::text, 'UTF8')),
    p_match_id, p_expected, p_rule_version, source.as_of);
  identity := verdict->'identity';
  IF identity IS NOT NULL THEN
    evidence_sha := sha256(convert_to((identity->'evidence')::text, 'UTF8'));
    SELECT r.* INTO current_review FROM panna.identity_reviews r
     WHERE r.entity_kind = 'match' AND r.origin = 'opta' AND r.source_key = p_key AND r.is_current FOR UPDATE;
    IF current_review.id IS NULL OR current_review.decision <> identity->>'decision'
       OR current_review.evidence_code <> identity->>'evidence_code' OR current_review.evidence_sha256 <> evidence_sha
       OR current_review.chosen_id IS DISTINCT FROM (identity->>'chosen_id')::integer THEN
      UPDATE panna.identity_reviews SET is_current = false WHERE id = current_review.id;
      INSERT INTO panna.identity_reviews (entity_kind, origin, source_key, candidate_ids, decision, chosen_id, evidence_code,
                                          evidence, evidence_sha256, reviewer, reviewed_at, is_current)
      VALUES ('match', 'opta', p_key, ARRAY(SELECT jsonb_array_elements_text(identity->'candidate_ids')::integer),
              identity->>'decision', (identity->>'chosen_id')::integer, identity->>'evidence_code', identity->'evidence',
              evidence_sha, p_reviewer, pg_catalog.now(), true);
    END IF;
  END IF;
  SELECT a.* INTO previous FROM panna.canonical_applications a
   WHERE a.segment_id = segment AND a.rule_version = p_rule_version AND a.target_relation = target FOR UPDATE;
  status := verdict->>'status';
  IF status = 'published' AND NOT (verdict->>'changed')::boolean
     AND coalesce(previous.status, '') NOT IN ('published') THEN
    -- The cells already held the pair: provenance only, no business change.
    status := 'unchanged';
  END IF;
  INSERT INTO panna.canonical_applications (segment_id, batch_id, rule_version, target_relation, target_match_id, status, reason_code,
                                            source_rows, target_rows, as_of, applied_at, published_at)
  VALUES (segment, (verdict->>'batch_id')::bigint, p_rule_version, target, p_match_id, status, verdict->>'reason', rows_n,
          (verdict->>'target_rows')::bigint, source.as_of, pg_catalog.now(),
          CASE WHEN status = 'published' AND (verdict->>'changed')::boolean THEN pg_catalog.now() END)
  ON CONFLICT (segment_id, rule_version, target_relation) DO UPDATE
    SET batch_id = excluded.batch_id, target_match_id = excluded.target_match_id, status = excluded.status,
        reason_code = excluded.reason_code, source_rows = excluded.source_rows,
        target_rows = CASE WHEN excluded.status IN ('published', 'unchanged') AND panna.canonical_applications.status = excluded.status
                           THEN panna.canonical_applications.target_rows ELSE excluded.target_rows END,
        as_of = excluded.as_of, applied_at = excluded.applied_at,
        published_at = CASE WHEN excluded.published_at IS NOT NULL THEN excluded.published_at
                            WHEN excluded.status = 'published' THEN panna.canonical_applications.published_at END
  RETURNING id INTO application;
  IF status IN ('published', 'unchanged') THEN
    -- One application governs the key's pair: the others of the key that did are superseded.
    UPDATE panna.canonical_applications a SET status = 'superseded', reason_code = 'LATER_GENERATION', applied_at = pg_catalog.now()
      FROM panna.segments s
     WHERE s.segment_id = a.segment_id AND s.dataset = 'opta_fixtures' AND s.key = p_key AND a.id <> application
       AND a.rule_version = p_rule_version AND a.target_relation = target AND a.status IN ('published', 'unchanged');
  END IF;
  RETURN verdict || jsonb_build_object('application', application, 'status', status, 'segment_id', segment, 'source_rows', rows_n,
                                       'target_match_id', p_match_id);
END $$;

-- The targeted revert of an application (FAILURE_MODES.md section 8, Revert): core re-arbitrates only while this
-- application governs the pair; any other state is only marked reverted.
CREATE FUNCTION panna.revert_score_application(p_application bigint, p_reviewer text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  application record;
  result jsonb := jsonb_build_object('restored', NULL, 'changed', false);
BEGIN
  IF p_application IS NULL OR p_reviewer IS NULL OR char_length(p_reviewer) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value', MESSAGE = 'panna.revert_score_application: invalid arguments';
  END IF;
  SELECT a.*, s.key INTO application FROM panna.canonical_applications a JOIN panna.segments s ON s.segment_id = a.segment_id
   WHERE a.id = p_application FOR UPDATE OF a;
  IF application.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value', MESSAGE = 'panna.revert_score_application: no such application';
  END IF;
  IF application.status IN ('published', 'unchanged') AND application.target_match_id IS NOT NULL THEN
    result := core.revert_score_selection(application.target_match_id, 'half_time', 'opta', application.key, application.rule_version);
  END IF;
  UPDATE panna.canonical_applications SET status = 'reverted', reason_code = 'REVERTED_ON_REQUEST', applied_at = pg_catalog.now()
   WHERE id = p_application;
  RETURN result || jsonb_build_object('application', p_application, 'status', 'reverted', 'previous_status', application.status,
                                      'target_match_id', application.target_match_id, 'reviewer', p_reviewer);
END $$;

GRANT SELECT ON panna.canonical_applications, panna.identity_reviews TO vega_panna;
REVOKE ALL ON FUNCTION panna.apply_score_segment(bigint, text, integer, jsonb, text, text, text),
  panna.revert_score_application(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION panna.apply_score_segment(bigint, text, integer, jsonb, text, text, text),
  panna.revert_score_application(bigint, text) TO vega_panna;
GRANT USAGE ON SCHEMA core TO vega_panna;
GRANT EXECUTE ON FUNCTION core.score_pair_verdict(core.provider, text, text, text, text, text, date, text, text, integer, jsonb)
  TO vega_panna;
