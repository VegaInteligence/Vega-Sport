-- VI-29: J1's 2026/27 table was observed in November 2026 under Vega's native 2027
-- edition (canonical 2027/28). The organiser's 380 fixtures matched the same season:
-- 199 in the native 2026 edition and 181 in the native 2027 edition. A different
-- table, a corrected edition and other competitions remain on migration 138's rules.
SET LOCAL lock_timeout = '3s';

-- The SHA-256 binds the complete table by club, rank, played, W/D/L, goals and points.
-- It matches all 20 captured rows in public reads and in RDS. Match repeat observations
-- before the first native 2027 kickoff, even if the old collector advanced as_of.
CREATE FUNCTION api.j1_standings_exclusion()
RETURNS TABLE (competition_season_id integer, season text, native_label text, is_current boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT cs.id, se.label, cs.native_label, cs.is_current
  FROM core.competition_seasons cs
  JOIN core.seasons se ON se.id = cs.season_id
  JOIN core.standings_official o ON o.competition_season_id = cs.id
  CROSS JOIN LATERAL (SELECT api.public_id('team', o.team_id) AS club) p
  WHERE cs.competition_id = api.internal_id('competition', 'l_2ApGa4')
    AND se.label = '2027/2028' AND cs.native_label = '2027'
    AND o.source = 'sportscore' AND o.stage IS NULL
  GROUP BY cs.id, se.label, cs.native_label, cs.is_current
  HAVING count(*) = 20
     AND bool_and(o.group_name IS NULL AND o.as_of IS NOT NULL AND o.as_of < TIMESTAMPTZ '2027-02-13 11:00:00+00')
     AND encode(sha256(convert_to(string_agg(
           concat_ws('|', p.club, o.position, o.played, o.won, o.drawn, o.lost, o.goals_for, o.goals_against, o.points),
           E'\n' ORDER BY p.club COLLATE "C"), 'UTF8')), 'hex') =
         '9c5678ca3c14db97182f0ce37f629d660b10b8990520b18b141dd4c0d99ead6b'
$$;

CREATE OR REPLACE VIEW api.standings AS
WITH excluded AS MATERIALIZED (
  SELECT competition_season_id FROM api.j1_standings_exclusion()
), authority AS NOT MATERIALIZED (
  SELECT o.* FROM core.standings_official o
  WHERE o.source = 'sportscore' AND o.stage IS NULL
    AND NOT EXISTS (SELECT 1 FROM excluded x WHERE x.competition_season_id = o.competition_season_id)
), unqualified AS NOT MATERIALIZED (
  SELECT e.competition_season_id
  FROM (SELECT DISTINCT o.competition_season_id FROM authority o) e
  WHERE EXISTS (SELECT 1 FROM agg.standings a WHERE a.competition_season_id = e.competition_season_id)
    AND EXISTS (
      SELECT 1
      FROM core.table_results(e.competition_season_id) c
      FULL JOIN (SELECT o.team_id, o.basis, o.as_of FROM authority o
                 WHERE o.competition_season_id = e.competition_season_id) o ON o.team_id = c.team_id
      WHERE o.team_id IS NULL
         OR (o.basis IS NOT NULL AND o.basis IS DISTINCT FROM coalesce(c.results, '{0,0,0,0,0,0}'))
         OR (o.basis IS NULL AND EXISTS (
               SELECT 1 FROM core.matches m LEFT JOIN core.rounds r ON r.id = m.round_id
               WHERE m.competition_season_id = e.competition_season_id AND m.first_finished_at > o.as_of
                 AND m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
                 AND coalesce(r.stage, 'regular') IN ('regular', 'group'))))
), merged AS (
  SELECT o.competition_season_id, o.stage, o.group_name, o.team_id, o.position, o.played, o.won, o.drawn,
    o.lost, o.goals_for, o.goals_against, o.points, o.source::text, o.as_of
  FROM authority o
  WHERE NOT EXISTS (SELECT 1 FROM unqualified u WHERE u.competition_season_id = o.competition_season_id)
  UNION ALL
  SELECT a.competition_season_id, a.stage, a.group_name, a.team_id, a.position, a.played, a.won, a.drawn,
    a.lost, a.goals_for, a.goals_against, a.points, 'vega', a.updated_at
  FROM agg.standings a
  -- The excluded edition's archive is also mispartitioned. It supplies no qualified fallback.
  WHERE NOT EXISTS (SELECT 1 FROM excluded x WHERE x.competition_season_id = a.competition_season_id)
    AND (NOT EXISTS (SELECT 1 FROM authority o WHERE o.competition_season_id = a.competition_season_id)
         OR EXISTS (SELECT 1 FROM unqualified u WHERE u.competition_season_id = a.competition_season_id))
)
SELECT merged.*, api.public_id('team', merged.team_id) AS team_public_id, t.name AS team_name,
  cr.s3_key AS crest_key, z.zone::text AS zone
FROM merged
JOIN core.teams t ON t.id = merged.team_id
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id
LEFT JOIN core.competition_zones z ON z.competition_season_id = merged.competition_season_id
  AND merged.position BETWEEN z.position_from AND z.position_to AND merged.group_name IS NULL;

INSERT INTO ops.resource_versions(resource_kind, resource_id)
SELECT 'competition_season', competition_season_id FROM api.j1_standings_exclusion()
ON CONFLICT (resource_kind, resource_id) DO UPDATE
SET version = ops.resource_versions.version + 1, updated_at = now();
