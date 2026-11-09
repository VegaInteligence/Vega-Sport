-- An observed provider team ID can precede its reference profile.
-- Preserve the identity without fabricating a display name.
ALTER TABLE core.teams ALTER COLUMN name DROP NOT NULL;
