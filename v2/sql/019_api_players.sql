-- Player reads of the API (legacy /api/read/players, performance, discipline): one row
-- per player and match, under the metric names of the legacy appearances.
--
-- A player has a row when the provider gave his match statistics, or else when he is
-- in a line-up. A line-up entry without statistics counts 0 minutes when the match's
-- player statistics were collected (he did not play), and unknown minutes otherwise.
-- Ids stay internal here; the routes translate only the rows they return. Single
-- precision values go through numeric so that 1.2 reads 1.2, not 1.2000000476837158.
CREATE VIEW api.player_appearances AS
SELECT x.season_id, se.label AS season, x.match_id, m.competition_season_id,
  coalesce(cp.provider_key, 'l_v' || lpad(cs.competition_id::text, 7, '0')) AS league_id,
  c.name AS league, m.match_date AS date, m.kickoff_at, m.status::text AS status,
  m.home_team_id, m.away_team_id, m.home_score, m.away_score,
  x.player_id, x.team_id, t.name AS team, t.is_national AS team_is_national,
  p.name AS player_name, ph.source_url AS image_url,
  x.position_id AS position_number, x.starter, x.is_captain, x.minutes, x.rating,
  x.goals, x.assists, x.xg, x.npxg, x.xgot, x.xa, x.shots, x.shots_on_target, x.touches_box,
  x.chances_created, x.big_chances_created, x.passes_final_third, x.dribbles, x.touches,
  x.passes_accurate, x.passes_attempted, x.duels_won, x.duels_lost, x.tackles, x.interceptions,
  x.recoveries, x.clearances, x.defensive_actions, x.blocks, x.saves, x.goals_prevented,
  x.fouls, x.was_fouled
FROM (
  SELECT s.season_id, s.match_id, s.player_id, coalesce(s.team_id, lp.team_id) AS team_id,
    coalesce(s.position_id, lp.position_id) AS position_id, lp.is_starter AS starter, lp.is_captain,
    s.minutes_played::float8 AS minutes, s.rating::numeric::float8 AS rating,
    s.goals::float8 AS goals, s.assists::float8 AS assists, s.xg::numeric::float8 AS xg, s.npxg::numeric::float8 AS npxg,
    s.xgot::numeric::float8 AS xgot, s.xa::numeric::float8 AS xa, s.total_shots::float8 AS shots,
    s.shots_on_target::float8 AS shots_on_target, s.touches_opp_box::float8 AS touches_box,
    s.chances_created::float8 AS chances_created, s.big_chances_created::float8 AS big_chances_created,
    s.passes_into_final_third::float8 AS passes_final_third, s.dribbles_succeeded::float8 AS dribbles,
    s.touches::float8 AS touches, s.accurate_passes::float8 AS passes_accurate,
    s.accurate_passes_total::float8 AS passes_attempted, s.duels_won::float8 AS duels_won,
    s.duels_lost::float8 AS duels_lost, s.tackles::float8 AS tackles, s.interceptions::float8 AS interceptions,
    s.recoveries::float8 AS recoveries, s.clearances::float8 AS clearances,
    s.defensive_actions::float8 AS defensive_actions, s.shot_blocks::float8 AS blocks,
    s.saves::float8 AS saves, s.goals_prevented::numeric::float8 AS goals_prevented,
    s.fouls::float8 AS fouls, s.was_fouled::float8 AS was_fouled
  FROM core.player_match_stats s
  LEFT JOIN core.lineup_players lp ON lp.season_id = s.season_id AND lp.match_id = s.match_id AND lp.player_id = s.player_id
  UNION ALL
  SELECT lp.season_id, lp.match_id, lp.player_id, lp.team_id, lp.position_id, lp.is_starter, lp.is_captain,
    CASE WHEN mc.player_stats = 'ok' THEN 0::float8 END, NULL::float8,
    NULL::float8, NULL::float8, NULL::float8, NULL::float8, NULL::float8, NULL::float8, NULL::float8,
    NULL::float8, NULL::float8, NULL::float8, NULL::float8, NULL::float8, NULL::float8, NULL::float8,
    NULL::float8, NULL::float8, NULL::float8, NULL::float8, NULL::float8, NULL::float8, NULL::float8,
    NULL::float8, NULL::float8, NULL::float8, NULL::float8, NULL::float8, NULL::float8, NULL::float8
  FROM core.lineup_players lp
  LEFT JOIN core.match_coverage mc ON mc.season_id = lp.season_id AND mc.match_id = lp.match_id
  WHERE NOT EXISTS (SELECT 1 FROM core.player_match_stats s
                    WHERE s.season_id = lp.season_id AND s.match_id = lp.match_id AND s.player_id = lp.player_id)
) x
JOIN core.matches m ON m.id = x.match_id AND m.season_id = x.season_id
JOIN core.seasons se ON se.id = x.season_id
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
JOIN core.competitions c ON c.id = cs.competition_id
JOIN core.players p ON p.id = x.player_id
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN core.teams t ON t.id = x.team_id
LEFT JOIN core.provider_ids cp ON cp.entity_type = 'competition' AND cp.entity_id = cs.competition_id
  AND cp.provider = 'pitchapi' AND cp.is_current;

-- Internal id of a public id (the inverse of api.public_id): the current PitchAPI key,
-- or a Vega key of the right kind that is still the entity's public id.
CREATE FUNCTION api.internal_id(kind core.entity_type, key text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT x.id FROM (
    SELECT coalesce(
      (SELECT p.entity_id FROM core.provider_ids p
        WHERE p.entity_type = kind AND p.provider = 'pitchapi' AND p.provider_key = key AND p.is_current),
      CASE WHEN key ~ '^[a-z]_v[0-9]{7}$' THEN substr(key, 4)::integer END) AS id
  ) x WHERE x.id IS NOT NULL AND api.public_id(kind, x.id) = key
$$;

-- Search aliases of a player (legacy shared/player-aliases.js), from the curated names.
CREATE VIEW api.player_search_aliases AS
SELECT entity_id AS player_id, string_agg(normalized, ' ' ORDER BY normalized) AS search_aliases
FROM core.entity_names WHERE entity_type = 'player' AND kind = 'alias'
GROUP BY entity_id;

-- Public ids of teams, without the profile joins of api.teams.
CREATE VIEW api.team_keys AS
SELECT t.id AS team_id, api.public_id('team', t.id) AS public_id, t.name, cr.source_url AS image_url
FROM core.teams t LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id;

GRANT SELECT ON api.player_appearances, api.player_search_aliases, api.team_keys TO vega_read;
REVOKE ALL ON FUNCTION api.internal_id(core.entity_type, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.internal_id(core.entity_type, text) TO vega_read;
