-- VI-29: strengthen qualification without rewriting the official archive or prior migrations.
SET LOCAL lock_timeout = '3s';

ALTER TABLE ops.source_runs
  ADD COLUMN detail text,
  ADD COLUMN repeats integer NOT NULL DEFAULT 0 CHECK (repeats >= 0);

-- Record the editions already unavailable under 147 so only a read change advances the version.
CREATE TEMP TABLE previous_j1_standings_exclusion ON COMMIT DROP AS
SELECT competition_season_id FROM api.j1_standings_exclusion();

-- J1's 2026/27 calendar was split between native 2026 and 2027. The canonical 2027/28
-- association below is disputed, so neither its official rows nor its calculated rows can serve.
-- A fresh timestamp, a changed club key or a new result cannot repair that association.
-- VI-21 must attest both the corrected calendar/edition and the accepted observation before
-- restoring this selector. If these labels must remain, release requires a forward migration.
CREATE OR REPLACE FUNCTION api.j1_standings_exclusion()
RETURNS TABLE (competition_season_id integer, season text, native_label text, is_current boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT cs.id, se.label, cs.native_label, cs.is_current
  FROM core.competition_seasons cs
  JOIN core.seasons se ON se.id = cs.season_id
  WHERE cs.competition_id = api.internal_id('competition', 'l_2ApGa4')
    AND se.label = '2027/2028' AND cs.native_label = '2027'
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
      WITH counted AS MATERIALIZED (
        SELECT team_id, results FROM core.table_results(e.competition_season_id)
      ), calculated AS (
        SELECT a.team_id, ARRAY[sum(a.played), sum(a.won), sum(a.drawn), sum(a.lost),
                                sum(a.goals_for), sum(a.goals_against)] AS results
        FROM agg.standings a WHERE a.competition_season_id = e.competition_season_id
        GROUP BY a.team_id
      ), officials AS NOT MATERIALIZED (
        SELECT * FROM authority o WHERE o.competition_season_id = e.competition_season_id
      )
      SELECT 1
      -- An aggregate built before a finished or corrected result is not a current fallback.
      WHERE NOT EXISTS (
        SELECT 1 FROM counted c FULL JOIN calculated a USING (team_id)
        WHERE (c.results::bigint[]) IS DISTINCT FROM a.results
      )
      -- Keep a table the native fixture inventory was already too short to supersede. An
      -- annulment can legitimately lower the count of a club whose earlier basis covered it.
      AND NOT EXISTS (
        SELECT 1 FROM officials o LEFT JOIN counted c USING (team_id)
        WHERE o.played > coalesce(c.results[1], 0) AND (o.basis IS NULL OR o.played > o.basis[1])
      )
      AND EXISTS (
        SELECT 1 FROM counted c FULL JOIN officials o USING (team_id)
        WHERE o.team_id IS NULL
          OR (
            -- An official row already reflects the current results when all its known fields agree.
            EXISTS (
              SELECT 1 FROM unnest(
                ARRAY[o.played, o.won, o.drawn, o.lost, o.goals_for, o.goals_against],
                coalesce(c.results, '{0,0,0,0,0,0}')
              ) AS s(official, native)
              WHERE s.official IS NOT NULL AND s.official <> s.native
            )
            AND ((o.basis IS NOT NULL AND o.basis IS DISTINCT FROM coalesce(c.results, '{0,0,0,0,0,0}'))
              OR (o.basis IS NULL AND EXISTS (
                SELECT 1 FROM core.matches m LEFT JOIN core.rounds r ON r.id = m.round_id
                WHERE m.competition_season_id = e.competition_season_id AND m.first_finished_at > o.as_of
                  AND m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
                  AND coalesce(r.stage, 'regular') IN ('regular', 'group'))))
          )
      )
    )
), merged AS (
  SELECT o.competition_season_id, o.stage, o.group_name, o.team_id, o.position, o.played, o.won, o.drawn,
    o.lost, o.goals_for, o.goals_against, o.points, o.source::text, o.as_of
  FROM authority o
  WHERE NOT EXISTS (SELECT 1 FROM unqualified u WHERE u.competition_season_id = o.competition_season_id)
  UNION ALL
  SELECT a.competition_season_id, a.stage, a.group_name, a.team_id, a.position, a.played, a.won, a.drawn,
    a.lost, a.goals_for, a.goals_against, a.points, 'vega', a.updated_at
  FROM agg.standings a
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
WHERE competition_season_id NOT IN (SELECT competition_season_id FROM previous_j1_standings_exclusion)
ON CONFLICT (resource_kind, resource_id) DO UPDATE
SET version = ops.resource_versions.version + 1, updated_at = now();
