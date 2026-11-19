-- football-data.co.uk's season files (vega/sources/footballdata.py, the user's choice of 19 November 2026): the
-- league seasons 2000/01–2020/21 the base archives, with what the archives lack: half-time scores, match statistics
-- where the file has them, referees (England), 1X2 prices. One row per row of a file, as typed by the reader; a club
-- name is the file's own. The one link to the base is a match's (match_id): the archived match of the same country
-- and season between the teams the row's names stand for. An archive that replaces that match clears the link
-- (ON DELETE SET NULL) and the reader pairs it again at its next round. Nothing reads these rows yet.
--
-- The credit and the site's terms are a row of core.source_revisions ('football-data-co-uk'), as the other sources'.
-- The provider value football_data was added by 008 and never used before.
SET LOCAL lock_timeout = '3s';

CREATE TABLE core.footballdata_matches (
  file_key text NOT NULL CHECK (file_key ~ '^(E0|E1|E2|E3|SP1|SP2|D1|D2|I1|I2|F1|F2|P1|N1)/[0-9]{4}$'),
  row_number integer NOT NULL CHECK (row_number >= 2),
  division text NOT NULL CHECK (division = split_part(file_key, '/', 1)),
  season_id smallint NOT NULL CHECK (season_id BETWEEN 1993 AND 2020),
  match_date date NOT NULL,
  kickoff_time time,
  home_name text NOT NULL CHECK (home_name <> ''),
  away_name text NOT NULL CHECK (away_name <> '' AND away_name <> home_name),
  home_goals smallint NOT NULL CHECK (home_goals >= 0),
  away_goals smallint NOT NULL CHECK (away_goals >= 0),
  ht_home_goals smallint CHECK (ht_home_goals BETWEEN 0 AND home_goals),
  ht_away_goals smallint CHECK (ht_away_goals BETWEEN 0 AND away_goals),
  referee text,
  attendance integer CHECK (attendance >= 0),
  home_shots smallint CHECK (home_shots >= 0), away_shots smallint CHECK (away_shots >= 0),
  home_shots_on_target smallint CHECK (home_shots_on_target >= 0), away_shots_on_target smallint CHECK (away_shots_on_target >= 0),
  home_woodwork smallint CHECK (home_woodwork >= 0), away_woodwork smallint CHECK (away_woodwork >= 0),
  home_corners smallint CHECK (home_corners >= 0), away_corners smallint CHECK (away_corners >= 0),
  home_fouls smallint CHECK (home_fouls >= 0), away_fouls smallint CHECK (away_fouls >= 0),
  home_free_kicks_conceded smallint CHECK (home_free_kicks_conceded >= 0), away_free_kicks_conceded smallint CHECK (away_free_kicks_conceded >= 0),
  home_offsides smallint CHECK (home_offsides >= 0), away_offsides smallint CHECK (away_offsides >= 0),
  home_yellow_cards smallint CHECK (home_yellow_cards >= 0), away_yellow_cards smallint CHECK (away_yellow_cards >= 0),
  home_red_cards smallint CHECK (home_red_cards >= 0), away_red_cards smallint CHECK (away_red_cards >= 0),
  home_booking_points smallint CHECK (home_booking_points >= 0), away_booking_points smallint CHECK (away_booking_points >= 0),
  -- 1X2 prices, each a whole triple or none: Bet365 and its closing prices, Pinnacle and its closing prices, the
  -- market's average and maximum (Oddsportal's from 2019/20, Betbrain's before).
  b365_home real, b365_draw real, b365_away real,
  b365_closing_home real, b365_closing_draw real, b365_closing_away real,
  pinnacle_home real, pinnacle_draw real, pinnacle_away real,
  pinnacle_closing_home real, pinnacle_closing_draw real, pinnacle_closing_away real,
  market_average_home real, market_average_draw real, market_average_away real,
  market_maximum_home real, market_maximum_draw real, market_maximum_away real,
  -- The base's archived match, when the reader finds exactly one.
  match_id integer UNIQUE REFERENCES core.matches(id) ON DELETE SET NULL,
  PRIMARY KEY (file_key, row_number),
  UNIQUE (file_key, home_name, away_name),
  CHECK (num_nulls(b365_home, b365_draw, b365_away) IN (0, 3)),
  CHECK (num_nulls(b365_closing_home, b365_closing_draw, b365_closing_away) IN (0, 3)),
  CHECK (num_nulls(pinnacle_home, pinnacle_draw, pinnacle_away) IN (0, 3)),
  CHECK (num_nulls(pinnacle_closing_home, pinnacle_closing_draw, pinnacle_closing_away) IN (0, 3)),
  CHECK (num_nulls(market_average_home, market_average_draw, market_average_away) IN (0, 3)),
  CHECK (num_nulls(market_maximum_home, market_maximum_draw, market_maximum_away) IN (0, 3))
);
CREATE INDEX footballdata_matches_season ON core.footballdata_matches (season_id, division, match_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON core.footballdata_matches TO vega_collect;
GRANT SELECT ON core.footballdata_matches TO vega_calc;

-- The reads (GET /api/archives/details, backend/api/src/routes/archive-details.mjs): no page reads them yet.
-- What the files hold and what is paired, per division and season; the country and level are the reader's DIVISIONS.
CREATE VIEW api.archive_detail_coverage AS
SELECT f.division, d.country, d.level, f.season_id,
  count(*)::int AS matches, count(f.match_id)::int AS paired,
  count(*) FILTER (WHERE num_nonnulls(f.home_shots, f.home_shots_on_target, f.home_corners, f.home_fouls, f.home_free_kicks_conceded,
                                      f.home_yellow_cards, f.home_red_cards, f.home_offsides, f.home_woodwork) > 0)::int AS with_stats,
  count(*) FILTER (WHERE num_nonnulls(f.b365_home, f.b365_closing_home, f.pinnacle_home, f.pinnacle_closing_home,
                                      f.market_average_home, f.market_maximum_home) > 0)::int AS with_odds
FROM core.footballdata_matches f
JOIN (VALUES ('E0', 'Angleterre', 1), ('E1', 'Angleterre', 2), ('E2', 'Angleterre', 3), ('E3', 'Angleterre', 4),
             ('SP1', 'Espagne', 1), ('SP2', 'Espagne', 2), ('D1', 'Allemagne', 1), ('D2', 'Allemagne', 2),
             ('I1', 'Italie', 1), ('I2', 'Italie', 2), ('F1', 'France', 1), ('F2', 'France', 2),
             ('P1', 'Portugal', 1), ('N1', 'Pays-Bas', 1)) AS d(division, country, level) USING (division)
GROUP BY f.division, d.country, d.level, f.season_id;

-- An archived match's row, under the archive's key, with the base's day and score.
CREATE VIEW api.archive_match_details AS
SELECT m.archive_key AS key, m.match_date AS date, m.home_score, m.away_score, f.*
FROM core.footballdata_matches f
JOIN core.matches m ON m.id = f.match_id
WHERE m.archive_key IS NOT NULL;

GRANT SELECT ON api.archive_detail_coverage, api.archive_match_details TO vega_read;
