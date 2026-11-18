SELECT e.team_id,e.elo_before::float8,e.elo_after::float8,e.expected::float8,e.result::float8,e.stakes::float8,e.run_id FROM agg.team_elo e WHERE e.match_id=739114 ORDER BY e.team_id
