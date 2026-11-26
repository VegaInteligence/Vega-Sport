-- 26 Nov 2026 (FAILURE_MODES_OPTIMISATIONS.md GH137M, GitHub #137): /api/matchdays read from the editions asked.
-- The route read api.match_rounds, a view over api.fixtures: to keep one league's season, the planner built every match
-- of the base (a sequential scan of core.matches and its keys), then filtered on the computed league id and season;
-- its validator being the answer's hash, each revalidation paid it (56 a day in production, 254 ms each on average).
-- This function returns the same rows for one league and season: the league's editions first (its current PitchAPI
-- key, else l_v and its id, as api.fixtures names it; never an archive's or a cup's edition) whose season's label or
-- native label is the one asked, then their matches through matches_competition_kickoff, each with its round, its
-- current key (else m_v and its id) and its play-off flag, both looked up by index for each match (OFFSET 0 keeps the
-- lookups per match: estimating ten times the matches the array gives, the planner hashed every round and every match
-- key of the base). A match's season is its edition's (the foreign key of core.matches on (competition_season_id,
-- season_id)). Nothing is written; api.match_rounds stays.
-- vega:online
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION api.matchday_rounds(league text, season text)
RETURNS TABLE(id text, name text, playoff boolean)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH editions AS MATERIALIZED (
    SELECT cs.id
    FROM core.competition_seasons cs
    JOIN core.seasons se ON se.id = cs.season_id
    LEFT JOIN core.provider_ids ck ON ck.entity_type = 'competition' AND ck.entity_id = cs.competition_id
      AND ck.provider = 'pitchapi' AND ck.is_current
    WHERE cs.archive_key IS NULL AND cs.cup_key IS NULL
      AND coalesce(ck.provider_key, 'l_v' || lpad(cs.competition_id::text, 7, '0')) = $1
      AND (se.label = $2 OR cs.native_label = $2)
  )
  SELECT coalesce(k.provider_key, 'm_v' || lpad(m.id::text, 7, '0')), r.name,
    coalesce(m.has_playoff, false) OR coalesce(r.stage = 'playoff', false)
  FROM core.matches m
  CROSS JOIN LATERAL (SELECT r.name, r.stage FROM core.rounds r WHERE r.id = m.round_id OFFSET 0) r
  LEFT JOIN LATERAL (
    SELECT mk.provider_key FROM core.provider_ids mk
    WHERE mk.entity_type = 'match' AND mk.entity_id = m.id AND mk.provider = 'pitchapi' AND mk.is_current OFFSET 0) k ON true
  WHERE m.competition_season_id = ANY (ARRAY(SELECT e.id FROM editions e))
$$;

REVOKE ALL ON FUNCTION api.matchday_rounds(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.matchday_rounds(text, text) TO vega_read;
