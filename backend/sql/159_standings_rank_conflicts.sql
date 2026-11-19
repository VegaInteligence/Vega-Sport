-- §43.1 (audit E02c): Veikkausliiga 2026's stored SportScore table holds the rows of three phases (ranks
-- 1,1,1,2,2,3,4,4,4,5,6,6 at 22, 27 and 32 matches), written before 10:05 UTC on 19 November 2026 by a writer that
-- merged the widget's three unnamed tables. The writer's rank invariant (sportscore.check) is now read too: within one
-- stored table, clubs sharing a rank have equal points, and an edition's only table holds all its ranks. An edition
-- whose stored rows break it is withheld: its official rows are no authority, Vega's own table is served when there is
-- one, and the edition stays the one /api/standings selects (api.standings_withheld), so a withheld current edition
-- answers 404 rather than the previous season's table. Rows that satisfy the invariant again are served again.
-- Nothing is deleted or rewritten. 147's and 150's J1 exclusion is kept as it is.
SET LOCAL lock_timeout = '3s';

CREATE FUNCTION api.standings_rank_conflicts()
RETURNS TABLE (competition_season_id integer, detail text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH own AS (
    SELECT o.competition_season_id, o.group_name, o.position, o.points
    FROM core.standings_official o WHERE o.source = 'sportscore' AND o.stage IS NULL
  ), conflicts AS (
    SELECT s.competition_season_id, coalesce(s.group_name, 'the table') || ': rank ' || s.position
             || ' shared at different points' AS detail
    FROM own s GROUP BY s.competition_season_id, s.group_name, s.position
    HAVING count(DISTINCT s.points) > 1
    UNION ALL
    SELECT s.competition_season_id, 'the table: rank ' || max(s.position) || ' in a table of ' || count(*) || ' rows'
    FROM own s GROUP BY s.competition_season_id
    HAVING bool_and(s.group_name IS NULL) AND max(s.position) > count(*)
  )
  SELECT c.competition_season_id, string_agg(c.detail, '; ' ORDER BY c.detail)
  FROM conflicts c GROUP BY c.competition_season_id
$$;

-- The editions /api/standings keeps in its selection although it serves none of their official rows: J1's (147,
-- 150) and those whose ranks conflict.
CREATE FUNCTION api.standings_withheld()
RETURNS TABLE (competition_season_id integer, season text, native_label text, is_current boolean, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT x.competition_season_id, x.season, x.native_label, x.is_current, 'j1_calendar' FROM api.j1_standings_exclusion() x
  UNION ALL
  SELECT cs.id, se.label, cs.native_label, cs.is_current, 'rank_conflict: ' || k.detail
  FROM api.standings_rank_conflicts() k
  JOIN core.competition_seasons cs ON cs.id = k.competition_season_id
  JOIN core.seasons se ON se.id = cs.season_id
$$;

CREATE OR REPLACE VIEW api.standings AS
WITH excluded AS MATERIALIZED (
  SELECT competition_season_id FROM api.j1_standings_exclusion()
), conflicted AS MATERIALIZED (
  SELECT competition_season_id FROM api.standings_rank_conflicts()
), authority AS NOT MATERIALIZED (
  SELECT o.* FROM core.standings_official o
  WHERE o.source = 'sportscore' AND o.stage IS NULL
    AND NOT EXISTS (SELECT 1 FROM excluded x WHERE x.competition_season_id = o.competition_season_id)
    -- A table whose ranks contradict themselves is no authority: Vega's own table, if any, is served.
    AND NOT EXISTS (SELECT 1 FROM conflicted k WHERE k.competition_season_id = o.competition_season_id)
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

-- The editions withheld now: their served table changes, so their version moves once.
INSERT INTO ops.resource_versions(resource_kind, resource_id)
SELECT 'competition_season', competition_season_id FROM api.standings_rank_conflicts()
ON CONFLICT (resource_kind, resource_id) DO UPDATE
SET version = ops.resource_versions.version + 1, updated_at = now();
