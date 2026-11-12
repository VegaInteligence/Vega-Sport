-- The team identity rules changed again: the national teams the Nations League editions
-- and the Euro and World Cup archives name otherwise than PitchAPI are recognised by a
-- reviewed spelling (vega/sources/identity.py: NATION_SPELLINGS). As in 071, the pass
-- runs at the worker's next round instead of a day after its last one.
UPDATE ops.source_runs SET last_success_at = NULL
WHERE source = 'vega' AND scope = 'team_identity';
