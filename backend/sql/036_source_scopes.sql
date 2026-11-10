-- A source scope may name a provider id, whose case matters (SportScore standings scopes
-- are `standings:<PitchAPI league id>`, e.g. standings:l_0275VP).
ALTER TABLE ops.source_runs DROP CONSTRAINT IF EXISTS source_runs_scope_check;
ALTER TABLE ops.source_runs ADD CONSTRAINT source_runs_scope_check CHECK (scope ~ '^[A-Za-z0-9_:/.-]{1,80}$');
