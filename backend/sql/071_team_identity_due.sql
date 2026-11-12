-- The team identity rules changed: the Club World Cup's teams are read with the country
-- their source writes after their name (vega/sources/identity.py). The pass, due once a
-- day, runs at the worker's next round instead of a day after its last one.
UPDATE ops.source_runs SET last_success_at = NULL
WHERE source = 'vega' AND scope = 'team_identity';
