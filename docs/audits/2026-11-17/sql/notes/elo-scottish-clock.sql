WITH latest AS (SELECT id,started_at,finished_at FROM agg.power_runs WHERE kind='elo' AND status='published' ORDER BY id DESC LIMIT 1)
SELECT m.competition_season_id AS edition_id,c.name,count(*) AS missing_whole_matches,min(m.match_date) AS earliest_match,max(m.match_date) AS latest_match,
 min(m.updated_at) AS first_row_change,max(m.updated_at) AS last_row_change,count(*) FILTER(WHERE m.updated_at>r.started_at) AS updated_after_read,
 count(*) FILTER(WHERE m.updated_at<=r.started_at) AS existed_at_read,r.id AS elo_run,r.started_at,r.finished_at
FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id JOIN core.competitions c ON c.id=cs.competition_id CROSS JOIN latest r
WHERE m.competition_season_id IN (324,325,337,338) AND m.status='finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM agg.team_elo e WHERE e.match_id=m.id AND e.season_id=m.season_id)
GROUP BY m.competition_season_id,c.name,r.id,r.started_at,r.finished_at ORDER BY 1