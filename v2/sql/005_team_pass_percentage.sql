-- Preserve provider passing percentages when no pass denominator is supplied.
ALTER TABLE core.team_match_stats ADD COLUMN accurate_passes_pct real;
ALTER TABLE agg.team_season_stats ADD COLUMN accurate_passes_pct real;
ALTER TABLE agg.team_season_stats ADD COLUMN accurate_passes_pct_avg real;
