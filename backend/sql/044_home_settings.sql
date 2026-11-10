-- The home's settings as data (doc "Accueil et personnalisation", "Ce qui change en v2").
--
-- 1. The lists: the 29 big clubs, the 18 leagues of the title race and the Top 7 are
--    rows of core.editorial_lists (written by the curated source from its reviewed list,
--    vega_v2/sources/curated.py), read through api.editorial_lists by public id. They are
--    changed without publishing code.
-- 2. The weights: api.home_weight_v1, versioned. A new weighting is a new function
--    (_v2) that the route switches to, never an edit of this one.
-- 3. One week rule: api.home_period, instead of the rule written in the query and in the
--    browser.
-- 4. The thresholds of « Prochains matchs » (5 places, 3 for favourites, 21 days, the big
--    card within 48 h), with the other settings: api.home_rules_v1.

CREATE VIEW api.editorial_lists AS
SELECT l.list_kind::text AS list_kind, l.entity_type::text AS entity_type,
       api.public_id(l.entity_type, l.entity_id) AS entity_key, l.seq
FROM core.editorial_lists l;

-- Editorial weight (results ticker, upcoming matches): 2 per big club, 3 for the
-- Champions League or 1 for another European cup, 1 for the Top 5, 1 per side in the
-- top 3 of its league. Showcase weight (match of the week): 4 per big club, 2 per side in
-- the top 4, 2 more when both are in the top 3, 3 for the Champions League, 1 for the
-- Top 5, 1 when the shot map exists. Ids are public ids, the lists come from
-- api.editorial_lists (arguments, so the function stays inlined in the read).
CREATE FUNCTION api.home_weight_v1(kind text, league_id text, home_id text, away_id text,
                                   home_rank integer, away_rank integer, has_shots boolean,
                                   featured_clubs text[], top_five text[])
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE kind
    WHEN 'editorial' THEN
      2 * (coalesce((home_id = ANY(featured_clubs))::int, 0) + coalesce((away_id = ANY(featured_clubs))::int, 0))
      + CASE WHEN league_id = 'l_0bfbkO' THEN 3 WHEN league_id IN ('l_38d9HA', 'l_2WZ2tt') THEN 1 ELSE 0 END
      + coalesce((league_id = ANY(top_five))::int, 0)
      + coalesce((home_rank <= 3)::int, 0) + coalesce((away_rank <= 3)::int, 0)
    WHEN 'showcase' THEN
      4 * (coalesce((home_id = ANY(featured_clubs))::int, 0) + coalesce((away_id = ANY(featured_clubs))::int, 0))
      + 2 * coalesce((home_rank <= 4)::int, 0) + 2 * coalesce((away_rank <= 4)::int, 0)
      + 2 * coalesce((home_rank <= 3 AND away_rank <= 3)::int, 0)
      + 3 * (league_id = 'l_0bfbkO')::int
      + coalesce((league_id = ANY(top_five))::int, 0)
      + coalesce(has_shots::int, 0)
  END
$$;

-- The displayed week, Monday to Sunday in Paris. A past season (archive) shows its last
-- played week. The current home keeps the last week with a result while the current
-- week has none (Monday morning, international break), as long as that result is under
-- latest_days days old (rule of 9 November 2026, commit e80b073134).
CREATE FUNCTION api.home_period(as_of timestamptz, last_result timestamptz, archive boolean, latest_days integer DEFAULT 14)
RETURNS TABLE(start_day date, end_day date, as_of_day date, latest boolean)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH fallback AS (
    SELECT NOT archive
           AND (last_result AT TIME ZONE 'Europe/Paris')::date < date_trunc('week', as_of AT TIME ZONE 'Europe/Paris')::date
           AND (last_result AT TIME ZONE 'Europe/Paris')::date > (as_of AT TIME ZONE 'Europe/Paris')::date - latest_days AS latest
  ), anchor AS (
    SELECT CASE WHEN archive OR f.latest THEN last_result ELSE as_of END AS at, coalesce(f.latest, false) AS latest FROM fallback f
  )
  SELECT date_trunc('week', a.at AT TIME ZONE 'Europe/Paris')::date,
         date_trunc('week', a.at AT TIME ZONE 'Europe/Paris')::date + 6,
         (as_of AT TIME ZONE 'Europe/Paris')::date,
         a.latest
  FROM anchor a
$$;

CREATE VIEW api.home_rules_v1 AS
SELECT 5 AS upcoming_places,       -- matches in « Prochains matchs »
       3 AS favourite_places,      -- at most, for the favourites' matches
       7 AS upcoming_days,         -- the followed competitions' matches
       21 AS favourite_days,       -- a favourite's next match, whatever the competition
       48 AS big_card_hours,       -- the closest favourite match is the big card within this
       14 AS latest_week_days;     -- api.home_period
