-- A match's public id, for the reads that hold its internal id.
--
-- api.public_id is SECURITY DEFINER, so never inlined: it runs once per row that names
-- it. A page of a whole selection of profiles (GET /api/read/players?detail=profile,
-- 3,000 players) names two matches per player, his most recent row and the most recent
-- one he played: 6,000 calls, 0.36 s on the base on 11 November 2026.
--
-- This view gives the same id by the same rule (the current PitchAPI key, else the Vega
-- key), read from core.provider_ids by a subquery as api.club_match_sides does since
-- 061: a read that does not name the id never runs it. Measured the same day on the
-- 36,841 profiles of every competition of 2026/2027, five runs each in turn: a page
-- 1.11 to 1.13 s with the function, 0.77 to 0.79 s through this view, and the same
-- answer for each of the 36,841 profiles (both read in one snapshot).

CREATE VIEW api.match_keys AS
SELECT m.id AS match_id,
  coalesce((SELECT k.provider_key FROM core.provider_ids k WHERE k.entity_type = 'match' AND k.entity_id = m.id
    AND k.provider = 'pitchapi' AND k.is_current), 'm_v' || lpad(m.id::text, 7, '0')) AS public_id
FROM core.matches m;
GRANT SELECT ON api.match_keys TO vega_read;
