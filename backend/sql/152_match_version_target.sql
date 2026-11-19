-- A resource version naming a match is a polymorphic reference: share-lock its target like a foreign key, as 151 does
-- for match keys (VI-27, docs/calculs/09-audit-2026-11/FAILURE_MODES.md §35, 35s). Written after a snapshot withdrawal
-- has checked the match, it waits for the deletion and is refused; written before, the check sees it.
SET LOCAL lock_timeout = '3s';

CREATE FUNCTION ops.lock_match_version_target()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  locked integer[];
BEGIN
  SELECT ARRAY(SELECT m.id FROM core.matches m WHERE m.id = NEW.resource_id FOR KEY SHARE) INTO locked;
  IF cardinality(locked) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'foreign_key_violation',
      MESSAGE = format('a match resource version cannot name missing match %s', NEW.resource_id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ops.lock_match_version_target() FROM PUBLIC;

CREATE TRIGGER lock_match_version_target
BEFORE INSERT OR UPDATE OF resource_kind, resource_id ON ops.resource_versions
FOR EACH ROW WHEN (NEW.resource_kind::text = 'match') EXECUTE FUNCTION ops.lock_match_version_target();
