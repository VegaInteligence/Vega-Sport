-- The archived league seasons (164), live on 23 November 2026: no Champions League colour before 2019/20. openfootball's
-- European editions name their clubs « Olympique Lyonnais (FRA) », rows the identity pass has not merged into the
-- site's clubs, so the ids never meet. Both reads now also give each side's spelling in its archive
-- (core.matches.home_team_name / away_team_name, 034), which the route compares once the country tag and the
-- legal-form words are dropped (api/src/league-history.mjs, clubName). Nothing is written.
DROP FUNCTION api.league_history_matches(text, smallint);
DROP FUNCTION api.league_history_next(text, text[], smallint);

CREATE FUNCTION api.league_history_matches(edition text, start smallint)
RETURNS TABLE(match_date date, round text, status text, home_key integer, home_id text, home_name text, home_image text,
  away_key integer, away_id text, away_name text, away_image text, home_score integer, away_score integer,
  home_source text, away_source text)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT m.match_date, r.name, m.status::text, h.team_key, h.public_id, h.name, h.image_url,
    a.team_key, a.public_id, a.name, a.image_url, m.home_score, m.away_score, m.home_team_name, m.away_team_name
  FROM core.competition_seasons cs
  JOIN core.matches m ON m.competition_season_id = cs.id AND m.season_id = cs.season_id
  LEFT JOIN core.rounds r ON r.id = m.round_id
  CROSS JOIN LATERAL api.league_history_team(m.home_team_id) h
  CROSS JOIN LATERAL api.league_history_team(m.away_team_id) a
  WHERE cs.archive_key = edition AND cs.season_id = start
  ORDER BY m.archive_position, m.id
$$;

CREATE FUNCTION api.league_history_next(league text, keys text[], start smallint)
RETURNS TABLE(kind text, team_key integer, public_id text, name text, source_name text)
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
    SELECT e.kind, m.home_team_id AS team, m.home_team_name AS source FROM editions e JOIN core.matches m ON m.competition_season_id = e.id WHERE e.kind IS NOT NULL
    UNION
    SELECT e.kind, m.away_team_id, m.away_team_name FROM editions e JOIN core.matches m ON m.competition_season_id = e.id WHERE e.kind IS NOT NULL
  )
  SELECT DISTINCT s.kind, t.team_key, t.public_id, t.name, s.source
  FROM sides s CROSS JOIN LATERAL api.league_history_team(s.team) t
  WHERE s.team IS NOT NULL
$$;

REVOKE ALL ON FUNCTION api.league_history_matches(text, smallint), api.league_history_next(text, text[], smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.league_history_matches(text, smallint), api.league_history_next(text, text[], smallint) TO vega_read;
