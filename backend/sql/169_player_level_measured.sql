-- 24 Nov 2026 (#90; FAILURE_MODES.md §54): Score Vega v9.1. A keeper without goals prevented on half of his minutes in
-- goal is not measured: his value is 0, his level his starts and his club alone. One flag per level row, written
-- with the run (level.write); the read API gives his rank as provisional. The rows in place, and those the worker
-- in service writes during the deployment, read measured until their year is computed again (power.stale_rankings).
SET LOCAL lock_timeout = '3s';

ALTER TABLE agg.player_level ADD COLUMN measured boolean NOT NULL DEFAULT true;

-- 167's view, with the row's flag last.
CREATE OR REPLACE VIEW api.player_levels AS
SELECT se.label AS season, p.season_id, p.player_id AS player_key, api.public_id('player', p.player_id) AS player_id, pl.name,
  ph.source_url AS image_url, api.public_id('team', p.team_id) AS team_id, t.name AS team, cr.source_url AS team_image_url,
  p.position, p.universe, p.eligible, p.linked, p.minutes::numeric::float8 AS minutes,
  p.level::numeric::float8 AS level, p.own::numeric::float8 AS own, p.blocks::numeric::float8 AS blocks,
  p.starts::numeric::float8 AS starts, p.club::numeric::float8 AS club, p.start_share::numeric::float8 AS start_share,
  p.club_level::numeric::float8 AS club_level, p.score::numeric::float8 AS score, p.rank, p.position_rank,
  r.version, r.finished_at AS computed_at, r.reference_season, p.measured
FROM agg.player_level p
JOIN core.seasons se ON se.id = p.season_id
JOIN core.players pl ON pl.id = p.player_id
LEFT JOIN core.assets ph ON ph.id = pl.photo_asset_id
LEFT JOIN core.teams t ON t.id = p.team_id
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id
JOIN agg.level_runs r ON r.id = p.run_id;
