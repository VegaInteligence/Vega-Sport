-- The national teams' results of the home's week (GET /api/read/home, routes/home.mjs; the user, 19 Nov 2026: during
-- the international break the strip shows the national teams first). Read from the national editions the base holds:
-- every international of the season (nations-results:internationals, outside the Elo), International Results'
-- Nations League and OpenLigaDB's. A match two editions hold (same day, same two teams once merged) is OpenLigaDB's.
-- Each day keeps its eight strongest pairs (the two sides' mean latest Elo; a side without one counts as the week's
-- weakest rated side), the four latest days of the week up to today. `*_page`: the side is a national team, so it
-- has its nation page.
SET LOCAL lock_timeout = '3s';

CREATE FUNCTION api.home_internationals(start_day date, end_day date)
RETURNS TABLE(match_id text, match_date date, tournament text, home_id text, home_name text, home_score integer,
  home_page boolean, away_id text, away_name text, away_score integer, away_page boolean)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH editions AS MATERIALIZED (
    SELECT cs.id, split_part(cs.cup_key, ':', 2) AS competition, left(cs.cup_key, 11) = 'openligadb:' AS fast
    FROM core.competition_seasons cs
    WHERE cs.cup_key LIKE 'nations-results:%' OR cs.cup_key LIKE 'openligadb:nations-league:%'
  ), played AS MATERIALIZED (
    SELECT m.id, coalesce(m.match_date, (m.kickoff_at AT TIME ZONE 'Europe/Paris')::date) AS d,
      coalesce(h.merged_into, h.id) AS home, coalesce(a.merged_into, a.id) AS away, m.home_score, m.away_score,
      CASE WHEN e.competition = 'nations-league' THEN 'UEFA Nations League'
           WHEN e.competition = 'internationals' THEN r.name ELSE cs.cup_name END AS tournament, e.fast
    FROM editions e
    JOIN core.competition_seasons cs ON cs.id = e.id
    JOIN core.matches m ON m.competition_season_id = e.id
    JOIN core.teams h ON h.id = m.home_team_id
    JOIN core.teams a ON a.id = m.away_team_id
    LEFT JOIN core.rounds r ON r.id = m.round_id
    WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
      AND coalesce(m.match_date, (m.kickoff_at AT TIME ZONE 'Europe/Paris')::date) BETWEEN start_day AND end_day
  ), once AS (
    SELECT DISTINCT ON (p.d, least(p.home, p.away), greatest(p.home, p.away)) p.*
    FROM played p ORDER BY p.d, least(p.home, p.away), greatest(p.home, p.away), p.fast DESC, p.id
  ), elo AS MATERIALIZED (
    SELECT o.*, eh.elo AS home_elo, ea.elo AS away_elo
    FROM once o
    LEFT JOIN LATERAL (SELECT x.elo_after::float8 AS elo FROM agg.team_elo x WHERE x.team_id = o.home
      ORDER BY x.kickoff_at DESC NULLS LAST LIMIT 1) eh ON true
    LEFT JOIN LATERAL (SELECT x.elo_after::float8 AS elo FROM agg.team_elo x WHERE x.team_id = o.away
      ORDER BY x.kickoff_at DESC NULLS LAST LIMIT 1) ea ON true
  ), strength AS (
    -- A side without an Elo (a nation the Elo never read) counts as the week's weakest rated side.
    SELECT e.*, (coalesce(e.home_elo, w.low) + coalesce(e.away_elo, w.low)) / 2 AS mean
    FROM elo e CROSS JOIN (SELECT min(least(home_elo, away_elo)) AS low FROM elo) w
  ), ranked AS (
    SELECT s.*, dense_rank() OVER (ORDER BY s.d DESC) AS day_number,
      row_number() OVER (PARTITION BY s.d ORDER BY s.mean DESC NULLS LAST, s.id) AS daily_number
    FROM strength s
  )
  SELECT api.public_id('match', k.id), k.d, k.tournament,
    api.public_id('team', k.home), h.name, k.home_score::integer, coalesce(h.is_national, false),
    api.public_id('team', k.away), a.name, k.away_score::integer, coalesce(a.is_national, false)
  FROM ranked k
  JOIN core.teams h ON h.id = k.home
  JOIN core.teams a ON a.id = k.away
  WHERE k.day_number <= 4 AND k.daily_number <= 8
  ORDER BY k.d DESC, k.daily_number
$$;

REVOKE ALL ON FUNCTION api.home_internationals(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.home_internationals(date, date) TO vega_read;
