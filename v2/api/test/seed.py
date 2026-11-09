"""Seed a disposable v2 database for the Node API contract tests (synthetic data only)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
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
    x("INSERT INTO core.competitions(id,name,country_code,kind,logo_asset_id) VALUES (1,'Ligue 1','FRA','league',1)")
    x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('competition','pitchapi','l_3FJFUl',1)")
    x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,is_current) VALUES (1,1,2025,'2025/2026',true)")
    for tid, (key, name, country) in TEAMS.items():
        x("INSERT INTO core.teams(id,name,country_code,crest_asset_id) VALUES (%s,%s,%s,%s)", (tid, name, country, 2 if tid == 1 else None))
        x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('team','pitchapi',%s,%s)", (key, tid))
        x("INSERT INTO core.team_seasons(team_id,competition_season_id) VALUES (%s,1)", (tid,))
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
            (mid, team, pid, position, minutes, rating, goals, xg, shots, ok, att, saves, prevented),
        )
        x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES (2025,%s,%s,%s,%s,%s)", (mid, team, pid, starter, position))
    for pid, mid, team in BENCH:
        x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES (2025,%s,%s,%s,false,61)", (mid, team, pid))
    x("INSERT INTO ops.resource_versions(resource_kind,resource_id,version,published_at) VALUES ('home',1,3,'2025-09-20T11:00:00Z'),('competition_season',1,4,'2025-09-20T11:00:00Z')")
    db.close()


if __name__ == "__main__":
    main(sys.argv[1])
