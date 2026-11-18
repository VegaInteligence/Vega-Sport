-- Bind the public alias to its physical archive target and exclude active former rows (VI-27).
SET LOCAL lock_timeout = '3s';

CREATE FUNCTION core.archive_attestation_matches_rows(a core.archive_match_attestations)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM core.matches m
        WHERE m.season_id=a.season_id AND m.id=a.match_id
          AND m.archive_key=a.canonical_key AND m.match_date=a.canonical_date
    )
    AND (
        a.former_key IS NULL OR NOT EXISTS (
            SELECT 1 FROM core.matches m
            WHERE m.season_id=a.season_id AND m.archive_key=a.former_key
        )
    )
    AND (
        a.former_id IS NULL OR (
            NOT EXISTS (SELECT 1 FROM core.matches m WHERE m.id=a.former_id)
            AND EXISTS (
                SELECT 1 FROM ops.archive_removals r
                WHERE r.kind='match' AND r.season_id=a.season_id AND r.id=a.former_id
                  AND r.archive_key=a.former_key
            )
        )
    )
$$;
REVOKE ALL ON FUNCTION core.archive_attestation_matches_rows(core.archive_match_attestations) FROM PUBLIC;

-- The local candidate can already hold completed decisions. Verify the same contract on upgrade.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM core.archive_match_attestations a WHERE NOT core.archive_attestation_matches_rows(a)
    ) THEN
        RAISE foreign_key_violation USING MESSAGE = 'an existing archive attestation conflicts with active matches';
    END IF;
END
$$;

CREATE FUNCTION core.enforce_archive_attestation_rows() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.former_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('vega.archives.apply'));
    END IF;
    PERFORM 1 FROM core.matches m WHERE m.season_id=NEW.season_id AND m.id=NEW.match_id FOR SHARE;
    IF NOT core.archive_attestation_matches_rows(NEW) THEN
        RAISE foreign_key_violation USING MESSAGE = 'the archive attestation does not match the target or names an active former match';
    END IF;
    RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION core.enforce_archive_attestation_rows() FROM PUBLIC;
CREATE TRIGGER enforce_archive_attestation_rows BEFORE INSERT OR UPDATE ON core.archive_match_attestations
FOR EACH ROW EXECUTE FUNCTION core.enforce_archive_attestation_rows();
