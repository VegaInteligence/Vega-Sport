-- The UEFA cups of the league-phase format (VI-19, 16 November 2026): each club's share of the
-- replays (forecast.simulate_cup) that finish the league phase in the first eight, from 9th to 24th
-- or below, and that reach the round of 16, the quarter-finals, the semi-finals, the final, and win.
-- A stage the club never reaches has no row; the rows go with the club's projection of the edition.
CREATE TABLE agg.cup_stage_odds (
  competition_season_id integer NOT NULL,
  team_id integer NOT NULL,
  stage text NOT NULL CHECK (stage IN ('top8', 'playoff', 'out', 'r16', 'qf', 'sf', 'final', 'win')),
  probability real NOT NULL CHECK (probability > 0 AND probability <= 1),
  PRIMARY KEY (competition_season_id, team_id, stage),
  FOREIGN KEY (competition_season_id, team_id) REFERENCES agg.season_projections ON DELETE CASCADE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.cup_stage_odds TO vega_calc;

CREATE VIEW api.cup_stage_odds AS
SELECT s.competition_season_id, s.team_id AS team_key, s.stage, s.probability::numeric::float8 AS probability
FROM agg.cup_stage_odds s;
GRANT SELECT ON api.cup_stage_odds TO vega_read;
