-- A team merged into another (vega/sources/identity.py, vega/sources/uefa.py) stays as a
-- pointer to the team it is, with nothing left naming it: removing its row made PostgreSQL
-- read, for each team, every table naming teams that has no index on them (38 columns, about
-- 40 million rows on 14 November 2026), and a set of a hundred teams ran for hours.
-- Waits 3 s at most for the table: a migration queued behind a long writer would hold every
-- read of core.teams behind it.
SET LOCAL lock_timeout = '3s';
ALTER TABLE core.teams ADD COLUMN merged_into integer REFERENCES core.teams(id) CHECK (merged_into <> id);
CREATE INDEX teams_merged_into ON core.teams(merged_into) WHERE merged_into IS NOT NULL;

-- A merged team is no longer one to find by name (012's view, the merged rows left out).
CREATE OR REPLACE VIEW api.search AS
SELECT n.entity_type::text AS entity_type, n.entity_id, api.public_id(n.entity_type, n.entity_id) AS public_id,
  n.name, n.normalized, n.kind::text AS name_kind
FROM core.entity_names n
UNION ALL
SELECT 'player', p.id, api.public_id('player', p.id), p.name, lower(p.name), 'official'
FROM core.players p WHERE p.name IS NOT NULL
UNION ALL
SELECT 'team', t.id, api.public_id('team', t.id), t.name, lower(t.name), 'official' FROM core.teams t WHERE t.merged_into IS NULL
UNION ALL
SELECT 'competition', c.id, api.public_id('competition', c.id), c.name, lower(c.name), 'official'
FROM core.competitions c;
