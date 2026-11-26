-- A club's own season, independent of the shared seed's expectations.
INSERT INTO core.seasons(id, label) VALUES (2024, '2024/2025') ON CONFLICT (id) DO NOTHING;
SELECT core.ensure_season_partitions(2024);
INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label)
VALUES (8000, 1, 2024, '2024/2025');
INSERT INTO core.teams(id, name) VALUES (8011, 'Club du test'), (8012, 'Adversaire'), (8013, 'Autre club');
INSERT INTO core.assets(id, kind, source_url) VALUES (8000, 'photo', 'https://img.example/substitution.png');
INSERT INTO core.players(id, name, photo_asset_id) VALUES
  (201, 'Aline', NULL), (202, 'Brune', 8000), (203, 'Aline', 8000), (204, 'Béatrice', NULL),
  (205, 'Zoé', NULL), (206, 'Aaron', NULL), (207, 'Statut inconnu', NULL), (208, 'Titulaire', NULL),
  (209, 'Minutes inconnues', NULL), (210, 'Sur le banc', NULL), (211, 'Sans contribution', NULL),
  (212, 'Feuille seule', NULL), (213, 'Statistiques seules', NULL);
INSERT INTO core.provider_ids(entity_type, provider, entity_id, provider_key) VALUES ('player', 'pitchapi', 205, 'p_cold01');

INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score)
VALUES
  (8001, 1, 2025, 'pitchapi', 'finished', 8011, 8012, 2, 1), -- leading at the first change
  (8002, 1, 2025, 'pitchapi', 'finished', 8012, 8011, 1, 2), -- trailing away
  (8003, 1, 2025, 'pitchapi', 'finished', 8011, 8012, 1, 0), -- level at the first change
  (8004, 1, 2025, 'pitchapi', 'finished', 8011, 8012, 2, 0), -- missing a goal event
  (8005, 1, 2025, 'pitchapi', 'finished', 8012, 8011, 0, 0), -- no change event
  (8006, 1, 2025, 'pitchapi', 'not_started', 8011, 8012, NULL, NULL),
  (8007, 1, 2025, 'pitchapi', 'finished', 8012, 8013, 5, 0),
  (8008, 8000, 2024, 'pitchapi', 'finished', 8011, 8012, 5, 0);
INSERT INTO core.match_events(season_id, match_id, seq, team_id, event_type, minute) VALUES
  (2025, 8001, 1, 8011, 'goal', 10), (2025, 8001, 2, 8011, 'substitution', 62),
  (2025, 8001, 3, 8012, 'goal', 81), (2025, 8001, 4, 8011, 'goal', 88),
  (2025, 8001, 5, 8011, 'substitution', 61),
  (2025, 8002, 1, 8012, 'goal', 10), (2025, 8002, 2, 8011, 'substitution', 70),
  (2025, 8002, 3, 8011, 'goal', 75), (2025, 8002, 4, 8011, 'goal', 82),
  (2025, 8003, 1, 8011, 'substitution', 57), (2025, 8003, 2, 8011, 'goal', 65),
  (2025, 8004, 1, 8011, 'goal', 14), (2025, 8004, 2, 8011, 'substitution', 20),
  (2025, 8006, 1, 8011, 'substitution', 50);
INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter) VALUES
  (2025, 8004, 8011, 201, false), (2025, 8005, 8011, 201, false), (2025, 8002, 8011, 202, false),
  (2025, 8002, 8011, 203, false), (2025, 8003, 8011, 204, false), (2025, 8003, 8011, 205, false),
  (2025, 8001, 8011, 206, false), (2025, 8001, 8011, 207, NULL), (2025, 8001, 8011, 208, true),
  (2025, 8001, 8011, 209, false), (2025, 8001, 8011, 210, false), (2025, 8001, 8011, 211, false),
  (2025, 8001, 8011, 212, false), (2025, 8001, 8012, 213, false),
  (2025, 8006, 8011, 201, false), (2025, 8007, 8012, 201, false), (2024, 8008, 8011, 201, false);
INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played, goals, assists) VALUES
  (2025, 8004, 8012, 201, 20, 1, 1), -- a conflicting team in the statistics: the sheet takes precedence
  (2025, 8005, 8011, 201, 25, NULL, NULL),
  (2025, 8002, 8011, 202, 50, 2, NULL), (2025, 8002, 8011, 203, 45, 1, 1),
  (2025, 8003, 8011, 204, 45, 1, 1), (2025, 8003, 8011, 205, 29, 2, 1), (2025, 8001, 8011, 206, 47, 1, 1),
  (2025, 8001, 8011, 207, 18, 5, 5), (2025, 8001, 8011, 208, 18, 5, 5),
  (2025, 8001, 8011, 209, NULL, 5, 5), (2025, 8001, 8011, 210, 0, 5, 5),
  (2025, 8001, 8011, 211, 12, NULL, NULL), (2025, 8001, 8011, 213, 10, 5, 5),
  (2025, 8006, 8011, 201, 30, 5, 0), (2025, 8007, 8012, 201, 20, 5, 0), (2024, 8008, 8011, 201, 20, 5, 0);
