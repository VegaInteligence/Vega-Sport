-- Version 3 of the power rankings counts a match for its stakes: its competition's
-- prestige times its round's (vega/power.py: PRESTIGE, CUP_PRESTIGE, STAGE). The stakes
-- applied are kept with each match, for the clubs' Elo and for the players.
ALTER TABLE agg.team_elo ADD COLUMN stakes real;
ALTER TABLE agg.player_power_matches ADD COLUMN stakes real;

-- A players' ranking reads the leagues' common scale: the number of leagues on it when
-- the ranking was computed. The worker recomputes a recent season whose ranking read
-- another scale than the present one (worker.due_seasons).
ALTER TABLE agg.power_runs ADD COLUMN linked_leagues integer;
