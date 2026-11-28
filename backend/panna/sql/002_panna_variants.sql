-- 28 Nov 2026 (GitHub #278, VI-177), pass H1: the source types a load converted, and each stream's current
-- generation (backend/panna/FAILURE_MODES.md GH278-am to aq). Added as its own file: 001 may already be applied.
--
-- conversions: for each column a file stored in another type than the dataset's, {from, to, rule}. One rule exists:
-- a double into a bigint column when every value is an exact integer within ±2^53 (not NaN, ±inf or -0.0), so that
-- `column::double precision` gives the source's values back. The receipt keeps the file's own schema.
SET LOCAL lock_timeout = '3s';

ALTER TABLE panna.loads ADD COLUMN conversions jsonb CHECK (conversions IS NULL OR jsonb_typeof(conversions) = 'object');

-- Each stream's latest complete generation, with the number of segments its current state holds (0 for a generation
-- whose rows were all out of the window, deferred or unresolved, or whose keys are gone). A stream whose latest
-- generation failed or was refused shows its last complete one; a stream never completed is absent.
CREATE VIEW panna.current_generations AS
SELECT s.origin, s.container, s.name, s.dataset, g.load_id, g.as_of, g.completed_at, r.sha256, r.source_rows, g.outcomes,
       g.conversions,
       (SELECT count(*) FROM (SELECT DISTINCT ON (m.key) m.segment_id
                              FROM panna.manifest m JOIN panna.loads ml ON ml.load_id = m.load_id
                              WHERE m.stream_id = s.stream_id AND ml.status = 'complete'
                              ORDER BY m.key, m.load_id DESC) c
        WHERE c.segment_id IS NOT NULL) AS segments
FROM panna.streams s
JOIN LATERAL (SELECT l.load_id, l.receipt_id, l.as_of, l.completed_at, l.outcomes, l.conversions
              FROM panna.loads l WHERE l.stream_id = s.stream_id AND l.status = 'complete'
              ORDER BY l.load_id DESC LIMIT 1) g ON true
JOIN panna.receipts r ON r.receipt_id = g.receipt_id;

GRANT SELECT ON panna.current_generations TO vega_panna;
