-- Remove the nine reserved scoring/model tables requested for retirement.
-- Run in one transaction, after recording the production backup/snapshot.
-- Never removes populated tables or cascades into other application objects.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(20261104, 2);
DO $retire$
DECLARE
    names constant text[] := ARRAY[
        'analytics.feature_versions',
        'analytics.scouting_features',
        'analytics.model_versions',
        'analytics.scoring_runs',
        'analytics.player_match_scores',
        'analytics.team_match_scores',
        'analytics.player_window_scores',
        'analytics.scoring_run_ranking_inputs',
        'analytics.published_score_runs'
    ];
    target text;
    existing text[] := ARRAY[]::text[];
    populated boolean;
    kind "char";
BEGIN
    FOREACH target IN ARRAY names LOOP
        IF to_regclass(target) IS NOT NULL THEN
            SELECT relkind INTO kind FROM pg_class WHERE oid = to_regclass(target);
            IF kind NOT IN ('r', 'p') THEN
                RAISE EXCEPTION 'Reserved name % is not an ordinary table', target;
            END IF;
            -- Close the race between checking emptiness and removing the table.
            EXECUTE 'LOCK TABLE ' || target || ' IN ACCESS EXCLUSIVE MODE';
            existing := array_append(existing, target);
        END IF;
    END LOOP;
    FOREACH target IN ARRAY existing LOOP
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM ' || target || ' LIMIT 1)' INTO populated;
        IF populated THEN
            RAISE EXCEPTION 'Refusing to remove populated model table %', target;
        END IF;
    END LOOP;
    IF cardinality(existing) > 0 THEN
        -- Dropping the set together permits its internal foreign keys. RESTRICT
        -- rejects any view or foreign key outside this explicitly named set.
        EXECUTE 'DROP TABLE ' || array_to_string(existing, ', ') || ' RESTRICT';
    END IF;
END
$retire$;
