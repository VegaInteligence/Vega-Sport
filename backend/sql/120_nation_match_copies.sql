-- A nation's match held twice (119): the collected match is kept, but it may lack what its archive
-- copy holds — the round (the collected World Cup 2022 names none) and the penalty shoot-out (its
-- final, 3–3, gives no penalties; the archive gives 4–2). Each is now read from the other copy when
-- the kept one has none; the penalties are matched to the teams, whichever side each copy put
-- them on. The kept match and its score are unchanged.
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
  ), copies AS (
    SELECT o.*, cs.cup_key, cs.archive_key, co.name AS competition_name, r.name AS round_name,
      least(o.home_team_id, o.away_team_id) AS lo, greatest(o.home_team_id, o.away_team_id) AS hi,
      -- Each copy's penalties by team: the lower team id's, then the other's.
      CASE WHEN o.home_team_id <= o.away_team_id THEN o.home_penalty_score ELSE o.away_penalty_score END AS pens_lo,
      CASE WHEN o.home_team_id <= o.away_team_id THEN o.away_penalty_score ELSE o.home_penalty_score END AS pens_hi
    FROM own o
    JOIN core.competition_seasons cs ON cs.id = o.competition_season_id
    JOIN core.competitions co ON co.id = cs.competition_id
    LEFT JOIN core.rounds r ON r.id = o.round_id
  ), picked AS (
    SELECT c.*,
      row_number() OVER w AS pick,
      max(c.round_name) OVER (PARTITION BY coalesce(c.d::text, 'm' || c.id), c.lo, c.hi) AS any_round,
      max(c.pens_lo) OVER (PARTITION BY coalesce(c.d::text, 'm' || c.id), c.lo, c.hi) AS any_pens_lo,
      max(c.pens_hi) OVER (PARTITION BY coalesce(c.d::text, 'm' || c.id), c.lo, c.hi) AS any_pens_hi
    FROM copies c
    WINDOW w AS (
      PARTITION BY coalesce(c.d::text, 'm' || c.id), c.lo, c.hi
      ORDER BY (c.cup_key IS NULL AND c.archive_key IS NULL) DESC, (c.home_score IS NOT NULL) DESC, c.id
    )
  )
  SELECT api.public_id('match', p.id), p.d, se.label, p.competition_name, coalesce(p.cup_key, p.archive_key),
    coalesce(p.round_name, p.any_round), p.status::text, p.cup_key IS NULL AND p.archive_key IS NULL,
    api.public_id('team', p.home_team_id), h.name, hc.source_url, api.public_id('team', p.away_team_id), a.name, ac.source_url,
    p.home_score::integer, p.away_score::integer,
    coalesce(p.home_penalty_score, CASE WHEN p.home_team_id = p.lo THEN p.any_pens_lo ELSE p.any_pens_hi END)::integer,
    coalesce(p.away_penalty_score, CASE WHEN p.away_team_id = p.lo THEN p.any_pens_lo ELSE p.any_pens_hi END)::integer
  FROM picked p
  JOIN core.seasons se ON se.id = p.season_id
  JOIN core.teams h ON h.id = p.home_team_id
  JOIN core.teams a ON a.id = p.away_team_id
  LEFT JOIN core.assets hc ON hc.id = h.crest_asset_id
  LEFT JOIN core.assets ac ON ac.id = a.crest_asset_id
  WHERE p.pick = 1
$$;

REVOKE ALL ON FUNCTION api.nation_matches(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.nation_matches(integer) TO vega_read;
