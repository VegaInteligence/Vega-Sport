-- The home's importance, version 2 (GitHub #69, Linear VI-48; doc docs/calculs/06-accueil-et-matchs/01-accueil.md).
-- 044 rule: a new weighting is a new function, never an edit of api.home_weight_v1, which the existing blocks keep.
--
--   importance = stakes × level + balance
--   stakes  = the competition's prestige × its round's: the values of vega/power.py (PRESTIGE, STAGE, round_of), as
--             rows of core.home_stakes (backend/tests/test_home_importance.py compares them with power.py). The
--             complementary cups' prestige (power.CUP_PRESTIGE) is not here: api.fixtures holds no cup-source edition.
--   level   = (mean of the two sides' ratings − centre) / divisor, the centre and divisor a row of core.home_level_scales
--             for each scope (clubs; nations when both sides are national teams). A side's rating: its Elo of the
--             season (agg.team_power), else the level of its league that season (agg.league_levels), else the level
--             of the match's competition, else the centre (a level term of 0, never NULL);
--   balance = 1 − |p_home − p_away|: the match forecast's (agg.match_forecasts) when there is one, else the Elo's
--             expected score (power.expected_score) with the run's home advantage (agg.power_runs.elo_home_advantage,
--             0 on neutral ground as in power.elo_updates) when both sides have a rating, else 0.5.
--
-- The windows of « À l'affiche » (GET /api/read/home, key billboard) and of GET /api/read/home-local are rules as data:
-- api.home_rules_v2.
SET LOCAL lock_timeout = '3s';

-- Stakes: kind 'prestige' is keyed by the competition's PitchAPI key, kind 'round' by power.STAGE's keys.
CREATE TABLE core.home_stakes (
  kind text NOT NULL CHECK (kind IN ('prestige', 'round')),
  key text NOT NULL,
  multiplier numeric NOT NULL CHECK (multiplier > 0),
  PRIMARY KEY (kind, key)
);
INSERT INTO core.home_stakes(kind, key, multiplier) VALUES
  ('prestige', 'l_1XLtP0', 1.30),  -- World Cup
  ('prestige', 'l_0bfbkO', 1.15),  -- Champions League
  ('prestige', 'l_38d9HA', 1.08),  -- Europa League
  ('prestige', 'l_2WZ2tt', 1.04),  -- Conference League
  ('round', 'knockout', 1.05),
  ('round', 'semi_final', 1.10),
  ('round', 'final', 1.15);

-- The level's scale, one row per scope. The nations take the clubs' values for now (provisional, VI-48): their Elo is
-- about to change scale, and a data migration changes this row, not the function.
CREATE TABLE core.home_level_scales (
  scope text PRIMARY KEY CHECK (scope IN ('clubs', 'nations')),
  centre double precision NOT NULL,
  divisor double precision NOT NULL CHECK (divisor > 0)
);
INSERT INTO core.home_level_scales(scope, centre, divisor) VALUES
  ('clubs', 1400, 100),
  ('nations', 1400, 100);

-- power.round_of: a round's key in power.STAGE, or NULL for an ordinary round. PitchAPI's stage and the round's name.
CREATE FUNCTION api.home_round_v2(stage text, name text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN stage = 'regular' THEN NULL
    WHEN n = '1/2' OR EXISTS (SELECT 1 FROM unnest(
      -- semi words (power._SEMI_WORDS)
      ARRAY['semi', 'halbfinal', 'demi']) w WHERE strpos(n, w) > 0) THEN 'semi_final'
    WHEN n IN ('1/4', '1/8', '1/16') OR EXISTS (SELECT 1 FROM unnest(
      -- knockout words (power._KNOCKOUT_WORDS)
      ARRAY['quarter', 'viertelfinal', 'achtelfinal', 'quarts de finale', 'huitièmes', 'huitiemes', 'seizièmes', 'seiziemes',
            'round of 16', 'round of 32', 'last 16', 'last 32']) w WHERE strpos(n, w) > 0) THEN 'knockout'
    WHEN n IN ('final', 'finale', 'finals', 'the final') OR right(n, 8) = ' - final' THEN 'final'
  END
  FROM (SELECT lower(btrim(coalesce(name, ''), E' \t\n\r\f\v')) AS n) x
$$;

-- The formula, from its inputs: ratings and forecast shares may be NULL.
CREATE FUNCTION api.home_weight_v2(stakes double precision, home_rating double precision, away_rating double precision,
                                   centre double precision, divisor double precision,
                                   home_win double precision, away_win double precision, home_advantage double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT coalesce(stakes, 1) * ((coalesce(home_rating, centre) + coalesce(away_rating, centre)) / 2 - centre) / divisor
    + coalesce(1 - abs(home_win - away_win),
               1 - abs(2 / (1 + power(10::double precision, (away_rating - home_rating - home_advantage) / 400)) - 1),
               0.5)
$$;

-- The importance of the given matches of one season (the read's window: a bounded list of ids), with the forecast's
-- three shares when there is one. A match without a row in core.matches gives no row.
CREATE FUNCTION api.home_importance_v2(season smallint, match_ids integer[])
RETURNS TABLE(match_id integer, weight double precision, home_win double precision, draw double precision, away_win double precision)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH picked AS MATERIALIZED (
    SELECT m.id, m.season_id, m.competition_season_id, m.round_id, m.home_team_id, m.away_team_id, coalesce(m.is_neutral, false) AS neutral
    FROM core.matches m WHERE m.id = ANY(match_ids) AND m.season_id = season
  ), latest_run AS MATERIALIZED (
    SELECT r.elo_home_advantage::double precision AS home FROM agg.power_runs r
    WHERE r.kind = 'elo' AND r.status = 'published' AND r.elo_home_advantage IS NOT NULL
    ORDER BY r.finished_at DESC NULLS LAST, r.id DESC LIMIT 1
  ), sides AS (
    SELECT p.*, cs.competition_id,
      coalesce(pr.multiplier, 1)::double precision * coalesce(rd.multiplier, 1)::double precision AS stakes,
      coalesce(th.elo::numeric::double precision, lh.level, lc.level::numeric::double precision) AS home_rating,
      coalesce(ta.elo::numeric::double precision, la.level, lc.level::numeric::double precision) AS away_rating,
      coalesce(rh.elo_home_advantage, ra.elo_home_advantage)::double precision AS run_home,
      CASE WHEN h.is_national AND a.is_national THEN 'nations' ELSE 'clubs' END AS scope
    FROM picked p
    JOIN core.competition_seasons cs ON cs.id = p.competition_season_id
    LEFT JOIN core.provider_ids ck ON ck.entity_type = 'competition' AND ck.entity_id = cs.competition_id
      AND ck.provider = 'pitchapi' AND ck.is_current
    LEFT JOIN core.home_stakes pr ON pr.kind = 'prestige' AND pr.key = ck.provider_key
    LEFT JOIN core.rounds r ON r.id = p.round_id
    LEFT JOIN core.home_stakes rd ON rd.kind = 'round' AND rd.key = api.home_round_v2(r.stage::text, r.name)
    LEFT JOIN core.teams h ON h.id = p.home_team_id
    LEFT JOIN core.teams a ON a.id = p.away_team_id
    LEFT JOIN agg.team_power th ON th.season_id = p.season_id AND th.team_id = p.home_team_id
    LEFT JOIN agg.team_power ta ON ta.season_id = p.season_id AND ta.team_id = p.away_team_id
    LEFT JOIN agg.power_runs rh ON rh.id = th.run_id
    LEFT JOIN agg.power_runs ra ON ra.id = ta.run_id
    LEFT JOIN agg.league_levels lc ON lc.competition_id = cs.competition_id
    -- A side's league that season: the highest level of the leagues it plays in.
    LEFT JOIN LATERAL (
      SELECT max(l.level)::numeric::double precision AS level FROM core.team_seasons ts
      JOIN core.competition_seasons c2 ON c2.id = ts.competition_season_id AND c2.season_id = p.season_id
      JOIN core.competitions co ON co.id = c2.competition_id AND co.kind = 'league'
      JOIN agg.league_levels l ON l.competition_id = c2.competition_id
      WHERE ts.team_id = p.home_team_id) lh ON th.team_id IS NULL
    LEFT JOIN LATERAL (
      SELECT max(l.level)::numeric::double precision AS level FROM core.team_seasons ts
      JOIN core.competition_seasons c2 ON c2.id = ts.competition_season_id AND c2.season_id = p.season_id
      JOIN core.competitions co ON co.id = c2.competition_id AND co.kind = 'league'
      JOIN agg.league_levels l ON l.competition_id = c2.competition_id
      WHERE ts.team_id = p.away_team_id) la ON ta.team_id IS NULL
  )
  SELECT s.id,
    api.home_weight_v2(s.stakes, s.home_rating, s.away_rating, sc.centre, sc.divisor,
      f.home_win::numeric::double precision, f.away_win::numeric::double precision,
      CASE WHEN s.neutral THEN 0 ELSE coalesce(s.run_home, (SELECT home FROM latest_run)) END),
    f.home_win::numeric::double precision, f.draw::numeric::double precision, f.away_win::numeric::double precision
  FROM sides s
  JOIN core.home_level_scales sc ON sc.scope = s.scope
  LEFT JOIN agg.match_forecasts f ON f.match_id = s.id
$$;

REVOKE ALL ON FUNCTION api.home_importance_v2(smallint, integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.home_importance_v2(smallint, integer[]) TO vega_read;
GRANT EXECUTE ON FUNCTION api.home_round_v2(text, text), api.home_weight_v2(double precision, double precision, double precision,
  double precision, double precision, double precision, double precision, double precision) TO vega_read;

-- The windows (Paris days around today) and their caps. 044's api.home_rules_v1 is left as it is.
CREATE VIEW api.home_rules_v2 AS
SELECT 1 AS billboard_days_before,  -- « À l'affiche » from yesterday…
       3 AS billboard_days_after,   -- …to today + 3
       8 AS billboard_per_day,      -- the most important of each day
       1 AS local_days_before,      -- GET /api/read/home-local from yesterday…
       7 AS local_days_after,       -- …to today + 7 (a Monday's top division often plays from Friday)
       16 AS local_per_day,         -- a country's busiest day (several divisions), bounded
       6 AS local_table_rows;       -- the top of the country's highest league
GRANT SELECT ON api.home_rules_v2 TO vega_read;
