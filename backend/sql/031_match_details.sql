-- Match details read per family (GET /api/matches/{id}[/<family>], v2/api/src/match-families.mjs):
-- the typed rows of one match, with the public ids, names and images of the people and
-- teams they name. Two facts the site shows were not kept yet: a player's rank in the
-- line-up (starters by role, substitutes as they came on) and the head-to-head meetings.

ALTER TABLE core.lineup_players ADD COLUMN lineup_order smallint CHECK (lineup_order >= 0);

CREATE TABLE core.match_h2h_meetings (
  season_id smallint NOT NULL,
  match_id integer NOT NULL,
  seq smallint NOT NULL CHECK (seq >= 0),
  kickoff_at timestamptz,
  home_team_id integer REFERENCES core.teams,
  away_team_id integer REFERENCES core.teams,
  home_score smallint,
  away_score smallint,
  finished boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, match_id, seq),
  FOREIGN KEY (match_id, season_id) REFERENCES core.matches(id, season_id) ON DELETE CASCADE
) PARTITION BY LIST (season_id);
-- The seasons that already exist get the new table's partition (new ones get it on creation).
SELECT core.ensure_season_partitions(id) FROM core.seasons;

CREATE VIEW api.match_lineup_rows AS
SELECT l.season_id, l.match_id, l.team_id AS internal_team_id, l.side::text AS side, l.formation, l.confirmed, l.lineup_type,
  co.name AS coach
FROM core.lineups l LEFT JOIN core.coaches co ON co.id = l.coach_id;

CREATE VIEW api.match_lineup_player_rows AS
SELECT lp.season_id, lp.match_id, lp.team_id AS internal_team_id, api.public_id('player', lp.player_id) AS player_id, p.name,
  lp.is_starter, lp.lineup_order, lp.shirt_number, lp.position_id, lp.is_captain, lp.pitch_x, lp.pitch_y
FROM core.lineup_players lp JOIN core.players p ON p.id = lp.player_id;

CREATE VIEW api.match_event_rows AS
SELECT e.season_id, e.match_id, e.seq, e.event_type::text AS event_type, e.minute, e.minute_added, e.period::text AS period,
  api.public_id('team', e.team_id) AS team_id,
  api.public_id('player', e.player_id) AS player_id, p.name AS player_name, pa.source_url AS player_image_url,
  api.public_id('player', e.related_player_id) AS related_id, r.name AS related_name, ra.source_url AS related_image_url,
  e.score_home, e.score_away, e.is_own_goal, e.is_penalty
FROM core.match_events e
LEFT JOIN core.players p ON p.id = e.player_id LEFT JOIN core.assets pa ON pa.id = p.photo_asset_id
LEFT JOIN core.players r ON r.id = e.related_player_id LEFT JOIN core.assets ra ON ra.id = r.photo_asset_id;

CREATE VIEW api.match_shot_rows AS
SELECT s.season_id, s.match_id, s.shot_no, s.provider_shot_key AS id, s.period::text AS period, s.minute, s.minute_added,
  api.public_id('team', s.team_id) AS team_id,
  api.public_id('player', s.player_id) AS player_id, p.name AS player_name, pa.source_url AS player_image_url,
  api.public_id('player', s.keeper_id) AS keeper_id, k.name AS keeper_name, ka.source_url AS keeper_image_url,
  s.x, s.y, s.xg, s.xgot, s.is_on_target, s.goal_crossed_y, s.goal_crossed_z, s.is_inside_box,
  s.outcome::text AS outcome, s.situation::text AS situation, s.body_part::text AS body_part,
  s.is_blocked, s.blocked_x, s.blocked_y, s.is_own_goal, s.is_saved_off_line
FROM core.shots s
LEFT JOIN core.players p ON p.id = s.player_id LEFT JOIN core.assets pa ON pa.id = p.photo_asset_id
LEFT JOIN core.players k ON k.id = s.keeper_id LEFT JOIN core.assets ka ON ka.id = k.photo_asset_id;

CREATE VIEW api.match_team_stat_rows AS
SELECT s.*, s.period::text AS period_name FROM core.team_match_stats s;

CREATE VIEW api.match_player_stat_rows AS
SELECT s.*, api.public_id('player', s.player_id) AS player_public_id, p.name AS player_name, ph.source_url AS player_image_url,
  api.public_id('team', s.team_id) AS team_public_id,
  EXISTS (SELECT 1 FROM core.shots x WHERE x.season_id = s.season_id AND x.match_id = s.match_id
          AND s.player_id IN (x.player_id, x.keeper_id)) AS has_shot
FROM core.player_match_stats s JOIN core.players p ON p.id = s.player_id LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id;

CREATE VIEW api.match_player_half_rows AS
SELECT s.*, s.period::text AS period_name, api.public_id('player', s.player_id) AS player_public_id, p.name AS player_name,
  ph.source_url AS player_image_url, api.public_id('team', s.team_id) AS team_public_id
FROM core.player_match_half_stats s JOIN core.players p ON p.id = s.player_id LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id;

CREATE VIEW api.match_momentum_rows AS
SELECT season_id, match_id, minute, value FROM core.match_momentum;

CREATE VIEW api.match_h2h_rows AS
SELECT season_id, match_id, home_wins, draws, away_wins, total_matches FROM core.match_h2h;

CREATE VIEW api.match_h2h_meeting_rows AS
SELECT h.season_id, h.match_id, h.seq, h.kickoff_at, h.finished, h.home_score, h.away_score,
  api.public_id('team', h.home_team_id) AS home_id, ht.name AS home_name,
  api.public_id('team', h.away_team_id) AS away_id, awt.name AS away_name
FROM core.match_h2h_meetings h
LEFT JOIN core.teams ht ON ht.id = h.home_team_id LEFT JOIN core.teams awt ON awt.id = h.away_team_id;

-- A player's shirt in a match is the line-up's, else the profile's.
CREATE VIEW api.match_team_advanced_rows AS
SELECT a.*, api.public_id('team', a.team_id) AS team_public_id, t.name AS team_name
FROM core.team_match_advanced a JOIN core.teams t ON t.id = a.team_id;

CREATE VIEW api.match_player_advanced_rows AS
SELECT a.*, api.public_id('player', a.player_id) AS player_public_id, p.name AS player_name,
  coalesce(lp.shirt_number, p.shirt_number) AS shirt, api.public_id('team', a.team_id) AS team_public_id
FROM core.player_match_advanced a JOIN core.players p ON p.id = a.player_id
LEFT JOIN core.lineup_players lp ON lp.season_id = a.season_id AND lp.match_id = a.match_id AND lp.player_id = a.player_id;

CREATE VIEW api.match_network_rows AS
SELECT n.season_id, n.match_id, n.team_id AS internal_team_id, api.public_id('team', n.team_id) AS team_id, t.name AS team_name,
  n.window_kind, n.window_until_s, n.centralization
FROM core.pass_network_teams n JOIN core.teams t ON t.id = n.team_id;

CREATE VIEW api.match_network_node_rows AS
SELECT n.season_id, n.match_id, n.team_id AS internal_team_id, api.public_id('player', n.player_id) AS player_id, p.name,
  coalesce(lp.shirt_number, p.shirt_number) AS shirt, n.avg_x, n.avg_y, n.passes, n.passes_received, n.degree, n.strength,
  n.betweenness, n.clustering
FROM core.pass_network_nodes n JOIN core.players p ON p.id = n.player_id
LEFT JOIN core.lineup_players lp ON lp.season_id = n.season_id AND lp.match_id = n.match_id AND lp.player_id = n.player_id;

CREATE VIEW api.match_network_edge_rows AS
SELECT e.season_id, e.match_id, e.team_id AS internal_team_id, e.passes,
  api.public_id('player', e.from_player_id) AS from_id, f.name AS from_name, coalesce(lf.shirt_number, f.shirt_number) AS from_shirt,
  api.public_id('player', e.to_player_id) AS to_id, t.name AS to_name, coalesce(lt.shirt_number, t.shirt_number) AS to_shirt
FROM core.pass_network_edges e
JOIN core.players f ON f.id = e.from_player_id JOIN core.players t ON t.id = e.to_player_id
LEFT JOIN core.lineup_players lf ON lf.season_id = e.season_id AND lf.match_id = e.match_id AND lf.player_id = e.from_player_id
LEFT JOIN core.lineup_players lt ON lt.season_id = e.season_id AND lt.match_id = e.match_id AND lt.player_id = e.to_player_id;

CREATE VIEW api.match_heatmap_rows AS
SELECT h.season_id, h.match_id, 'team' AS kind, CASE WHEN h.team_id = m.home_team_id THEN 'home' ELSE 'away' END AS side,
  api.public_id('team', h.team_id) AS team_id, t.name AS team_name, NULL::text AS player_id, NULL::text AS player_name,
  NULL::smallint AS shirt, h.actions, h.cells
FROM core.team_heatmaps h JOIN core.matches m ON m.id = h.match_id AND m.season_id = h.season_id JOIN core.teams t ON t.id = h.team_id
UNION ALL
SELECT h.season_id, h.match_id, 'player', CASE WHEN h.team_id = m.home_team_id THEN 'home' ELSE 'away' END,
  api.public_id('team', h.team_id), t.name, api.public_id('player', h.player_id), p.name,
  coalesce(lp.shirt_number, p.shirt_number), h.actions, h.cells
FROM core.player_heatmaps h JOIN core.matches m ON m.id = h.match_id AND m.season_id = h.season_id
LEFT JOIN core.teams t ON t.id = h.team_id JOIN core.players p ON p.id = h.player_id
LEFT JOIN core.lineup_players lp ON lp.season_id = h.season_id AND lp.match_id = h.match_id AND lp.player_id = h.player_id;

-- Which detail families of a match were collected ("ok"), by family name.
CREATE VIEW api.match_family_coverage AS
SELECT mc.season_id, mc.match_id, mc.lineups::text AS lineups, mc.player_stats::text AS player_stats, mc.team_stats::text AS team_stats,
  mc.shots::text AS shots, mc.events::text AS events, mc.momentum::text AS momentum, mc.player_halves::text AS player_halves,
  mc.advanced::text AS advanced, mc.advanced_players::text AS advanced_players, mc.network::text AS network,
  mc.heatmaps::text AS heatmaps, mc.h2h::text AS h2h
FROM core.match_coverage mc;

-- Profiles of players and teams (legacy /api/pitchapi/players/{id} and /teams/{id}).
CREATE VIEW api.player_profiles AS
SELECT p.id AS player_id, api.public_id('player', p.id) AS public_id, p.name, p.short_name, p.position_id, p.country_code,
  p.shirt_number, ph.source_url AS image_url
FROM core.players p LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id;

CREATE VIEW api.team_profiles AS
SELECT t.id AS team_id, api.public_id('team', t.id) AS public_id, t.name, t.short_name, t.country_code, cr.source_url AS image_url
FROM core.teams t LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id;
