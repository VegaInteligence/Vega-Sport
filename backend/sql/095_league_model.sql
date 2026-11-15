-- League levels, version 4 (vega/power.py, « League levels (version 4) »): every league has a
-- level and its standard error, from the matches between leagues, the players who change
-- league and a prior by division and confederation; a league is measured (linked, its players
-- ranked) when the error is at most power.MEASURED_SE. A women's league is a universe of its own.
SET LOCAL lock_timeout = '3s';
ALTER TABLE agg.league_levels
  ADD COLUMN level_se real,
  ADD COLUMN tier smallint,
  ADD COLUMN confederation text,
  ADD COLUMN movers integer,
  ADD COLUMN universe text NOT NULL DEFAULT 'men' CHECK (universe IN ('men', 'women'));
ALTER TABLE agg.power_runs
  ADD COLUMN level_exchange real,
  ADD COLUMN tier_gap real,
  ADD COLUMN tier_gap_sd real,
  ADD COLUMN top_sd real,
  ADD COLUMN pair_sd real,
  ADD COLUMN dispersion real,
  ADD COLUMN measured_se real;

-- The moves between leagues the levels read (power.move_evidence), computed again only when a
-- finished award year's ranking changes: one set, its pairs of leagues.
CREATE TABLE agg.league_move_sets (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_run integer NOT NULL REFERENCES agg.power_runs,
  variance real NOT NULL,
  stayers integer NOT NULL,
  moves integer NOT NULL,
  persistence real,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agg.league_moves (
  set_id integer NOT NULL REFERENCES agg.league_move_sets ON DELETE CASCADE,
  competition_a integer NOT NULL REFERENCES core.competitions ON DELETE CASCADE,
  competition_b integer NOT NULL REFERENCES core.competitions ON DELETE CASCADE,
  movers integer NOT NULL,
  mean_change real NOT NULL,
  PRIMARY KEY (set_id, competition_a, competition_b)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.league_move_sets, agg.league_moves TO vega_calc;

-- The read gives the new columns, at its end.
CREATE OR REPLACE VIEW api.league_levels AS
SELECT coalesce(cp.provider_key, 'l_v' || lpad(l.competition_id::text, 7, '0')) AS competition_id, c.name, c.country_code AS country,
  l.level::numeric::float8 AS level, l.entry_level::numeric::float8 AS entry_level, l.teams, l.links, l.linked,
  r.finished_at AS computed_at, r.method_version, l.competition_id AS competition_key,
  l.level_se::numeric::float8 AS level_se, l.tier, l.universe, l.confederation, l.movers
FROM agg.league_levels l
JOIN core.competitions c ON c.id = l.competition_id
JOIN agg.power_runs r ON r.id = l.run_id
LEFT JOIN core.provider_ids cp ON cp.entity_type = 'competition' AND cp.entity_id = l.competition_id
  AND cp.provider = 'pitchapi' AND cp.is_current;
