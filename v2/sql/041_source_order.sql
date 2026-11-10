-- The archive sources in the order the archive index lists them (main's catalogue shows
-- them in that order; v2 sorted them by key). Sources other than the archives have none.
ALTER TABLE core.source_revisions ADD COLUMN position smallint;
CREATE OR REPLACE VIEW api.source_revisions AS SELECT * FROM core.source_revisions;
