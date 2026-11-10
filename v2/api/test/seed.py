"""Seed a disposable v2 database for the Node API contract tests (synthetic data only)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tests"))
import tempfile

from archive_fixtures import make_sources
from cup_samples import SAMPLES
from vega_v2.sources import cups, curated
from vega_v2 import archives, power
from vega_v2.worker import publish
from vega_v2.store import Store, connect_local, migrate

TEAMS = {1: ("t_aaaaa1", "Olympique Été", "FRA"), 2: ("t_aaaaa2", "Racing Club", "FRA"), 3: ("t_aaaaa3", "Stade Nord", None), 4: ("t_aaaaa4", "Union Sud", "FRA")}
# Players: (id, key, name, team); stats per match: (match, minutes, rating, goals, xg, shots, passes ok/att, position, starter, saves, prevented)
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
            x(
                "INSERT INTO core.match_events(season_id,match_id,team_id,seq,event_type,minute,period,is_own_goal) VALUES (2025,%s,%s,%s,'goal',%s,'first_half',false)",
                (mid, team, seq, 10 * seq + mid),
            )
    x("INSERT INTO core.assets(id,kind,source_url) VALUES (3,'photo','https://img.example/p1.png')")
    for pid, (key, name) in PLAYERS.items():
        x("INSERT INTO core.players(id,name,photo_asset_id) VALUES (%s,%s,%s)", (pid, name, 3 if pid == 101 else None))
        x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','pitchapi',%s,%s)", (key, pid))
    x("INSERT INTO core.entity_names(entity_type,entity_id,name,normalized,kind,source) VALUES ('player',104,'CR7','cr7','alias','vega')")
    for pid, mid, team, minutes, rating, goals, xg, shots, ok, att, position, starter, saves, prevented in STATS:
        x(
            "INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,position_id,minutes_played,rating,goals,xg,total_shots,accurate_passes,accurate_passes_total,saves,goals_prevented) VALUES (2025,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            # As in production: the statistics carry no position, the line-up does.
            (mid, team, pid, None, minutes, rating, goals, xg, shots, ok, att, saves, prevented),
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
    # open-matchday competitions, from the real (trimmed) files of v2/tests/fixtures/open_matchday.
    from test_open_matchday import fake_get
    from vega_v2.sources import open_matchday

    with db.transaction():
        open_matchday.run(db, fake_get, "europe", datetime(2026, 11, 9, 6, tzinfo=timezone.utc))
    # Power rankings: the clubs' Elo for real; players synthetic (too few matches for the role references).
    power.refresh_elo(db)
    run = x("INSERT INTO agg.power_runs(kind,season_id,method_version,status,finished_at) VALUES ('players',2025,'power-ranking-v1','published','2025-09-06T03:00:00Z') RETURNING id").fetchone()[0]
    x("""INSERT INTO agg.player_power(season_id,player_id,role,team_id,matches,minutes,total,rate,eligible,total_percentile,rate_percentile,score,rank,role_rank,run_id)
         VALUES (2025,101,'centre_forward',1,3,260,4.2,0.535,true,90,80,87.5,1,1,%(run)s),(2025,104,'winger',2,2,160,1.1,0.161,true,50,50,50,2,1,%(run)s),
                (2025,103,'goalkeeper',4,2,180,0.3,0.042,false,NULL,NULL,NULL,NULL,NULL,%(run)s)""", {"run": run})
    # Élie Durand's season by block and by role (two roles: 200 minutes up front, 60 on the wing).
    x("UPDATE agg.player_power SET finishing_total=3.1,creation_total=0.8,defence_total=0.3,finishing_percentile=95,creation_percentile=70.5,defence_percentile=40 WHERE player_id=101")
    x("""INSERT INTO agg.player_power_roles(season_id,player_id,role,matches,minutes,total,rate,run_id)
         VALUES (2025,101,'centre_forward',2,200,3.9,0.539,%(run)s),(2025,101,'winger',1,60,0.3,0.053,%(run)s)""", {"run": run})
    # The players' season totals, as the calculator writes them (the home's leaders read them).
    from vega_v2 import calculator

    x(calculator.PLAYER_SQL, {"cs": 1, "sid": 2025, "all": True, "players": [], "teams": []})
    x("SELECT agg.refresh_performance_distribution(1)")
    # The seeded data is one publication (the worker publishes on its rhythm).
    published = db.execute("SELECT max(coalesce(published_at, updated_at)) FROM ops.resource_versions").fetchone()[0]
    publish(db, published, force=True)
    db.close()


if __name__ == "__main__":
    main(sys.argv[1])
