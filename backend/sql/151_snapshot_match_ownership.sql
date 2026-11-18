-- Match keys live in a polymorphic table. Share-lock their target like a foreign key
-- so a late link cannot appear while a snapshot owns the match for change or withdrawal.
SET LOCAL lock_timeout = '3s';

CREATE FUNCTION core.lock_match_key_target()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  previous integer;
  target integer;
  locked integer[];
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.entity_type = 'match' THEN
    previous := OLD.entity_id;
  END IF;
  IF NEW.entity_type = 'match' THEN
    target := NEW.entity_id;
  END IF;
  IF previous IS NULL AND target IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT ARRAY(SELECT m.id FROM core.matches m
               WHERE m.id IN (previous, target) ORDER BY m.id FOR KEY SHARE) INTO locked;
  IF target IS NOT NULL AND NOT target = ANY(locked) THEN
    RAISE EXCEPTION USING ERRCODE = 'foreign_key_violation',
      MESSAGE = format('a match provider key cannot name missing match %s', target);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION core.lock_match_key_target() FROM PUBLIC;

CREATE TRIGGER lock_match_key_target
BEFORE INSERT OR UPDATE OF entity_type, entity_id, provider, provider_key, is_current ON core.provider_ids
FOR EACH ROW EXECUTE FUNCTION core.lock_match_key_target();
