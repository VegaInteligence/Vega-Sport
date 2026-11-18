-- SportScore official standings (VI-29, docs/calculs/09-audit-2026-11/FAILURE_MODES_SPORTSCORE.md §2).
-- One authority: an edition's official table is SportScore's current table, its rows without a
-- stage. Rows of another provider or of a stage stay stored, are never served, and neither qualify
-- nor disqualify it (on 18 Nov 2026 production held SportScore rows only, none with a stage).
-- That table is served while it is qualified: it holds every club of Vega's own table, and every
-- club's results Vega counts are still those its observation could reflect. Otherwise Vega's own
-- table is served and the official rows stay stored with their dates.
-- api.standings was created by 012 (generated from api_schema.py), which is immutable once applied:
-- this file replaces the view with the same columns, so api.standing_rows (022) and every reader
-- keep their contract.

-- The results a league table counts, per club: {played, won, drawn, lost, goals for, goals
-- against} of the edition's finished matches with both scores, of a regular or group round or of
-- none (the matches of calculator.STANDINGS_SQL). Read by the SportScore writer and by
-- api.standings; as its owner, since a function a view calls runs with the reader's rights.
CREATE FUNCTION core.table_results(edition integer)
RETURNS TABLE (team_id integer, results smallint[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT x.team_id,
    ARRAY[count(*), count(*) FILTER (WHERE x.gf > x.ga), count(*) FILTER (WHERE x.gf = x.ga),
          count(*) FILTER (WHERE x.gf < x.ga), sum(x.gf), sum(x.ga)]::smallint[]
  FROM core.matches m
  LEFT JOIN core.rounds r ON r.id = m.round_id
  CROSS JOIN LATERAL (VALUES (m.home_team_id, m.home_score, m.away_score),
                             (m.away_team_id, m.away_score, m.home_score)) AS x(team_id, gf, ga)
  WHERE m.competition_season_id = edition AND m.status = 'finished'
    AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND x.team_id IS NOT NULL
    AND coalesce(r.stage, 'regular') IN ('regular', 'group')
  GROUP BY x.team_id
$$;

-- What an observation could reflect: the club's counted results when the row was observed. NULL on
-- the rows stored before this migration.
ALTER TABLE core.standings_official
  ADD COLUMN basis smallint[] CHECK (basis IS NULL OR cardinality(basis) = 6);

CREATE OR REPLACE VIEW api.standings AS
WITH authority AS NOT MATERIALIZED (
  -- The standings authority's current table (one row per edition, group and club: the unique key
  -- of core.standings_official). Making another provider the authority is a change of this view.
  SELECT o.* FROM core.standings_official o WHERE o.source = 'sportscore' AND o.stage IS NULL
), unqualified AS NOT MATERIALIZED (
  -- Editions whose official table Vega's own table supersedes: it lacks a club of Vega's table, a
  -- club's counted results moved since its row was observed, or (a row without a basis) a counted
  -- match finished after its observation. Only where Vega's own table exists.
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
  WHERE NOT EXISTS (SELECT 1 FROM authority o WHERE o.competition_season_id = a.competition_season_id)
     OR EXISTS (SELECT 1 FROM unqualified u WHERE u.competition_season_id = a.competition_season_id)
)
SELECT merged.*, api.public_id('team', merged.team_id) AS team_public_id, t.name AS team_name,
  cr.s3_key AS crest_key, z.zone::text AS zone
FROM merged
JOIN core.teams t ON t.id = merged.team_id
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id
LEFT JOIN core.competition_zones z ON z.competition_season_id = merged.competition_season_id
  AND merged.position BETWEEN z.position_from AND z.position_to AND merged.group_name IS NULL;
