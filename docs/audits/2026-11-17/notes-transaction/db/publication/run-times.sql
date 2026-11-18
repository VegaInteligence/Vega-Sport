SELECT id,kind,season_id,status,started_at,finished_at,method_version
FROM agg.power_runs WHERE started_at >= TIMESTAMPTZ '2026-11-17 18:00:00+00'
AND kind IN ('players','leagues') ORDER BY started_at,id
