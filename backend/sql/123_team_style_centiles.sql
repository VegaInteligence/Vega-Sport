-- Similar clubs across every league (VI-22, 17 November 2026): GET /api/teams/{id}/similar
-- compares the clubs' style centiles, each club placed in its own league. This view gives the
-- read API, which reads the api schema only, the centiles of the ten style axes
-- (vega/models.py TEAM_SIMILARITY_AXES) in the league cohorts (one per league edition: no
-- Europe pool, no cup), with the league's size, its level on the league strength scale and
-- whether it is a women's league. No table: the read computes the distances on demand
-- (about 12 000 rows for a season, 100 to 300 ms measured on 17 November 2026).
SET LOCAL lock_timeout = '3s';

CREATE VIEW api.team_style_centiles AS
SELECT c.season_id, split_part(c.key, ':', 4)::integer AS competition_season_id, c.size AS league_clubs,
  cc.competition_id AS competition_key, co.name AS league_name, co.country_code AS country,
  l.level::numeric::float8 AS league_level,
  coalesce(l.universe = 'women', co.name ~* '\mwomen') AS women,
  p.team_id AS team_key, p.metric_key, p.percentile, p.covered_matches
FROM agg.cohorts c
JOIN agg.cohort_competitions cc ON cc.cohort_id = c.id
JOIN core.competitions co ON co.id = cc.competition_id
LEFT JOIN agg.league_levels l ON l.competition_id = cc.competition_id
JOIN agg.team_percentiles p ON p.cohort_id = c.id
WHERE c.entity_type = 'team' AND c.universe = 'league' AND c.key LIKE 'team:%:cs:%'
  AND p.metric_key IN ('possession_pct', 'field_tilt_pct', 'directness_pct', 'ppda_approx', 'crosses_pm',
                       'set_share_pct', 'def_actions_adj', 'xg_pm', 'xga_pm', 'pass_accuracy_pct');
GRANT SELECT ON api.team_style_centiles TO vega_read;
