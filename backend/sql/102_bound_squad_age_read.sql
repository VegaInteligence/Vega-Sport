-- Scope to the club's finished matches before reading any player statistics.
-- The primary key on (season_id, match_id, player_id) can then serve each match.
-- Keep the 100 view readable by API instances still on the previous release.
CREATE FUNCTION api.club_age_minutes(season_key smallint, club_key integer)
RETURNS TABLE(age integer, minutes integer)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH matches AS MATERIALIZED (
    SELECT m.id, m.match_date
    FROM core.matches m
    WHERE m.season_id = season_key AND m.status = 'finished'
      AND (m.home_team_id = club_key OR m.away_team_id = club_key)
  ), played AS MATERIALIZED (
    SELECT s.match_id, s.player_id, s.minutes_played
    FROM core.player_match_stats s
    WHERE s.season_id = season_key AND s.team_id = club_key AND s.minutes_played > 0
      AND s.match_id = ANY(ARRAY(SELECT id FROM matches))
  )
  SELECT core.age_on(p.birth_date, m.match_date) AS age, sum(s.minutes_played)::int AS minutes
  FROM played s
  JOIN matches m ON m.id = s.match_id
  JOIN core.players p ON p.id = s.player_id
  GROUP BY 1
$$;

REVOKE ALL ON FUNCTION api.club_age_minutes(smallint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.club_age_minutes(smallint, integer) TO vega_read;
