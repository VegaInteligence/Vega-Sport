-- /api/league-history's reads (164, 165), their rows unchanged (FAILURE_MODES_OPTIMISATIONS.md, GH137-k). Nothing is written.
--
-- - api.league_history_next: planned as a hash join on the editions it kept, it read the whole core.matches table
--   twice (a sequential scan for the home sides, another for the away sides) to keep the matches of three editions:
--   65 % of the read on a local archive of 157 000 matches, and more as the base grows. The kept editions' ids, given
--   as an array, let the scan take them at matches_competition_kickoff; both sides of a match in one pass.
-- - api.league_history_matches, _players, _scorers: api.league_history_team (a SECURITY DEFINER function, never
--   inlined) ran once per match side, player row or goal, 760 times for a season of 380 matches. It now runs once per
--   club the read meets, and the rows are joined to its answers: the same team, id, name and crest for each.
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION api.league_history_matches(edition text, start smallint)
RETURNS TABLE(match_date date, round text, status text, home_key integer, home_id text, home_name text, home_image text,
  away_key integer, away_id text, away_name text, away_image text, home_score integer, away_score integer,
  home_source text, away_source text)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH ms AS MATERIALIZED (
    SELECT m.id, m.archive_position, m.match_date, m.round_id, m.status, m.home_team_id, m.away_team_id, m.home_score, m.away_score,
      m.home_team_name, m.away_team_name
    FROM core.competition_seasons cs
    JOIN core.matches m ON m.competition_season_id = cs.id AND m.season_id = cs.season_id
    WHERE cs.archive_key = edition AND cs.season_id = start
  ), teams AS MATERIALIZED (
    SELECT s.team, t.team_key, t.public_id, t.name, t.image_url
    FROM (SELECT home_team_id AS team FROM ms UNION SELECT away_team_id FROM ms) s
    CROSS JOIN LATERAL api.league_history_team(s.team) t
  )
  SELECT m.match_date, r.name, m.status::text, h.team_key, h.public_id, h.name, h.image_url,
    a.team_key, a.public_id, a.name, a.image_url, m.home_score, m.away_score, m.home_team_name, m.away_team_name
  FROM ms m
  LEFT JOIN core.rounds r ON r.id = m.round_id
  JOIN teams h ON h.team = m.home_team_id
  JOIN teams a ON a.team = m.away_team_id
  ORDER BY m.archive_position, m.id
$$;

CREATE OR REPLACE FUNCTION api.league_history_next(league text, keys text[], start smallint)
RETURNS TABLE(kind text, team_key integer, public_id text, name text, source_name text)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH editions AS MATERIALIZED (
    SELECT e.id, e.kind FROM (
      SELECT cs.id, CASE
          WHEN cs.archive_key = ANY(keys) THEN 'league'
          WHEN cs.archive_key ~ '/uefa\.cl$' OR cs.archive_key = 'g:champions-league' THEN 'cl'
          WHEN cs.archive_key ~ '/uefa\.el$' OR cs.archive_key = 'g:europa-league' THEN 'el'
        END AS kind
      FROM core.competition_seasons cs
      WHERE cs.season_id = start AND cs.archive_key IS NOT NULL
      UNION ALL
      SELECT cs.id, CASE p.provider_key WHEN league THEN 'league' WHEN 'l_0bfbkO' THEN 'cl' WHEN 'l_38d9HA' THEN 'el' WHEN 'l_2WZ2tt' THEN 'ecl' END
      FROM core.competition_seasons cs
      JOIN core.provider_ids p ON p.entity_type = 'competition' AND p.provider = 'pitchapi' AND p.is_current AND p.entity_id = cs.competition_id
      WHERE cs.season_id = start AND cs.archive_key IS NULL AND cs.cup_key IS NULL
        AND p.provider_key IN (league, 'l_0bfbkO', 'l_38d9HA', 'l_2WZ2tt')
    ) e
    WHERE e.kind IS NOT NULL
  ), sides AS MATERIALIZED (
    SELECT DISTINCT e.kind, s.team, s.source
    FROM core.matches m
    JOIN editions e ON e.id = m.competition_season_id
    CROSS JOIN LATERAL (VALUES (m.home_team_id, m.home_team_name), (m.away_team_id, m.away_team_name)) s(team, source)
    WHERE m.competition_season_id = ANY(ARRAY(SELECT id FROM editions)) AND s.team IS NOT NULL
  ), teams AS MATERIALIZED (
    SELECT s.team, t.team_key, t.public_id, t.name
    FROM (SELECT DISTINCT team FROM sides) s CROSS JOIN LATERAL api.league_history_team(s.team) t
  )
  SELECT DISTINCT s.kind, t.team_key, t.public_id, t.name, s.source
  FROM sides s JOIN teams t ON t.team = s.team
$$;

CREATE OR REPLACE FUNCTION api.league_history_scorers(edition text, start smallint)
RETURNS TABLE(name text, team_key integer, team_id text, team_name text, team_image text, goals integer)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH goals AS MATERIALIZED (
    SELECT coalesce(p.name, e.player_name) AS name, e.team_id
    FROM core.competition_seasons cs
    JOIN core.matches m ON m.competition_season_id = cs.id AND m.season_id = cs.season_id
    JOIN core.match_events e ON e.season_id = m.season_id AND e.match_id = m.id AND e.event_type = 'goal'
      AND e.is_own_goal IS NOT TRUE
    LEFT JOIN core.players p ON p.id = e.player_id
    WHERE cs.archive_key = edition AND cs.season_id = start AND coalesce(p.name, e.player_name) IS NOT NULL
  ), teams AS MATERIALIZED (
    SELECT s.team, t.team_key, t.public_id, t.name, t.image_url
    FROM (SELECT DISTINCT team_id AS team FROM goals WHERE team_id IS NOT NULL) s CROSS JOIN LATERAL api.league_history_team(s.team) t
  )
  SELECT g.name, t.team_key, t.public_id, t.name, t.image_url, count(*)::int
  FROM goals g LEFT JOIN teams t ON t.team = g.team_id
  GROUP BY 1, 2, 3, 4, 5
$$;

CREATE OR REPLACE FUNCTION api.league_history_players(league text, start smallint)
RETURNS TABLE(name text, player_id text, image_url text, club_name text, team_id text, team_image text,
  matches integer, minutes integer, goals integer, assists integer)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH lines AS MATERIALIZED (
    SELECT s.*
    FROM core.league_player_seasons s
    JOIN core.provider_ids c ON c.entity_type = 'competition' AND c.provider = 'pitchapi' AND c.is_current
      AND c.entity_id = s.competition_id AND c.provider_key = league
    WHERE s.season_id = start
  ), teams AS MATERIALIZED (
    SELECT s.team, t.public_id, t.name, t.image_url
    FROM (SELECT DISTINCT team_id AS team FROM lines WHERE team_id IS NOT NULL) s CROSS JOIN LATERAL api.league_history_team(s.team) t
  )
  SELECT s.player_name,
    CASE WHEN s.player_id IS NOT NULL AND EXISTS (SELECT 1 FROM core.provider_ids q WHERE q.entity_type = 'player'
      AND q.provider = 'pitchapi' AND q.entity_id = s.player_id) THEN api.public_id('player', s.player_id) END,
    ph.source_url, coalesce(t.name, s.club_name), t.public_id, t.image_url,
    s.matches::int, s.minutes::int, s.goals::int, s.assists::int
  FROM lines s
  LEFT JOIN core.players pl ON pl.id = s.player_id
  LEFT JOIN core.assets ph ON ph.id = pl.photo_asset_id
  LEFT JOIN teams t ON t.team = s.team_id
$$;

REVOKE ALL ON FUNCTION api.league_history_matches(text, smallint), api.league_history_next(text, text[], smallint),
  api.league_history_scorers(text, smallint), api.league_history_players(text, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.league_history_matches(text, smallint), api.league_history_next(text, text[], smallint),
  api.league_history_scorers(text, smallint), api.league_history_players(text, smallint) TO vega_read;
