SELECT m.id,m.season_id,m.competition_season_id AS edition,m.match_number,m.kickoff_at,m.match_date,m.round_id,m.archive_position,cs.cup_data_url,cs.cup_digest,r.name AS registered_round,r.stage::text AS stage,m.venue_id,m.home_team_name,m.away_team_name,m.status::text,m.source::text,m.home_team_id,h.name AS home,m.away_team_id,a.name AS away,m.home_score,m.away_score,m.home_score_ht,m.away_score_ht,m.home_score_90,m.away_score_90,m.home_score_et,m.away_score_et,m.home_penalty_score,m.away_penalty_score,
    (SELECT count(*) FROM core.lineups s WHERE (s.season_id,s.match_id)=(m.season_id,m.id)) AS team_sheets,
    (SELECT count(*) FROM core.lineup_players s WHERE (s.season_id,s.match_id)=(m.season_id,m.id)) AS lineups,
    (SELECT count(*) FROM core.player_match_stats s WHERE (s.season_id,s.match_id)=(m.season_id,m.id)) AS stats,
    (SELECT count(*) FROM core.player_match_stats s WHERE (s.season_id,s.match_id)=(m.season_id,m.id) AND s.minutes_played>0) AS positive_minutes,
    (SELECT count(*) FROM core.player_match_half_stats s WHERE (s.season_id,s.match_id)=(m.season_id,m.id)) AS halves,
    (SELECT count(*) FROM core.player_match_advanced s WHERE (s.season_id,s.match_id)=(m.season_id,m.id)) AS advanced,
    (SELECT count(*) FROM core.match_events s WHERE (s.season_id,s.match_id)=(m.season_id,m.id)) AS events,
    (SELECT count(*) FROM core.shots s WHERE (s.season_id,s.match_id)=(m.season_id,m.id)) AS shots,
    (SELECT count(*) FROM agg.player_power_matches s WHERE s.match_id=m.id) AS player_intermediates,
    (SELECT count(*) FROM agg.player_match_grades g WHERE (g.season_id,g.match_id)=(m.season_id,m.id)) AS player_grades,
    (SELECT array_agg(e.team_id ORDER BY e.team_id) FROM agg.team_elo e WHERE e.season_id=m.season_id AND e.match_id=m.id) AS elo_teams
    FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id LEFT JOIN core.rounds r ON r.id=m.round_id JOIN core.teams h ON h.id=m.home_team_id JOIN core.teams a ON a.id=m.away_team_id WHERE m.competition_season_id IN (31672,31673,31675) ORDER BY m.competition_season_id,m.match_date,m.id
