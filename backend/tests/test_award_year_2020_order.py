"""Award year 2020 in production's order (docs/calculs/09-audit-2026-11/FAILURE_MODES.md §48, 48a–48e, written before
these tests).

Production (code bfab25d4ef, power-ranking-v8): the stale step ranked 2021/22 at 23:39:52 UTC on 18 Nov 2026, then
2020/21 at 23:39:58 by the rule of then (its own references, a ranking and an award race). 2020's run is the later:
§47's two conditions never list it. Here, on §38's two leagues (test_player_grade_reasons.league), under the real roles:
the Elo, 2020 ranked by the earlier rule (the ranking 2021 reads as its prior), 2021's daily models, 2020 ranked by the
earlier rule again, after 2021 — production's state. Then the code under test: `stale_rankings`, the real
`Worker.daily` (twice), a new run of 2021 and the passes after it; the real read API under vega_read
(tests/read_http.mjs) before and after.
"""

from datetime import date, datetime, timedelta, timezone
import contextlib
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest import mock
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from prerequisites import required  # noqa: E402
from test_player_grade_reasons import AWARD_2020, league  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_GRADES_TEST_DSN")
NODE_READY = bool(shutil.which("node")) and (ROOT / "api" / "node_modules" / "pg").is_dir()
NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)
RANKING = "/api/rankings/power?kind=players&season={}"
# What a run of award year 2020 may not touch: award year 2021's ranking, roles, award race, runs, grades, references.
OF_2021 = {
    "player_power": "SELECT * FROM agg.player_power WHERE season_id = 2021 ORDER BY player_id",
    "player_power_roles": "SELECT * FROM agg.player_power_roles WHERE season_id = 2021 ORDER BY player_id, role",
    "award": "SELECT * FROM agg.player_award_ranking WHERE season_id = 2021 ORDER BY rank",
    "runs": "SELECT id, status, method_version, started_at, players FROM agg.power_runs WHERE kind = 'players' AND season_id = 2021 ORDER BY id",
    "grades": "SELECT * FROM agg.player_match_grades WHERE award_season = 2021 ORDER BY season_id, match_id, player_id",
    "roles": "SELECT * FROM agg.match_grade_roles WHERE ref_season = 2021 ORDER BY role",
    "spreads": "SELECT * FROM agg.match_grade_spreads WHERE ref_season = 2021 ORDER BY role, competition_id",
    "quantiles": "SELECT * FROM agg.match_grade_quantiles WHERE ref_season = 2021 ORDER BY role, step",
}


def http(paths):
    done = subprocess.run([shutil.which("node"), str(ROOT / "tests" / "read_http.mjs"), DSN, json.dumps([{"path": p} for p in paths])],
                          capture_output=True, text=True, timeout=120)
    if done.returncode:
        raise AssertionError(done.stderr)
    return {r["path"]: r for r in json.loads(done.stdout.strip().splitlines()[-1])}


@required(DSN and psycopg and NODE_READY, "requires a disposable local grades DB (VEGA_V2_GRADES_TEST_DSN), psycopg, node and backend/api/node_modules")
class AwardYear2020ProductionOrderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_grades_test":
            raise RuntimeError("dedicated local grades DB required")
        from vega import models, power
        from vega.store import Store, connect_local, migrate
        from vega.worker import Worker

        cls.power = power
        db = cls.db = connect_local(DSN)
        db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(db)
        with db.transaction():
            for label in ("2020/2021", "2021/2022"):
                Store(db).season(label)
        cls.calendar = league(db.execute, 1, "l_CALEND", "2021", range(1, 9), date(2021, 4, 1))
        cls.season = league(db.execute, 2, "l_SEASON", "2021/2022", range(11, 19), date(2021, 8, 14))
        collect, calc, read = (connect_local(DSN) for _ in range(3))
        for conn, role in ((collect, "vega_collect"), (calc, "vega_calc"), (read, "vega_read")):
            conn.execute(f"SET ROLE {role}")
        cls.calc, cls.read = calc, read
        cls.connections = (db, collect, calc, read)
        # Production's history: the Elo; 2020 by the earlier rule (the ranking 2021's prior reads); 2021's models; 2020 by
        # the earlier rule again, after 2021 (18 Nov 2026, 23:39:52 then 23:39:58 UTC).
        earlier_rule = lambda: mock.patch.object(power, "partial_year", lambda conn, season: False, create=True)
        power.refresh_elo(calc)
        with earlier_rule():
            power.refresh_players(calc, 2020)
        models.refresh_daily(calc, 2021, elo=False)
        with earlier_rule():
            power.refresh_players(calc, 2020)
        cls.production = {
            "runs": cls.runs(2020), "ranked": cls.one("SELECT count(*) FROM agg.player_power WHERE season_id = 2020")[0],
            "own_refs": cls.one("SELECT count(*) FROM agg.match_grade_roles WHERE ref_season = 2020")[0],
            "graded": cls.db.execute("SELECT ref_season, count(*) FROM agg.player_match_grades WHERE award_season = 2020 GROUP BY 1").fetchall(),
            "2021": cls.of_2021(),
        }
        cls.match = cls.one("SELECT api.public_id('match', %s)", cls.calendar[0][0])[0]
        cls.paths = [RANKING.format("2020/2021") + "&scope=all", RANKING.format("2020/2021"), RANKING.format("2021/2022") + "&scope=all",
                     f"/api/rankings/match?match={cls.match}"]
        cls.api_before = http(cls.paths)
        cls.grades_before = cls.match_grades()
        # The code under test, on production's state.
        cls.stale_deployed = power.stale_rankings(calc)  # 48a
        cls.clock = NOW
        cls.worker = Worker(Store(collect), SimpleNamespace(), clock=lambda: cls.clock, calc_conn=calc)
        cls.log_first = cls.daily()  # 48b
        cls.after_first = {"runs": cls.runs(2020), "stale": power.stale_rankings(calc), "grades": cls.grades_2020(), "2021": cls.of_2021()}
        cls.api_after = http(cls.paths)
        cls.grades_after = cls.match_grades()
        cls.clock = NOW + timedelta(hours=1)
        cls.log_second = cls.daily()  # 48c
        cls.after_second = {"runs": cls.runs(2020), "grades": cls.grades_2020(), "2021": cls.of_2021()}

    @classmethod
    def tearDownClass(cls):
        for conn in cls.connections:
            conn.close()

    @classmethod
    def one(cls, sql, *args):
        return cls.db.execute(sql, args).fetchone()

    @classmethod
    def runs(cls, season):
        return cls.db.execute("SELECT id, status, method_version, players FROM agg.power_runs WHERE kind = 'players' AND season_id = %s ORDER BY id",
                              (season,)).fetchall()

    @classmethod
    def of_2021(cls):
        return {name: sha256(json.dumps(cls.db.execute(sql).fetchall(), default=str).encode()).hexdigest() for name, sql in OF_2021.items()}

    @classmethod
    def grades_2020(cls):
        return cls.db.execute("SELECT season_id, match_id, player_id, ref_season, z, changed_at FROM agg.player_match_grades WHERE award_season = 2020 ORDER BY 1, 2, 3").fetchall()

    @classmethod
    def match_grades(cls):
        """{player's public id: (ref_season, the grade the base gives, shown)} of the first 2020 match."""
        return {p: (ref, grade, shown) for p, ref, grade, shown in cls.db.execute(
            """SELECT api.public_id('player', player_id), ref_season, (100 / (1 + power(10, -z / 4.0)))::numeric::float8, minutes >= 20 OR abs(z) >= 1
               FROM agg.player_match_grades WHERE season_id = 2021 AND match_id = %s""", (cls.calendar[0][0],)).fetchall()}

    @classmethod
    def daily(cls):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            cls.worker.daily()
        return out.getvalue()

    def ranking_lines(self, log):
        return [line for line in log.splitlines() if line.startswith("player ranking ")]

    def test_48a_production_s_state_lists_award_year_2020(self):
        # Production's state as the reviews read it: two published v8 runs of 2020 (the later one ranked players),
        # 2020's run after 2021's, 2020 ranked, graded against its own references.
        runs = self.production["runs"]
        self.assertEqual([r[1] for r in runs], ["superseded", "published"])
        self.assertGreater(runs[-1][3], 0)
        self.assertGreater(self.production["ranked"], 0)
        self.assertGreater(self.production["own_refs"], 0)
        self.assertEqual(self.production["graded"], [(2020, AWARD_2020)])
        started = self.db.execute("""SELECT season_id, started_at FROM agg.power_runs WHERE kind = 'players' AND status = 'published'
                                     ORDER BY season_id""").fetchall()
        self.assertLess(started[1][1], started[0][1])  # 2021's run before 2020's
        self.assertEqual(self.stale_deployed, [2020])  # red on M0: []

    def test_48b_the_worker_s_pass_grades_2020_against_2021_and_ranks_nothing(self):
        self.assertNotIn("error=", self.log_first)
        self.assertEqual(self.ranking_lines(self.log_first), ["player ranking season=2020 method=power-ranking-v8 players=0"])
        self.assertEqual(self.db.execute("SELECT ref_season, count(*) FROM agg.player_match_grades WHERE award_season = 2020 GROUP BY 1").fetchall(),
                         [(2021, AWARD_2020)])
        for table in ("agg.player_power", "agg.player_power_roles", "agg.player_award_ranking"):
            self.assertEqual(self.one(f"SELECT count(*) FROM {table} WHERE season_id = 2020")[0], 0, table)
        published = [r for r in self.after_first["runs"] if r[1] == "published"]
        self.assertEqual([(r[2], r[3]) for r in published], [("power-ranking-v8", 0)])
        self.assertEqual(len(self.after_first["runs"]), 3)
        for table in ("agg.match_grade_roles", "agg.match_grade_spreads", "agg.match_grade_quantiles"):
            self.assertEqual(self.one(f"SELECT count(*) FROM {table} WHERE ref_season = 2020")[0], 0, table)
        self.assertEqual(self.after_first["stale"], [])
        # Award year 2021 is unchanged: its ranking, roles, award race, runs, grades and references (48.1).
        self.assertEqual(self.after_first["2021"], self.production["2021"])

    def test_48c_a_second_pass_changes_nothing(self):
        self.assertNotIn("error=", self.log_second)
        self.assertEqual(self.ranking_lines(self.log_second), [])
        self.assertEqual(self.after_second, {k: self.after_first[k] for k in ("runs", "grades", "2021")})

    def test_48d_a_new_run_of_2021_sends_2020_back_once(self):
        from vega import power

        self.power.refresh_players(self.calc, 2021)
        self.assertEqual(power.stale_rankings(self.calc), [2020])
        self.clock_at(NOW + timedelta(hours=2))
        log = self.daily()
        self.assertNotIn("error=", log)
        self.assertEqual(self.ranking_lines(log), ["player ranking season=2020 method=power-ranking-v8 players=0"])
        self.clock_at(NOW + timedelta(hours=3))
        self.assertEqual(self.ranking_lines(self.daily()), [])
        self.assertEqual(power.stale_rankings(self.calc), [])
        self.assertEqual(self.grades_2020(), self.after_first["grades"])  # no grade of 2020 rewritten

    def clock_at(self, at):
        type(self).clock = at

    def test_48e_the_read_api_before_and_after(self):
        before, after = self.api_before, self.api_after
        whole_2020, award_2020, whole_2021, board = self.paths
        # Production's state: 2020/21 ranked and served.
        self.assertEqual(before[whole_2020]["status"], 200)
        self.assertGreater(before[whole_2020]["body"]["total"], 0)
        # After the pass: no 2020/21 ranking, by either read; 2021/22's the same.
        self.assertEqual((after[whole_2020]["status"], after[award_2020]["status"]), (404, 404))
        self.assertEqual(before[whole_2021]["status"], 200)
        self.assertEqual(after[whole_2021]["body"], before[whole_2021]["body"])
        # A 2020 match's board reads each method's grade from its row: own references before, 2021's after.
        for grades, response, ref in ((self.grades_before, before[board], 2020), (self.grades_after, after[board], 2021)):
            self.assertEqual(response["status"], 200)
            served = {g["playerId"]: g["gradeExact"] for g in response["body"]["grades"]}
            self.assertEqual(set(served), set(grades))
            for player, (own_ref, grade, shown) in grades.items():
                self.assertEqual(own_ref, ref)
                if shown:
                    self.assertAlmostEqual(served[player], grade, places=9)
                else:
                    self.assertIsNone(served[player])
        self.assertNotEqual({p: g for p, (_, g, _) in self.grades_before.items()}, {p: g for p, (_, g, _) in self.grades_after.items()})
        statuses = self.read.execute("""SELECT grade_status, count(*) FROM api.player_grade_status WHERE award_season = 2020 GROUP BY 1""").fetchall()
        self.assertEqual(sum(n for s, n in statuses if s in ("graded", "below_display_threshold")), AWARD_2020)


if __name__ == "__main__":
    unittest.main()
