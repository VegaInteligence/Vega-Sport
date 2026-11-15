-- A team merged into another (vega/sources/identity.py, vega/sources/uefa.py) stays as a
-- pointer to the team it is, with nothing left naming it: removing its row made PostgreSQL
-- read, for each team, every table naming teams that has no index on them (38 columns, about
-- 40 million rows on 14 November 2026), and a set of a hundred teams ran for hours.
-- Waits 3 s at most for the table: a migration queued behind a long writer would hold every
-- read of core.teams behind it.
SET LOCAL lock_timeout = '3s';
ALTER TABLE core.teams ADD COLUMN merged_into integer REFERENCES core.teams(id) CHECK (merged_into <> id);
CREATE INDEX teams_merged_into ON core.teams(merged_into) WHERE merged_into IS NOT NULL;
