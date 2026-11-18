-- Exact archive fixture decisions and persisted public aliases (VI-27).
SET LOCAL lock_timeout = '3s';
CREATE TABLE core.archive_match_attestations (
    season_id smallint NOT NULL,
    match_id integer NOT NULL,
    canonical_key text NOT NULL CHECK (canonical_key LIKE 'r:%'),
    former_key text CHECK (former_key LIKE 'g:%'),
    former_id integer UNIQUE,
    canonical_date date NOT NULL,
    authority_key text NOT NULL UNIQUE,
    proof_sha256 text NOT NULL CHECK (proof_sha256 ~ '^[0-9a-f]{64}$'),
    proof jsonb NOT NULL,
    PRIMARY KEY (season_id, canonical_key),
    UNIQUE (season_id, former_key),
    UNIQUE (match_id, season_id),
    FOREIGN KEY (match_id, season_id) REFERENCES core.matches(id, season_id),
    CHECK (former_id IS NULL OR (former_key IS NOT NULL AND former_id <> match_id))
);
REVOKE ALL ON core.archive_match_attestations FROM PUBLIC, vega_collect, vega_read;
GRANT SELECT, INSERT ON core.archive_match_attestations TO vega_collect;

CREATE FUNCTION core.protect_attested_archive_match() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.season_id NOT BETWEEN 1963 AND 1966 THEN
        RETURN NEW;
    END IF;
    IF NEW.archive_key IS NULL AND (TG_OP = 'INSERT' OR OLD.archive_key IS NULL) THEN
        RETURN NEW;
    END IF;
    -- A legacy INSERT that starts during the transfer must check after the
    -- reviewed transaction commits. The key check alone would race the unique index.
    PERFORM pg_advisory_xact_lock(hashtext('vega.archives.apply'));
    IF EXISTS(
        SELECT 1 FROM core.archive_match_attestations a
        WHERE a.season_id=NEW.season_id AND
          (a.former_key=NEW.archive_key OR
           (a.match_id=NEW.id AND (a.canonical_key IS DISTINCT FROM NEW.archive_key OR a.canonical_date IS DISTINCT FROM NEW.match_date)))
    ) THEN
        RAISE foreign_key_violation USING MESSAGE = 'archive match key or date has an attested replacement';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION core.protect_attested_archive_match() FROM PUBLIC;
CREATE TRIGGER protect_attested_archive_match BEFORE INSERT OR UPDATE OF archive_key,match_date ON core.matches
FOR EACH ROW EXECUTE FUNCTION core.protect_attested_archive_match();

CREATE FUNCTION core.protect_attested_archive_goals() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF EXISTS(SELECT 1 FROM core.archive_match_attestations a WHERE a.season_id=OLD.season_id AND a.match_id=OLD.match_id
              AND a.former_key IS NOT NULL) THEN
        RAISE foreign_key_violation USING MESSAGE = 'reviewed archive goal transfers cannot be removed by a source replay';
    END IF;
    RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION core.protect_attested_archive_goals() FROM PUBLIC;
CREATE TRIGGER protect_attested_archive_goals BEFORE DELETE ON core.match_events
FOR EACH ROW WHEN (OLD.event_type='goal') EXECUTE FUNCTION core.protect_attested_archive_goals();

CREATE VIEW api.archive_match_aliases AS
SELECT season_id, match_id, canonical_key, former_key,
       CASE WHEN former_id IS NOT NULL THEN 'm_v' || lpad(former_id::text, 7, '0') END AS former_public_id,
       proof #>> '{goals_observation,team1}' AS former_home, proof #>> '{goals_observation,team2}' AS former_away
FROM core.archive_match_attestations WHERE former_key IS NOT NULL;
GRANT SELECT ON api.archive_match_aliases TO vega_read;
