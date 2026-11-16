-- The nation pages (VI-18, 16 Nov 2026): the national teams and one nation's page, read from the
-- base as it is. Each read is a function bound to one season or one team, like 117. Nothing is
-- written: a national team a source names otherwise (« Italie », « Grèce » of the Nations League)
-- is still its own team here; the identity pass (vega/sources/identity.py) is where it would join.

-- 1. Every national team that played a match the base holds (a merged row aside): how many
-- distinct matches (a match held twice, collected and archived, counts once), its last match,
-- its latest Elo, and its place in the season's nations power ranking when it has one.
CREATE FUNCTION api.nation_list(season_key smallint)
RETURNS TABLE(team_id text, team_key integer, name text, image_url text, matches integer, last_match date,
  elo float8, elo_at date, rank integer, season_elo float8, elo_change float8, season_matches integer,
  wins integer, draws integer, losses integer, result_sum float8, expected_sum float8)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH nations AS MATERIALIZED (
    SELECT t.id, t.name, t.crest_asset_id FROM core.teams t WHERE t.is_national AND t.merged_into IS NULL
  ), games AS MATERIALIZED (
    SELECT n.id AS team, coalesce(m.match_date, m.kickoff_at::date) AS d,
      least(m.home_team_id, m.away_team_id) AS a, greatest(m.home_team_id, m.away_team_id) AS b, m.id AS match
    FROM nations n JOIN core.matches m ON m.home_team_id = n.id
    UNION ALL
    SELECT n.id, coalesce(m.match_date, m.kickoff_at::date),
      least(m.home_team_id, m.away_team_id), greatest(m.home_team_id, m.away_team_id), m.id
    FROM nations n JOIN core.matches m ON m.away_team_id = n.id
  ), played AS MATERIALIZED (
    -- A match without a date is its own match.
    SELECT team, count(DISTINCT coalesce(d::text || ':' || a || ':' || b, 'm' || match))::integer AS matches, max(d) AS last_match
    FROM games GROUP BY team
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

-- 2. A nation's matches, every competition and every era: a match held twice (a collected match
-- and its copy in a cup or history archive, same day and same two teams) is kept once, the
-- collected one first, then the one with a score. `collected`: the site has the match's page.
CREATE FUNCTION api.nation_matches(team_key integer)
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
  ), picked AS (
    SELECT o.*, cs.cup_key, cs.archive_key, co.name AS competition_name,
      row_number() OVER (
        PARTITION BY coalesce(o.d::text, 'm' || o.id), least(o.home_team_id, o.away_team_id), greatest(o.home_team_id, o.away_team_id)
        ORDER BY (cs.cup_key IS NULL AND cs.archive_key IS NULL) DESC, (o.home_score IS NOT NULL) DESC, o.id
      ) AS pick
    FROM own o
    JOIN core.competition_seasons cs ON cs.id = o.competition_season_id
    JOIN core.competitions co ON co.id = cs.competition_id
  )
  SELECT api.public_id('match', p.id), p.d, se.label, p.competition_name, coalesce(p.cup_key, p.archive_key), r.name,
    p.status::text, p.cup_key IS NULL AND p.archive_key IS NULL,
    api.public_id('team', p.home_team_id), h.name, hc.source_url, api.public_id('team', p.away_team_id), a.name, ac.source_url,
    p.home_score::integer, p.away_score::integer, p.home_penalty_score::integer, p.away_penalty_score::integer
  FROM picked p
  JOIN core.seasons se ON se.id = p.season_id
  JOIN core.teams h ON h.id = p.home_team_id
  JOIN core.teams a ON a.id = p.away_team_id
  LEFT JOIN core.assets hc ON hc.id = h.crest_asset_id
  LEFT JOIN core.assets ac ON ac.id = a.crest_asset_id
  LEFT JOIN core.rounds r ON r.id = p.round_id
  WHERE p.pick = 1
$$;

-- 3. A nation's Elo after each of its matches the ranking read, oldest first.
CREATE FUNCTION api.nation_elo(team_key integer)
RETURNS TABLE(match_date date, elo float8, result float8)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.kickoff_at::date, e.elo_after::numeric::float8, e.result::numeric::float8
  FROM agg.team_elo e WHERE e.team_id = team_key ORDER BY e.kickoff_at NULLS FIRST, e.match_id
$$;

-- 4. The players of a nation's latest edition with player statistics (the World Cup 2026 for the
-- 48 nations that played it): their matches, minutes, goals, assists and xG there, and the club
-- they last played for.
CREATE FUNCTION api.nation_players(team_key integer)
RETURNS TABLE(competition text, edition text, last_date date, player_id text, name text, image_url text,
  position_id integer, matches integer, minutes integer, goals integer, assists integer, xg float8,
  club_id text, club_name text, club_image text)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH games AS MATERIALIZED (
    SELECT m.id, m.season_id, m.competition_season_id, coalesce(m.match_date, m.kickoff_at::date) AS d
    FROM core.matches m WHERE m.home_team_id = team_key
    UNION ALL
    SELECT m.id, m.season_id, m.competition_season_id, coalesce(m.match_date, m.kickoff_at::date)
    FROM core.matches m WHERE m.away_team_id = team_key AND m.home_team_id <> team_key
  ), stats AS MATERIALIZED (
    SELECT s.player_id, s.minutes_played, s.goals, s.assists, s.xg, g.competition_season_id, g.d
    FROM games g
    JOIN core.player_match_stats s ON s.season_id = g.season_id AND s.match_id = g.id AND s.team_id = team_key
    WHERE coalesce(s.minutes_played, 0) > 0
  ), edition AS MATERIALIZED (
    SELECT competition_season_id, max(d) AS last_date FROM stats GROUP BY 1 ORDER BY max(d) DESC NULLS LAST LIMIT 1
  )
  SELECT co.name, coalesce(cs.cup_key, cs.archive_key), e.last_date,
    api.public_id('player', pl.id), pl.name, ph.source_url, pl.position_id::integer,
    count(*)::integer, sum(st.minutes_played)::integer, coalesce(sum(st.goals), 0)::integer,
    coalesce(sum(st.assists), 0)::integer, sum(st.xg)::numeric::float8,
    api.public_id('team', club.team_id), club.name, club.image
  FROM edition e
  JOIN stats st ON st.competition_season_id = e.competition_season_id
  JOIN core.competition_seasons cs ON cs.id = e.competition_season_id
  JOIN core.competitions co ON co.id = cs.competition_id
  JOIN core.players pl ON pl.id = st.player_id
  LEFT JOIN core.assets ph ON ph.id = pl.photo_asset_id
  LEFT JOIN LATERAL (
    SELECT s2.team_id, t2.name, c2.source_url AS image
    FROM core.player_match_stats s2
    JOIN core.teams t2 ON t2.id = s2.team_id AND t2.is_national IS NOT TRUE
    JOIN core.matches m2 ON m2.season_id = s2.season_id AND m2.id = s2.match_id
    LEFT JOIN core.assets c2 ON c2.id = t2.crest_asset_id
    WHERE s2.player_id = pl.id
    ORDER BY m2.kickoff_at DESC NULLS LAST LIMIT 1
  ) club ON true
  GROUP BY co.name, cs.cup_key, cs.archive_key, e.last_date, pl.id, pl.name, ph.source_url, pl.position_id,
    club.team_id, club.name, club.image
  ORDER BY sum(st.minutes_played) DESC, pl.id
$$;

REVOKE ALL ON FUNCTION api.nation_list(smallint), api.nation_matches(integer), api.nation_elo(integer),
  api.nation_players(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.nation_list(smallint), api.nation_matches(integer), api.nation_elo(integer),
  api.nation_players(integer) TO vega_read;
