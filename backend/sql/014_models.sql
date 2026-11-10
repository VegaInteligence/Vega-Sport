-- Model layer (vega_v2/models.py): stable cohort keys, the position-group rule,
-- and the role catalogue. Formulas: docs/calculs, sections 04-clubs and 05-joueurs.

-- A cohort is found again by its key ("team:2025:cs:12", "player:2025:europe:M"),
-- so a recalculation replaces its rows instead of creating a new cohort.
ALTER TABLE agg.cohorts ADD COLUMN key text NOT NULL;
CREATE UNIQUE INDEX cohorts_key ON agg.cohorts(key);
CREATE INDEX cohorts_season ON agg.cohorts(season_id, entity_type);
CREATE INDEX cohort_competitions_competition ON agg.cohort_competitions(competition_id);
CREATE INDEX calc_runs_kind ON agg.calc_runs(kind, cohort_definition, status);

-- Formation slot (positionId) to comparison group: G, D, M, or O (attacking
-- midfielders and forwards together). NULL when the slot is unknown.
CREATE FUNCTION core.position_group(position_id integer)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN position_id IN (0, 11) THEN 'G'
    WHEN position_id IN (1, 51, 59) OR position_id BETWEEN 30 AND 39 THEN 'D'
    WHEN position_id = 2 OR position_id BETWEEN 50 AND 79 THEN 'M'
    WHEN position_id = 3 OR position_id BETWEEN 80 AND 119 THEN 'O'
  END
$$;

-- Role profiles: equal weights, evaluated for the groups listed (comma-separated).
INSERT INTO agg.role_definitions(code, label_fr, position_group) VALUES
  ('recovery', 'Récupération', 'D,M,O'),
  ('box_defence', 'Défense de surface', 'D'),
  ('build_up', 'Construction', 'D,M,G'),
  ('creation', 'Création', 'M,O'),
  ('penetration', 'Percussion', 'M,O'),
  ('attacking_presence', 'Présence offensive', 'O'),
  ('shot_stopping', 'Arrêts', 'G');

INSERT INTO agg.role_weights(role_code, metric_key, weight) VALUES
  ('recovery', 'recoveries', 1), ('recovery', 'interceptions', 1), ('recovery', 'tackles', 1),
  ('box_defence', 'clearances', 1), ('box_defence', 'shot_blocks', 1), ('box_defence', 'duels_won', 1),
  ('build_up', 'accurate_passes', 1), ('build_up', 'pass_completion', 1), ('build_up', 'touches', 1),
  ('creation', 'chances_created', 1), ('creation', 'passes_into_final_third', 1), ('creation', 'accurate_passes', 1),
  ('penetration', 'dribbles_succeeded', 1), ('penetration', 'touches_opp_box', 1), ('penetration', 'chances_created', 1),
  ('attacking_presence', 'xg', 1), ('attacking_presence', 'total_shots', 1), ('attacking_presence', 'touches_opp_box', 1),
  ('shot_stopping', 'saves', 1), ('shot_stopping', 'goals_prevented', 1);

-- Cohort recalculations publish a version like any other resource; goalkeeping
-- metrics get their own family (used from 015 on, once this file has committed).
ALTER TYPE ops.resource_kind ADD VALUE IF NOT EXISTS 'cohort';
ALTER TYPE agg.metric_category ADD VALUE IF NOT EXISTS 'goalkeeping';
