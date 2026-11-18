"""Collect the actual production rows in all three finals editions and compare the national identity pool."""
def collect(db):
 with db.transaction():
  db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
  at,snap,ro=db.execute("SELECT transaction_timestamp(),pg_current_snapshot()::text,current_setting('transaction_read_only')").fetchone();assert ro=='on'
  def q(sql):
   c=db.execute(sql);return {'columns':[s.name for s in c.description],'rows':c.fetchall()}
  games=q("""SELECT m.id,m.season_id,m.competition_season_id AS edition,m.match_date,m.status::text,m.source::text,m.home_team_id,h.name AS home,m.away_team_id,a.name AS away,m.home_score,m.away_score,m.home_score_90,m.away_score_90,m.home_score_et,m.away_score_et,m.home_penalty_score,m.away_penalty_score,
    (SELECT count(*) FROM core.lineups s WHERE (s.season_id,s.match_id)=(m.season_id,m.id)) AS team_sheets,
    (SELECT count(*) FROM core.lineup_players s WHERE (s.season_id,s.match_id)=(m.season_id,m.id)) AS lineups,
    (SELECT count(*) FROM core.player_match_stats s WHERE (s.season_id,s.match_id)=(m.season_id,m.id)) AS stats,
    (SELECT count(*) FROM core.player_match_half_stats s WHERE (s.season_id,s.match_id)=(m.season_id,m.id)) AS halves,
    (SELECT count(*) FROM core.player_match_advanced s WHERE (s.season_id,s.match_id)=(m.season_id,m.id)) AS advanced,
    (SELECT count(*) FROM core.match_events s WHERE (s.season_id,s.match_id)=(m.season_id,m.id)) AS events,
    (SELECT count(*) FROM core.shots s WHERE (s.season_id,s.match_id)=(m.season_id,m.id)) AS shots,
    (SELECT count(*) FROM agg.player_power_matches s WHERE s.match_id=m.id) AS player_intermediates,
    (SELECT count(*) FROM agg.player_match_grades g WHERE (g.season_id,g.match_id)=(m.season_id,m.id)) AS player_grades,
    (SELECT array_agg(e.team_id ORDER BY e.team_id) FROM agg.team_elo e WHERE e.season_id=m.season_id AND e.match_id=m.id) AS elo_teams
    FROM core.matches m JOIN core.teams h ON h.id=m.home_team_id JOIN core.teams a ON a.id=m.away_team_id WHERE m.competition_season_id IN (53152,53155,53156) ORDER BY 2,4,1""")
  rest=q("""SELECT m.season_id,m.id,m.match_date,m.kickoff_at::date AS kickoff_day,m.competition_season_id AS edition,m.home_team_id,m.away_team_id,h.name AS hname,h.short_name AS hshort,m.home_team_name AS hlabel,a.name AS aname,a.short_name AS ashort,m.away_team_name AS alabel,m.home_score,m.away_score,m.status::text FROM core.matches m LEFT JOIN core.teams h ON h.id=m.home_team_id LEFT JOIN core.teams a ON a.id=m.away_team_id WHERE m.match_date BETWEEN '2022-01-08' AND '2022-02-07' OR m.match_date BETWEEN '2024-01-12' AND '2024-02-12' OR m.match_date BETWEEN '2025-12-20' AND '2026-01-19' OR m.kickoff_at::date BETWEEN '2022-01-08' AND '2022-02-07' OR m.kickoff_at::date BETWEEN '2024-01-12' AND '2024-02-12' OR m.kickoff_at::date BETWEEN '2025-12-20' AND '2026-01-19' ORDER BY m.season_id,m.id""")
  players=q("""SELECT p.id,p.name,p.short_name,p.birth_date,p.country_code,ARRAY(SELECT DISTINCT e.name FROM core.entity_names e WHERE e.entity_type='player' AND e.entity_id=p.id ORDER BY 1) AS aliases FROM core.players p ORDER BY p.id""")
  staged=q("""SELECT p.id,q.provider::text,q.provider_key,q.name,q.birth_date,q.read_on FROM core.provider_players q JOIN core.provider_ids i ON i.entity_type='player' AND i.provider=q.provider AND i.provider_key=q.provider_key AND i.is_current JOIN core.players p ON p.id=i.entity_id LEFT JOIN ops.provider_links l ON l.entity_type=i.entity_type AND l.provider=i.provider AND l.provider_key=i.provider_key WHERE l.quarantined_at IS NULL AND q.birth_date IS NOT NULL ORDER BY 1,2,3""")
  return {'at':at,'snap':snap,'read_only':ro,'games':games,'nearby':rest,'players':players,'staged':staged}
