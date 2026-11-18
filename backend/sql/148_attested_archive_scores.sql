-- Keep the two verified Scottish football scores when a legacy writer replays the raw results.
CREATE FUNCTION core.protect_attested_archive_score() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM core.archive_match_attestations a
        WHERE a.season_id=OLD.season_id AND a.match_id=OLD.id AND a.proof ? 'new_score'
          AND (NEW.home_score IS DISTINCT FROM (a.proof #>> '{new_score,0}')::smallint
               OR NEW.away_score IS DISTINCT FROM (a.proof #>> '{new_score,1}')::smallint)
    ) THEN
        RAISE foreign_key_violation USING MESSAGE = 'the archive score is bound to an independent reviewed score';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION core.protect_attested_archive_score() FROM PUBLIC;
CREATE TRIGGER protect_attested_archive_score BEFORE UPDATE OF home_score,away_score ON core.matches
FOR EACH ROW WHEN (OLD.season_id IN (1924,1946) AND OLD.archive_key IS NOT NULL)
EXECUTE FUNCTION core.protect_attested_archive_score();
