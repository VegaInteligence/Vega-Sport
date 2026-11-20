-- 20 Nov 2026 (VI-40): what each player brings to his team, for « Remplaçant » (vega/team_fit.py,
-- docs/calculs/05-joueurs/13-remplacant-compatibilite-equipe.md). One row per player of a season
-- with 450 minutes or more at his main club: his shares of the club's play and their centiles
-- among his role, his defensive work, his effort and his discipline. The read compares a
-- candidate's row with the replaced player's (api/src/routes/profiles.mjs, replacements).
SET LOCAL lock_timeout = '3s';

CREATE TABLE agg.player_team_fit (
  season_id smallint NOT NULL REFERENCES core.seasons,
  player_id integer NOT NULL REFERENCES core.players ON DELETE CASCADE,
  team_id integer NOT NULL REFERENCES core.teams,
  role text,
  minutes integer NOT NULL CHECK (minutes >= 0),
  share_touches real, share_passes real, share_final_third real, share_chances real, share_shots real, share_defensive real,
  role_touches smallint CHECK (role_touches BETWEEN 0 AND 100),
  role_passes smallint CHECK (role_passes BETWEEN 0 AND 100),
  role_final_third smallint CHECK (role_final_third BETWEEN 0 AND 100),
  role_chances smallint CHECK (role_chances BETWEEN 0 AND 100),
  role_shots smallint CHECK (role_shots BETWEEN 0 AND 100),
  role_defensive smallint CHECK (role_defensive BETWEEN 0 AND 100),
  defensive_p90 real,
  defensive smallint CHECK (defensive BETWEEN 0 AND 100),
  distance_p90 real, running_p90 real, sprints_p90 real,
  physical_minutes integer CHECK (physical_minutes >= 0),
  effort smallint CHECK (effort BETWEEN 0 AND 100),
  fouls_p90 real, card_points_p90 real, discipline_index real,
  discipline smallint CHECK (discipline BETWEEN 0 AND 100),
  version text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, player_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.player_team_fit TO vega_calc;

-- The rows as the read takes them, with the club's league level (api.league_levels) beside.
CREATE VIEW api.player_team_fit AS
SELECT f.season_id, f.player_id AS player_key, f.team_id AS team_key, f.role, f.minutes,
  f.share_touches::float8 AS share_touches, f.share_passes::float8 AS share_passes, f.share_final_third::float8 AS share_final_third,
  f.share_chances::float8 AS share_chances, f.share_shots::float8 AS share_shots, f.share_defensive::float8 AS share_defensive,
  f.role_touches, f.role_passes, f.role_final_third, f.role_chances, f.role_shots, f.role_defensive,
  f.defensive_p90::float8 AS defensive_p90, f.defensive,
  f.distance_p90::float8 AS distance_p90, f.running_p90::float8 AS running_p90, f.sprints_p90::float8 AS sprints_p90, f.effort,
  f.fouls_p90::float8 AS fouls_p90, f.card_points_p90::float8 AS card_points_p90, f.discipline
FROM agg.player_team_fit f;

GRANT SELECT ON api.player_team_fit TO vega_read;
