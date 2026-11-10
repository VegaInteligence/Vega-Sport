-- Read API support (v2/api): what the current routes need, read from api only.
-- The legacy envelope speaks of a publication "generation" and of "partitions"
-- (season × competition); here they are the resource versions and the editions.

-- One global generation: it grows whenever any resource version is published.
CREATE VIEW api.publication AS
SELECT coalesce(sum(version), 0)::bigint AS generation,
  max(coalesce(published_at, updated_at)) AS published_at
FROM ops.resource_versions;

-- One row per edition that has matches: the legacy partition and its watermarks.
-- Historical archive editions are not partitions (they have their own reads).
CREATE VIEW api.editions AS
SELECT cs.id AS competition_season_id, s.label AS season, cs.native_label, cs.is_current,
  api.public_id('competition', c.id) AS league_id, c.name AS league_name, c.country_code AS country,
  c.kind::text AS kind, lg.source_url AS league_image_url,
  x.start_date, x.end_date, x.match_count, x.finished_count, x.collected_count, x.team_count, x.retrieved_at
FROM core.competition_seasons cs
JOIN core.seasons s ON s.id = cs.season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
JOIN core.competitions c ON c.id = cs.competition_id
LEFT JOIN core.assets lg ON lg.id = c.logo_asset_id
JOIN LATERAL (
  SELECT min(m.match_date) AS start_date, max(m.match_date) AS end_date, count(*) AS match_count,
    count(*) FILTER (WHERE m.status = 'finished') AS finished_count,
    count(*) FILTER (WHERE mc.player_stats = 'ok') AS collected_count,
    (SELECT count(*) FROM core.team_seasons ts WHERE ts.competition_season_id = cs.id) AS team_count,
    max(f.last_success_at) AS retrieved_at
  FROM core.matches m
  LEFT JOIN LATERAL (
    SELECT max(fs.last_success_at) AS last_success_at FROM ops.family_state fs WHERE fs.match_id = m.id
  ) f ON true
  LEFT JOIN core.match_coverage mc ON mc.season_id = m.season_id AND mc.match_id = m.id
  WHERE m.competition_season_id = cs.id
) x ON x.match_count > 0;

-- One row per club and match, with both sides, formations and the team statistics
-- the club directory and its analysis aggregate (legacy /api/read/clubs).
CREATE VIEW api.club_match_sides AS
SELECT m.match_id, m.public_id, s.label AS season, m.season_id, m.competition_season_id,
  m.competition_public_id AS league_id, m.competition_name AS league, cc.country_code AS league_country,
  m.match_date AS date, m.kickoff_at AS time_utc, m.status, m.team_stats_coverage,
  x.side, x.team_id, x.team_public_id, x.name, x.image_url, x.country, x.formation, x.own, x.against,
  (m.status = 'finished' AND x.own IS NOT NULL AND x.against IS NOT NULL) AS scored,
  m.home_public_id, m.home_name, m.home_score, hl.formation AS home_formation,
  m.away_public_id, m.away_name, m.away_score, al.formation AS away_formation,
  o.xg, o.total_shots, o.shots_on_target, o.possession_pct, o.passes, o.accurate_passes,
  o.touches_opp_box, o.corners, o.duels_won, o.aerials_won, o.tackles, o.interceptions,
  o.clearances, o.keeper_saves, p.xg AS xg_against, p.total_shots AS shots_against
FROM api.match_list m
JOIN core.seasons s ON s.id = m.season_id
JOIN core.competitions cc ON cc.id = m.competition_id
LEFT JOIN core.teams ht ON ht.id = m.home_team_id
LEFT JOIN core.teams awt ON awt.id = m.away_team_id
LEFT JOIN core.assets hi ON hi.id = ht.crest_asset_id
LEFT JOIN core.assets ai ON ai.id = awt.crest_asset_id
LEFT JOIN core.lineups hl ON hl.season_id = m.season_id AND hl.match_id = m.match_id AND hl.team_id = m.home_team_id
LEFT JOIN core.lineups al ON al.season_id = m.season_id AND al.match_id = m.match_id AND al.team_id = m.away_team_id
CROSS JOIN LATERAL (VALUES
  ('home', m.home_team_id, m.home_public_id, m.home_name, hi.source_url, ht.country_code, hl.formation, m.home_score, m.away_score, m.away_team_id),
  ('away', m.away_team_id, m.away_public_id, m.away_name, ai.source_url, awt.country_code, al.formation, m.away_score, m.home_score, m.home_team_id)
) AS x(side, team_id, team_public_id, name, image_url, country, formation, own, against, opponent_id)
LEFT JOIN core.team_match_stats o ON o.season_id = m.season_id AND o.match_id = m.match_id AND o.team_id = x.team_id AND o.period = 'all'
LEFT JOIN core.team_match_stats p ON p.season_id = m.season_id AND p.match_id = m.match_id AND p.team_id = x.opponent_id AND p.period = 'all'
WHERE m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL AND m.home_team_id <> m.away_team_id
  AND NOT EXISTS (SELECT 1 FROM core.competition_seasons ax WHERE ax.id = m.competition_season_id AND (ax.archive_key IS NOT NULL OR ax.cup_key IS NOT NULL));

-- The manifest's competition catalogue: every known edition label, latest first.
CREATE VIEW api.competitions AS
SELECT api.public_id('competition', c.id) AS id, c.name, c.country_code AS country, c.kind::text AS kind,
  lg.source_url AS image_url,
  (SELECT array_agg(cs.native_label ORDER BY cs.season_id DESC, cs.id DESC)
   FROM core.competition_seasons cs WHERE cs.competition_id = c.id AND cs.archive_key IS NULL AND cs.cup_key IS NULL) AS seasons
FROM core.competitions c
LEFT JOIN core.assets lg ON lg.id = c.logo_asset_id
-- An archive or cup-source competition (only such editions) is not in the catalogue.
WHERE NOT EXISTS (SELECT 1 FROM core.competition_seasons cs WHERE cs.competition_id = c.id AND (cs.archive_key IS NOT NULL OR cs.cup_key IS NOT NULL))
   OR EXISTS (SELECT 1 FROM core.competition_seasons cs WHERE cs.competition_id = c.id AND cs.archive_key IS NULL AND cs.cup_key IS NULL);

-- Club countries for the manifest (clubCountries), without the team profile joins.
CREATE VIEW api.team_countries AS
SELECT api.public_id('team', t.id) AS team_id, t.country_code AS country
FROM core.teams t WHERE t.country_code IS NOT NULL;
