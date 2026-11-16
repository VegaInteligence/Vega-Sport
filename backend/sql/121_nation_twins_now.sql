-- National teams PitchAPI does not hold now join their twin of another source (identity.nation_twins:
-- « Italie » and « Italy », « Nigeria » and « Nigeria »), and every match between two national teams
-- enters the Elo (power.ELO_MATCHES), 16 November 2026. The identity pass runs at the worker's next
-- round instead of tomorrow's.
UPDATE ops.source_runs SET last_success_at = NULL WHERE source = 'vega' AND scope = 'team_identity';
