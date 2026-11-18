-- VI-29, read-only measure before rollout (not executed by the implementer): what migration 138 and the
-- new writer would do to production as it stands. SELECT only; core.table_results is inlined because
-- it does not exist before 138. One row per edition holding official rows.
--   authority_rows / other_rows: rows 138 serves (SportScore, no stage) / rows it keeps but never serves
--   tables: distinct table names of the authority's rows
--   vega_clubs_missing: clubs with counted results absent from the official table (138: Vega served)
--   legacy_behind: a counted match first finished after the official as_of (rows without a basis,
--                  which is every production row before 138: Vega served until the next valid repeat)
--   served_after_138: what api.standings would serve right after the migration
--   every_club_ahead: rule 11 would refuse the current SportScore table (every club > kicked off + 4)
WITH counted AS (
  SELECT m.competition_season_id, x.team_id, count(*) AS played
  FROM core.matches m
  LEFT JOIN core.rounds r ON r.id = m.round_id
  CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) AS x(team_id)
  WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND x.team_id IS NOT NULL
    AND coalesce(r.stage, 'regular') IN ('regular', 'group')
    AND m.competition_season_id IN (SELECT DISTINCT competition_season_id FROM core.standings_official)
  GROUP BY 1, 2
), kicked AS (
  SELECT m.competition_season_id, x.team_id, count(*) AS kicked_off
  FROM core.matches m
  LEFT JOIN core.rounds r ON r.id = m.round_id
  CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) AS x(team_id)
  WHERE m.kickoff_at <= now() AND x.team_id IS NOT NULL AND coalesce(r.stage, 'regular') IN ('regular', 'group')
    AND m.competition_season_id IN (SELECT DISTINCT competition_season_id FROM core.standings_official)
  GROUP BY 1, 2
), editions AS (
  SELECT o.competition_season_id,
    count(*) FILTER (WHERE o.source = 'sportscore' AND o.stage IS NULL) AS authority_rows,
    count(*) FILTER (WHERE NOT (o.source = 'sportscore' AND o.stage IS NULL)) AS other_rows,
    count(DISTINCT coalesce(o.group_name, '')) FILTER (WHERE o.source = 'sportscore' AND o.stage IS NULL) AS tables,
    min(o.as_of) FILTER (WHERE o.source = 'sportscore' AND o.stage IS NULL) AS as_of
  FROM core.standings_official o
  GROUP BY 1
)
SELECT e.competition_season_id, c.name AS competition, cs.native_label, cs.is_current,
  e.authority_rows, e.other_rows, e.tables, e.as_of,
  (SELECT count(*) FROM counted k WHERE k.competition_season_id = e.competition_season_id AND NOT EXISTS (
     SELECT 1 FROM core.standings_official o WHERE o.competition_season_id = k.competition_season_id
       AND o.team_id = k.team_id AND o.source = 'sportscore' AND o.stage IS NULL)) AS vega_clubs_missing,
  EXISTS (SELECT 1 FROM core.matches m LEFT JOIN core.rounds r ON r.id = m.round_id
          WHERE m.competition_season_id = e.competition_season_id AND m.first_finished_at > e.as_of
            AND m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
            AND coalesce(r.stage, 'regular') IN ('regular', 'group')) AS legacy_behind,
  EXISTS (SELECT 1 FROM agg.standings a WHERE a.competition_season_id = e.competition_season_id) AS vega_table,
  CASE WHEN e.authority_rows = 0 THEN 'Vega (no authority rows)'
       WHEN NOT EXISTS (SELECT 1 FROM agg.standings a WHERE a.competition_season_id = e.competition_season_id) THEN 'SportScore (no Vega table)'
       WHEN (SELECT count(*) FROM counted k WHERE k.competition_season_id = e.competition_season_id AND NOT EXISTS (
               SELECT 1 FROM core.standings_official o WHERE o.competition_season_id = k.competition_season_id
                 AND o.team_id = k.team_id AND o.source = 'sportscore' AND o.stage IS NULL)) > 0 THEN 'Vega (incomplete)'
       WHEN EXISTS (SELECT 1 FROM core.matches m LEFT JOIN core.rounds r ON r.id = m.round_id
                    WHERE m.competition_season_id = e.competition_season_id AND m.first_finished_at > e.as_of
                      AND m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
                      AND coalesce(r.stage, 'regular') IN ('regular', 'group')) THEN 'Vega (behind, until the next valid repeat)'
       ELSE 'SportScore' END AS served_after_138,
  NOT EXISTS (SELECT 1 FROM core.standings_official o
              LEFT JOIN kicked k ON k.competition_season_id = o.competition_season_id AND k.team_id = o.team_id
              WHERE o.competition_season_id = e.competition_season_id AND o.source = 'sportscore' AND o.stage IS NULL
                AND o.played <= coalesce(k.kicked_off, 0) + 4) AS every_club_ahead
FROM editions e
JOIN core.competition_seasons cs ON cs.id = e.competition_season_id
JOIN core.competitions c ON c.id = cs.competition_id
ORDER BY served_after_138, e.competition_season_id
