-- A player's honours as the Honours section of his English Wikipedia article lists them
-- (main's dashboard/scripts/player_honours.py, reused as it is): title, team (none for an
-- individual award) and the seasons as written ("2014–15"). A dated, identity-checked
-- source, not a complete career: an empty section is never "no honour".
CREATE TABLE core.player_honour_titles(
  player_id integer NOT NULL REFERENCES core.players ON DELETE CASCADE,
  seq smallint NOT NULL CHECK (seq >= 0),
  category text NOT NULL CHECK (category IN ('team', 'individual')),
  name text NOT NULL CHECK (btrim(name) <> ''),
  team text,
  seasons text[] NOT NULL CHECK (cardinality(seasons) > 0),
  PRIMARY KEY (player_id, seq),
  CHECK ((category = 'individual') = (team IS NULL))
);
ALTER TABLE core.players
  ADD COLUMN honours_source_url text CHECK (honours_source_url LIKE 'https://en.wikipedia.org/%'),
  ADD COLUMN honours_revision bigint,
  ADD COLUMN honours_fetched_at timestamptz,
  ADD COLUMN honours_checked_at timestamptz;

CREATE VIEW api.player_honours AS
SELECT p.id AS player_id, api.public_id('player', p.id) AS public_id, w.provider_key AS wikidata_id,
  p.honours_source_url AS source_url, p.honours_revision AS revision, p.honours_fetched_at AS fetched_at,
  coalesce((SELECT json_agg(json_build_object('name', t.name, 'team', t.team, 'category', t.category, 'seasons', t.seasons) ORDER BY t.seq)
            FROM core.player_honour_titles t WHERE t.player_id = p.id), '[]'::json) AS honours
FROM core.players p
JOIN core.provider_ids w ON w.entity_type = 'player' AND w.entity_id = p.id AND w.provider = 'wikidata' AND w.is_current
WHERE p.honours_fetched_at IS NOT NULL;
