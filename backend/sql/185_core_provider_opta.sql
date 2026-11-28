-- vega:online
-- 28 Nov 2026 (GitHub #278, VI-177), S1 of PannaData in Vega's model (backend/panna/FAILURE_MODES.md section 8, the
-- dictionary Hugo approved): Opta is a provider of its own, as every source is. Alone in its file: a new enum value is
-- usable once committed (186 uses it), and it stays when the loader is rolled back.
ALTER TYPE core.provider ADD VALUE IF NOT EXISTS 'opta';
