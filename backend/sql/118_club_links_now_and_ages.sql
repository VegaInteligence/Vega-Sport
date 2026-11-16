-- 16 Nov 2026: the clubs' squads shown for every linked club, and ages known for more minutes.

-- 1. The club links are made on the first plan of each day; the value histories read since this
-- morning (and the profiles' current clubs, which now vote too) link some 370 more clubs, the
-- largest among them. The next plan makes them now rather than tomorrow.
UPDATE ops.transfermarkt_state SET planned_at = NULL WHERE id = 1;

-- 2. A club's minutes by age: a player without a birth date of ours takes his linked profile's
-- (never a doubted link's). core.players keeps only ours: the player links read it.
CREATE OR REPLACE FUNCTION api.club_age_minutes(season_key smallint, club_key integer)
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
  ), births AS MATERIALIZED (
    SELECT p.id AS player_id, coalesce(p.birth_date, (
      SELECT pp.birth_date FROM core.provider_ids i
      JOIN core.provider_players pp ON pp.provider = i.provider AND pp.provider_key = i.provider_key
      WHERE i.entity_type = 'player' AND i.provider = 'transfermarkt' AND i.entity_id = p.id AND i.is_current
        AND NOT EXISTS (SELECT 1 FROM ops.provider_links l WHERE l.entity_type = 'player' AND l.provider = 'transfermarkt'
                        AND l.provider_key = i.provider_key AND l.quarantined_at IS NOT NULL)
      LIMIT 1)) AS birth_date
    FROM core.players p
    WHERE p.id = ANY(ARRAY(SELECT DISTINCT player_id FROM played))
  )
  SELECT core.age_on(b.birth_date, m.match_date) AS age, sum(s.minutes_played)::int AS minutes
  FROM played s
  JOIN matches m ON m.id = s.match_id
  JOIN births b ON b.player_id = s.player_id
  GROUP BY 1
$$;
