-- 23 Nov 2026 (#68): the in-play probabilities carried through extra time (vega/inplay.py, dashboard/shared/inplay.js,
-- docs/calculs/06-accueil-et-matchs/03-pronostics-et-projections.md). A match's two strengths (086) also give its
-- extra-time and shoot-out scores, for the read route to tell a match that went to the 120th (api/src/routes/rankings.mjs,
-- liveProbability). Views only: four more columns at the end, no data changed; the view keeps its grants.
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE VIEW api.match_strengths AS
SELECT m.id AS match_key, m.season_id, m.status::text AS status, coalesce(m.is_neutral, false) AS neutral,
  m.home_score, m.away_score,
  coalesce(eh.elo_before, lh.elo_after)::float8 AS home_elo, coalesce(ea.elo_before, la.elo_after)::float8 AS away_elo,
  m.home_score_et, m.away_score_et, m.home_penalty_score, m.away_penalty_score
FROM core.matches m
LEFT JOIN agg.team_elo eh ON eh.match_id = m.id AND eh.team_id = m.home_team_id
LEFT JOIN agg.team_elo ea ON ea.match_id = m.id AND ea.team_id = m.away_team_id
LEFT JOIN LATERAL (SELECT e.elo_after FROM agg.team_elo e WHERE e.team_id = m.home_team_id AND eh.match_id IS NULL
                   ORDER BY e.kickoff_at DESC NULLS LAST LIMIT 1) lh ON true
LEFT JOIN LATERAL (SELECT e.elo_after FROM agg.team_elo e WHERE e.team_id = m.away_team_id AND ea.match_id IS NULL
                   ORDER BY e.kickoff_at DESC NULLS LAST LIMIT 1) la ON true;
