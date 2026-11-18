SELECT g.season_id, g.award_season, g.ref_season, g.match_id, g.player_id, g.team_id, g.minutes, g.role,
 g.graded_at, g.changed_at, g.z, g.first_z, p.match_index, p.contribution, g.run_id, p.run_id AS power_run,
 pp.provider_key AS player_key, mp.provider_key AS match_key, t.name AS team_name,
 c.name AS competition_name, cp.provider_key AS competition_key,m.match_date
FROM agg.player_match_grades g JOIN agg.player_power_matches p ON (p.season_id,p.match_id,p.player_id)=(g.award_season,g.match_id,g.player_id)
JOIN core.matches m ON (m.season_id,m.id)=(g.season_id,g.match_id)
JOIN core.competition_seasons cs ON cs.id=m.competition_season_id AND cs.season_id=m.season_id
JOIN core.competitions c ON c.id=cs.competition_id JOIN core.teams t ON t.id=g.team_id
LEFT JOIN core.provider_ids pp ON pp.entity_type='player' AND pp.entity_id=g.player_id AND pp.provider='pitchapi' AND pp.is_current
LEFT JOIN core.provider_ids mp ON mp.entity_type='match' AND mp.entity_id=g.match_id AND mp.provider='pitchapi' AND mp.is_current
LEFT JOIN core.provider_ids cp ON cp.entity_type='competition' AND cp.entity_id=c.id AND cp.provider='pitchapi' AND cp.is_current
WHERE (g.season_id,g.match_id,g.player_id) IN ((2026,47188,28945),(2021,248344,24369))
ORDER BY g.season_id,pp.provider_key,mp.provider_key
