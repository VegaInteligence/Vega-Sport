-- The reads of an archived World Cup match's details (GET /api/worldcup/matches…, mock-up validated 18 Nov 2026), from
-- the Fjelstul World Cup Database (137). A match is served as the archived match it is paired with: its home side is
-- the archive's home side (`swapped`: the database lists the two teams the other way), its score is the base's.
-- Only the men's matches paired with an archived match are served: the base holds no women's World Cup.
SET LOCAL lock_timeout = '3s';

ALTER TABLE core.worldcup_matches ADD COLUMN swapped boolean;
COMMENT ON COLUMN core.worldcup_matches.swapped IS
  'The archived match (match_id) lists the away team of the database first; set with match_id, by the reader.';
-- The pairs made before this column are made again, with it, at the reader's next round.
UPDATE core.worldcup_matches SET match_id = NULL;
UPDATE ops.source_runs SET last_success_at = NULL WHERE source = 'fjelstul';

CREATE VIEW api.worldcup_match_index AS
SELECT w.match_key AS key, t.year AS edition, m.match_date AS date, m.home_team_name AS home, m.away_team_name AS away
FROM core.worldcup_matches w
JOIN core.worldcup_tournaments t USING (tournament_key)
JOIN core.matches m ON m.id = w.match_id
WHERE NOT t.women;

CREATE VIEW api.worldcup_match_heads AS
SELECT w.match_key AS key, t.year AS edition, w.stage, w.group_name, m.match_date AS date, to_char(w.match_time, 'HH24:MI') AS time,
  s.name AS stadium, s.city, s.country,
  m.home_team_name AS home, m.away_team_name AS away,
  CASE WHEN w.swapped THEN w.away_team_key ELSE w.home_team_key END AS home_team_key,
  CASE WHEN w.swapped THEN w.home_team_key ELSE w.away_team_key END AS away_team_key,
  m.home_score, m.away_score, m.home_penalty_score, m.away_penalty_score, w.extra_time
FROM core.worldcup_matches w
JOIN core.worldcup_tournaments t USING (tournament_key)
JOIN core.matches m ON m.id = w.match_id
JOIN core.worldcup_stadiums s USING (stadium_key)
WHERE NOT t.women AND w.swapped IS NOT NULL;

-- Who was at a match: players, managers, the referee. A name is the given name and the family name, or the family
-- name alone (a player of a single name).
CREATE VIEW api.worldcup_match_people AS
SELECT a.match_key AS key, a.role, a.team_key, a.person_key AS person,
  CASE WHEN p.given_name IS NULL THEN p.family_name ELSE p.given_name || ' ' || p.family_name END AS name,
  p.country, a.shirt_number AS number, a.position, a.starter
FROM core.worldcup_appearances a JOIN core.worldcup_people p USING (person_key);

-- A match's events: goals (a penalty, an own goal counted for the team it benefits), cards, and each half of a
-- substitution, as the database gives them.
CREATE VIEW api.worldcup_match_events AS
SELECT e.match_key AS key, e.kind, e.team_key, e.player_key AS person,
  CASE WHEN p.given_name IS NULL THEN p.family_name ELSE p.given_name || ' ' || p.family_name END AS name,
  e.minute, e.stoppage, e.event_key
FROM (
  SELECT match_key, CASE WHEN own_goal THEN 'own_goal' WHEN penalty THEN 'penalty' ELSE 'goal' END AS kind, team_key, player_key, minute, stoppage, goal_key AS event_key
  FROM core.worldcup_goals
  UNION ALL
  SELECT match_key, CASE WHEN second_yellow THEN 'second_yellow' WHEN red THEN 'red' ELSE 'yellow' END, team_key, player_key, minute, stoppage, booking_key
  FROM core.worldcup_bookings
  UNION ALL
  SELECT match_key, CASE WHEN going_off THEN 'off' ELSE 'on' END, team_key, player_key, minute, stoppage, substitution_key
  FROM core.worldcup_substitutions
) e JOIN core.worldcup_people p ON p.person_key = e.player_key;

CREATE VIEW api.worldcup_match_kicks AS
SELECT k.match_key AS key, k.position, k.team_key, k.player_key AS person,
  CASE WHEN p.given_name IS NULL THEN p.family_name ELSE p.given_name || ' ' || p.family_name END AS name, k.converted
FROM core.worldcup_shootout_kicks k JOIN core.worldcup_people p ON p.person_key = k.player_key;

GRANT SELECT ON api.worldcup_match_index, api.worldcup_match_heads, api.worldcup_match_people, api.worldcup_match_events,
  api.worldcup_match_kicks TO vega_read;
