-- Preserve native source scalars without changing the deployed appearance layout.
CREATE TABLE IF NOT EXISTS statarena_app.appearance_shirt_numbers (
    appearance_id text PRIMARY KEY REFERENCES statarena_app.appearances(id) ON DELETE CASCADE,
    value_text text,
    value_type text NOT NULL CHECK (value_type IN ('str', 'int', 'float', 'bool', 'NoneType')),
    CHECK ((value_text IS NULL) = (value_type = 'NoneType'))
);

-- Existing source digests predate native scalar delivery. Rebuild those rows
-- through the normal worker instead of inventing source types from doubles.
INSERT INTO statarena_app.publication_jobs(season, league_id)
SELECT DISTINCT season, league_id FROM statarena_app.appearances a
WHERE NOT EXISTS (
    SELECT 1 FROM statarena_app.appearance_shirt_numbers s WHERE s.appearance_id=a.id
)
ON CONFLICT DO NOTHING;
