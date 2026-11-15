-- A merged team's public id (a link kept from before its merge) reads as the team it is
-- (core.teams.merged_into, 094): 019's function, the pointer followed for a team.
CREATE OR REPLACE FUNCTION api.internal_id(kind core.entity_type, key text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT coalesce(CASE WHEN kind = 'team' THEN (SELECT t.merged_into FROM core.teams t WHERE t.id = x.id) END, x.id) FROM (
    SELECT coalesce(
      (SELECT p.entity_id FROM core.provider_ids p
        WHERE p.entity_type = kind AND p.provider = 'pitchapi' AND p.provider_key = key AND p.is_current),
      CASE WHEN key ~ '^[a-z]_v[0-9]{7}$' THEN substr(key, 4)::integer END) AS id
  ) x WHERE x.id IS NOT NULL AND api.public_id(kind, x.id) = key
$$;

-- The identity pass last succeeded under merges switched off (14-15 November 2026); its next
-- turn is a day later. As a cup source does for a new team (cups.py), it runs at the next pass.
UPDATE ops.source_runs SET last_success_at = NULL WHERE source = 'vega' AND scope = 'team_identity';
