-- 20 Nov 2026 (VI-39): the two tabs of /joueurs that replace « Explorer » and « Indices ».
--
-- « Remplaçant » (GET /api/players/{id}/similar with limit, maxAge or maxValue): what the read
-- needs of each player of a season's profile vectors (081) beside his distance:
-- - his age on the season's last day (30 June of a two-year season, 31 December of a calendar
--   one), or today when sooner: our birth date, else the one of his linked profile, never
--   through a link in quarantine (as 118's club ages);
-- - his latest valuation on that day, a valuation the source no longer lists (absent_since,
--   160) ignored, none through a link in quarantine (as api.player_market_values);
-- - his season grade over every edition, from five graded matches (as the list's ranking by
--   grade, players.mjs MIN_GRADED_MATCHES): 100 / (1 + 10^(−(Σ zm / Σ minutes) / 4));
-- - his five profile axes: the mean of his stored league centiles (agg.player_percentiles,
--   per 90, worker's league cohorts of 450 minutes and 30 players) in each family, read in the
--   league cohort where he covered the most minutes. Goalkeepers have none.
--
-- « En forme » (GET /api/player-form): each graded player-match and each player-match's minutes
-- of the finished matches, and each club's finished matches, keyed so the read can bound them
-- to the page's scope by ids (publication.mjs idScopeWhere).
SET LOCAL lock_timeout = '3s';

CREATE VIEW api.player_replacement_facts AS
SELECT e.season_id, e.player_id AS player_key,
  core.age_on(coalesce(p.birth_date, linked.birth_date), d.as_of) AS age,
  v.value_eur::float8 AS value_eur, v.valued_at::text AS value_date,
  CASE WHEN g.matches >= 5 AND g.minutes > 0 THEN (100 / (1 + power(10, -(g.zm / g.minutes) / 4.0)))::float8 END AS grade
FROM agg.player_embeddings e
JOIN core.seasons s ON s.id = e.season_id
CROSS JOIN LATERAL (
  SELECT least(current_date, CASE WHEN s.label ~ '^\d{4}/\d{4}$' THEN make_date(split_part(s.label, '/', 2)::int, 6, 30)
                                  WHEN s.label ~ '^\d{4}$' THEN make_date(s.label::int, 12, 31) END) AS as_of
) d
JOIN core.players p ON p.id = e.player_id
LEFT JOIN LATERAL (
  SELECT pp.birth_date FROM core.provider_ids i
  JOIN core.provider_players pp ON pp.provider = i.provider AND pp.provider_key = i.provider_key
  WHERE p.birth_date IS NULL AND i.entity_type = 'player' AND i.provider = 'transfermarkt' AND i.entity_id = p.id AND i.is_current
    AND pp.birth_date IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ops.provider_links l WHERE l.entity_type = 'player' AND l.provider = 'transfermarkt'
                    AND l.provider_key = i.provider_key AND l.quarantined_at IS NOT NULL)
  LIMIT 1
) linked ON true
LEFT JOIN LATERAL (
  SELECT mv.value_eur, mv.valued_at FROM core.player_market_values mv
  WHERE mv.player_id = e.player_id AND mv.source = 'transfermarkt' AND mv.value_eur > 0 AND mv.absent_since IS NULL
    AND mv.valued_at <= d.as_of
    AND NOT EXISTS (SELECT 1 FROM ops.provider_links l WHERE l.entity_type = 'player' AND l.provider = 'transfermarkt'
                    AND l.entity_id = mv.player_id AND l.quarantined_at IS NOT NULL)
  ORDER BY mv.valued_at DESC LIMIT 1
) v ON true
LEFT JOIN LATERAL (
  SELECT sum(x.grade_count) AS matches, sum(x.grade_minutes)::float8 AS minutes, sum(x.zm_sum) AS zm
  FROM agg.player_grade_editions x WHERE x.season_id = e.season_id AND x.player_id = e.player_id
) g ON true;

CREATE VIEW api.player_profile_axes AS
WITH best AS (
  SELECT DISTINCT ON (c.season_id, pc.player_id) c.season_id, pc.player_id, pc.cohort_id, c.position_group
  FROM agg.player_percentiles pc
  JOIN agg.cohorts c ON c.id = pc.cohort_id AND c.entity_type = 'player' AND c.universe = 'league'
  ORDER BY c.season_id, pc.player_id, pc.covered_minutes DESC NULLS LAST, pc.cohort_id
)
SELECT b.season_id, b.player_id AS player_key,
  avg(pc.percentile) FILTER (WHERE pc.metric_key IN ('accurate_passes', 'pass_completion', 'touches'))::float8 AS construction,
  avg(pc.percentile) FILTER (WHERE pc.metric_key IN ('assists', 'chances_created', 'big_chances_created'))::float8 AS creation,
  avg(pc.percentile) FILTER (WHERE pc.metric_key IN ('dribbles_succeeded', 'passes_into_final_third'))::float8 AS percussion,
  avg(pc.percentile) FILTER (WHERE pc.metric_key IN ('defensive_actions', 'tackles', 'interceptions', 'recoveries',
                                                     'duels_won', 'duel_success', 'clearances', 'shot_blocks'))::float8 AS defense,
  avg(pc.percentile) FILTER (WHERE pc.metric_key IN ('goals', 'xg', 'npxg', 'xgot', 'total_shots', 'shots_on_target',
                                                     'touches_opp_box'))::float8 AS finishing
FROM best b
JOIN agg.player_percentiles pc ON pc.cohort_id = b.cohort_id AND pc.player_id = b.player_id AND pc.percentile IS NOT NULL
WHERE b.position_group IS DISTINCT FROM 'G'
GROUP BY b.season_id, b.player_id;

CREATE VIEW api.player_form_grades AS
SELECT g.season_id, m.competition_season_id, g.match_id AS match_key, m.match_date, m.kickoff_at,
  g.player_id AS player_key, g.team_id AS team_key, g.minutes, g.z::float8 AS z
FROM agg.player_match_grades g
JOIN core.matches m ON m.id = g.match_id AND m.season_id = g.season_id
WHERE m.status = 'finished';

CREATE VIEW api.player_form_minutes AS
SELECT s.season_id, m.competition_season_id, s.match_id AS match_key, m.match_date, m.kickoff_at,
  s.player_id AS player_key, s.team_id AS team_key, t.is_national AS team_is_national, s.minutes_played AS minutes
FROM core.player_match_stats s
JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id
JOIN core.teams t ON t.id = s.team_id
WHERE m.status = 'finished';

CREATE VIEW api.team_finished_matches AS
SELECT m.season_id, m.competition_season_id, m.id AS match_key, m.match_date, m.kickoff_at, side.team_key
FROM core.matches m
CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) side(team_key)
WHERE m.status = 'finished' AND side.team_key IS NOT NULL;

-- Who a listed player is: his name, his picture, his role of the season (power ranking).
CREATE VIEW api.player_identities AS
SELECT p.id AS player_key, api.public_id('player', p.id) AS player_id, p.name, ph.source_url AS image_url
FROM core.players p
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id;

CREATE VIEW api.player_season_roles AS
SELECT w.season_id, w.player_id AS player_key, w.role FROM agg.player_power w;

CREATE VIEW api.team_identities AS
SELECT t.id AS team_key, api.public_id('team', t.id) AS team_id, t.name FROM core.teams t;

GRANT SELECT ON api.player_replacement_facts, api.player_profile_axes, api.player_form_grades, api.player_form_minutes,
  api.team_finished_matches, api.player_identities, api.player_season_roles, api.team_identities TO vega_read;
