-- All editions, even no recorded fixture. Source/provider universe is what the database can prove.
SELECT cs.id AS edition_id,cs.season_id,se.label AS season,cs.competition_id,c.name AS competition,
 c.country_code,c.kind::text AS competition_kind,cs.cup_key,cs.archive_key,
 count(m.id) AS recorded_matches,count(*) FILTER(WHERE m.status='finished') AS finished,
 count(*) FILTER(WHERE m.status='finished' AND (m.home_score IS NULL OR m.away_score IS NULL)) AS finished_unknown_score,
 count(*) FILTER(WHERE m.status='finished' AND (m.home_team_id IS NULL OR m.away_team_id IS NULL)) AS finished_unknown_team,
 count(*) FILTER(WHERE m.id IS NOT NULL AND m.status IS DISTINCT FROM 'finished') AS other_status,
 min(m.match_date) FILTER(WHERE m.status='finished') AS first_finished_date,
 max(m.match_date) FILTER(WHERE m.status='finished') AS last_finished_date
FROM core.competition_seasons cs JOIN core.competitions c ON c.id=cs.competition_id
JOIN core.seasons se ON se.id=cs.season_id LEFT JOIN core.matches m ON m.competition_season_id=cs.id AND m.season_id=cs.season_id
GROUP BY cs.id,cs.season_id,se.label,cs.competition_id,c.name,c.country_code,c.kind,cs.cup_key,cs.archive_key ORDER BY cs.id
