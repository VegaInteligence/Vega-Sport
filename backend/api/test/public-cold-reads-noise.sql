-- 40,000 matches, 240,000 rows per participation table, 12,000 rich profiles.
-- Half the matches share the requested season, every hundredth match of the other season has the requested club.
-- The test owner loads generated padding into its disposable database. The relevant match facts in
-- public-cold-reads-fixture.sql use all the normal constraints and tracking triggers.
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO core.teams(id, name) SELECT i, 'Autre équipe ' || i FROM generate_series(1000, 1159) i;
INSERT INTO core.players(id, name) SELECT i, 'Autre joueur ' || i FROM generate_series(10000, 21999) i;
INSERT INTO core.provider_ids(entity_type, provider, entity_id, provider_key)
SELECT 'player', 'transfermarkt', i, i::text FROM generate_series(10000, 21999) i;
INSERT INTO core.provider_players(provider, provider_key, name, read_on, contract_until)
SELECT 'transfermarkt', i::text, 'Autre joueur ' || i, current_date, current_date + 365
FROM generate_series(10000, 21999) i;
INSERT INTO core.player_contracts(player_id, team_id, start_date, end_date, source, as_of)
SELECT i, 1000 + i % 160, current_date - 1, current_date + 365, 'vega', current_date
FROM generate_series(10000, 21999) i;
INSERT INTO core.player_market_values(player_id, valued_at, value_eur, source, as_of)
SELECT i, current_date - 1, 1500000, 'transfermarkt', current_date
FROM generate_series(10000, 21999) i;

INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score)
SELECT 40000 + i, CASE WHEN i <= 20000 THEN 1 ELSE 8000 END, CASE WHEN i <= 20000 THEN 2025 ELSE 2024 END,
  'pitchapi', 'finished', CASE WHEN i > 20000 AND i % 100 = 0 THEN 8011 ELSE 1000 + i % 160 END,
  1000 + (i + 17) % 160, 0, 0
FROM generate_series(1, 40000) i;
INSERT INTO core.match_events(season_id, match_id, seq, team_id, event_type, minute)
SELECT m.season_id, m.id, e.seq, e.team, 'substitution', 60
FROM core.matches m CROSS JOIN LATERAL (VALUES (1, m.home_team_id), (2, m.away_team_id)) e(seq, team)
WHERE m.id > 40000;
INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter)
SELECT m.season_id, m.id, CASE WHEN slot < 3 THEN m.home_team_id ELSE m.away_team_id END,
  10000 + ((m.id * 6 + slot) % 12000), slot % 3 = 2
FROM core.matches m CROSS JOIN generate_series(0, 5) slot
WHERE m.id > 40000;
INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played, goals)
SELECT season_id, match_id, team_id, player_id, CASE WHEN is_starter THEN 60 ELSE 30 END, 0
FROM core.lineup_players WHERE match_id > 40000;

SET LOCAL session_replication_role = origin;
ANALYZE core.matches, core.match_events, core.lineup_players, core.player_match_stats,
  core.players, core.teams, core.provider_ids, core.provider_players, core.player_contracts, core.player_market_values;
COMMIT;
