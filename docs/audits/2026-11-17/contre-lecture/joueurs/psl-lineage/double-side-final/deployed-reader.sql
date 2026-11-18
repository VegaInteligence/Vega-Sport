
SELECT s.match_id, s.player_id, s.season_id AS edition, s.team_id, s.minutes_played, coalesce(lp.position_id, s.position_id) AS position_id, lp.is_starter,
  l.formation, cs.competition_id, m.competition_season_id, s.touches IS NOT NULL AS measured, t.is_national IS TRUE AS national,
  own.elo_before AS own_elo, opp.elo_before AS opponent_elo,
  CASE WHEN mc.events = 'ok' THEN s.goals - (SELECT count(*) FROM core.match_events e
    WHERE e.season_id = s.season_id AND e.match_id = s.match_id AND e.player_id = s.player_id
      AND e.event_type = 'goal' AND e.is_penalty AND e.is_own_goal IS NOT TRUE) END AS np_goals,
  s.npxg, s.shots_on_target, s.big_chances_missed, s.assists, s.xa, s.chances_created, s.big_chances_created,
  s.passes_into_final_third, a.progressive_passes, a.progressive_carries, s.dribbles_succeeded, s.dribbles_total,
  s.tackles, s.interceptions, s.recoveries, s.clearances, s.shot_blocks, s.duels_won, s.duels_won + s.duels_lost AS duels_attempted,
  s.aerials_won, s.aerials_total, s.dribbled_past, s.errors_led_to_goal, s.accurate_passes, s.accurate_passes_total,
  s.dispossessed, s.touches, s.goals_prevented, s.high_claims, s.punches, s.sweeper_actions, s.long_balls_accurate, s.long_balls_total
FROM core.player_match_stats s
JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id AND m.status = 'finished'
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
JOIN core.teams t ON t.id = s.team_id
LEFT JOIN core.match_coverage mc ON mc.season_id = s.season_id AND mc.match_id = s.match_id
LEFT JOIN core.lineup_players lp ON lp.season_id = s.season_id AND lp.match_id = s.match_id AND lp.player_id = s.player_id
LEFT JOIN core.lineups l ON l.season_id = s.season_id AND l.match_id = s.match_id AND l.team_id = s.team_id
LEFT JOIN core.player_match_advanced a ON a.season_id = s.season_id AND a.match_id = s.match_id AND a.player_id = s.player_id
LEFT JOIN agg.team_elo own ON own.match_id = s.match_id AND own.team_id = s.team_id
LEFT JOIN agg.team_elo opp ON opp.match_id = s.match_id AND opp.team_id <> s.team_id
WHERE s.season_id = ANY(%s) AND s.minutes_played > 0 AND m.match_date >= %s AND m.match_date < %s