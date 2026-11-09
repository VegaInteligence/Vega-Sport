"""Seed a disposable v2 database for the Node API contract tests (synthetic data only)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from vega_v2.store import Store, connect_local, migrate

TEAMS = {1: ("t_aaaaa1", "Olympique Été", "FRA"), 2: ("t_aaaaa2", "Racing Club", "FRA"), 3: ("t_aaaaa3", "Stade Nord", None), 4: ("t_aaaaa4", "Union Sud", "FRA")}
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
    x("INSERT INTO ops.resource_versions(resource_kind,resource_id,version,published_at) VALUES ('home',1,3,'2025-09-20T11:00:00Z'),('competition_season',1,4,'2025-09-20T11:00:00Z')")
    db.close()


if __name__ == "__main__":
    main(sys.argv[1])
