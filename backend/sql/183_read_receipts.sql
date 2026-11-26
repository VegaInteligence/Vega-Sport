-- GH137R. Preserve the existing content tags for five reads. The worker remembers each prepared digest along with a
-- proof of its inputs. Readers can only obtain the digest for the current version, in their own query snapshot.
-- The new row triggers on the five sources require the writers to be stopped while this migration applies.

-- In addition to the whole-table mark (182), mark affected scopes. The WHEN conditions claim the latest scope at row
-- time, before queuing an AFTER trigger event. A bulk update of one season queues one such event, not one per row.
-- Both sides of a move are marked. A leaf truncation or attachment is also covered by the partition layout.
CREATE FUNCTION ops.mark_scoped_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  old_scope text;
  new_scope text;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    INSERT INTO ops.data_changes (relation, scope) VALUES (TG_ARGV[0], '*');
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    old_scope := to_jsonb(OLD) ->> TG_ARGV[1];
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_scope := to_jsonb(NEW) ->> TG_ARGV[1];
  END IF;
  INSERT INTO ops.data_changes (relation, scope)
    SELECT DISTINCT TG_ARGV[0], k FROM unnest(ARRAY[old_scope, new_scope]) k WHERE k IS NOT NULL;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION ops.mark_scoped_change() FROM PUBLIC;

DO $$
DECLARE
  t record;
  setting text;
  previous text;
  old_key text;
  new_key text;
BEGIN
  FOR t IN SELECT * FROM (VALUES ('core.matches', 'season_id'), ('core.match_events', 'season_id'),
    ('core.league_player_seasons', 'season_id'), ('core.player_transfers', 'player_id'),
    ('ops.transfermarkt_reads', 'provider_key')) AS s(relation, key)
  LOOP
    setting := 'vega.scope_' || replace(t.relation, '.', '__');
    previous := format('nullif(pg_catalog.current_setting(%L, true), %L)', setting, '');
    old_key := format('OLD.%I::text', t.key);
    new_key := format('NEW.%I::text', t.key);
    EXECUTE format('CREATE TRIGGER vega_scope_insert AFTER INSERT ON %s FOR EACH ROW
      WHEN (CASE WHEN %s IS DISTINCT FROM %s THEN pg_catalog.set_config(%L, %s, true) IS NOT NULL ELSE false END)
      EXECUTE FUNCTION ops.mark_scoped_change(%L,%L)', t.relation, new_key, previous, setting, new_key, t.relation, t.key);
    -- CASE keeps the claim after the comparison; a no-op must not consume it.
    EXECUTE format('CREATE TRIGGER vega_scope_update AFTER UPDATE ON %s FOR EACH ROW
      WHEN (CASE WHEN (%s IS DISTINCT FROM %s OR %s IS DISTINCT FROM %s) AND OLD.* *<> NEW.*
        THEN pg_catalog.set_config(%L, %s, true) IS NOT NULL ELSE false END)
      EXECUTE FUNCTION ops.mark_scoped_change(%L,%L)',
      t.relation, new_key, previous, old_key, new_key, setting, new_key, t.relation, t.key);
    EXECUTE format('CREATE TRIGGER vega_scope_delete AFTER DELETE ON %s FOR EACH ROW
      WHEN (CASE WHEN %s IS DISTINCT FROM %s THEN pg_catalog.set_config(%L, %s, true) IS NOT NULL ELSE false END)
      EXECUTE FUNCTION ops.mark_scoped_change(%L,%L)', t.relation, old_key, previous, setting, old_key, t.relation, t.key);
    EXECUTE format('CREATE TRIGGER vega_scope_truncate AFTER TRUNCATE ON %s FOR EACH STATEMENT
      EXECUTE FUNCTION ops.mark_scoped_change(%L,%L)', t.relation, t.relation, t.key);
  END LOOP;
END
$$;

-- Both the matchdays read and the worker's scopes use the identical edition selection (including native labels).
CREATE FUNCTION api.matchday_editions(league text, season text)
RETURNS TABLE(id integer, season_id smallint)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT cs.id, cs.season_id
  FROM core.competition_seasons cs
  JOIN core.seasons se ON se.id = cs.season_id
  LEFT JOIN core.provider_ids ck ON ck.entity_type = 'competition' AND ck.entity_id = cs.competition_id
    AND ck.provider = 'pitchapi' AND ck.is_current
  WHERE cs.archive_key IS NULL AND cs.cup_key IS NULL
    AND coalesce(ck.provider_key, 'l_v' || lpad(cs.competition_id::text, 7, '0')) = $1
    AND (se.label = $2 OR cs.native_label = $2)
$$;

CREATE OR REPLACE FUNCTION api.matchday_rounds(league text, season text)
RETURNS TABLE(id text, name text, playoff boolean)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT coalesce(k.provider_key, 'm_v' || lpad(m.id::text, 7, '0')), r.name,
    coalesce(m.has_playoff, false) OR coalesce(r.stage = 'playoff', false)
  FROM core.matches m
  CROSS JOIN LATERAL (SELECT r.name, r.stage FROM core.rounds r WHERE r.id = m.round_id OFFSET 0) r
  LEFT JOIN LATERAL (
    SELECT mk.provider_key FROM core.provider_ids mk
    WHERE mk.entity_type = 'match' AND mk.entity_id = m.id AND mk.provider = 'pitchapi' AND mk.is_current OFFSET 0) k ON true
  WHERE m.competition_season_id = ANY (ARRAY(SELECT e.id FROM api.matchday_editions($1, $2) e))
$$;

CREATE FUNCTION api.player_transfer_scope(public_player text)
RETURNS TABLE(player_key integer, provider_key text)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT p.entity_id, p.provider_key FROM core.provider_ids p
  WHERE p.entity_id = api.internal_id('player', $1) AND p.entity_type = 'player'
    AND p.provider = 'transfermarkt' AND p.is_current
$$;

REVOKE ALL ON FUNCTION api.matchday_editions(text,text), api.player_transfer_scope(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.matchday_editions(text,text), api.player_transfer_scope(text) TO vega_read;

CREATE TABLE ops.read_receipts (
  route text NOT NULL CHECK (route IN ('league-history', 'matchdays', 'standings', 'cup-edition', 'transfers')),
  selector text NOT NULL CHECK (length(selector) <= 48),
  representation text NOT NULL,
  relations text[] NOT NULL CHECK (cardinality(relations) BETWEEN 1 AND 20),
  scopes text[][] NOT NULL CHECK (cardinality(scopes) = 0 OR
    (array_ndims(scopes) = 2 AND array_length(scopes, 2) = 2 AND array_length(scopes, 1) <= 40)),
  version text NOT NULL,
  digest text CHECK (digest ~ '^[0-9a-f]{64}$'),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(route, selector)
);
CREATE INDEX read_receipts_check ON ops.read_receipts(checked_at, route, selector);
CREATE INDEX read_receipts_age ON ops.read_receipts(route, prepared_at, selector);
CREATE TABLE ops.read_receipt_discovery (
  route text PRIMARY KEY,
  after_key text NOT NULL
);
REVOKE ALL ON ops.read_receipts, ops.read_receipt_discovery FROM PUBLIC, vega_collect, vega_calc, vega_read;

CREATE FUNCTION ops.receipt_version(relations text[], scopes text[][]) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT ops.scoped_data_version($1, NULL, $2)
$$;
REVOKE ALL ON FUNCTION ops.receipt_version(text[],text[]) FROM PUBLIC;

CREATE FUNCTION api.read_receipt(p_route text, p_selector text, p_representation text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT r.digest FROM ops.read_receipts r
  WHERE r.route = p_route AND r.selector = p_selector AND r.representation = p_representation
    AND r.digest IS NOT NULL AND r.version = ops.receipt_version(r.relations, r.scopes)
$$;
REVOKE ALL ON FUNCTION api.read_receipt(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.read_receipt(text,text,text) TO vega_read;

CREATE FUNCTION ops.put_read_receipt(p_route text, p_selector text, p_representation text,
  p_relations text[], p_scopes text[][], p_digest text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  stamp text;
  cap integer := CASE p_route WHEN 'league-history' THEN 100 WHEN 'cup-edition' THEN 5000
    WHEN 'transfers' THEN 50000 WHEN 'standings' THEN 20000 WHEN 'matchdays' THEN 20000 END;
BEGIN
  IF current_setting('transaction_isolation') <> 'repeatable read' OR cap IS NULL THEN
    RETURN false;
  END IF;
  stamp := ops.receipt_version(p_relations, p_scopes);
  IF stamp IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO ops.read_receipts(route, selector, representation, relations, scopes, version, digest)
    VALUES (p_route, p_selector, p_representation, p_relations, p_scopes, stamp, p_digest)
  ON CONFLICT (route, selector) DO UPDATE SET representation = EXCLUDED.representation,
    relations = EXCLUDED.relations, scopes = EXCLUDED.scopes, version = EXCLUDED.version,
    digest = EXCLUDED.digest, prepared_at = now(), checked_at = now();
  DELETE FROM ops.read_receipts r
    WHERE r.route = p_route AND r.selector IN (SELECT s.selector FROM ops.read_receipts s
      WHERE s.route = p_route ORDER BY s.prepared_at DESC, s.selector DESC OFFSET cap);
  RETURN true;
END
$$;

CREATE FUNCTION ops.check_read_receipts(p_representation text, p_limit integer)
RETURNS TABLE(route text, selector text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH oldest AS MATERIALIZED (
    SELECT r.* FROM ops.read_receipts r ORDER BY r.checked_at, r.route, r.selector LIMIT least(p_limit, 200)),
  changed AS MATERIALIZED (
    SELECT r.route, r.selector, r.checked_at FROM oldest r WHERE r.representation <> p_representation
      OR r.version IS DISTINCT FROM ops.receipt_version(r.relations, r.scopes)),
  checked AS (
    UPDATE ops.read_receipts r SET checked_at = now()
    FROM oldest o WHERE (r.route, r.selector) = (o.route, o.selector))
  SELECT c.route, c.selector FROM changed c ORDER BY c.checked_at, c.route, c.selector
$$;

-- The archived leagues have only 55 supported combinations. The caller supplies that fixed list from route code.
CREATE FUNCTION ops.missing_history_receipts(p_keys text[], p_limit integer) RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT k.alias FROM unnest(p_keys) k(alias)
  WHERE NOT EXISTS (SELECT 1 FROM ops.read_receipts r WHERE r.route = 'league-history' AND r.selector = k.alias)
  LIMIT least(p_limit, 20)
$$;

-- Page the underlying indexed edition ids or Transfermarkt keys before constructing candidate selectors.
-- Failed/unprepared selections get another chance on the next traversal, even after a worker restart.
CREATE FUNCTION ops.discover_read_receipts(p_route text, p_limit integer) RETURNS SETOF text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  previous text := coalesce((SELECT d.after_key FROM ops.read_receipt_discovery d WHERE d.route = p_route), '');
  last_key text;
  keys text[];
BEGIN
  IF p_route = 'transfers' THEN
    WITH page AS MATERIALIZED (
      SELECT r.provider_key FROM ops.transfermarkt_reads r
        WHERE r.kind = 'transfers' AND r.provider_key > previous
        ORDER BY r.provider_key LIMIT least(p_limit, 20)),
    linked AS (
      SELECT DISTINCT api.public_id('player', p.entity_id) AS selector
      FROM page s JOIN core.provider_ids p ON (p.entity_type, p.provider, p.provider_key) = ('player', 'transfermarkt', s.provider_key)
        AND p.is_current
      JOIN ops.transfermarkt_reads r ON r.kind = 'transfers' AND r.provider_key = s.provider_key
      WHERE r.read_at IS NOT NULL)
    SELECT (SELECT max(provider_key) FROM page), array_agg(l.selector) INTO last_key, keys FROM linked l;
  ELSIF p_route IN ('matchdays', 'standings', 'cup-edition') THEN
    WITH page AS MATERIALIZED (
      SELECT cs.id, cs.competition_id, cs.season_id, cs.native_label
      FROM core.competition_seasons cs
      WHERE cs.id > coalesce(nullif(previous, '')::int, 0) AND cs.archive_key IS NULL
        AND (cs.cup_key IS NOT NULL) = (p_route = 'cup-edition')
      ORDER BY cs.id LIMIT least(p_limit, 20)),
    selectors AS (
      SELECT coalesce(p.provider_key, 'l_v' || lpad(e.competition_id::text, 7, '0')) ||
        '|' || s.label AS selector
      FROM page e JOIN core.seasons se ON se.id = e.season_id
      LEFT JOIN core.provider_ids p ON p.entity_type = 'competition' AND p.entity_id = e.competition_id
        AND p.provider = 'pitchapi' AND p.is_current
      CROSS JOIN LATERAL (
        SELECT e.native_label AS label
        UNION SELECT se.label WHERE p_route <> 'cup-edition'
        UNION SELECT '' WHERE p_route = 'standings') s
      WHERE s.label IS NOT NULL)
    SELECT (SELECT max(id)::text FROM page), array_agg(DISTINCT s.selector) INTO last_key, keys FROM selectors s;
  ELSE
    RETURN;
  END IF;
  INSERT INTO ops.read_receipt_discovery AS d(route, after_key) VALUES (p_route, coalesce(last_key, ''))
    ON CONFLICT (route) DO UPDATE SET after_key = EXCLUDED.after_key;
  RETURN QUERY SELECT k.selector FROM unnest(keys) k(selector)
    WHERE NOT EXISTS (SELECT 1 FROM ops.read_receipts r WHERE r.route = p_route AND r.selector = k.selector);
END
$$;

REVOKE ALL ON FUNCTION ops.put_read_receipt(text,text,text,text[],text[],text), ops.check_read_receipts(text,integer),
  ops.missing_history_receipts(text[],integer), ops.discover_read_receipts(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.put_read_receipt(text,text,text,text[],text[],text), ops.check_read_receipts(text,integer),
  ops.missing_history_receipts(text[],integer), ops.discover_read_receipts(text,integer) TO vega_calc;

-- Receipt reads and writes are separate transactions/privileges, with SET LOCAL ROLE only inside preparation.
GRANT vega_read TO vega_calc WITH INHERIT FALSE, SET TRUE;
