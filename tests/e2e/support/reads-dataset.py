"""The deterministic base of tests/e2e/page-reads.e2e.mjs (FAILURE_MODES_OPTIMISATIONS.md GH129), synthetic only.

The read API's seed (backend/api/test/seed.py), then, around its own matches: Ligue 1 2025/2026 as a whole season of 20
clubs (380 fixtures, 38 rounds; rounds 1 to 34 played, 35 to 38 to come), so that the match page's season holds eight
pages of the paged read; the seed's match m_aaaaa1 in round 1 and its other matches in rounds 2 to 6; and a season
before (Ligue 1 2024/2025) where the seed's forward p_aaaab1 played twice, so that his page has a history.

    python3 tests/e2e/support/reads-dataset.py postgresql://…/vega_v2_<name>   (a local base only)
"""
import runpy
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "backend" / "tests")]
seed = runpy.run_path(str(ROOT / "backend/api/test/seed.py"))

from vega.store import Store, connect_local  # noqa: E402
from vega.worker import publish  # noqa: E402

CLUBS = 20
FIRST = date(2025, 8, 8)


def schedule(teams):
    """A double round robin (circle method): 38 rounds of 10 matches for 20 clubs."""
    teams = list(teams)
    rounds = []
    for r in range(len(teams) - 1):
        pairs = [(teams[i], teams[-1 - i]) for i in range(len(teams) // 2)]
        rounds.append([(a, b) if (r + i) % 2 == 0 else (b, a) for i, (a, b) in enumerate(pairs)])
        teams = [teams[0], teams[-1], *teams[1:-1]]
    return rounds + [[(b, a) for a, b in pairs] for pairs in rounds]


def main(dsn):
    seed["main"](dsn)
    db = connect_local(dsn)
    x = db.execute
    with db.transaction():
        teams = [1, 2, 3, 4]
        for i in range(1, CLUBS - 3):
            tid = 200 + i
            x("INSERT INTO core.teams(id,name,country_code) VALUES (%s,%s,'FRA')", (tid, f"Club E2E {i:02d}"))
            x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('team','pitchapi',%s,%s)", (f"t_e2e{i:03d}", tid))
            x("INSERT INTO core.team_seasons(team_id,competition_season_id) VALUES (%s,1)", (tid,))
            teams.append(tid)
        rounds = {name: rid for rid, name in x("SELECT id, name FROM core.rounds WHERE competition_season_id=1").fetchall()}
        for n in range(1, 39):
            if str(n) not in rounds:
                rounds[str(n)] = x("INSERT INTO core.rounds(competition_season_id,name,seq) VALUES (1,%s,%s) RETURNING id", (str(n), n)).fetchone()[0]
        for mid in range(2, 7):
            x("UPDATE core.matches SET round_id=%s WHERE id=%s", (rounds[str(mid)], mid))
        mid = 1000
        for r, pairs in enumerate(schedule(teams), 1):
            day = FIRST + timedelta(days=7 * (r - 1))
            for k, (home, away) in enumerate(pairs):
                mid += 1
                played = r <= 34
                kickoff = datetime(day.year, day.month, day.day, 13 + (k % 5) * 2, tzinfo=timezone.utc)
                x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,
                       match_date,kickoff_at,round_id) VALUES (%s,1,2025,'pitchapi',%s,%s,%s,%s,%s,%s,%s,%s)""",
                  (mid, "finished" if played else "not_started", home, away, (mid * 7) % 4 if played else None,
                   (mid * 3) % 3 if played else None, day, kickoff, rounds[str(r)]))
                x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('match','pitchapi',%s,%s)", (f"m_e{mid - 1000:05d}", mid))
                x("INSERT INTO core.match_coverage(season_id,match_id,player_stats) VALUES (2025,%s,'pending')", (mid,))
        # The season before: p_aaaab1 (101) of t_aaaaa1 (1), two matches of Ligue 1 2024/2025.
        Store(db).season("2024/2025")
        edition = x("INSERT INTO core.competition_seasons(competition_id,season_id,native_label,is_current) VALUES (1,2024,'2024/2025',false) RETURNING id").fetchone()[0]
        for team in (1, 2):
            x("INSERT INTO core.team_seasons(team_id,competition_season_id) VALUES (%s,%s)", (team, edition))
        for n, (home, away, hs, as_) in enumerate(((1, 2, 2, 1), (2, 1, 0, 0)), 1):
            hid = 2000 + n
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date,kickoff_at)
                 VALUES (%s,%s,2024,'pitchapi','finished',%s,%s,%s,%s,%s,%s)""",
              (hid, edition, home, away, hs, as_, date(2024, 9, n * 7), datetime(2024, 9, n * 7, 19, tzinfo=timezone.utc)))
            x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('match','pitchapi',%s,%s)", (f"m_h{n:05d}", hid))
            x("INSERT INTO core.match_coverage(season_id,match_id,player_stats) VALUES (2024,%s,'ok')", (hid,))
            x("""INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played,goals,xg,total_shots,accurate_passes,accurate_passes_total)
                 VALUES (2024,%s,1,101,90,%s,0.6,3,20,25)""", (hid, 1 if n == 1 else 0))
            x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES (2024,%s,1,101,true,91)", (hid,))
    x("SELECT count(agg.refresh_player_list(id)) FROM core.competition_seasons")
    # The editions the manifest lists (agg.editions), with the matches added above.
    x("SELECT ops.refresh_editions()")
    published = x("SELECT max(coalesce(published_at, updated_at)) FROM ops.resource_versions").fetchone()[0]
    publish(db, published, force=True)
    counts = x("SELECT count(*) FILTER (WHERE competition_season_id=1), count(*) FILTER (WHERE season_id=2024) FROM core.matches").fetchone()
    db.close()
    print(f"dataset: Ligue 1 2025/2026 {counts[0]} matches, 2024/2025 {counts[1]}")


if __name__ == "__main__":
    main(sys.argv[1])
