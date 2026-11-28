-- 28 Nov 2026 (GitHub #278, VI-177), pass H1, after Fable's review (M2; backend/panna/FAILURE_MODES.md GH278-at):
-- the chunk's server verification, and any read of one segment, find its rows by a B-tree on segment_id. The block
-- range indexes of 001 return every range VACUUM has not summarised yet, so each chunk's verification read the whole
-- unsummarised tail of the table, a tail that grows with the backfill (autovacuum summarises an insert-only table
-- after about a fifth of its rows). Measured on 2 093 758 real events: the B-tree is 2.3 % of the table.
--
-- On the empty tables of a first install (production) both builds are instant. On a loaded table the build holds off
-- the loader's writes until it ends, and each DROP INDEX takes the table's lock for an instant; nothing else reads
-- these schemas.
SET LOCAL lock_timeout = '3s';

CREATE INDEX opta_fixtures_segment_id ON panna_data.opta_fixtures (segment_id);
CREATE INDEX opta_events_segment_id ON panna_data.opta_events (segment_id);
DROP INDEX panna_data.opta_fixtures_segment;
DROP INDEX panna_data.opta_events_segment;
