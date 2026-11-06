-- Both keys are traversed when replacing an edition. Without leading-key
-- indexes, cascading each match/appearance deletion scans the full child table.
-- The match index also serves the bounded HTTP appearance pages.
CREATE INDEX IF NOT EXISTS app_appearances_match
  ON statarena_app.appearances(match_id, id);
CREATE INDEX IF NOT EXISTS app_match_members_appearance
  ON statarena_app.match_appearance_members(appearance_id);
