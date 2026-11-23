-- The archived seasons of the five big leagues (2010/11–2020/21) on the competition page (23 November 2026, mock-up
-- approved by the user): reads for GET /api/league-history (api/src/routes/league-history.mjs). Nothing is written.
--
-- A team is the one the identity pass merged it into (core.teams.merged_into, 094): a club the site holds has its
-- public id and its crest, a club only the archive knows its archived name and neither.

-- The archive edition, among `keys`, holding the most matches of the season starting `start` (openfootball's or
-- engsoccerdata's key of a league season).
CREATE FUNCTION api.league_history_edition(keys text[], start smallint)
RETURNS TABLE(key text, matches integer)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT cs.archive_key, count(m.id)::int
  FROM core.competition_seasons cs JOIN core.matches m ON m.competition_season_id = cs.id
  WHERE cs.archive_key = ANY(keys) AND cs.season_id = start
  GROUP BY cs.archive_key ORDER BY count(m.id) DESC, cs.archive_key LIMIT 1
$$;

-- The team as the site shows it: the team merged into, its public id when the site holds the club (a PitchAPI id),
-- its name, its crest.
CREATE FUNCTION api.league_history_team(team integer)
RETURNS TABLE(team_key integer, public_id text, name text, image_url text)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT k.id,
    CASE WHEN EXISTS (SELECT 1 FROM core.provider_ids p WHERE p.entity_type = 'team' AND p.provider = 'pitchapi' AND p.entity_id = k.id)
      THEN api.public_id('team', k.id) END,
    k.name, cr.source_url
  FROM core.teams t JOIN core.teams k ON k.id = coalesce(t.merged_into, t.id)
  LEFT JOIN core.assets cr ON cr.id = k.crest_asset_id
  WHERE t.id = team
$$;

-- The edition's matches in the archive's order: day, round, both teams, the score (none when unplayed).
CREATE FUNCTION api.league_history_matches(edition text, start smallint)
RETURNS TABLE(match_date date, round text, status text, home_key integer, home_id text, home_name text, home_image text,
  away_key integer, away_id text, away_name text, away_image text, home_score integer, away_score integer)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT m.match_date, r.name, m.status::text, h.team_key, h.public_id, h.name, h.image_url,
    a.team_key, a.public_id, a.name, a.image_url, m.home_score, m.away_score
  FROM core.competition_seasons cs
  JOIN core.matches m ON m.competition_season_id = cs.id AND m.season_id = cs.season_id
  LEFT JOIN core.rounds r ON r.id = m.round_id
  CROSS JOIN LATERAL api.league_history_team(m.home_team_id) h
  CROSS JOIN LATERAL api.league_history_team(m.away_team_id) a
  WHERE cs.archive_key = edition AND cs.season_id = start
  ORDER BY m.archive_position, m.id
$$;

-- Who played where the season starting `start` (the next one of the season shown): the league (archive `keys`, or the
-- PitchAPI edition of `league`), the Champions League, the Europa League and the Conference League (archived editions
-- of that season, or PitchAPI's). One row per kind and team.
CREATE FUNCTION api.league_history_next(league text, keys text[], start smallint)
RETURNS TABLE(kind text, team_key integer, public_id text, name text)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH editions AS (
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
  ), sides AS (
    SELECT e.kind, m.home_team_id AS team FROM editions e JOIN core.matches m ON m.competition_season_id = e.id WHERE e.kind IS NOT NULL
    UNION
    SELECT e.kind, m.away_team_id FROM editions e JOIN core.matches m ON m.competition_season_id = e.id WHERE e.kind IS NOT NULL
  )
  SELECT DISTINCT s.kind, t.team_key, t.public_id, t.name
  FROM sides s CROSS JOIN LATERAL api.league_history_team(s.team) t
  WHERE s.team IS NOT NULL
$$;

-- The edition's scorers from its archived goals (the seasons the players' file does not cover), own goals apart.
CREATE FUNCTION api.league_history_scorers(edition text, start smallint)
RETURNS TABLE(name text, team_key integer, team_id text, team_name text, team_image text, goals integer)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT coalesce(p.name, e.player_name), t.team_key, t.public_id, t.name, t.image_url, count(*)::int
  FROM core.competition_seasons cs
  JOIN core.matches m ON m.competition_season_id = cs.id AND m.season_id = cs.season_id
  JOIN core.match_events e ON e.season_id = m.season_id AND e.match_id = m.id AND e.event_type = 'goal'
    AND e.is_own_goal IS NOT TRUE
  LEFT JOIN core.players p ON p.id = e.player_id
  LEFT JOIN LATERAL api.league_history_team(e.team_id) t ON true
  WHERE cs.archive_key = edition AND cs.season_id = start AND coalesce(p.name, e.player_name) IS NOT NULL
  GROUP BY 1, 2, 3, 4, 5
$$;

-- A league season's players (core.league_player_seasons, 163: the Transfermarkt datasets' appearances), one row per
-- player and club; the player's public id when the base holds him, the club as the site shows it when linked.
CREATE FUNCTION api.league_history_players(league text, start smallint)
RETURNS TABLE(name text, player_id text, image_url text, club_name text, team_id text, team_image text,
  matches integer, minutes integer, goals integer, assists integer)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT s.player_name,
    CASE WHEN s.player_id IS NOT NULL AND EXISTS (SELECT 1 FROM core.provider_ids q WHERE q.entity_type = 'player'
      AND q.provider = 'pitchapi' AND q.entity_id = s.player_id) THEN api.public_id('player', s.player_id) END,
    ph.source_url, coalesce(t.name, s.club_name), t.public_id, t.image_url,
    s.matches::int, s.minutes::int, s.goals::int, s.assists::int
  FROM core.league_player_seasons s
  JOIN core.provider_ids c ON c.entity_type = 'competition' AND c.provider = 'pitchapi' AND c.is_current
    AND c.entity_id = s.competition_id AND c.provider_key = league
  LEFT JOIN core.players pl ON pl.id = s.player_id
  LEFT JOIN core.assets ph ON ph.id = pl.photo_asset_id
  LEFT JOIN LATERAL api.league_history_team(s.team_id) t ON true
  WHERE s.season_id = start
$$;

REVOKE ALL ON FUNCTION api.league_history_edition(text[], smallint), api.league_history_team(integer),
  api.league_history_matches(text, smallint), api.league_history_next(text, text[], smallint),
  api.league_history_scorers(text, smallint), api.league_history_players(text, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.league_history_edition(text[], smallint), api.league_history_team(integer),
  api.league_history_matches(text, smallint), api.league_history_next(text, text[], smallint),
  api.league_history_scorers(text, smallint), api.league_history_players(text, smallint) TO vega_read;
