-- Read the verified emblem of the exact edition selected by each existing view.
-- The storage and link validation are owned by the archive migrations (141/142).
-- Keep family logos, established columns, views' row sets and reader grants.
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE VIEW api.cup_editions AS
SELECT cs.id AS competition_season_id, split_part(cs.cup_key, ':', 1) AS kind, split_part(cs.cup_key, ':', 2) AS competition,
  cs.native_label AS season, cs.cup_name AS name, cs.cup_source_url AS source_url, cs.cup_data_url AS data_url,
  cs.cup_checked_at AS checked_at, cs.cup_updated_at AS updated_at,
  api.public_id('competition', cs.competition_id) AS competition_id,
  CASE split_part(cs.cup_key, ':', 1) WHEN 'open-cups' THEN 'matches-v1' WHEN 'openligadb' THEN 'rounds-v1'
    WHEN 'open-matchday' THEN 'table-v1' ELSE 'results-v1' END AS format,
  cs.competition_id AS internal_competition_id,
  la.source_url AS logo_url, emblem.source_url AS edition_emblem_url
FROM core.competition_seasons cs
LEFT JOIN core.competitions c ON c.id = cs.competition_id
LEFT JOIN core.assets la ON la.id = c.logo_asset_id
LEFT JOIN core.assets emblem ON emblem.id = cs.emblem_asset_id
WHERE cs.cup_key IS NOT NULL;

CREATE OR REPLACE VIEW api.fixtures AS
SELECT m.id AS match_id, m.season_id, m.competition_season_id, m.revision,
  coalesce(mk.provider_key, 'm_v' || lpad(m.id::text, 7, '0')) AS id,
  se.label AS season, cs.native_label AS native_season, m.match_date AS day, m.kickoff_at,
  to_char(m.kickoff_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS time_utc,
  m.status::text AS status, r.name AS round_name, m.has_playoff,
  m.home_team_id AS home_internal_id,
  coalesce(hk.provider_key, 't_v' || lpad(m.home_team_id::text, 7, '0')) AS home_team_id,
  ht.name AS home_name, hc.source_url AS home_image_url,
  m.away_team_id AS away_internal_id,
  coalesce(ak.provider_key, 't_v' || lpad(m.away_team_id::text, 7, '0')) AS away_team_id,
  awt.name AS away_name, ac.source_url AS away_image_url,
  coalesce(ck.provider_key, 'l_v' || lpad(cs.competition_id::text, 7, '0')) AS league_id,
  c.name AS league_name, lg.source_url AS league_image_url, c.country_code AS country,
  m.home_score::float8 AS score_home, m.away_score::float8 AS score_away,
  m.home_penalty_score::float8 AS score_penalty_home, m.away_penalty_score::float8 AS score_penalty_away,
  ref.id AS referee_internal_id, ref.name AS referee, v.id AS venue_internal_id, v.name AS stadium,
  emblem.source_url AS edition_emblem_url
FROM core.matches m
JOIN core.seasons se ON se.id = m.season_id
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
JOIN core.competitions c ON c.id = cs.competition_id
LEFT JOIN core.rounds r ON r.id = m.round_id
LEFT JOIN core.teams ht ON ht.id = m.home_team_id
LEFT JOIN core.teams awt ON awt.id = m.away_team_id
LEFT JOIN core.assets hc ON hc.id = ht.crest_asset_id
LEFT JOIN core.assets ac ON ac.id = awt.crest_asset_id
LEFT JOIN core.assets lg ON lg.id = c.logo_asset_id
LEFT JOIN core.assets emblem ON emblem.id = cs.emblem_asset_id
LEFT JOIN core.referees ref ON ref.id = m.referee_id
LEFT JOIN core.venues v ON v.id = m.venue_id
LEFT JOIN core.provider_ids mk ON mk.entity_type = 'match' AND mk.entity_id = m.id AND mk.provider = 'pitchapi' AND mk.is_current
LEFT JOIN core.provider_ids hk ON hk.entity_type = 'team' AND hk.entity_id = m.home_team_id AND hk.provider = 'pitchapi' AND hk.is_current
LEFT JOIN core.provider_ids ak ON ak.entity_type = 'team' AND ak.entity_id = m.away_team_id AND ak.provider = 'pitchapi' AND ak.is_current
LEFT JOIN core.provider_ids ck ON ck.entity_type = 'competition' AND ck.entity_id = cs.competition_id AND ck.provider = 'pitchapi' AND ck.is_current;

CREATE OR REPLACE VIEW api.archive_editions AS
SELECT cs.id AS competition_season_id, se.label AS season, cs.archive_key AS id, cs.archive_name AS name,
  cs.archive_country AS country, cs.archive_position AS position, emblem.source_url AS edition_emblem_url
FROM core.competition_seasons cs JOIN core.seasons se ON se.id = cs.season_id
LEFT JOIN core.assets emblem ON emblem.id = cs.emblem_asset_id
WHERE cs.archive_key IS NOT NULL;

-- The match's own club sides also travel with its non-tabular cup representation.
CREATE OR REPLACE VIEW api.cup_matches AS
SELECT m.competition_season_id, m.id AS match_id, m.archive_position AS position, k.provider_key AS key, m.source::text AS provider,
  m.match_date AS date, m.status::text AS status, r.name AS round, m.group_name, m.match_number,
  coalesce(m.home_team_name, ht.name) AS home, hk.provider_key AS home_key,
  coalesce(m.away_team_name, awt.name) AS away, ak.provider_key AS away_key,
  m.home_score, m.away_score, m.home_score_90, m.away_score_90, m.home_score_ht, m.away_score_ht,
  m.home_score_et, m.away_score_et, m.home_penalty_score, m.away_penalty_score,
  m.is_neutral,
  api.public_id('team', home_kept.id) AS home_team_public_id, home_crest.source_url AS home_image_url,
  api.public_id('team', away_kept.id) AS away_team_public_id, away_crest.source_url AS away_image_url
FROM core.matches m
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.cup_key IS NOT NULL
LEFT JOIN core.provider_ids k ON k.entity_type = 'match' AND k.entity_id = m.id AND k.provider = m.source
LEFT JOIN core.rounds r ON r.id = m.round_id
LEFT JOIN core.teams ht ON ht.id = m.home_team_id
LEFT JOIN core.teams awt ON awt.id = m.away_team_id
LEFT JOIN core.teams home_kept ON home_kept.id = coalesce(ht.merged_into, ht.id)
LEFT JOIN core.assets home_crest ON home_crest.id = home_kept.crest_asset_id
LEFT JOIN core.teams away_kept ON away_kept.id = coalesce(awt.merged_into, awt.id)
LEFT JOIN core.assets away_crest ON away_crest.id = away_kept.crest_asset_id
LEFT JOIN LATERAL (
  SELECT p.provider_key FROM core.provider_ids p
  WHERE p.entity_type = 'team' AND p.entity_id = m.home_team_id AND p.provider = m.source
  ORDER BY (p.provider_key = 'name:' || m.home_team_name) DESC NULLS LAST, p.is_current DESC, p.provider_key LIMIT 1
) hk ON true
LEFT JOIN LATERAL (
  SELECT p.provider_key FROM core.provider_ids p
  WHERE p.entity_type = 'team' AND p.entity_id = m.away_team_id AND p.provider = m.source
  ORDER BY (p.provider_key = 'name:' || m.away_team_name) DESC NULLS LAST, p.is_current DESC, p.provider_key LIMIT 1
) ak ON true;
