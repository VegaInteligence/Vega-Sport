-- Preserve an observed player identity when the provider has no name or profile.
ALTER TABLE core.players ALTER COLUMN name DROP NOT NULL;
