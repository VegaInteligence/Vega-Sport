-- vega:online
-- 28 Nov 2026 (GitHub #278, VI-177), S3 of PannaData in Vega's model (backend/panna/FAILURE_MODES.md section 10, the
-- dictionary Hugo approved): a producer's content of one subject stored once (core.observation_sets), the dated
-- activations of a subject's content (core.observation_set_revisions), and the detailed actions of a match in their
-- published order (core.match_action_sets, core.match_actions). Keyed by the source's own subject
-- (`match:<octets>:<native key>`), never by a Vega id; core.current_match_action_sets resolves a subject's current
-- set to a Vega match through core.provider_ids, and leaves it pending (match_id NULL) without a current link.
--
-- Online: new tables and views only, no lock on an existing table but the references to core.observation_batches
-- (186) and core.provider_ids read by a view. vega_collect keeps the default SELECT and loses the default INSERT,
-- UPDATE, DELETE (and TRUNCATE) on these: PannaData's loader writes them through panna's functions
-- (backend/panna/sql/006_panna_actions.sql), which also keep the rare exact exceptions of a cell
-- (panna.action_field_exceptions). Nothing here references panna.
SET LOCAL lock_timeout = '3s';

CREATE TABLE core.observation_sets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origin core.provider NOT NULL,
  product text NOT NULL CHECK (product ~ '^[a-z][a-z0-9_]{0,62}$'),
  subject_key text NOT NULL CHECK (char_length(subject_key) BETWEEN 1 AND 2000),
  schema_key text NOT NULL CHECK (char_length(schema_key) BETWEEN 1 AND 4000),
  content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  row_count integer NOT NULL CHECK (row_count >= 0),
  first_seen_at timestamptz NOT NULL,
  CONSTRAINT observation_sets_content UNIQUE (origin, product, subject_key, schema_key, content_sha256),
  -- The target of a revision's composite reference: its set is of its own origin, product and subject.
  CONSTRAINT observation_sets_subject UNIQUE (id, origin, product, subject_key)
);

CREATE TABLE core.observation_set_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origin core.provider NOT NULL,
  product text NOT NULL,
  subject_key text NOT NULL,
  revision_no integer NOT NULL CHECK (revision_no >= 1),
  set_id bigint,
  batch_id bigint NOT NULL REFERENCES core.observation_batches(id) ON DELETE RESTRICT,
  effective_at timestamptz,
  observed_at timestamptz NOT NULL,
  is_current boolean NOT NULL,
  author_order integer,
  UNIQUE (origin, product, subject_key, revision_no),
  FOREIGN KEY (set_id, origin, product, subject_key)
    REFERENCES core.observation_sets (id, origin, product, subject_key) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX observation_set_revisions_current ON core.observation_set_revisions (origin, product, subject_key)
  WHERE is_current;
CREATE INDEX observation_set_revisions_set ON core.observation_set_revisions (set_id);
CREATE INDEX observation_set_revisions_batch ON core.observation_set_revisions (batch_id);

CREATE TABLE core.match_action_sets (
  set_id bigint PRIMARY KEY REFERENCES core.observation_sets(id) ON DELETE RESTRICT,
  source_competition_label text,
  source_season_label text
);

CREATE TABLE core.match_actions (
  set_id bigint NOT NULL REFERENCES core.match_action_sets(set_id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  source_event_id bigint,
  type_code bigint,
  period_code bigint,
  minute bigint,
  second bigint,
  outcome_code bigint,
  x double precision,
  y double precision,
  end_x double precision,
  end_y double precision,
  source_team_key text,
  source_player_key text,
  source_player_name text,
  qualifiers text,
  PRIMARY KEY (set_id, ordinal)
);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON core.observation_sets, core.observation_set_revisions, core.match_action_sets,
  core.match_actions FROM vega_collect;
REVOKE ALL ON SEQUENCE core.observation_sets_id_seq, core.observation_set_revisions_id_seq FROM vega_collect;

-- The native qualifiers of an action as an ordered list: each pair of a JSON object in its written order, duplicates
-- kept; nothing for a value that is not a JSON object (NULL, empty, another text: the column keeps it as published).
CREATE VIEW core.match_action_qualifiers AS
SELECT a.set_id, a.ordinal, (q.n - 1)::integer AS qualifier_ordinal, q.key AS qualifier_code,
       json_typeof(q.value) AS value_type, q.value #>> '{}' AS value_text
FROM core.match_actions a
CROSS JOIN LATERAL json_each(CASE WHEN a.qualifiers IS JSON OBJECT THEN a.qualifiers::json END)
  WITH ORDINALITY AS q (key, value, n);

-- Each subject's current set of actions, its native match key, and the Vega match its current provider key names
-- (NULL: pending identity). No row is created here or by the loader in core.matches or core.provider_ids.
CREATE VIEW core.current_match_action_sets AS
SELECT r.origin, r.subject_key, k.source_match_key, r.set_id, r.revision_no, r.batch_id, r.effective_at,
       s.row_count AS action_count, h.source_competition_label, h.source_season_label, p.entity_id AS match_id
FROM core.observation_set_revisions r
JOIN core.observation_sets s ON s.id = r.set_id
JOIN core.match_action_sets h ON h.set_id = r.set_id
CROSS JOIN LATERAL (SELECT substr(r.subject_key, 8 + length(split_part(r.subject_key, ':', 2))) AS source_match_key) k
LEFT JOIN core.provider_ids p ON p.entity_type = 'match' AND p.provider = r.origin AND p.provider_key = k.source_match_key
                             AND p.is_current
WHERE r.product = 'match_actions' AND r.is_current;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON core.match_action_qualifiers, core.current_match_action_sets FROM vega_collect;
