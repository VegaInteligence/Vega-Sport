-- vega:online
-- 28 Nov 2026 (GitHub #278, VI-177), S1 of PannaData in Vega's model (backend/panna/FAILURE_MODES.md section 8, the
-- dictionary Hugo approved): the half-time pair of an existing match, published from a source's observation.
--
-- A score is a pair. Each producer's pair of a phase is an observation (both published cells kept as text, and as
-- goals when `^[0-9]{1,3}$`), numbered per producer, key and phase; a batch is the published object version that
-- carried it. A valid Opta observation governs the existing cells of its match (core.matches.home_score_ht and
-- away_score_ht) through one selection per (match, phase); the cells it replaces are first captured as an observation
-- of origin other under the Vega key. No column of core.matches changes; nothing here references panna.
--
-- Online: new tables and functions only. The functions are SECURITY DEFINER with qualified names and a fixed
-- search_path; PUBLIC executes none of them, and the panna migration (backend/panna/sql/004_panna_canonical.sql)
-- grants the loader's group the read, core.score_pair_verdict, alone (its two writing entry points are reached through
-- panna's). vega_collect keeps the default SELECT of core's tables and loses the default INSERT, UPDATE and DELETE on
-- these three (TRUNCATE revoked too): only the functions write them.
-- The one lock on an existing table is the key of core.match_score_selections on core.matches (SHARE ROW EXCLUSIVE,
-- which the collector's writes wait for; reads go on). It is the file's last step, asked without queueing (NOWAIT,
-- again every 50 ms, for at most 60 s) and held until the file commits; a base written without a pause for 60 s
-- refuses 186, nothing of it stays, and the migrate task can run again (FAILURE_MODES.md section 8, review m4).
SET LOCAL lock_timeout = '3s';

CREATE TABLE core.observation_batches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  distributor text NOT NULL,
  object_name text NOT NULL,
  member_path text,
  content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  publisher_version text,
  issued_at timestamptz,
  first_seen_at timestamptz NOT NULL,
  source_url text,
  schema_sha256 bytea CHECK (schema_sha256 IS NULL OR octet_length(schema_sha256) = 32),
  CONSTRAINT observation_batches_version UNIQUE NULLS NOT DISTINCT (distributor, object_name, member_path, content_sha256)
);

CREATE TABLE core.match_score_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origin core.provider NOT NULL,
  source_match_key text NOT NULL,
  score_phase text NOT NULL
    CHECK (score_phase IN ('half_time', 'regulation_90', 'after_extra_time', 'shootout', 'final_reported')),
  revision_no integer NOT NULL CHECK (revision_no >= 1),
  home_goals smallint CHECK (home_goals >= 0),
  away_goals smallint CHECK (away_goals >= 0),
  home_lexeme text,
  away_lexeme text,
  source_dataset text NOT NULL,
  batch_id bigint REFERENCES core.observation_batches(id) ON DELETE RESTRICT,
  effective_at timestamptz,
  seen_at timestamptz NOT NULL,
  UNIQUE (origin, source_match_key, score_phase, revision_no),
  CHECK ((batch_id IS NULL) = (source_dataset = 'core.matches')),
  CHECK (batch_id IS NULL OR effective_at IS NOT NULL)
);
CREATE INDEX match_score_observations_batch ON core.match_score_observations (batch_id);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON core.observation_batches, core.match_score_observations FROM vega_collect;
REVOKE ALL ON SEQUENCE core.observation_batches_id_seq, core.match_score_observations_id_seq FROM vega_collect;

-- A team name as the identity proof compares it: case folded, accents removed, words of letters and digits; with
-- p_affix, without the affix words of club names (FC, AS, ...) unless nothing else is left. NULL for no name.
CREATE FUNCTION core.score_team_name(p_name text, p_affix boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH w AS (
    SELECT t.m[1] AS word, t.o
    FROM regexp_matches(regexp_replace(normalize(lower(p_name), NFKD), '[̀-ͯ]', '', 'g'), '[a-z0-9]+', 'g')
         WITH ORDINALITY AS t(m, o)
  ), kept AS (
    SELECT word, o FROM w WHERE NOT p_affix OR word NOT IN ('fc', 'afc', 'cf', 'as', 'sc', 'fk', 'ac', 'ssc')
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM kept) THEN (SELECT string_agg(word, ' ' ORDER BY o) FROM kept)
              ELSE (SELECT string_agg(word, ' ' ORDER BY o) FROM w) END
  WHERE p_name IS NOT NULL
$$;

-- An observation of one pair, once. A source's: the one this batch gave at this instant (a replay), else a new
-- revision, even with the same pair, so that the latest activation ranks first (review, M2). A capture (origin other,
-- no batch, no instant): the latest one when it holds the same two cells, else a new revision.
CREATE FUNCTION core.score_observe(p_origin core.provider, p_key text, p_phase text, p_home text, p_away text,
                                   p_dataset text, p_batch bigint, p_effective timestamptz)
RETURNS bigint LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  found_id bigint;
  latest core.match_score_observations%ROWTYPE;
BEGIN
  IF p_batch IS NOT NULL THEN
    SELECT o.id INTO found_id FROM core.match_score_observations o
     WHERE o.origin = p_origin AND o.source_match_key = p_key AND o.score_phase = p_phase AND o.batch_id = p_batch
       AND o.effective_at IS NOT DISTINCT FROM p_effective
     ORDER BY o.revision_no DESC LIMIT 1;
    IF found_id IS NOT NULL THEN
      RETURN found_id;
    END IF;
  ELSE
    SELECT o.* INTO latest FROM core.match_score_observations o
     WHERE o.origin = p_origin AND o.source_match_key = p_key AND o.score_phase = p_phase
     ORDER BY o.revision_no DESC LIMIT 1;
    IF latest.id IS NOT NULL AND latest.home_lexeme IS NOT DISTINCT FROM p_home AND latest.away_lexeme IS NOT DISTINCT FROM p_away THEN
      RETURN latest.id;
    END IF;
  END IF;
  INSERT INTO core.match_score_observations (origin, source_match_key, score_phase, revision_no, home_goals, away_goals,
                                             home_lexeme, away_lexeme, source_dataset, batch_id, effective_at, seen_at)
  SELECT p_origin, p_key, p_phase, coalesce(max(o.revision_no), 0) + 1,
         CASE WHEN p_home ~ '^[0-9]{1,3}$' THEN p_home::smallint END, CASE WHEN p_away ~ '^[0-9]{1,3}$' THEN p_away::smallint END,
         p_home, p_away, p_dataset, p_batch, p_effective, pg_catalog.now()
    FROM core.match_score_observations o
   WHERE o.origin = p_origin AND o.source_match_key = p_key AND o.score_phase = p_phase
  RETURNING id INTO found_id;
  RETURN found_id;
END $$;

-- Whether the source's key names the anchor (FAILURE_MODES.md section 8, Identity): never by the arbitrated pair.
CREATE FUNCTION core.score_identity(p_origin core.provider, p_key text, p_match_id integer, p_day date, p_home_name text,
                                    p_away_name text, p_final_home smallint, p_final_away smallint)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  linked integer;
  parent record;
  home record;
  away record;
  owners text[];
  names text;
  pairs integer[];
  evidence jsonb := jsonb_build_object('rule', 'score-identity-s1', 'anchor', p_match_id, 'source_day', p_day,
                                       'source_teams', jsonb_build_array(p_home_name, p_away_name),
                                       'source_final', jsonb_build_array(p_final_home, p_final_away));
BEGIN
  SELECT k.entity_id INTO linked FROM core.provider_ids k
   WHERE k.entity_type = 'match' AND k.provider = p_origin AND k.provider_key = p_key;
  IF linked IS NOT NULL AND linked <> p_match_id THEN
    RETURN jsonb_build_object('decision', 'rejected', 'candidate_ids', jsonb_build_array(LEAST(linked, p_match_id), GREATEST(linked, p_match_id)),
                              'chosen_id', NULL, 'evidence_code', 'KEY_LINKED_ELSEWHERE',
                              'evidence', evidence || jsonb_build_object('linked_to', linked));
  END IF;
  SELECT m.id, m.match_date, m.source::text AS source, m.status::text AS status, m.home_team_id, m.away_team_id,
         m.home_score, m.away_score INTO parent FROM core.matches m WHERE m.id = p_match_id;
  IF parent.id IS NULL THEN
    RETURN jsonb_build_object('decision', 'no_candidate', 'candidate_ids', '[]'::jsonb, 'chosen_id', NULL,
                              'evidence_code', 'NO_CANDIDATE', 'evidence', evidence);
  END IF;
  evidence := evidence || jsonb_build_object('parent_day', parent.match_date, 'parent_source', parent.source,
                                             'parent_status', parent.status,
                                             'parent_final', jsonb_build_array(parent.home_score, parent.away_score));
  SELECT array_agg(DISTINCT k.provider::text ORDER BY k.provider::text) INTO owners FROM core.provider_ids k
   WHERE k.entity_type = 'match' AND k.entity_id = p_match_id
     AND k.provider::text IN ('open_matchday', 'openfootball', 'openligadb', 'international_results');
  IF parent.source IN ('open_matchday', 'openfootball', 'openligadb', 'international_results') OR owners IS NOT NULL THEN
    RETURN jsonb_build_object('decision', 'rejected', 'candidate_ids', jsonb_build_array(p_match_id), 'chosen_id', NULL,
                              'evidence_code', 'PARENT_OWNED_BY_SNAPSHOT',
                              'evidence', evidence || jsonb_build_object('snapshot_keys', coalesce(to_jsonb(owners), '[]'::jsonb)));
  END IF;
  IF parent.source <> 'pitchapi' THEN
    RETURN jsonb_build_object('decision', 'rejected', 'candidate_ids', jsonb_build_array(p_match_id), 'chosen_id', NULL,
                              'evidence_code', 'PARENT_NOT_PITCH', 'evidence', evidence);
  END IF;
  IF EXISTS (SELECT 1 FROM core.provider_ids k WHERE k.entity_type = 'match' AND k.entity_id = p_match_id
                AND k.provider = p_origin AND k.is_current AND k.provider_key <> p_key) THEN
    RETURN jsonb_build_object('decision', 'rejected', 'candidate_ids', jsonb_build_array(p_match_id), 'chosen_id', NULL,
                              'evidence_code', 'MATCH_HAS_OTHER_KEY', 'evidence', evidence);
  END IF;
  IF p_day IS DISTINCT FROM parent.match_date THEN
    RETURN jsonb_build_object('decision', 'rejected', 'candidate_ids', jsonb_build_array(p_match_id), 'chosen_id', NULL,
                              'evidence_code', 'DATE_DIFFERS', 'evidence', evidence);
  END IF;
  SELECT t.name, t.short_name, t.merged_into INTO home FROM core.teams t WHERE t.id = parent.home_team_id;
  SELECT t.name, t.short_name, t.merged_into INTO away FROM core.teams t WHERE t.id = parent.away_team_id;
  evidence := evidence || jsonb_build_object('vega_teams', jsonb_build_array(
                jsonb_build_array(home.name, home.short_name), jsonb_build_array(away.name, away.short_name)));
  IF home.merged_into IS NOT NULL OR away.merged_into IS NOT NULL THEN
    RETURN jsonb_build_object('decision', 'rejected', 'candidate_ids', jsonb_build_array(p_match_id), 'chosen_id', NULL,
                              'evidence_code', 'TEAM_MERGED', 'evidence', evidence);
  END IF;
  names := CASE
    WHEN core.score_team_name(p_home_name, false) IN (core.score_team_name(home.name, false), core.score_team_name(home.short_name, false))
     AND core.score_team_name(p_away_name, false) IN (core.score_team_name(away.name, false), core.score_team_name(away.short_name, false))
      THEN 'strict'
    WHEN core.score_team_name(p_home_name, true) IN (core.score_team_name(home.name, true), core.score_team_name(home.short_name, true))
     AND core.score_team_name(p_away_name, true) IN (core.score_team_name(away.name, true), core.score_team_name(away.short_name, true))
      THEN 'affix'
  END;
  IF names IS NULL THEN
    RETURN jsonb_build_object('decision', 'rejected', 'candidate_ids', jsonb_build_array(p_match_id), 'chosen_id', NULL,
                              'evidence_code', 'TEAMS_DIFFER', 'evidence', evidence);
  END IF;
  evidence := evidence || jsonb_build_object('names', names);
  IF p_final_home IS NULL OR p_final_away IS NULL OR parent.home_score IS NULL OR parent.away_score IS NULL
     OR (p_final_home, p_final_away) IS DISTINCT FROM (parent.home_score, parent.away_score) THEN
    RETURN jsonb_build_object('decision', 'rejected', 'candidate_ids', jsonb_build_array(p_match_id), 'chosen_id', NULL,
                              'evidence_code', 'FINAL_DIFFERS', 'evidence', evidence);
  END IF;
  SELECT array_agg(m.id ORDER BY m.id) INTO pairs FROM core.matches m
   WHERE m.match_date = p_day AND m.id <> p_match_id
     AND ((m.home_team_id = parent.home_team_id AND m.away_team_id = parent.away_team_id)
       OR (m.home_team_id = parent.away_team_id AND m.away_team_id = parent.home_team_id));
  IF pairs IS NOT NULL THEN
    RETURN jsonb_build_object('decision', 'ambiguous', 'candidate_ids', to_jsonb(array_prepend(p_match_id, pairs)),
                              'chosen_id', NULL, 'evidence_code', 'SAME_DAY_PAIR', 'evidence', evidence);
  END IF;
  RETURN jsonb_build_object('decision', 'linked', 'candidate_ids', jsonb_build_array(p_match_id), 'chosen_id', p_match_id,
                            'evidence_code', 'ANCHOR_DATE_TEAMS_FINAL', 'evidence', evidence);
END $$;

-- The protections of a pair about to govern (FAILURE_MODES.md section 8): not above a final, the same as the parent's
-- first-half goals. NULL status: none applies.
CREATE FUNCTION core.score_protections(p_match_id integer, p_home smallint, p_away smallint, p_final_home smallint,
                                       p_final_away smallint)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  parent record;
  coverage text;
  chronology record;
BEGIN
  SELECT m.season_id, m.home_team_id, m.away_team_id, m.home_score, m.away_score INTO parent FROM core.matches m WHERE m.id = p_match_id;
  IF (p_final_home IS NOT NULL AND p_home > p_final_home) OR (p_final_away IS NOT NULL AND p_away > p_final_away)
     OR (parent.home_score IS NOT NULL AND p_home > parent.home_score) OR (parent.away_score IS NOT NULL AND p_away > parent.away_score) THEN
    RETURN jsonb_build_object('status', 'conflict', 'reason', 'HALF_TIME_ABOVE_FINAL');
  END IF;
  SELECT c.events::text INTO coverage FROM core.match_coverage c WHERE c.season_id = parent.season_id AND c.match_id = p_match_id;
  IF coverage IS DISTINCT FROM 'ok' THEN
    RETURN jsonb_build_object('status', 'observed', 'reason', 'CHRONOLOGY_ABSENT');
  END IF;
  SELECT count(*) FILTER (WHERE e.team_id = parent.home_team_id AND e.is_own_goal IS FALSE) AS home,
         count(*) FILTER (WHERE e.team_id = parent.away_team_id AND e.is_own_goal IS FALSE) AS away,
         count(*) FILTER (WHERE e.is_own_goal IS NOT FALSE OR e.team_id IS NULL
                             OR e.team_id NOT IN (parent.home_team_id, parent.away_team_id)) AS unclear
    INTO chronology FROM core.match_events e
   WHERE e.season_id = parent.season_id AND e.match_id = p_match_id AND e.event_type = 'goal' AND e.period = 'first_half';
  IF chronology.unclear > 0 THEN
    RETURN jsonb_build_object('status', 'observed', 'reason', 'CHRONOLOGY_UNCLEAR');
  END IF;
  IF (chronology.home, chronology.away) IS DISTINCT FROM (p_home::bigint, p_away::bigint) THEN
    RETURN jsonb_build_object('status', 'conflict', 'reason', 'CHRONOLOGY_CONTRADICTS',
                              'chronology', jsonb_build_array(chronology.home, chronology.away));
  END IF;
  RETURN jsonb_build_object('status', NULL, 'chronology', jsonb_build_array(chronology.home, chronology.away));
END $$;

-- The approval names the nine fields it saw of the parent (FAILURE_MODES.md section 8, Approval): one lacking, or another
-- match, is refused, whoever calls (review, M1.2).
CREATE FUNCTION core.score_approval_check(p_match_id integer, p_expected jsonb)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(k, ', ' ORDER BY k) INTO missing
    FROM unnest(ARRAY['match_id', 'public_id', 'season_id', 'competition_season_id', 'home_team_id', 'away_team_id',
                      'match_date', 'status', 'parent_source']) k
   WHERE p_expected IS NULL OR jsonb_typeof(p_expected) <> 'object' OR NOT p_expected ? k;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value', MESSAGE = 'the approval lacks ' || missing;
  END IF;
  IF (p_expected->>'match_id') IS DISTINCT FROM p_match_id::text THEN
    RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value', MESSAGE = 'the approval names another match';
  END IF;
END $$;

-- The approval's fields that no longer hold, NULL included (an expected NULL holds only against NULL; review, m5): []
-- when none.
CREATE FUNCTION core.score_stale(p_match_id integer, p_pitch_key text, p_expected jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(f.key ORDER BY f.key), '[]'::jsonb)
  FROM core.matches m
  CROSS JOIN LATERAL (VALUES ('season_id', m.season_id::text), ('competition_season_id', m.competition_season_id::text),
                             ('home_team_id', m.home_team_id::text), ('away_team_id', m.away_team_id::text),
                             ('match_date', m.match_date::text), ('status', m.status::text),
                             ('parent_source', m.source::text), ('public_id', p_pitch_key)) AS f(key, value)
  WHERE m.id = p_match_id AND (p_expected->>f.key) IS DISTINCT FROM f.value
$$;

-- The cells of a phase changed once: the match's revision and updated_at, then the versions of its edition and the
-- match, in Store._flush_versions's order.
CREATE FUNCTION core.score_set_cells(p_match_id integer, p_edition integer, p_home smallint, p_away smallint)
RETURNS integer LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  revised integer;
BEGIN
  UPDATE core.matches SET home_score_ht = p_home, away_score_ht = p_away, revision = revision + 1, updated_at = pg_catalog.now()
   WHERE id = p_match_id RETURNING revision INTO revised;
  INSERT INTO ops.resource_versions (resource_kind, resource_id) VALUES ('competition_season', p_edition)
    ON CONFLICT (resource_kind, resource_id) DO UPDATE SET version = ops.resource_versions.version + 1, updated_at = pg_catalog.now();
  INSERT INTO ops.resource_versions (resource_kind, resource_id) VALUES ('match', p_match_id)
    ON CONFLICT (resource_kind, resource_id) DO UPDATE SET version = ops.resource_versions.version + 1, updated_at = pg_catalog.now();
  RETURN revised;
END $$;

-- What an application of this pair would do, read only and without locks (the CLI's `pilot check`).
CREATE FUNCTION core.score_pair_verdict(p_origin core.provider, p_key text, p_ht_home text, p_ht_away text,
                                        p_ft_home text, p_ft_away text, p_day date, p_home_name text, p_away_name text,
                                        p_match_id integer, p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  home smallint := CASE WHEN p_ht_home ~ '^[0-9]{1,3}$' THEN p_ht_home::smallint END;
  away smallint := CASE WHEN p_ht_away ~ '^[0-9]{1,3}$' THEN p_ht_away::smallint END;
  final_home smallint := CASE WHEN p_ft_home ~ '^[0-9]{1,3}$' THEN p_ft_home::smallint END;
  final_away smallint := CASE WHEN p_ft_away ~ '^[0-9]{1,3}$' THEN p_ft_away::smallint END;
  parent record;
  pitch_key text;
  stale jsonb;
  identity jsonb;
  protect jsonb;
  base jsonb;
BEGIN
  PERFORM core.score_approval_check(p_match_id, p_expected);
  SELECT m.home_score_ht, m.away_score_ht, m.revision INTO parent FROM core.matches m WHERE m.id = p_match_id;
  SELECT k.provider_key INTO pitch_key FROM core.provider_ids k
   WHERE k.entity_type = 'match' AND k.provider = 'pitchapi' AND k.entity_id = p_match_id AND k.is_current;
  base := jsonb_build_object('half_time', jsonb_build_array(home, away), 'cells', jsonb_build_array(parent.home_score_ht, parent.away_score_ht),
                             'revision', parent.revision);
  identity := core.score_identity(p_origin, p_key, p_match_id, p_day, p_home_name, p_away_name, final_home, final_away);
  base := base || jsonb_build_object('identity', identity);
  IF identity->>'decision' = 'no_candidate' THEN
    RETURN base || jsonb_build_object('status', 'pending_identity', 'reason', 'NO_CANDIDATE');
  END IF;
  stale := core.score_stale(p_match_id, pitch_key, p_expected);
  IF jsonb_array_length(stale) > 0 THEN
    RETURN base || jsonb_build_object('status', 'quarantined', 'reason', 'STALE_APPROVAL', 'stale', stale);
  END IF;
  IF identity->>'decision' <> 'linked' THEN
    RETURN base || jsonb_build_object('status', CASE identity->>'decision' WHEN 'rejected' THEN 'quarantined' ELSE 'pending_identity' END,
                                      'reason', identity->>'evidence_code');
  END IF;
  IF home IS NULL OR away IS NULL THEN
    RETURN base || jsonb_build_object('status', 'observed', 'reason', 'INVALID_PAIR');
  END IF;
  protect := core.score_protections(p_match_id, home, away, final_home, final_away);
  IF protect->>'status' IS NOT NULL THEN
    RETURN base || jsonb_build_object('status', protect->>'status', 'reason', protect->>'reason');
  END IF;
  RETURN base || jsonb_build_object('status', CASE WHEN (parent.home_score_ht, parent.away_score_ht) IS NOT DISTINCT FROM (home, away)
                                                   THEN 'unchanged' ELSE 'published' END, 'reason', NULL);
END $$;

-- An application of a source's pair (FAILURE_MODES.md section 8): the rows of the key (one element per row, source
-- order), its batch, the anchor and the approval's expectations. Locks: the source key, the Pitch writer's key lock
-- (Store.save_matches), the parent, its keys; then the S1 tables, then the versions. Idempotent: an application run
-- again finds what it wrote and changes nothing.
CREATE FUNCTION core.publish_score_pair(
  p_origin core.provider, p_key text, p_dataset text,
  p_ht_home text[], p_ht_away text[], p_ft_home text[], p_ft_away text[],
  p_day date, p_home_name text, p_away_name text,
  p_distributor text, p_object_name text, p_member_path text, p_content_sha256 bytea, p_publisher_version text,
  p_issued_at timestamptz, p_first_seen_at timestamptz, p_source_url text, p_schema_sha256 bytea,
  p_match_id integer, p_expected jsonb, p_rule_version text, p_as_of date)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  n integer := cardinality(p_ht_home);
  pitch_key text;
  parent core.matches%ROWTYPE;
  batch bigint;
  issued timestamptz;
  effective timestamptz;
  ht bigint;
  ft bigint;
  home smallint;
  away smallint;
  final_home smallint;
  final_away smallint;
  identity jsonb;
  protect jsonb;
  stale jsonb;
  candidate core.match_score_observations%ROWTYPE;
  chosen record;  -- core.match_score_selections, created last in this file
  captured bigint;
  revised integer;
  result jsonb;
BEGIN
  IF p_origin IS DISTINCT FROM 'opta' OR p_key IS NULL OR n IS NULL OR n < 1 OR cardinality(p_ht_away) IS DISTINCT FROM n
     OR cardinality(p_ft_home) IS DISTINCT FROM n OR cardinality(p_ft_away) IS DISTINCT FROM n OR p_dataset IS NULL
     OR p_dataset = 'core.matches' OR p_content_sha256 IS NULL OR octet_length(p_content_sha256) <> 32
     OR p_distributor IS NULL OR p_object_name IS NULL OR p_match_id IS NULL OR p_rule_version IS NULL OR p_as_of IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value', MESSAGE = 'core.publish_score_pair: invalid arguments';
  END IF;
  PERFORM core.score_approval_check(p_match_id, p_expected);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('opta:match:' || p_key, 0));
  SELECT k.provider_key INTO pitch_key FROM core.provider_ids k
   WHERE k.entity_type = 'match' AND k.provider = 'pitchapi' AND k.entity_id = p_match_id AND k.is_current;
  IF pitch_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pitchapi:match:' || pitch_key, 0));
  END IF;
  SELECT m.* INTO parent FROM core.matches m WHERE m.id = p_match_id FOR UPDATE;
  IF parent.id IS NOT NULL THEN
    PERFORM 1 FROM core.provider_ids k WHERE k.entity_type = 'match' AND k.entity_id = p_match_id
     ORDER BY k.entity_id, k.provider, k.provider_key FOR UPDATE;
  END IF;
  INSERT INTO core.observation_batches (distributor, object_name, member_path, content_sha256, publisher_version, issued_at,
                                        first_seen_at, source_url, schema_sha256)
  VALUES (p_distributor, p_object_name, p_member_path, p_content_sha256, p_publisher_version, p_issued_at,
          coalesce(p_first_seen_at, pg_catalog.now()), p_source_url, p_schema_sha256)
  ON CONFLICT ON CONSTRAINT observation_batches_version DO NOTHING;
  SELECT b.id, b.issued_at INTO batch, issued FROM core.observation_batches b
   WHERE b.distributor = p_distributor AND b.object_name = p_object_name AND b.member_path IS NOT DISTINCT FROM p_member_path
     AND b.content_sha256 = p_content_sha256;
  result := jsonb_build_object('batch_id', batch, 'changed', false, 'target_rows', 0,
                               'cells_before', jsonb_build_array(parent.home_score_ht, parent.away_score_ht),
                               'revision_before', parent.revision, 'revision_after', parent.revision,
                               'lexemes', jsonb_build_array(p_ht_home[1], p_ht_away[1]));
  -- Contradictory rows of the key: no single fact (the rows stay in their segment, with their ordinals).
  IF EXISTS (SELECT 1 FROM unnest(p_ht_home, p_ht_away, p_ft_home, p_ft_away) AS r(hh, ha, fh, fa)
              WHERE (r.hh, r.ha, r.fh, r.fa) IS DISTINCT FROM (p_ht_home[1], p_ht_away[1], p_ft_home[1], p_ft_away[1])) THEN
    RETURN result || jsonb_build_object('status', 'conflict', 'reason', 'DUPLICATE_SOURCE_ROWS');
  END IF;
  home := CASE WHEN p_ht_home[1] ~ '^[0-9]{1,3}$' THEN p_ht_home[1]::smallint END;
  away := CASE WHEN p_ht_away[1] ~ '^[0-9]{1,3}$' THEN p_ht_away[1]::smallint END;
  final_home := CASE WHEN p_ft_home[1] ~ '^[0-9]{1,3}$' THEN p_ft_home[1]::smallint END;
  final_away := CASE WHEN p_ft_away[1] ~ '^[0-9]{1,3}$' THEN p_ft_away[1]::smallint END;
  result := result || jsonb_build_object('half_time', jsonb_build_array(home, away));
  -- This activation's instant (review, M2): the issue the caller read for this collection, else the batch's first
  -- one, else the first collection's day. Undated, once the key has another batch's observations, it cannot be placed;
  -- dated after this clock (beyond five minutes' skew), it would outrank every later real generation.
  effective := coalesce(p_issued_at, issued);
  IF effective IS NULL THEN
    IF EXISTS (SELECT 1 FROM core.match_score_observations o
                WHERE o.origin = p_origin AND o.source_match_key = p_key AND o.batch_id IS DISTINCT FROM batch) THEN
      RETURN result || jsonb_build_object('status', 'quarantined', 'reason', 'GENERATION_NOT_ORDERABLE');
    END IF;
    SELECT min(o.effective_at) INTO effective FROM core.match_score_observations o
     WHERE o.origin = p_origin AND o.source_match_key = p_key AND o.batch_id = batch;
    effective := coalesce(effective, (p_as_of::timestamp AT TIME ZONE 'UTC'));
  ELSIF effective > pg_catalog.now() + interval '5 minutes' THEN
    RETURN result || jsonb_build_object('status', 'quarantined', 'reason', 'GENERATION_NOT_ORDERABLE', 'instant', effective);
  END IF;
  ht := core.score_observe(p_origin, p_key, 'half_time', p_ht_home[1], p_ht_away[1], p_dataset, batch, effective);
  ft := core.score_observe(p_origin, p_key, 'final_reported', p_ft_home[1], p_ft_away[1], p_dataset, batch, effective);
  result := result || jsonb_build_object('observations', jsonb_build_object('half_time', ht, 'final_reported', ft));
  IF parent.id IS NOT NULL THEN
    stale := core.score_stale(p_match_id, pitch_key, p_expected);
    IF jsonb_array_length(stale) > 0 THEN
      RETURN result || jsonb_build_object('status', 'quarantined', 'reason', 'STALE_APPROVAL', 'stale', stale);
    END IF;
  END IF;
  identity := core.score_identity(p_origin, p_key, p_match_id, p_day, p_home_name, p_away_name, final_home, final_away);
  result := result || jsonb_build_object('identity', identity);
  IF identity->>'decision' <> 'linked' THEN
    RETURN result || jsonb_build_object('status', CASE identity->>'decision' WHEN 'rejected' THEN 'quarantined' ELSE 'pending_identity' END,
                                        'reason', identity->>'evidence_code');
  END IF;
  INSERT INTO core.provider_ids (entity_type, provider, provider_key, entity_id) VALUES ('match', p_origin, p_key, p_match_id)
    ON CONFLICT DO NOTHING;
  -- The producer's governing pair: its valid complete pair of the latest generation.
  SELECT o.* INTO candidate FROM core.match_score_observations o
   WHERE o.origin = p_origin AND o.source_match_key = p_key AND o.score_phase = 'half_time'
     AND o.home_goals IS NOT NULL AND o.away_goals IS NOT NULL
   ORDER BY o.effective_at DESC NULLS LAST, o.revision_no DESC LIMIT 1;
  IF candidate.id IS NULL OR (candidate.id <> ht AND (home IS NULL OR away IS NULL)) THEN
    RETURN result || jsonb_build_object('status', 'observed', 'reason', 'INVALID_PAIR');
  END IF;
  IF candidate.id <> ht THEN
    RETURN result || jsonb_build_object('status', 'superseded', 'reason', 'OLDER_GENERATION');
  END IF;
  protect := core.score_protections(p_match_id, candidate.home_goals, candidate.away_goals, final_home, final_away);
  IF protect->>'status' IS NOT NULL THEN
    RETURN result || jsonb_build_object('status', protect->>'status', 'reason', protect->>'reason');
  END IF;
  SELECT s.* INTO chosen FROM core.match_score_selections s WHERE s.match_id = p_match_id AND s.score_phase = 'half_time' FOR UPDATE;
  IF chosen.match_id IS NULL THEN
    -- The cells as this selection finds them, unattributed, kept before they are replaced; kept too when they already
    -- hold the pair but differ from an earlier selection's capture, which a revert must never bring back (review, m7).
    IF (parent.home_score_ht, parent.away_score_ht) IS DISTINCT FROM (candidate.home_goals, candidate.away_goals)
       OR EXISTS (SELECT 1 FROM core.match_score_observations o
                   WHERE o.origin = 'other' AND o.source_match_key = p_match_id::text AND o.score_phase = 'half_time'
                     AND o.source_dataset = 'core.matches') THEN
      captured := core.score_observe('other', p_match_id::text, 'half_time', parent.home_score_ht::text, parent.away_score_ht::text,
                                     'core.matches', NULL, NULL);
    END IF;
    INSERT INTO core.match_score_selections (match_id, score_phase, observation_id, selected_at, rule_version)
    VALUES (p_match_id, 'half_time', candidate.id, pg_catalog.now(), p_rule_version);
  ELSIF chosen.observation_id <> candidate.id THEN
    UPDATE core.match_score_selections SET observation_id = candidate.id, selected_at = pg_catalog.now(), rule_version = p_rule_version
     WHERE match_id = p_match_id AND score_phase = 'half_time';
  END IF;
  result := result || jsonb_build_object('captured', captured,
                                         'selection', jsonb_build_object('match_id', p_match_id, 'observation_id', candidate.id));
  IF (parent.home_score_ht, parent.away_score_ht) IS DISTINCT FROM (candidate.home_goals, candidate.away_goals) THEN
    revised := core.score_set_cells(p_match_id, parent.competition_season_id, candidate.home_goals, candidate.away_goals);
    result := result || jsonb_build_object('changed', true, 'target_rows', 1, 'revision_after', revised);
  END IF;
  RETURN result || jsonb_build_object('status', 'published', 'reason', NULL,
                                      'cells_after', jsonb_build_array(candidate.home_goals, candidate.away_goals));
END $$;

-- The targeted cancellation of a producer's governing pair (FAILURE_MODES.md section 8, Revert): only while that
-- producer's key holds the selection; the cells go back to the last capture of the unattributed state, if any.
CREATE FUNCTION core.revert_score_selection(p_match_id integer, p_phase text, p_origin core.provider, p_key text,
                                            p_rule_version text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  pitch_key text;
  parent core.matches%ROWTYPE;
  owner record;
  capture core.match_score_observations%ROWTYPE;
  revised integer;
BEGIN
  IF p_phase IS DISTINCT FROM 'half_time' OR p_origin IS NULL OR p_key IS NULL OR p_match_id IS NULL OR p_rule_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value', MESSAGE = 'core.revert_score_selection: invalid arguments';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('opta:match:' || p_key, 0));
  SELECT k.provider_key INTO pitch_key FROM core.provider_ids k
   WHERE k.entity_type = 'match' AND k.provider = 'pitchapi' AND k.entity_id = p_match_id AND k.is_current;
  IF pitch_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pitchapi:match:' || pitch_key, 0));
  END IF;
  SELECT m.* INTO parent FROM core.matches m WHERE m.id = p_match_id FOR UPDATE;
  SELECT s.observation_id, o.origin, o.source_match_key INTO owner
    FROM core.match_score_selections s JOIN core.match_score_observations o ON o.id = s.observation_id
   WHERE s.match_id = p_match_id AND s.score_phase = p_phase FOR UPDATE OF s;
  IF owner.observation_id IS NULL OR owner.origin <> p_origin OR owner.source_match_key <> p_key THEN
    RETURN jsonb_build_object('status', 'not_owner', 'restored', NULL, 'changed', false, 'revision_after', parent.revision);
  END IF;
  DELETE FROM core.match_score_selections WHERE match_id = p_match_id AND score_phase = p_phase;
  SELECT o.* INTO capture FROM core.match_score_observations o
   WHERE o.origin = 'other' AND o.source_match_key = p_match_id::text AND o.score_phase = p_phase AND o.source_dataset = 'core.matches'
   ORDER BY o.revision_no DESC LIMIT 1;
  IF capture.id IS NOT NULL AND (parent.home_score_ht, parent.away_score_ht) IS DISTINCT FROM (capture.home_goals, capture.away_goals) THEN
    revised := core.score_set_cells(p_match_id, parent.competition_season_id, capture.home_goals, capture.away_goals);
    RETURN jsonb_build_object('status', 'reverted', 'restored', jsonb_build_array(capture.home_goals, capture.away_goals),
                              'changed', true, 'revision_before', parent.revision, 'revision_after', revised);
  END IF;
  RETURN jsonb_build_object('status', 'reverted', 'restored', NULL, 'changed', false, 'revision_before', parent.revision,
                            'revision_after', parent.revision);
END $$;

REVOKE ALL ON FUNCTION core.score_team_name(text, boolean), core.score_observe(core.provider, text, text, text, text, text, bigint, timestamptz),
  core.score_approval_check(integer, jsonb),
  core.score_identity(core.provider, text, integer, date, text, text, smallint, smallint),
  core.score_protections(integer, smallint, smallint, smallint, smallint), core.score_stale(integer, text, jsonb),
  core.score_set_cells(integer, integer, smallint, smallint),
  core.score_pair_verdict(core.provider, text, text, text, text, text, date, text, text, integer, jsonb),
  core.publish_score_pair(core.provider, text, text, text[], text[], text[], text[], date, text, text, text, text, text,
                          bytea, text, timestamptz, timestamptz, text, bytea, integer, jsonb, text, date),
  core.revert_score_selection(integer, text, core.provider, text, text)
FROM PUBLIC;

-- Last: the selection table, whose key on core.matches needs a lock the collector's writes wait for (SHARE ROW
-- EXCLUSIVE). Asked without queueing, so that no writer waits behind the request: again every 50 ms, for at most 60 s.
DO $$
DECLARE
  attempts integer := 0;
BEGIN
  LOOP
    BEGIN
      LOCK TABLE core.matches IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      attempts := attempts + 1;
      IF attempts >= 1200 THEN
        RAISE EXCEPTION USING ERRCODE = 'lock_not_available',
          MESSAGE = '186: core.matches was written without a pause for 60 s; nothing of 186 applied, run the migrate task again';
      END IF;
      PERFORM pg_catalog.pg_sleep(0.05);
    END;
  END LOOP;
END $$;

CREATE TABLE core.match_score_selections (
  match_id integer NOT NULL REFERENCES core.matches(id) ON DELETE CASCADE,
  score_phase text NOT NULL CHECK (score_phase = 'half_time'),
  observation_id bigint NOT NULL UNIQUE REFERENCES core.match_score_observations(id) ON DELETE RESTRICT,
  selected_at timestamptz NOT NULL,
  rule_version text NOT NULL,
  PRIMARY KEY (match_id, score_phase)
);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON core.match_score_selections FROM vega_collect;
