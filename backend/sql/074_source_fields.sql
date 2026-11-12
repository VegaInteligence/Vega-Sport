-- Fields the source sends that the collector left out (ops.unknown_fields listed them on
-- 12 November 2026): a team's possession won by third of the pitch, its recoveries, its
-- pressing figure (passes per defensive action) and its entries into the final third and
-- the penalty area, each with the share the source gives beside it; a player's walking
-- distance. The team's physical figures and the penalties saved in a shoot-out go to
-- columns that existed (vega/schema_contract.py).
ALTER TABLE core.team_match_stats
  ADD COLUMN poss_won_att_3rd smallint,
  ADD COLUMN poss_won_mid_3rd smallint,
  ADD COLUMN poss_won_def_3rd smallint,
  ADD COLUMN recoveries smallint,
  ADD COLUMN final_third_entries smallint,
  ADD COLUMN penalty_area_entries smallint,
  ADD COLUMN ppda real,
  ADD COLUMN final_third_entries_pct real,
  ADD COLUMN penalty_area_entries_pct real;
ALTER TABLE core.player_match_stats ADD COLUMN walking_m real;
ALTER TABLE core.player_match_half_stats ADD COLUMN walking_m real;
