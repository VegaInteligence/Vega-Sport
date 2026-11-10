-- The club directory's rows (GET /api/read/clubs), read from the tables.
--
-- api.club_match_sides read api.match_list, which gives its public ids by api.public_id:
-- the function is SECURITY DEFINER, so never inlined, and it was called for every id of
-- every row. The read also named its season by label, which reaches core.matches only
-- through core.seasons: on 10 November 2026 the directory of 2026/2027 read the 593,624
-- matches of the table to keep 40,328 rows and took 5.6 s.
--
-- Same columns, same rows, read as the doc asks (a view reads tables, never another view):
--  - the public ids follow the rule of api.public_id, read from core.provider_ids. The
--    club's and the competition's, which every read uses, come by a join (as api.fixtures
--    since 021 and the key views since 057). The match's and the two teams' of its score
--    line, which only the analysis shows, are scalar subqueries: a read that does not name
--    them never runs them. A join on the current key is not removed when its column is
--    unused: the planner proves a join removable from a full unique index, and the unique
--    index on the current key is partial (WHERE is_current). The comment of 057 says the
--    contrary and is wrong: its key views keep that join whatever is read;
--  - the two sides of a match carry ids and scores only; the club, its crest and its
--    formation are joined to the side, and the home and away columns have their own
--    joins, on primary keys: a read that leaves those columns out leaves their joins out.
--    The directory reads neither the line-ups, nor the team statistics, nor the coverage;
--  - season_id and competition_season_id are the match's own columns: a read that binds
--    them reaches its matches by index (matches_competition_kickoff) and reads only its
--    season's partitions of the line-ups and the team statistics.
CREATE OR REPLACE VIEW api.club_match_sides AS
SELECT m.id AS match_id,
  coalesce((SELECT k.provider_key FROM core.provider_ids k WHERE k.entity_type = 'match' AND k.entity_id = m.id
    AND k.provider = 'pitchapi' AND k.is_current), 'm_v' || lpad(m.id::text, 7, '0')) AS public_id,
  se.label AS season, m.season_id, m.competition_season_id,
  coalesce(ck.provider_key, 'l_v' || lpad(cs.competition_id::text, 7, '0')) AS league_id,
  c.name AS league, c.country_code AS league_country,
  m.match_date AS date, m.kickoff_at AS time_utc, m.status::text AS status, mc.team_stats::text AS team_stats_coverage,
  x.side, x.team_id, coalesce(tk.provider_key, 't_v' || lpad(x.team_id::text, 7, '0')) AS team_public_id,
  t.name, ti.source_url AS image_url, t.country_code AS country, l.formation, x.own, x.against,
  (m.status = 'finished' AND x.own IS NOT NULL AND x.against IS NOT NULL) AS scored,
  coalesce((SELECT k.provider_key FROM core.provider_ids k WHERE k.entity_type = 'team' AND k.entity_id = m.home_team_id
    AND k.provider = 'pitchapi' AND k.is_current), 't_v' || lpad(m.home_team_id::text, 7, '0')) AS home_public_id,
  ht.name AS home_name, m.home_score, hl.formation AS home_formation,
  coalesce((SELECT k.provider_key FROM core.provider_ids k WHERE k.entity_type = 'team' AND k.entity_id = m.away_team_id
    AND k.provider = 'pitchapi' AND k.is_current), 't_v' || lpad(m.away_team_id::text, 7, '0')) AS away_public_id,
  awt.name AS away_name, m.away_score, al.formation AS away_formation,
  o.xg, o.total_shots, o.shots_on_target, o.possession_pct, o.passes, o.accurate_passes,
  o.touches_opp_box, o.corners, o.duels_won, o.aerials_won, o.tackles, o.interceptions,
  o.clearances, o.keeper_saves, p.xg AS xg_against, p.total_shots AS shots_against
FROM core.matches m
-- An archive or cup-source edition is not in the directory.
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
JOIN core.competitions c ON c.id = cs.competition_id
JOIN core.seasons se ON se.id = m.season_id
CROSS JOIN LATERAL (VALUES
  ('home', m.home_team_id, m.away_team_id, m.home_score, m.away_score),
  ('away', m.away_team_id, m.home_team_id, m.away_score, m.home_score)
) AS x(side, team_id, opponent_id, own, against)
LEFT JOIN core.teams t ON t.id = x.team_id
LEFT JOIN core.assets ti ON ti.id = t.crest_asset_id
LEFT JOIN core.provider_ids tk ON tk.entity_type = 'team' AND tk.entity_id = x.team_id
  AND tk.provider = 'pitchapi' AND tk.is_current
LEFT JOIN core.lineups l ON l.season_id = m.season_id AND l.match_id = m.id AND l.team_id = x.team_id
LEFT JOIN core.provider_ids ck ON ck.entity_type = 'competition' AND ck.entity_id = cs.competition_id
  AND ck.provider = 'pitchapi' AND ck.is_current
LEFT JOIN core.match_coverage mc ON mc.season_id = m.season_id AND mc.match_id = m.id
LEFT JOIN core.teams ht ON ht.id = m.home_team_id
LEFT JOIN core.teams awt ON awt.id = m.away_team_id
LEFT JOIN core.lineups hl ON hl.season_id = m.season_id AND hl.match_id = m.id AND hl.team_id = m.home_team_id
LEFT JOIN core.lineups al ON al.season_id = m.season_id AND al.match_id = m.id AND al.team_id = m.away_team_id
LEFT JOIN core.team_match_stats o ON o.season_id = m.season_id AND o.match_id = m.id AND o.team_id = x.team_id AND o.period = 'all'
LEFT JOIN core.team_match_stats p ON p.season_id = m.season_id AND p.match_id = m.id AND p.team_id = x.opponent_id AND p.period = 'all'
WHERE m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL AND m.home_team_id <> m.away_team_id;
