-- Model fit timestamps provide only a necessary condition for the row to represent a prior prediction.
SELECT m.status,count(*) AS current_forecasts,
 count(*) FILTER(WHERE f.model_id IS NOT NULL AND p.fitted_at<=m.kickoff_at) AS model_fitted_by_kickoff,
 count(*) FILTER(WHERE p.fitted_at>m.kickoff_at) AS fit_after_kickoff,min(p.fitted_at),max(p.fitted_at)
FROM agg.match_forecasts f JOIN agg.forecast_models p ON p.id=f.model_id
JOIN core.matches m ON m.id=f.match_id AND m.season_id=f.season_id
GROUP BY m.status ORDER BY m.status
