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

-- §43.2 (audit E03f, E04d): a nation's match two editions hold. OpenFootball dates a match on its local day, PitchAPI
-- on the UTC day of its kick-off: an evening match in the Americas is one day earlier in the archive, and 120 kept
-- one copy per day only (Argentina's World Cup 2026: 11 matches for 8, Mexico's 9 for 5). A copy is absorbed when a
-- preferred copy of another edition holds the same two teams with the same score by team (two unscored copies agree)
-- one day apart: the native copy first (no cup or archive key), then the lowest id. Copies of one day stay merged as
-- in 120. The kept match takes the round and the penalties of the copies it absorbs when it has none. A match is
-- labelled with its edition's name when the edition has one (cup_name: « World Cup 2026 »), not with the family's
-- competition, which cups.save names after the first edition it imported (« World Cup 1930 »). The list counts the
-- matches the page lists. Nothing is written.
CREATE OR REPLACE FUNCTION api.nation_matches(team_key integer)
RETURNS TABLE(match_id text, match_date date, season text, competition text, edition text, round text, status text,
  collected boolean, home_id text, home_name text, home_image text, away_id text, away_name text, away_image text,
  home_score integer, away_score integer, home_penalties integer, away_penalties integer)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH own AS MATERIALIZED (
    SELECT m.id, m.season_id, m.competition_season_id, m.round_id, m.status, m.home_team_id, m.away_team_id,
      m.home_score, m.away_score, m.home_penalty_score, m.away_penalty_score, coalesce(m.match_date, m.kickoff_at::date) AS d
    FROM core.matches m WHERE m.home_team_id = team_key
    UNION ALL
    SELECT m.id, m.season_id, m.competition_season_id, m.round_id, m.status, m.home_team_id, m.away_team_id,
      m.home_score, m.away_score, m.home_penalty_score, m.away_penalty_score, coalesce(m.match_date, m.kickoff_at::date)
    FROM core.matches m WHERE m.away_team_id = team_key AND m.home_team_id <> team_key
  ), copies AS MATERIALIZED (
    SELECT o.*, cs.cup_key, cs.archive_key, coalesce(cs.cup_name, co.name) AS competition_name, r.name AS round_name,
      cs.cup_key IS NULL AND cs.archive_key IS NULL AS native,
      least(o.home_team_id, o.away_team_id) AS lo, greatest(o.home_team_id, o.away_team_id) AS hi,
      -- Each copy's score and penalties by team: the lower team id's, then the other's.
      CASE WHEN o.home_team_id <= o.away_team_id THEN o.home_score ELSE o.away_score END AS score_lo,
      CASE WHEN o.home_team_id <= o.away_team_id THEN o.away_score ELSE o.home_score END AS score_hi,
      CASE WHEN o.home_team_id <= o.away_team_id THEN o.home_penalty_score ELSE o.away_penalty_score END AS pens_lo,
      CASE WHEN o.home_team_id <= o.away_team_id THEN o.away_penalty_score ELSE o.home_penalty_score END AS pens_hi
    FROM own o
    JOIN core.competition_seasons cs ON cs.id = o.competition_season_id
    JOIN core.competitions co ON co.id = cs.competition_id
    LEFT JOIN core.rounds r ON r.id = o.round_id
  ), absorbed AS MATERIALIZED (
    -- The copy of the day before or after, in another edition, with the same score: absorbed by the preferred one.
    SELECT c.id, k.id AS by_id FROM copies c JOIN copies k
      ON k.lo = c.lo AND k.hi = c.hi AND abs(k.d - c.d) = 1 AND k.competition_season_id <> c.competition_season_id
     AND k.score_lo IS NOT DISTINCT FROM c.score_lo AND k.score_hi IS NOT DISTINCT FROM c.score_hi
     AND (k.native > c.native OR (k.native = c.native AND k.id < c.id))
  ), picked AS (
    SELECT c.*, row_number() OVER w AS pick,
      max(c.round_name) OVER (PARTITION BY coalesce(c.d::text, 'm' || c.id), c.lo, c.hi) AS any_round,
      max(c.pens_lo) OVER (PARTITION BY coalesce(c.d::text, 'm' || c.id), c.lo, c.hi) AS any_pens_lo,
      max(c.pens_hi) OVER (PARTITION BY coalesce(c.d::text, 'm' || c.id), c.lo, c.hi) AS any_pens_hi
    FROM copies c
    WHERE NOT EXISTS (SELECT 1 FROM absorbed a WHERE a.id = c.id)
    WINDOW w AS (
      PARTITION BY coalesce(c.d::text, 'm' || c.id), c.lo, c.hi
      ORDER BY c.native DESC, (c.home_score IS NOT NULL) DESC, c.id
    )
  ), kept AS (
    -- What the copies absorbed by a copy of the kept one's day hold that the kept copy lacks.
    SELECT p.*, coalesce(p.round_name, p.any_round, x.round_name) AS round_kept,
      coalesce(p.any_pens_lo, x.pens_lo) AS pens_lo_kept, coalesce(p.any_pens_hi, x.pens_hi) AS pens_hi_kept
    FROM picked p
    LEFT JOIN LATERAL (
      SELECT max(c.round_name) AS round_name, max(c.pens_lo) AS pens_lo, max(c.pens_hi) AS pens_hi
      FROM absorbed b JOIN copies c ON c.id = b.id JOIN copies s ON s.id = b.by_id
      WHERE s.lo = p.lo AND s.hi = p.hi AND s.d = p.d
    ) x ON true
    WHERE p.pick = 1
  )
  SELECT api.public_id('match', p.id), p.d, se.label, p.competition_name, coalesce(p.cup_key, p.archive_key),
    p.round_kept, p.status::text, p.native,
    api.public_id('team', p.home_team_id), h.name, hc.source_url, api.public_id('team', p.away_team_id), a.name, ac.source_url,
    p.home_score::integer, p.away_score::integer,
    coalesce(p.home_penalty_score, CASE WHEN p.home_team_id = p.lo THEN p.pens_lo_kept ELSE p.pens_hi_kept END)::integer,
    coalesce(p.away_penalty_score, CASE WHEN p.away_team_id = p.lo THEN p.pens_lo_kept ELSE p.pens_hi_kept END)::integer
  FROM kept p
  JOIN core.seasons se ON se.id = p.season_id
  JOIN core.teams h ON h.id = p.home_team_id
  JOIN core.teams a ON a.id = p.away_team_id
  LEFT JOIN core.assets hc ON hc.id = h.crest_asset_id
  LEFT JOIN core.assets ac ON ac.id = a.crest_asset_id
$$;

CREATE OR REPLACE FUNCTION api.nation_list(season_key smallint)
RETURNS TABLE(team_id text, team_key integer, name text, image_url text, matches integer, last_match date,
  elo float8, elo_at date, rank integer, season_elo float8, elo_change float8, season_matches integer,
  wins integer, draws integer, losses integer, result_sum float8, expected_sum float8)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH nations AS MATERIALIZED (
    SELECT t.id, t.name, t.crest_asset_id FROM core.teams t WHERE t.is_national AND t.merged_into IS NULL
  ), games AS MATERIALIZED (
    SELECT g.team, g.d, least(m.home_team_id, m.away_team_id) AS a, greatest(m.home_team_id, m.away_team_id) AS b, m.id AS match,
      m.competition_season_id AS edition, coalesce(cs.cup_key IS NULL AND cs.archive_key IS NULL, true) AS native,
      CASE WHEN m.home_team_id <= m.away_team_id THEN m.home_score ELSE m.away_score END AS score_a,
      CASE WHEN m.home_team_id <= m.away_team_id THEN m.away_score ELSE m.home_score END AS score_b
    FROM (
      SELECT n.id AS team, m.id AS match, coalesce(m.match_date, m.kickoff_at::date) AS d FROM nations n JOIN core.matches m ON m.home_team_id = n.id
      UNION ALL
      SELECT n.id, m.id, coalesce(m.match_date, m.kickoff_at::date) FROM nations n JOIN core.matches m ON m.away_team_id = n.id
    ) g
    JOIN core.matches m ON m.id = g.match
    LEFT JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
  ), played AS MATERIALIZED (
    -- A match without a date is its own match; a copy api.nation_matches absorbs is not counted.
    SELECT g.team, count(DISTINCT coalesce(g.d::text || ':' || g.a || ':' || g.b, 'm' || g.match))::integer AS matches, max(g.d) AS last_match
    FROM games g
    WHERE NOT EXISTS (
      SELECT 1 FROM games k WHERE k.team = g.team AND k.a = g.a AND k.b = g.b AND abs(k.d - g.d) = 1 AND k.edition <> g.edition
        AND k.score_a IS NOT DISTINCT FROM g.score_a AND k.score_b IS NOT DISTINCT FROM g.score_b
        AND (k.native > g.native OR (k.native = g.native AND k.match < g.match)))
    GROUP BY g.team
  )
  SELECT api.public_id('team', n.id), n.id, n.name, cr.source_url, p.matches, p.last_match,
    e.elo_after::numeric::float8, e.kickoff_at::date,
    tp.rank, tp.elo::numeric::float8, tp.elo_change::numeric::float8, tp.matches, tp.wins, tp.draws, tp.losses,
    tp.result_sum::numeric::float8, tp.expected_sum::numeric::float8
  FROM nations n
  JOIN played p ON p.team = n.id
  LEFT JOIN core.assets cr ON cr.id = n.crest_asset_id
  LEFT JOIN LATERAL (
    SELECT x.elo_after, x.kickoff_at FROM agg.team_elo x WHERE x.team_id = n.id ORDER BY x.kickoff_at DESC NULLS LAST LIMIT 1
  ) e ON true
  LEFT JOIN agg.team_power tp ON tp.season_id = season_key AND tp.team_id = n.id AND tp.scope = 'nations'
$$;
