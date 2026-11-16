-- The last blocks of the player and club pages that showed mock-up figures, read from the base
-- (16 Nov 2026): a club's squad (its record's value, average age and size), a player's tracked
-- physical figures, his zones of action, the foot he shoots with and his share of his team's
-- passes. Each read is a function bound to one season and one player or club, like 102.

-- 1. A club record's squad: the value of its squad and of its 18 most valued players, their
-- average age and their number, as the record gives them on the day it is read.
ALTER TABLE core.provider_clubs
  ADD COLUMN squad_value_eur bigint CHECK (squad_value_eur > 0),
  ADD COLUMN top18_value_eur bigint CHECK (top18_value_eur > 0),
  ADD COLUMN average_age numeric(3,1) CHECK (average_age BETWEEN 14 AND 45),
  ADD COLUMN squad_size smallint CHECK (squad_size BETWEEN 1 AND 150);

-- The clubs read before kept none of these: read them again now (a hundred per request).
UPDATE ops.transfermarkt_reads SET next_due_at = now() WHERE kind = 'club' AND error_code IS NULL;

-- A club's squad, and its place by squad value among the clubs of the league it plays the most
-- in that season (league_clubs: how many there are, league_valued: how many have a value; a
-- rank is only meaningful when every club has one).
CREATE FUNCTION api.club_squad(season_key smallint, club_key integer)
RETURNS TABLE(squad_value_eur bigint, top18_value_eur bigint, average_age float8, squad_size integer, read_on date,
  league_rank integer, league_clubs integer, league_valued integer)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH league AS MATERIALIZED (
    SELECT m.competition_season_id AS id
    FROM core.matches m
    JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
    JOIN agg.league_levels l ON l.competition_id = cs.competition_id
    WHERE m.season_id = season_key AND (m.home_team_id = club_key OR m.away_team_id = club_key)
    GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1
  ), clubs AS MATERIALIZED (
    SELECT t.id AS team_id
    FROM core.matches m CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) t(id)
    WHERE m.season_id = season_key AND m.competition_season_id = (SELECT id FROM league) AND t.id IS NOT NULL
    UNION SELECT club_key
  ), valued AS MATERIALIZED (
    SELECT c.team_id, r.squad_value_eur, r.top18_value_eur, r.average_age, r.squad_size, r.read_on
    FROM clubs c
    LEFT JOIN LATERAL (
      SELECT p.squad_value_eur, p.top18_value_eur, p.average_age, p.squad_size, p.read_on
      FROM core.provider_ids i
      JOIN core.provider_clubs p ON p.provider = i.provider AND p.provider_key = i.provider_key
      WHERE i.entity_type = 'team' AND i.provider = 'transfermarkt' AND i.entity_id = c.team_id AND i.is_current
        AND NOT EXISTS (SELECT 1 FROM ops.provider_links q WHERE q.entity_type = 'team' AND q.provider = 'transfermarkt'
                        AND q.provider_key = i.provider_key AND q.quarantined_at IS NOT NULL)
      ORDER BY p.read_on DESC LIMIT 1
    ) r ON true
  )
  SELECT v.squad_value_eur, v.top18_value_eur, v.average_age::float8, v.squad_size::integer, v.read_on,
    CASE WHEN EXISTS (SELECT 1 FROM league) THEN (SELECT count(*)::integer + 1 FROM valued o WHERE o.squad_value_eur > v.squad_value_eur) END,
    CASE WHEN EXISTS (SELECT 1 FROM league) THEN (SELECT count(*)::integer FROM valued) END,
    CASE WHEN EXISTS (SELECT 1 FROM league) THEN (SELECT count(o.squad_value_eur)::integer FROM valued o) END
  FROM valued v
  WHERE v.team_id = club_key AND v.squad_value_eur IS NOT NULL
$$;

-- 2. A player's tracked matches of a season: his minutes, distances, sprints and top speed. A top
-- speed above 38 km/h (no tracked player reaches it: 24 values above 100 in the base) or over
-- fewer than 20 minutes is left out; his other figures of that match are kept.
CREATE FUNCTION api.player_physical_matches(season_key smallint, player_key integer)
RETURNS TABLE(match_id integer, competition_id integer, competition_name text, match_date date, opponent_name text, role text,
  minutes integer, distance_m float8, running_m float8, sprinting_m float8, sprints integer, top_speed_kmh float8)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT s.match_id, cs.competition_id, co.name, m.match_date, o.name, pp.role,
    s.minutes_played::integer, s.distance_m::float8, s.running_m::float8, s.sprinting_m::float8, s.sprints::integer,
    CASE WHEN s.top_speed_kmh <= 38 AND s.minutes_played >= 20 THEN s.top_speed_kmh::float8 END
  FROM core.player_match_stats s
  JOIN core.matches m ON m.season_id = s.season_id AND m.id = s.match_id AND m.status = 'finished'
  JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
  JOIN core.competitions co ON co.id = cs.competition_id
  LEFT JOIN core.teams o ON o.id = CASE WHEN m.home_team_id = s.team_id THEN m.away_team_id ELSE m.home_team_id END
  LEFT JOIN agg.player_power pp ON pp.season_id = s.season_id AND pp.player_id = s.player_id
  WHERE s.season_id = season_key AND s.player_id = player_key AND s.distance_m IS NOT NULL AND s.minutes_played > 0
$$;

-- Every player tracked in a competition's season: his minutes, each figure per 90 minutes of the
-- matches that give it, the median of his match top speeds (same rule as above) and his role in
-- the season's ranking (the API places a player among those tracked 450 minutes or more).
-- tracked / finished: the competition's matches with tracking against its finished matches.
CREATE FUNCTION api.competition_physical_peers(season_key smallint, competition_key integer)
RETURNS TABLE(player_id integer, role text, matches integer, minutes integer, distance_m float8, running_m float8,
  sprinting_m float8, sprints float8, top_speed_kmh float8, tracked integer, finished integer)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH matches AS MATERIALIZED (
    SELECT m.id FROM core.matches m
    JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.competition_id = competition_key
    WHERE m.season_id = season_key AND m.status = 'finished'
  ), played AS MATERIALIZED (
    SELECT s.match_id, s.player_id, s.minutes_played, s.distance_m, s.running_m, s.sprinting_m, s.sprints,
      CASE WHEN s.top_speed_kmh <= 38 AND s.minutes_played >= 20 THEN s.top_speed_kmh END AS top_speed_kmh
    FROM core.player_match_stats s
    WHERE s.season_id = season_key AND s.match_id = ANY(ARRAY(SELECT id FROM matches))
      AND s.distance_m IS NOT NULL AND s.minutes_played > 0
  ), counts AS (
    SELECT (SELECT count(DISTINCT match_id)::integer FROM played) AS tracked, (SELECT count(*)::integer FROM matches) AS finished
  )
  SELECT s.player_id, pp.role, count(*)::integer, sum(s.minutes_played)::integer,
    (90 * sum(s.distance_m) / sum(s.minutes_played))::float8,
    (90 * sum(s.running_m) / nullif(sum(s.minutes_played) FILTER (WHERE s.running_m IS NOT NULL), 0))::float8,
    (90 * sum(s.sprinting_m) / nullif(sum(s.minutes_played) FILTER (WHERE s.sprinting_m IS NOT NULL), 0))::float8,
    (90.0 * sum(s.sprints) / nullif(sum(s.minutes_played) FILTER (WHERE s.sprints IS NOT NULL), 0))::float8,
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY s.top_speed_kmh))::float8,
    (SELECT tracked FROM counts), (SELECT finished FROM counts)
  FROM played s
  LEFT JOIN agg.player_power pp ON pp.season_id = season_key AND pp.player_id = s.player_id
  GROUP BY s.player_id, pp.role
$$;

-- 3. Where a player acts over a season: his whole activity maps summed (16 cells along the pitch,
-- attack to the right, 12 across), by third of the length (cells 0-4, 5-10, 11-15) and by side
-- (cells 0-3 across are his right, 8-11 his left: right wingers and right backs fill 0-3).
CREATE FUNCTION api.player_zones(season_key smallint, player_key integer)
RETURNS TABLE(matches integer, minutes integer, actions bigint, own_third bigint, middle_third bigint, final_third bigint,
  right_side bigint, centre bigint, left_side bigint)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH maps AS MATERIALIZED (
    SELECT h.match_id, h.cells FROM core.player_heatmaps h
    JOIN core.matches m ON m.season_id = h.season_id AND m.id = h.match_id AND m.status = 'finished'
    WHERE h.season_id = season_key AND h.player_id = player_key AND h.actions > 0
      AND (SELECT sum(v) FROM unnest(h.cells) v) = h.actions
  )
  SELECT (SELECT count(*)::integer FROM maps),
    (SELECT coalesce(sum(s.minutes_played), 0)::integer FROM core.player_match_stats s
     WHERE s.season_id = season_key AND s.player_id = player_key AND s.match_id = ANY(ARRAY(SELECT match_id FROM maps))),
    coalesce(sum(u.v), 0)::bigint,
    coalesce(sum(u.v) FILTER (WHERE (u.i - 1) % 16 <= 4), 0)::bigint,
    coalesce(sum(u.v) FILTER (WHERE (u.i - 1) % 16 BETWEEN 5 AND 10), 0)::bigint,
    coalesce(sum(u.v) FILTER (WHERE (u.i - 1) % 16 >= 11), 0)::bigint,
    coalesce(sum(u.v) FILTER (WHERE (u.i - 1) / 16 <= 3), 0)::bigint,
    coalesce(sum(u.v) FILTER (WHERE (u.i - 1) / 16 BETWEEN 4 AND 7), 0)::bigint,
    coalesce(sum(u.v) FILTER (WHERE (u.i - 1) / 16 >= 8), 0)::bigint
  FROM maps CROSS JOIN LATERAL unnest(maps.cells) WITH ORDINALITY u(v, i)
$$;

-- 4. A player's shots of a season by body part and inside the box, penalties and own goals left
-- out (a penalty is always taken inside the box, with the foot the taker chooses).
CREATE FUNCTION api.player_shot_profile(season_key smallint, player_key integer)
RETURNS TABLE(shots integer, right_foot integer, left_foot integer, header integer, other integer, inside_box integer)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*)::integer,
    count(*) FILTER (WHERE s.body_part = 'right_foot')::integer,
    count(*) FILTER (WHERE s.body_part = 'left_foot')::integer,
    count(*) FILTER (WHERE s.body_part = 'header')::integer,
    count(*) FILTER (WHERE s.body_part = 'other')::integer,
    count(*) FILTER (WHERE s.is_inside_box)::integer
  FROM core.shots s
  WHERE s.season_id = season_key AND s.player_id = player_key
    AND s.situation IS DISTINCT FROM 'penalty' AND s.is_own_goal IS NOT TRUE
$$;

-- 5. Passes received in the pass networks of the league a player plays the most in that season:
-- for every player of that league, the networks he is in, the passes he received there and all
-- the passes of those networks (a network covers a match up to its first substitution).
CREATE FUNCTION api.player_pass_share(season_key smallint, player_key integer)
RETURNS TABLE(competition_name text, player_id integer, role text, networks integer, received integer, total integer)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH league AS MATERIALIZED (
    SELECT cs.id, cs.competition_id
    FROM core.player_match_stats s
    JOIN core.matches m ON m.season_id = s.season_id AND m.id = s.match_id
    JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
    JOIN agg.league_levels l ON l.competition_id = cs.competition_id
    WHERE s.season_id = season_key AND s.player_id = player_key AND s.minutes_played > 0
    GROUP BY 1, 2 ORDER BY sum(s.minutes_played) DESC, 1 LIMIT 1
  ), matches AS MATERIALIZED (
    SELECT m.id FROM core.matches m
    WHERE m.season_id = season_key AND m.competition_season_id = (SELECT id FROM league) AND m.status = 'finished'
  ), edges AS MATERIALIZED (
    SELECT e.match_id, e.team_id, e.from_player_id, e.to_player_id, coalesce(e.passes, 0) AS passes
    FROM core.pass_network_edges e
    WHERE e.season_id = season_key AND e.match_id = ANY(ARRAY(SELECT id FROM matches))
      AND e.team_id IS NOT NULL AND e.from_player_id <> e.to_player_id
  ), networks AS (
    SELECT e.match_id, e.team_id, sum(e.passes) AS total FROM edges e GROUP BY 1, 2
  ), members AS (
    SELECT e.match_id, e.team_id, e.from_player_id AS player_id FROM edges e
    UNION SELECT e.match_id, e.team_id, e.to_player_id FROM edges e
  ), received AS (
    SELECT e.match_id, e.team_id, e.to_player_id AS player_id, sum(e.passes) AS received FROM edges e GROUP BY 1, 2, 3
  )
  SELECT (SELECT co.name FROM league l JOIN core.competitions co ON co.id = l.competition_id), b.player_id, pp.role, count(*)::integer,
    coalesce(sum(r.received), 0)::integer, sum(n.total)::integer
  FROM members b
  JOIN networks n ON n.match_id = b.match_id AND n.team_id = b.team_id AND n.total > 0
  LEFT JOIN received r ON r.match_id = b.match_id AND r.team_id = b.team_id AND r.player_id = b.player_id
  LEFT JOIN agg.player_power pp ON pp.season_id = season_key AND pp.player_id = b.player_id
  GROUP BY b.player_id, pp.role
$$;

REVOKE ALL ON FUNCTION api.club_squad(smallint, integer), api.player_physical_matches(smallint, integer),
  api.competition_physical_peers(smallint, integer), api.player_zones(smallint, integer),
  api.player_shot_profile(smallint, integer), api.player_pass_share(smallint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.club_squad(smallint, integer), api.player_physical_matches(smallint, integer),
  api.competition_physical_peers(smallint, integer), api.player_zones(smallint, integer),
  api.player_shot_profile(smallint, integer), api.player_pass_share(smallint, integer) TO vega_read;
