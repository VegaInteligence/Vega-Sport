-- A source without team ids (archives, complementary cups) names each side of a match: that
-- name is a fact of the match record, kept with it (as match_events.player_name keeps a
-- scorer known only by name). The team itself is one entity whatever the sources
-- (sources/identity.py merges a source-only team into its PitchAPI team); the archive and
-- cup reads show each match as its source wrote it.
ALTER TABLE core.matches
  ADD COLUMN home_team_name text,
  ADD COLUMN away_team_name text;

UPDATE core.matches m SET home_team_name = t.name FROM core.teams t
WHERE m.source <> 'pitchapi' AND m.home_team_name IS NULL AND t.id = m.home_team_id;
UPDATE core.matches m SET away_team_name = t.name FROM core.teams t
WHERE m.source <> 'pitchapi' AND m.away_team_name IS NULL AND t.id = m.away_team_id;

CREATE OR REPLACE VIEW api.archive_matches AS
SELECT m.season_id, m.id AS match_id, se.label AS season, m.archive_key AS key, m.archive_position AS position,
  cs.archive_key AS competition_id, cs.archive_name AS competition, cs.archive_country AS country,
  m.match_date AS date, m.date_unverified, r.name AS round, coalesce(m.home_team_name, ht.name) AS team1, coalesce(m.away_team_name, awt.name) AS team2,
  m.home_score, m.away_score, m.home_score_et, m.away_score_et, m.home_penalty_score, m.away_penalty_score,
  m.decided_on_penalties, m.status::text AS status, m.note, m.is_neutral,
  (SELECT count(*) FROM core.match_events e WHERE e.season_id = m.season_id AND e.match_id = m.id AND e.event_type = 'goal')::int AS goal_count
FROM core.matches m
JOIN core.seasons se ON se.id = m.season_id
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
LEFT JOIN core.rounds r ON r.id = m.round_id
LEFT JOIN core.teams ht ON ht.id = m.home_team_id
LEFT JOIN core.teams awt ON awt.id = m.away_team_id
WHERE m.archive_key IS NOT NULL;

CREATE OR REPLACE VIEW api.archive_goals AS
SELECT e.season_id, e.match_id, e.seq, e.source_minute AS minute, coalesce(p.name, e.player_name) AS player,
  CASE WHEN e.team_id = m.home_team_id THEN coalesce(m.home_team_name, t.name)
       WHEN e.team_id = m.away_team_id THEN coalesce(m.away_team_name, t.name) ELSE t.name END AS team,
  e.score_home, e.score_away, e.score_disagreement
FROM core.match_events e
JOIN core.matches m ON m.id = e.match_id AND m.season_id = e.season_id AND m.archive_key IS NOT NULL
LEFT JOIN core.players p ON p.id = e.player_id
LEFT JOIN core.teams t ON t.id = e.team_id
WHERE e.event_type = 'goal';

CREATE OR REPLACE VIEW api.cup_matches AS
SELECT m.competition_season_id, m.id AS match_id, m.archive_position AS position, k.provider_key AS key, m.source::text AS provider,
  m.match_date AS date, m.status::text AS status, r.name AS round, m.group_name, m.match_number,
  coalesce(m.home_team_name, ht.name) AS home, hk.provider_key AS home_key,
  coalesce(m.away_team_name, awt.name) AS away, ak.provider_key AS away_key,
  m.home_score, m.away_score, m.home_score_90, m.away_score_90, m.home_score_ht, m.away_score_ht,
  m.home_score_et, m.away_score_et, m.home_penalty_score, m.away_penalty_score
FROM core.matches m
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.cup_key IS NOT NULL
LEFT JOIN core.provider_ids k ON k.entity_type = 'match' AND k.entity_id = m.id AND k.provider = m.source
LEFT JOIN core.rounds r ON r.id = m.round_id
LEFT JOIN core.teams ht ON ht.id = m.home_team_id
LEFT JOIN core.teams awt ON awt.id = m.away_team_id
LEFT JOIN core.provider_ids hk ON hk.entity_type = 'team' AND hk.entity_id = m.home_team_id AND hk.provider = m.source
LEFT JOIN core.provider_ids ak ON ak.entity_type = 'team' AND ak.entity_id = m.away_team_id AND ak.provider = m.source;
