SELECT cs.id AS edition_id,c.id AS competition_id,c.name AS competition,c.country_code,s.label AS season,cs.native_label,cs.cup_key,cs.archive_key,
 m.source AS match_provider,count(m.id) AS recorded_matches,count(m.id) FILTER (WHERE m.status='finished') AS recorded_finished
FROM core.competition_seasons cs JOIN core.competitions c ON c.id=cs.competition_id JOIN core.seasons s ON s.id=cs.season_id
LEFT JOIN core.matches m ON m.competition_season_id=cs.id AND m.season_id=cs.season_id
GROUP BY cs.id,c.id,c.name,c.country_code,s.label,cs.native_label,cs.cup_key,cs.archive_key,m.source ORDER BY cs.id,m.source
