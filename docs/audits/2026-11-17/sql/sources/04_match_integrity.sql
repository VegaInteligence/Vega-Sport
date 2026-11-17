SELECT m.source::text AS match_source,count(*) AS matches,
 count(*) FILTER (WHERE m.home_team_id=m.away_team_id) AS same_team_both_sides,
 count(*) FILTER (WHERE m.season_id<>cs.season_id OR cs.id IS NULL) AS wrong_or_missing_edition,
 count(*) FILTER (WHERE m.status='finished' AND (m.home_team_id IS NULL OR m.away_team_id IS NULL)) AS finished_missing_team,
 count(*) FILTER (WHERE m.status='finished' AND (m.home_score IS NULL OR m.away_score IS NULL)) AS finished_missing_result,
 count(*) FILTER (WHERE h.merged_into IS NOT NULL OR a.merged_into IS NOT NULL) AS rows_referencing_merged_team
FROM core.matches m LEFT JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
LEFT JOIN core.teams h ON h.id=m.home_team_id LEFT JOIN core.teams a ON a.id=m.away_team_id GROUP BY 1 ORDER BY 1
