SELECT g.season_id, g.award_season, cs.competition_id, m.competition_season_id,
       g.ref_season, g.match_id, g.player_id, g.role, p.role, p.contribution, g.z,
       p.match_index, g.run_id, p.run_id
FROM agg.player_match_grades g
LEFT JOIN agg.player_power_matches p ON p.season_id=g.award_season
    AND p.match_id=g.match_id AND p.player_id=g.player_id
LEFT JOIN core.matches m ON m.season_id=g.season_id AND m.id=g.match_id
LEFT JOIN core.competition_seasons cs ON cs.season_id=m.season_id AND cs.id=m.competition_season_id
WHERE g.season_id=%s
