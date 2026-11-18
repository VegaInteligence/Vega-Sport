SELECT m.source, m.competition_season_id, cs.cup_key, co.name, count(*) AS scheduled,
 count(*) FILTER(WHERE f.match_id IS NOT NULL) AS has_forecast,
 count(*) FILTER(WHERE l.match_id IS NOT NULL) AS has_lineup_forecast,
 count(*) FILTER(WHERE f.match_id IS NOT NULL AND l.match_id IS NULL) AS forecast_only_among_these_two,
 count(DISTINCT m.competition_season_id) FILTER(WHERE f.match_id IS NOT NULL) AS editions_with_forecast
FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id JOIN core.competitions co ON co.id=cs.competition_id
LEFT JOIN agg.match_forecasts f ON f.match_id=m.id
LEFT JOIN agg.match_lineup_forecasts l ON l.match_id=m.id
WHERE m.status='not_started' AND m.source IN ('open_matchday','openfootball','openligadb','international_results')
 AND EXISTS(SELECT 1 FROM core.provider_ids p WHERE p.entity_type='match' AND p.provider=m.source AND p.entity_id=m.id AND p.is_current)
GROUP BY m.source,m.competition_season_id,cs.cup_key,co.name ORDER BY m.source,m.competition_season_id