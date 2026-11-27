"""Seed a disposable database for the Node API contract tests (synthetic data only)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tests"))
import tempfile

from archive_fixtures import make_sources
from cup_samples import SAMPLES
from vega.sources import cups, curated
from vega import archives, power
from vega.worker import publish
from vega.store import Store, connect_local, migrate

TEAMS = {1: ("t_aaaaa1", "Olympique Été", "FRA"), 2: ("t_aaaaa2", "Racing Club", "FRA"), 3: ("t_aaaaa3", "Stade Nord", None), 4: ("t_aaaaa4", "Union Sud", "FRA")}
# Players: (id, key, name, team); stats per match: (match, minutes, level, goals, xg, shots, passes ok/att, position, starter, saves, prevented),
# the level giving the match's Vega grade below: z = 3 (level − 7).
PLAYERS = {101: ("p_aaaab1", "Élie Durand"), 102: ("p_aaaab2", "Marc Petit"), 103: ("p_aaaab3", "Hugo Sud"), 104: ("p_aaaab4", "Cristiano Test")}
STATS = [
    (101, 1, 1, 90, 7.5, 2, 1.2, 4, 20, 25, 91, True, None, None),
    (101, 3, 1, 90, 6.0, 0, 0.4, 2, 15, 20, 91, True, None, None),
    (101, 5, 1, 80, 7.0, 0, 0.3, 1, 10, 12, 91, True, None, None),
    (102, 1, 1, 90, 6.5, 0, 0.1, 0, 40, 44, 61, True, None, None),
    (102, 5, 1, None, None, None, None, None, None, None, 61, False, None, None),  # minutes unknown
    (103, 2, 4, 90, 7.2, 0, None, None, 25, 30, 11, True, 3, 0.5),
    (103, 5, 4, 90, 6.8, 0, None, None, 22, 30, 11, True, 5, -0.2),
    (104, 1, 2, 70, 6.9, 0, 0.2, 1, 12, 15, 81, True, None, None),
    (104, 4, 2, 90, 8.1, 3, 2.1, 6, 18, 20, 81, True, None, None),
]
# Line-up entries without statistics (bench): (player, match, team).
BENCH = [(102, 3, 1)]
# (home, away, home score, away score, status)
MATCHES = [
    (1, 2, 2, 0, "finished"), (3, 4, 1, 1, "finished"), (1, 3, 0, 1, "finished"),
    (2, 4, 3, 2, "finished"), (4, 1, 0, 0, "finished"), (2, 3, None, None, "not_started"),
]


def main(dsn):
    db = connect_local(dsn)
    db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
    migrate(db)
    with db.transaction():
        Store(db).season("2025/2026")
    x = db.execute
    x("INSERT INTO core.countries(code) VALUES ('FRA')")
    x("INSERT INTO core.assets(id,kind,source_url) VALUES (1,'logo','https://img.example/l1.png'),(2,'crest','https://img.example/t1.png')")
    # The crest of t_aaaaa1 has its copy (media=1); the league logo has none.
    x("UPDATE core.assets SET s3_key=%s, content_type='image/png' WHERE id=2", ("sources/v2/images/" + "ab" * 32 + ".png",))
    x("INSERT INTO core.competitions(id,name,country_code,kind,logo_asset_id) VALUES (1,'Ligue 1','FRA','league',1)")
    x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('competition','pitchapi','l_3FJFUl',1)")
    x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,is_current) VALUES (1,1,2025,'2025/2026',true)")
    for tid, (key, name, country) in TEAMS.items():
        x("INSERT INTO core.teams(id,name,country_code,crest_asset_id) VALUES (%s,%s,%s,%s)", (tid, name, country, 2 if tid == 1 else None))
        x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('team','pitchapi',%s,%s)", (key, tid))
        x("INSERT INTO core.team_seasons(team_id,competition_season_id) VALUES (%s,1)", (tid,))
    # The home's editorial lists (Ligue 1: title race and Top 7), as the curated source writes them.
    curated.editorial_lists(db)
    for mid, (home, away, hs, as_, status) in enumerate(MATCHES, 1):
        x(
            "INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date,kickoff_at) VALUES (%s,1,2025,'pitchapi',%s,%s,%s,%s,%s,%s,%s)",
            (mid, status, home, away, hs, as_, f"2025-09-{mid:02d}", f"2025-09-{mid:02d}T19:00:00Z"),
        )
        x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('match','pitchapi',%s,%s)", (f"m_aaaaa{mid}", mid))
        x("INSERT INTO core.match_coverage(season_id,match_id,player_stats) VALUES (2025,%s,%s)", (mid, "ok" if status == "finished" else "pending"))
        if status != "finished":
            continue
        x("INSERT INTO ops.family_state(match_id,family,status,last_success_at) VALUES (%s,'summary','ok','2025-09-20T10:00:00Z')", (mid,))
        for team, formation in ((home, "4-3-3"), (away, "3-5-2" if away == 4 else "4-4-2")):
            x("INSERT INTO core.lineups(season_id,match_id,team_id,side,formation) VALUES (2025,%s,%s,%s,%s)", (mid, team, "home" if team == home else "away", formation))
            x(
                "INSERT INTO core.team_match_stats(season_id,match_id,team_id,period,xg,total_shots,possession_pct,passes,accurate_passes) VALUES (2025,%s,%s,'all',%s,%s,%s,%s,%s)",
                (mid, team, round(0.5 + 0.25 * team, 2), 10 + team, 45 + team, 400 + team, 320 + team),
            )
        for seq in range(1, (hs or 0) + (as_ or 0) + 1):
            team = home if seq <= (hs or 0) else away
            # The event's team is the side credited, own goals included (as production stores it,
            # FAILURE_MODES §17.1): m3's goal is team 1's own goal, for team 3.
            x(
                "INSERT INTO core.match_events(season_id,match_id,team_id,seq,event_type,minute,period,is_own_goal) VALUES (2025,%s,%s,%s,'goal',%s,'first_half',%s)",
                (mid, team, seq, 10 * seq + mid, mid == 3),
            )
    x("INSERT INTO core.assets(id,kind,source_url) VALUES (3,'photo','https://img.example/p1.png')")
    for pid, (key, name) in PLAYERS.items():
        x("INSERT INTO core.players(id,name,photo_asset_id) VALUES (%s,%s,%s)", (pid, name, 3 if pid == 101 else None))
        x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','pitchapi',%s,%s)", (key, pid))
    x("INSERT INTO core.entity_names(entity_type,entity_id,name,normalized,kind,source) VALUES ('player',104,'CR7','cr7','alias','vega')")
    x("UPDATE core.players SET birth_date='1999-05-06', height_cm=181, preferred_foot='both' WHERE id=102")
    x("""INSERT INTO core.player_contracts(player_id,team_id,start_date,end_date,source,as_of) VALUES
         (102,1,current_date-1,current_date+365,'vega',current_date),
         (102,2,current_date-366,current_date-1,'vega',current_date-366),
         (103,1,current_date-1,current_date+365,'vega',current_date),
         (103,4,current_date-1,current_date+90,'vega',current_date)""")
    x("""INSERT INTO core.player_fact_observations
         (source,source_player_id,player_id,source_url,observed_on,club_name,contract_until)
         VALUES ('transfermarkt_snapshot','987654',102,'https://www.transfermarkt.com/profil/spieler/987654',
                 '2026-07-06','Former Club','2027-06-30')""")
    x("""INSERT INTO core.player_contracts (player_id,team_id,start_date,source,as_of,end_season_year,end_season_competition)
         VALUES (104,2,'2025-07-01','other','2025-07-01',2099,'MLS')""")
    x("""INSERT INTO core.player_market_values(player_id,valued_at,value_eur,source,as_of) VALUES
         (102,'2026-06-02',15000000,'transfermarkt','2026-07-06'),
         (102,'2025-06-01',0,'transfermarkt','2026-07-06'),
         (102,'2026-06-10',16000000,'other','2026-07-06')""")
    # Profile vectors (081): four players placed on the axes, one of them in a women's competition.
    x("INSERT INTO agg.embedding_models(season_id, version, players, statistics, variance_kept) VALUES (2025, 'profile-embedding-v1', 4, 60, 0.78)")
    zeros = ",".join(["0"] * 8)
    x(f"""INSERT INTO agg.player_embeddings(season_id, player_id, minutes, women, e1, e2, e3, e4, e5, e6, e7, e8, e9, e10) VALUES
          (2025,101,900,false,0,0,{zeros}), (2025,102,800,false,3,4,{zeros}), (2025,103,700,false,6,8,{zeros}), (2025,104,600,true,0.1,0,{zeros})""")
    # Pass network edges (079): player 101 with two team-mates over two matches.
    x("""INSERT INTO core.pass_network_edges(season_id, match_id, team_id, from_player_id, to_player_id, passes) VALUES
         (2025,1,1,101,102,7), (2025,1,1,102,101,4), (2025,5,1,101,102,3), (2025,1,1,101,104,2), (2025,1,1,102,104,9)""")
    for pid, mid, team, minutes, level, goals, xg, shots, ok, att, position, starter, saves, prevented in STATS:
        x(
            "INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,position_id,minutes_played,goals,xg,total_shots,accurate_passes,accurate_passes_total,saves,goals_prevented) VALUES (2025,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            # As in production: the statistics carry no position, the line-up does.
            (mid, team, pid, None, minutes, goals, xg, shots, ok, att, saves, prevented),
        )
        x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES (2025,%s,%s,%s,%s,%s)", (mid, team, pid, starter, position))
    for pid, mid, team in BENCH:
        x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES (2025,%s,%s,%s,false,61)", (mid, team, pid))
    # Match 1 in detail: referee, coaches, shots and their coverage.
    x("INSERT INTO core.referees(id,name) VALUES (1,'Clément Turpin')")
    x("INSERT INTO core.coaches(id,name) VALUES (1,'Coach Un')")
    x("INSERT INTO core.rounds(id,competition_season_id,name,seq) VALUES (1,1,'1',1)")
    x("UPDATE core.matches SET referee_id=1, round_id=1 WHERE id=1")
    x("UPDATE core.lineups SET coach_id=1, confirmed=true WHERE match_id=1 AND team_id=1")
    x("UPDATE core.match_coverage SET shots='ok', team_stats='ok' WHERE match_id=1")
    x("UPDATE core.team_match_stats SET shots_on_target=%s WHERE match_id=1", (4,))
    for no, (team, player, minute, xg, outcome) in enumerate([(1, 101, 11, 0.7, "goal"), (2, 104, 30, 0.2, "saved"), (1, 101, 21, 0.5, "goal")], 1):
        x("INSERT INTO core.shots(season_id,match_id,team_id,shot_no,provider_shot_key,period,minute,player_id,xg,outcome,is_own_goal) VALUES (2025,1,%s,%s,%s,'first_half',%s,%s,%s,%s,false)",
          (team, no, f"s{no}", minute, player, xg, outcome))
    # Vega's own table (the calculator's agg.standings), and the UEFA id of club 1.
    for team, pos, played, w, d, l, gf, ga, pts in [(1, 1, 3, 1, 1, 1, 2, 1, 4), (3, 2, 2, 1, 1, 0, 2, 1, 4), (2, 3, 2, 1, 0, 1, 3, 4, 3), (4, 4, 3, 0, 2, 1, 3, 4, 2)]:
        x("INSERT INTO agg.standings(competition_season_id,team_id,position,played,won,drawn,lost,goals_for,goals_against,points,updated_at) VALUES (1,%s,%s,%s,%s,%s,%s,%s,%s,%s,'2025-09-20T11:00:00Z')",
          (team, pos, played, w, d, l, gf, ga, pts))
    x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('team','uefa','52747',1)")
    # Wikidata facts of club 1: its stadium (with a plan), founded year and current coach.
    x("INSERT INTO core.venues(id,name,capacity,capacity_observed,latitude,longitude,opened,wikidata_fetched_at) VALUES (1,'Stade Été',41000,'2019',45.76,4.98,'2016-01-09','2025-09-20T09:00:00Z')")
    x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('team','wikidata','Q704',1),('venue','wikidata','Q1150',1)")
    x("UPDATE core.teams SET founded_year=1950, home_venue_id=1, wikidata_fetched_at='2025-09-20T09:00:00Z' WHERE id=1")
    x("INSERT INTO core.assets(id,kind,source_url,author,license,source_page_url) VALUES (4,'photo','https://upload.wikimedia.org/wikipedia/commons/c/c1/Coach.jpg','Someone','CC BY-SA 4.0','https://commons.wikimedia.org/wiki/File:Coach.jpg')")
    x("UPDATE core.coaches SET photo_asset_id=4, portrait_checked_at='2025-09-20T09:00:00Z', portrait_lookup_version=3 WHERE id=1")
    x("INSERT INTO core.team_coach_tenures(team_id,coach_id,start_date,source) VALUES (1,1,'2025-07-01','wikidata')")
    x("INSERT INTO core.venue_plans(venue_id,seq,title,url,source,detail,format,is_embedded,allow_geolocation) VALUES (1,0,'Plan interactif','https://club.example/plan','Club','Accès et tribunes.','Plan',true,true)")
    # Wikipedia honours of Élie Durand (main's player_honours.py projection, typed).
    x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','wikidata','Q100',101)")
    x("UPDATE core.players SET honours_source_url='https://en.wikipedia.org/w/index.php?title=E&oldid=7#Honours', honours_revision=7, honours_fetched_at='2025-09-20T09:00:00Z', honours_checked_at='2025-09-20T09:00:00Z' WHERE id=101")
    x("INSERT INTO core.player_honour_titles(player_id,seq,category,name,team,seasons) VALUES (101,0,'team','French Ligue 1','Olympique Été',ARRAY['2023–24','2024–25']),(101,1,'individual','Ligue 1 Player of the Year',NULL,ARRAY['2025'])")
    # UEFA club and association coefficients of 2025/2026, FIFA's edition of 18 September 2025.
    x("""INSERT INTO core.ranking_editions(id,kind,provider,label,period,published_on,is_current,source_url,source_updated_at,updated_at) VALUES
         (1,'uefa_clubs','uefa','2025/2026','2025/2026','2025-09-01',true,'https://comp.uefa.com/v2/coefficients?c','2025-09-01T08:00:00Z','2025-09-02T00:00:00Z'),
         (2,'uefa_associations','uefa','2025/2026','2025/2026','2025-09-01',true,'https://comp.uefa.com/v2/coefficients?a','2025-09-01T08:00:00Z','2025-09-02T00:00:00Z'),
         (3,'fifa_men','fifa','2025-09-18','2025-09-18','2025-09-18',true,'https://inside.fifa.com/api/ranking-overview?x','2025-09-18T00:00:00Z','2025-09-19T00:00:00Z')""")
    x("INSERT INTO core.ranking_rows(edition_id,row_no,team_id,position,points,provider_key,entity_name,earned_points,teams_still_playing) VALUES (1,1,1,40,30.5,'52747','Olympique Ete',29.5,1)")
    x("INSERT INTO core.ranking_rows(edition_id,row_no,country_code,position,points,provider_key,entity_name,earned_points,teams_still_playing) VALUES (2,1,'FRA',5,72.3,'1','France',72.3,7)")
    x("INSERT INTO core.ranking_season_points(edition_id,row_no,season_year,points,association_points,teams_still_playing) VALUES (2,1,2026,15.5,15.5,7),(2,1,2025,17.0,17.0,0)")
    x("INSERT INTO core.ranking_rows(edition_id,row_no,country_code,position,previous_position,points,provider_key,entity_name,confederation) VALUES (3,1,'FRA',2,1,1870.0,'43946','France','UEFA')")
    # Cards of Élie Durand: a yellow (m1), a direct red (m3), a second yellow and its red (m5).
    for mid, seq, kind, minute in [(1, 10, "yellow_card", 30), (3, 10, "red_card", 60), (5, 10, "second_yellow", 80), (5, 11, "red_card", 80)]:
        x("INSERT INTO core.match_events(season_id,match_id,team_id,seq,event_type,minute,period,player_id) VALUES (2025,%s,1,%s,%s,%s,'second_half',101)", (mid, seq, kind, minute))
    x("UPDATE core.match_coverage SET events='ok' WHERE match_id IN (1,3,5)")
    # A player's two halves (083): player 101 in match 1.
    x("""INSERT INTO core.player_match_half_stats(season_id, match_id, team_id, player_id, period, minutes_played, goals, total_shots, xg, accurate_passes, touches, duels_won, touches_opp_box, dribbles_succeeded, tackles)
         VALUES (2025,1,1,101,'first_half',45,2,3,0.9,8,20,3,4,1,NULL), (2025,1,1,101,'second_half',45,0,1,0.3,12,25,NULL,2,NULL,1)""")
    # Substitutions (082, 085). Match 1 (2-0): after its two goals, the home side's first change
    # while leading. Match 5 (0-0): each side's first change, level.
    x("""INSERT INTO core.match_events(season_id,match_id,team_id,seq,event_type,minute,period) VALUES
         (2025,1,1,12,'substitution',65,'second_half'), (2025,5,1,20,'substitution',60,'second_half'), (2025,5,4,21,'substitution',70,'second_half')""")
    # Activity maps (16 x 12, cells[y * 16 + x]): Élie Durand's of m1 and m3, one of m5 whose
    # cells do not add up to its actions, Marc Petit's of m3 (on the bench) and m5 (minutes unknown).
    for pid, mid, actions, cells in [(101, 1, 5, {(2, 3): 4, (15, 11): 1}), (101, 3, 5, {(2, 3): 2, (0, 0): 3}), (101, 5, 9, {(1, 1): 2}),
                                     (102, 3, 1, {(5, 5): 1}), (102, 5, 3, {(4, 4): 3})]:
        grid = [0] * 192
        for (cx, cy), n in cells.items():
            grid[cy * 16 + cx] = n
        x("INSERT INTO core.player_heatmaps(season_id,match_id,team_id,player_id,actions,cells,updated_at) VALUES (2025,%s,1,%s,%s,%s,'2025-09-20T10:00:00Z')", (mid, pid, actions, grid))
    # Generation 7 = home 3 + edition 3 + the archive season 1 (imported below, dated before).
    x("INSERT INTO ops.resource_versions(resource_kind,resource_id,version,published_at) VALUES ('home',1,3,'2025-09-20T11:00:00Z'),('competition_season',1,3,'2025-09-20T11:00:00Z')")
    # The seed sets ids by hand: move every identity past them before the import adds rows.
    for table in ("competitions", "competition_seasons", "teams", "players", "matches", "rounds", "coaches", "referees", "assets"):
        db.execute(f"SELECT setval(pg_get_serial_sequence('core.{table}','id'), greatest(1,(SELECT coalesce(max(id),0) FROM core.{table})))")
    # The 2015/2016 archive, imported by main's builders and shared/archive.js (tests/archive_fixtures.py).
    with tempfile.TemporaryDirectory() as sources:
        archives.run(db, make_sources(sources))
    # The archive index reads the counts the worker's daily pass computes (058).
    db.execute("SELECT agg.refresh_archive_seasons()")
    db.execute("UPDATE ops.resource_versions SET published_at='2025-09-20T10:30:00Z' WHERE resource_kind='archive_season'")
    # Cup editions as main's source projections answer them, written by the cups adapter.
    from datetime import datetime, timezone
    with db.transaction():
        for kind, competition, season, body in SAMPLES:
            cups.save(db, kind, competition, season, body, datetime(2025, 9, 20, 8, tzinfo=timezone.utc))
        # Supplemental cup reads live alongside this suite's fixed native publication (generation 7).
        # Their own notification and replay are exercised separately in the PostgreSQL snapshot suites.
        db.execute("""DELETE FROM ops.resource_versions v USING core.competition_seasons cs
                      WHERE v.resource_kind='competition_season' AND v.resource_id=cs.id AND cs.cup_key IS NOT NULL""")
    # open-matchday competitions, from the real (trimmed) files of backend/tests/fixtures/open_matchday.
    from test_open_matchday import fake_get
    from vega.sources import open_matchday

    with db.transaction():
        open_matchday.run(db, fake_get, "europe", datetime(2026, 11, 9, 6, tzinfo=timezone.utc))
    # Power rankings: the clubs' Elo for real; players synthetic (too few matches for the role references).
    power.refresh_elo(db)
    run = x("INSERT INTO agg.power_runs(kind,season_id,method_version,status,finished_at) VALUES ('players',2025,'power-ranking-v3','published','2025-09-06T03:00:00Z') RETURNING id").fetchone()[0]
    # A total is what the player does and the level of his club (own_total + level_total); the index ranks.
    x("""INSERT INTO agg.player_power(season_id,player_id,role,team_id,matches,minutes,total,rate,eligible,total_percentile,rate_percentile,score,rank,role_rank,run_id,own_total,level_total,index)
         VALUES (2025,101,'centre_forward',1,3,260,4.2,0.535,true,90,80,87.5,1,1,%(run)s,3.0,1.2,1.4),(2025,104,'winger',2,2,160,1.1,0.161,true,50,50,50,2,1,%(run)s,1.3,-0.2,0),
                (2025,103,'goalkeeper',4,2,180,0.3,0.042,false,NULL,NULL,NULL,NULL,NULL,%(run)s,0.3,0,NULL)""", {"run": run})
    # A replacement (090): a second centre-forward this season, the first one's season before, and the
    # worth of a line-up as lineup.refresh writes it.
    with db.transaction():
        Store(db).season("2024/2025")
    x("""INSERT INTO agg.player_power(season_id,player_id,role,team_id,matches,minutes,total,rate,eligible,run_id,own_total,level_total)
         VALUES (2025,102,'centre_forward',2,6,540,0.6,0.055,false,%(run)s,0.55,0.05),(2024,101,'centre_forward',1,30,2400,14,0.44,true,%(run)s,12.0,2.0)""", {"run": run})
    x("INSERT INTO agg.lineup_models(version, fitted_at, matches, rated, elo_per_unit, elo_per_unit_error) VALUES ('lineup-v1', '2025-09-06T03:14:00Z', 28524, 75907, 44.8, 3.2)")
    # The players' level (167 and 169, Score Vega v9.1), as level.write keeps it beside the ranking: the forward
    # judged up front (his hour on the wing is not: too few minutes), a number 10, and the keeper, above the
    # minutes bar and without goals prevented on half his minutes (not measured, §54).
    level_run = x("""INSERT INTO agg.level_runs(season_id, version, status, started_at, finished_at, players, settings)
                     VALUES (2025, 'score-vega-v9.1', 'published', '2025-09-06T03:00:00Z', '2025-09-06T03:05:00Z', 3, '{"psi": 10}') RETURNING id""").fetchone()[0]
    x("""INSERT INTO agg.player_level(season_id, player_id, position, team_id, universe, eligible, linked, minutes, level, own, blocks, starts, club,
           start_share, club_level, score, rank, position_rank, run_id, measured)
         VALUES (2025,101,'centre_forward',1,'men',true,true,260,21.4,14.2,11.0,3.2,7.2,0.9,0.72,79.7,1,1,%(run)s,true),
                (2025,104,'attacking_midfielder',2,'men',true,true,160,0,1.5,1.0,0.5,-1.5,0.6,-0.15,50,2,1,%(run)s,true),
                (2025,103,'goalkeeper',4,'men',true,true,180,-6.0,-6.0,-2.0,-4.0,0,0.2,0,40.5,3,1,%(run)s,false)""", {"run": level_run})
    x("""INSERT INTO agg.player_level_positions(season_id, player_id, position, acquired, minutes, minutes_two_seasons, share, value, level,
           finishing, creation, progression, defence, retention, run_id)
         VALUES (2025,101,'centre_forward',true,200,2600,1,13.5,21.4,1.25,0.4,0.1,-0.3,0.2,%(run)s),
                (2025,101,'winger',false,60,60,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,%(run)s),
                (2025,104,'attacking_midfielder',true,160,160,1,2.5,0,0.1,0.5,0.2,0,0.1,%(run)s),
                (2025,103,'goalkeeper',true,180,180,1,-1.2,-6.0,NULL,NULL,NULL,NULL,NULL,%(run)s)""", {"run": level_run})
    # The Ballon d'Or race on the level (175, FAILURE_MODES §60), as award.write keeps it beside the v8 race: the forward
    # and the number 10 ranked, the keeper not measured scored and out of the race. Only once 175 is in the schema.
    if x("SELECT to_regclass('agg.player_award')").fetchone()[0]:
        award_run = x("""INSERT INTO agg.award_runs(season_id, version, status, started_at, finished_at, level_run_id, reference_season, players,
                           settings, spreads)
                         VALUES (2025, 'vega-award-v1', 'published', '2025-09-06T03:05:00Z', '2025-09-06T03:06:00Z', %s, 2025, 3, '{}', '{}')
                         RETURNING id""", (level_run,)).fetchone()[0]
        x("""INSERT INTO agg.player_award(season_id, player_id, team_id, position, universe, eligible, linked, top_division, measured, individual,
               collective, card_points, fair_play_minutes, fair_play, z_individual, z_collective, z_fair_play, level, score, rank, reason, run_id)
             VALUES (2025,101,1,'centre_forward','men',true,true,true,true,21.4,0.5,1,260,-0.25,1.2,1.5,0.5,25.5,82.5,1,NULL,%(run)s),
                    (2025,104,2,'attacking_midfielder','men',true,true,true,true,0,0.2,0,0,-0.1,0,0.5,0,1.5,52.5,2,NULL,%(run)s),
                    (2025,103,4,'goalkeeper','men',true,true,true,false,-6.0,0,0,180,-0.1,-0.5,-0.5,0,-8.5,37.5,NULL,'keeper_data',%(run)s)""",
          {"run": award_run})
        x("""INSERT INTO agg.player_award_honours(season_id, player_id, team_id, competition_season_id, kind, reached, league_rank, progress, factor,
               prestige, share, value, reason, run_id)
             VALUES (2025,101,1,1,'league',NULL,1,1,1,NULL,1,0.5,NULL,%(run)s),
                    (2025,104,2,1,'league',NULL,2,1,1,NULL,1,0.2,NULL,%(run)s)""", {"run": award_run})
        # A run of the next day whose race failed (60ab): kept with no player, the race above still served.
        x("""INSERT INTO agg.award_runs(season_id, version, status, started_at, finished_at, level_run_id, players, settings)
             VALUES (2025, 'vega-award-v1', 'failed', '2025-09-07T03:05:00Z', '2025-09-07T03:05:30Z', %s, NULL, '{}')""", (level_run,))
    # Match grades (099): match 1's players, a forward's great match, a winger's ordinary one, and a
    # keeper's ten minutes, too short and too ordinary for a grade to show.
    x("""INSERT INTO agg.player_power_matches(season_id,match_id,player_id,team_id,role,minutes,contribution,run_id,match_index)
         VALUES (2025,1,101,1,'centre_forward',90,1.6,%(run)s,2.5),(2025,1,104,2,'winger',70,0.0,%(run)s,0.0),(2025,1,103,4,'goalkeeper',10,0.1,%(run)s,0.4)""", {"run": run})
    # Vega's grades where the statistics are (107): every played match of the seed with a level
    # gets the normal score z = 3 (level − 7); match 1's three ranked ones are those above.
    ranked = {(1, 101), (1, 104), (1, 103)}
    for pid, mid, team, minutes, level, *_ in STATS:
        if level is not None and minutes and (mid, pid) not in ranked:
            x("""INSERT INTO agg.player_match_grades(season_id,match_id,player_id,award_season,team_id,role,minutes,z,first_z,run_id)
                 VALUES (2025,%s,%s,2025,%s,'centre_forward',%s,%s,%s,%s)""", (mid, pid, team, minutes, 3 * (level - 7), 3 * (level - 7), run))
    x("""INSERT INTO agg.player_match_grades(season_id,match_id,player_id,award_season,team_id,role,minutes,z,first_z,run_id)
         SELECT 2025,match_id,player_id,2025,team_id,role,minutes,match_index,match_index,run_id FROM agg.player_power_matches WHERE match_id=1""")
    # The league's rounds (109): round 1 closed, with a Team of the Round of two players shown
    # here (a real one has eleven) and the race after it; the next week still open.
    x("""INSERT INTO agg.league_rounds(competition_season_id,round_key,season_id,round_id,label,window_start,window_end,matches,played,excused,last_match_at,status,closed_at)
         VALUES (1,'r1',2025,1,'1','2025-09-01T19:00Z','2025-09-02T19:00Z',2,2,0,'2025-09-02T19:00Z','closed','2025-09-03T03:00Z'),
                (1,'w2025-09-02',2025,NULL,'Semaine du 2025-09-02','2025-09-04T19:00Z','2025-09-05T19:00Z',2,1,0,'2025-09-04T19:00Z','open',NULL)""")
    x("""INSERT INTO agg.round_teams(competition_season_id,round_key,slot,line,slot_role,formation,player_id,team_id,match_id,season_id,role,minutes,z)
         VALUES (1,'r1',0,0,'GK','4-3-3',103,4,2,2025,'goalkeeper',90,0.6),(1,'r1',10,3,'CF','4-3-3',101,1,1,2025,'centre_forward',90,2.5)""")
    x("""INSERT INTO agg.round_season_race(competition_season_id,round_key,rank,player_id,team_id,z,matches,minutes)
         VALUES (1,'r1',1,101,1,0.9,3,260),(1,'r1',2,104,2,0.5,2,160)""")
    x("""INSERT INTO agg.player_grade_editions(season_id,competition_season_id,player_id,grade_count,grade_minutes,zm_sum)
         SELECT g.season_id,m.competition_season_id,g.player_id,count(*),sum(g.minutes),sum(g.minutes*g.z::float8)
         FROM agg.player_match_grades g JOIN core.matches m ON m.id=g.match_id AND m.season_id=g.season_id
         WHERE g.minutes>=20 GROUP BY 1,2,3""")
    # A breakout (088): the keeper below the ranking's minutes, ahead of 91.3 % of his role's regulars.
    x("INSERT INTO agg.breakout_runs(season_id, version, computed_at, candidates, flagged) VALUES (2025, 'breakout-v2', '2025-09-06T03:12:00Z', 12, 1)")
    x("INSERT INTO agg.player_breakouts(season_id, player_id, role, team_id, minutes, rate, percentile, regulars, rank) VALUES (2025, 103, 'goalkeeper', 4, 180, 0.042, 91.3, 40, 1)")
    # Action values (089): the forward's league season, third of the 24 of his role by VAEP; a team-mate too alone in his role to be placed.
    x("INSERT INTO agg.action_value_runs(season_id, version, computed_at, players, placed) VALUES (2025, 'actions-v2', '2025-09-06T03:13:00Z', 2, 1)")
    x("""INSERT INTO agg.player_action_values(season_id, player_id, competition_id, role, minutes, vaep, vaep_offensive, vaep_defensive, pv, pv_offensive, pv_defensive, xt,
           peers, vaep_rank, vaep_percentile, pv_rank, pv_percentile, xt_rank, xt_percentile) VALUES
         (2025, 101, 1, 'centre_forward', 1260, 0.4126, 0.4391, -0.0268, 0.3871, 0.3802, 0.0069, 0.0834, 24, 3, 89.58, 5, 81.25, 14, 43.75),
         (2025, 102, 1, 'central_midfielder', 990, 0.1512, 0.1403, 0.0109, 0.1298, NULL, NULL, 0.0911, 7, NULL, NULL, NULL, NULL, NULL, NULL)""")
    # Élie Durand's season by block and by role (two roles: 200 minutes up front, 60 on the wing).
    x("UPDATE agg.player_power SET finishing_total=3.1,creation_total=0.8,defence_total=0.3,finishing_percentile=95,creation_percentile=70.5,defence_percentile=40 WHERE player_id=101")
    x("""INSERT INTO agg.player_power_roles(season_id,player_id,role,matches,minutes,total,rate,run_id)
         VALUES (2025,101,'centre_forward',2,200,3.9,0.539,%(run)s),(2025,101,'winger',1,60,0.3,0.053,%(run)s)""", {"run": run})
    # A match forecast and a league projection, as forecast.refresh writes them (076). The fit's time has microseconds,
    # as now() gives them: the grid's model is found in SQL, never by a JavaScript Date (FAILURE_MODES § 80.1, 80b).
    model = x("""INSERT INTO agg.forecast_models(version,fitted_at,matches,home_base,home_slope,away_base,away_slope,rho,strength_spread,simulations)
                 VALUES ('forecast-v1','2025-09-06T03:10:00.123456Z',60000,0.26,0.93,0.32,0.91,-0.03,90,1000) RETURNING id""").fetchone()[0]
    pending = x("SELECT id, home_team_id, away_team_id FROM core.matches WHERE status='not_started' ORDER BY id LIMIT 1").fetchone()
    if pending:
        x("""INSERT INTO agg.match_forecasts(match_id,season_id,home_win,draw,away_win,home_goals,away_goals,likely_home,likely_away,home_elo,away_elo,model_id)
             VALUES (%s,2025,0.5123,0.2501,0.2376,1.62,1.04,1,0,1540,1490,%s)""", (pending[0], model))
        # Two bookmakers' odds of that match (111): one moved since its opening line.
        x("""INSERT INTO core.match_odds(season_id,match_id,bookmaker,title,home,draw,away,first_home,first_draw,first_away,updated_at,fetched_at)
             VALUES (2025,%(m)s,'betclic_fr','Betclic',2.00,3.40,3.50,2.10,3.30,3.40,'2025-09-06T10:00Z','2025-09-06T10:05Z'),
                    (2025,%(m)s,'winamax_fr','Winamax',1.95,3.35,3.60,1.95,3.35,3.60,'2025-09-06T09:00Z','2025-09-06T10:05Z')""", {"m": pending[0]})
    # The same forecast read with the two confirmed line-ups (091), and a finished match that was forecast with its own.
    lineup_forecast = """INSERT INTO agg.match_lineup_forecasts(match_id, season_id, home_win, draw, away_win, home_goals, away_goals, likely_home, likely_away,
                           home_elo, away_elo, home_deviation, away_deviation, elo_per_unit, first_computed_at, computed_at)
                         VALUES (%s, 2025, 0.5642, 0.2389, 0.1969, 1.74, 0.97, 2, 0, 1540, 1490, %s, %s, 44.8, '2025-09-06T11:10:00Z', '2025-09-06T11:10:00Z')"""
    if pending:
        x(lineup_forecast, (pending[0], 0.31, -0.72))
    x(lineup_forecast, (1, 0.2, -0.1))
    for team, played, points, projected, places in ((1, 3, 7, 71.4, {1: 0.6, 2: 0.4}), (2, 3, 4, 55.25, {1: 0.4, 2: 0.6})):
        x("INSERT INTO agg.season_projections(competition_season_id,team_id,season_id,played,points,projected_points,model_id) VALUES (1,%s,2025,%s,%s,%s,%s)",
          (team, played, points, projected, model))
        for place, share in places.items():
            x("INSERT INTO agg.season_projection_places(competition_season_id,team_id,place,probability) VALUES (1,%s,%s,%s)", (team, place, share))
    # A return from absence (087): the curve of one length of absence, and player 102 in the middle of one.
    x("""INSERT INTO agg.return_curves(bucket, match_no, returns, minutes, usual_minutes, version) VALUES
         ('30_59', 1, 7000, 37, 54, 'returns-v1'), ('30_59', 2, 6000, 49, 55, 'returns-v1'), ('30_59', 3, 5000, 55, 56, 'returns-v1'),
         ('60_119', 1, 4000, 37, 55, 'returns-v1')""")
    x("""INSERT INTO agg.player_returns(player_id, team_id, absent_from, returned_on, days, matches_missed, matches_back, bucket, usual_minutes, minutes_back)
         VALUES (102, 1, '2025-08-16', '2025-09-27', 42, 5, 2, '30_59', 84.4, 51.5)""")
    # The in-play model (086) and the two strengths of match 1 (2-0, goals at 11' and 21').
    x("""INSERT INTO agg.inplay_models(version, fitted_at, matches, goals, red_matches, q1, q2, q3, q4, q5, q6, after_90, down, up)
         VALUES ('inplay-v1', '2025-09-06T03:11:00Z', 16000, 43000, 3000, 0.13, 0.14, 0.18, 0.16, 0.16, 0.16, 0.07, 0.6, 1.7)""")
    if not x("SELECT 1 FROM agg.team_elo WHERE match_id=1").fetchone():
        elo_run = x("INSERT INTO agg.power_runs(kind, method_version, status) VALUES ('elo', 'seed', 'published') RETURNING id").fetchone()[0]
        x("""INSERT INTO agg.team_elo(match_id, team_id, season_id, kickoff_at, elo_before, elo_after, expected, result, run_id)
             VALUES (1, 1, 2025, '2025-08-16T19:00:00Z', 1540, 1552, 0.6, 1, %(r)s), (1, 2, 2025, '2025-08-16T19:00:00Z', 1490, 1478, 0.4, 0, %(r)s)""", {"r": elo_run})
    # Extra time (issue #68), in a cup edition of its own, of an earlier season (2023/2024) and keyed as a cup's, so that
    # the league's tables, the season's rates and the PitchAPI-era reads stay as they are; clubs 1 and 2 (their Elo after match 1): m_xtime1 0-0 at the 90th, 1-0 at the 112th; m_shoot1 1-1 after extra time, 4-3 on
    # penalties; m_shoot2 2-2 then 5-4 on penalties, no extra-time score stated; m_live91 in play, its clock at the
    # 100th with nothing saying it is in extra time. As the provider gives a match (no extra-time score, the shoot-out's
    # not always): m_xtime2 2-1 with its winner at the 108th and no score but the final one; m_xtime3 1-1 with a goal at
    # the 118th and no shoot-out score (the 2022 World Cup final's case in production); m_stop90 1-0, its goal at 90+4.
    cup = x("INSERT INTO core.competitions(name,country_code,kind) VALUES ('Coupe Test','FRA','cup') RETURNING id").fetchone()[0]
    edition = x("INSERT INTO core.competition_seasons(competition_id,season_id,native_label,is_current,cup_key) VALUES (%s,2023,'2023/2024',false,'openligadb:extra-time-test:2023/2024') RETURNING id", (cup,)).fetchone()[0]
    for key, status, score, score_90, score_et, penalties, goals in [
        ("m_xtime1", "finished", (1, 0), (0, 0), (1, 0), None, [(112, 0, 1)]),
        ("m_shoot1", "finished", (1, 1), (1, 1), (1, 1), (4, 3), [(30, 0, 1), (75, 0, 2)]),
        ("m_shoot2", "finished", (2, 2), None, None, (5, 4), [(12, 0, 1), (40, 0, 2), (90, 3, 2), (101, 0, 1)]),
        ("m_live91", "in_play", (1, 1), None, None, None, [(20, 0, 1), (80, 0, 2)]),
        ("m_xtime2", "finished", (2, 1), None, None, None, [(30, 0, 1), (60, 0, 2), (108, 0, 1)]),
        ("m_xtime3", "finished", (1, 1), None, None, None, [(20, 0, 1), (118, 0, 2)]),
        ("m_stop90", "finished", (1, 0), None, None, None, [(90, 4, 1)]),
    ]:
        mid = x(
            """INSERT INTO core.matches(competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,home_score_90,away_score_90,
                 home_score_et,away_score_et,home_penalty_score,away_penalty_score,match_date,kickoff_at)
               VALUES (%s,2023,'pitchapi',%s,1,2,%s,%s,%s,%s,%s,%s,%s,%s,'2023-07-20','2023-07-20T19:00:00Z') RETURNING id""",
            (edition, status, *score, *(score_90 or (None, None)), *(score_et or (None, None)), *(penalties or (None, None))),
        ).fetchone()[0]
        x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('match','pitchapi',%s,%s)", (key, mid))
        for seq, (minute, added, team) in enumerate(goals, 1):
            x("INSERT INTO core.match_events(season_id,match_id,team_id,seq,event_type,minute,minute_added) VALUES (2023,%s,%s,%s,'goal',%s,%s)", (mid, team, seq, minute, added))
        if status == "in_play":
            x("INSERT INTO core.match_momentum(season_id,match_id,minute,value) VALUES (2023,%s,45,1),(2023,%s,100,2)", (mid, mid))
    # The players' season totals, as the calculator writes them (the home's leaders read them).
    from vega import calculator

    x(calculator.PLAYER_SQL, {"cs": 1, "sid": 2025, "all": True, "players": [], "teams": []})
    x("SELECT agg.refresh_performance_distribution(1)")
    # The player list's rows (060), for every seeded edition.
    x("SELECT count(agg.refresh_player_list(id)) FROM core.competition_seasons")
    # The seeded data is one publication (the worker publishes on its rhythm).
    published = db.execute("SELECT max(coalesce(published_at, updated_at)) FROM ops.resource_versions").fetchone()[0]
    publish(db, published, force=True)
    db.close()


if __name__ == "__main__":
    main(sys.argv[1])
