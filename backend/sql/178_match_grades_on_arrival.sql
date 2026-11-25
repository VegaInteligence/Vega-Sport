-- 25 Nov 2026 (FAILURE_MODES.md §69, GitHub #236; hugo: « met cela en match »): a match is graded as soon as its player
-- statistics arrive, with the references of its award year's last players run (vega/arrival_grades.py), instead of
-- waiting for the season's next run (at least an hour). Additive: two tables, written by the calculation role, and an
-- index of the finished matches by kick-off.
SET LOCAL lock_timeout = '3s';

-- The contribution references each players run fits on its award year's rows (vega/power.py, references): per role and
-- indicator, how a value is expected (a volume: minutes / 90 · exp(alpha + beta · delta); a conditional: attempts ·
-- rate; a relative: 0) and its spread. Replaced by each run of the year, in the transaction that publishes it.
CREATE TABLE agg.player_contribution_refs (
  award_season smallint NOT NULL,
  role text NOT NULL,
  indicator text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('volume', 'conditional', 'relative')),
  alpha double precision,
  beta double precision,
  rate double precision,
  spread double precision NOT NULL CHECK (spread > 0),
  run_id integer NOT NULL REFERENCES agg.power_runs,
  PRIMARY KEY (award_season, role, indicator),
  CHECK ((kind = 'volume') = (alpha IS NOT NULL AND beta IS NOT NULL)),
  CHECK ((kind = 'conditional') = (rate IS NOT NULL))
);

-- The matches the step graded: their rows' latest change it read, when, against which run, how many players. A match is
-- graded again when its rows change after that, or when a run of its year is published after it. A withdrawn match
-- takes its row (ON DELETE CASCADE); the step deletes the rows of matches kicked off more than 7 days ago.
CREATE TABLE agg.match_grade_arrivals (
  season_id smallint NOT NULL,
  match_id integer NOT NULL REFERENCES core.matches(id) ON DELETE CASCADE,
  stats_at timestamptz NOT NULL,
  graded_at timestamptz NOT NULL DEFAULT now(),
  run_id integer NOT NULL REFERENCES agg.power_runs,
  players smallint NOT NULL CHECK (players >= 0),
  PRIMARY KEY (season_id, match_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON agg.player_contribution_refs, agg.match_grade_arrivals TO vega_calc;

-- The step looks every minute for the finished matches of the last 3 days: by kick-off, without reading every match.
CREATE INDEX matches_finished_kickoff ON core.matches(kickoff_at) WHERE status = 'finished';
