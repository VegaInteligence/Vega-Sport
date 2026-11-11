"""Worker loop end to end against an in-memory PitchAPI: plan, collect, calculate."""

import contextlib
import io
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import types
import unittest
from urllib.parse import urlparse

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega import calculator, models, planner
from vega.jobs import DETAIL_FAMILIES, claim, enqueue, enqueue_or_revive
from vega.pitchapi import PitchClient
from vega.store import Store, StoreError, connect_local, migrate
from vega.worker import (HEALTHY_AFTER, PUBLISH_EVERY, RECOMPUTE_AFTER, RECONNECT_FOR, RETRY_DAILY_AFTER, SideProcess, Worker, connect,
                            due_seasons, error_code, keep_running, main, prefer_as_oom_victim, publish, report, side_loop)

DSN = os.environ.get("VEGA_V2_WORKER_TEST_DSN")
HOME = {"id": "t_aaaaaa", "name": "Home FC"}
AWAY = {"id": "t_bbbbbb", "name": "Away FC"}
LIGUE1 = {"id": "l_aaaaaa", "name": "Ligue 1", "country_code": "FRA"}
PLAYER = {"id": "p_aaaaaa", "name": "Synthetic Player"}


def iso(value):
    return value.isoformat().replace("+00:00", "Z")


def match(key, kickoff, status, score=None, season="2025/2026"):
    item = {
        "id": key,
        "home_team": HOME,
        "away_team": AWAY,
        "league": LIGUE1,
        "season": season,
        "status": status,
        "date": kickoff.date().isoformat(),
        "time_utc": iso(kickoff),
        "round": "Matchday 12",
    }
    if season is None:
        del item["season"]
    if score:
        item.update(score_home=score[0], score_away=score[1])
    return item


def details(key, goals=2):
    """The 12 detail families of one finished match (shapes from the pilot fixture)."""
    base = "/matches/" + key
    return {
        base + "/lineups": {
            "home_team": HOME,
            "away_team": AWAY,
            "home": {"starters": [{"player_id": PLAYER["id"], "pitch_x": 0.5, "pitch_y": 0.5}], "subs": []},
            "away": {"starters": [], "subs": []},
        },
        base + "/players": [
            {
                "player": PLAYER,
                "team_id": HOME["id"],
                "stats": [
                    {
                        "stats": {
                            "g": {"key": "goals", "stat": {"type": "integer", "value": goals}},
                            "m": {"key": "minutes_played", "stat": {"type": "integer", "value": 90}},
                        }
                    }
                ],
            }
        ],
        base + "/stats": {
            "home_team": HOME,
            "away_team": AWAY,
            "periods": [
                {
                    "period": "All",
                    "groups": [{"items": [{"key": "expected_goals", "home": "1.25", "away": "0.5", "format_type": "double"}]}],
                }
            ],
        },
        base + "/shots": {"periods": []},
        base + "/events": {"events": []},
        base + "/momentum": {"points": [{"minute": 1, "value": 0.5}]},
        base + "/players/halves": {"players": []},
        base + "/advanced": {"teams": []},
        base + "/advanced/players": {"players": []},
        base + "/advanced/network": {"networks": []},
        base + "/heatmaps": {"grid": {"length": 16, "width": 12, "frame": "acting_ltr"}, "teams": [], "players": []},
        base + "/h2h": {"home_wins": 1, "draws": 0, "away_wins": 0, "total_matches": 1},
    }


class FakeApi:
    def __init__(self):
        self.routes = {}
        self.errors = {}
        self.calls = []

    def __call__(self, request, timeout):
        path = urlparse(request.full_url).path.removeprefix("/v1")
        self.calls.append(path)
        if path in self.errors:
            status, code = self.errors[path]
            return status, {}, json.dumps({"error": {"code": code}}).encode()
        if path.startswith("/date/") and path not in self.routes:
            return 200, {}, json.dumps({"data": {"date": path[6:], "matches": []}}).encode()
        if path not in self.routes:
            return 404, {}, json.dumps({"error": {"code": "RESOURCE_NOT_FOUND"}}).encode()
        return 200, {}, json.dumps({"data": self.routes[path]}).encode()


class ConnectTest(unittest.TestCase):
    def test_remote_needs_tls_and_a_v2_database(self):
        for dsn in (
            "postgresql://u:p@db.example.com/vega_v2",
            "postgresql://u:p@db.example.com/statarena?sslmode=require",
        ):
            with self.assertRaises(StoreError):
                connect(dsn)


class KeepRunningTest(unittest.TestCase):
    """A database restart ends a session; the task opens another one (worker.keep_running)."""

    def play(self, sessions, *, stop_after=None):
        """sessions: (seconds it holds, True when it loses the database) per call."""
        clock, left = [0.0], list(sessions)

        def session():
            held, lost = left.pop(0)
            clock[0] += held
            if lost:
                raise psycopg.OperationalError("connection lost")

        def sleep(seconds):
            clock[0] += seconds

        def stop():
            return stop_after is not None and clock[0] >= stop_after

        marks = []

        def watched():
            marks.append(clock[0])
            return session()

        self.log = io.StringIO()
        with contextlib.redirect_stdout(self.log):
            ended = keep_running(watched, stop=stop, sleep=sleep, clock=lambda: clock[0])
        # The wait before each new session: its start minus the end of the one before.
        ends = [marks[i] + sessions[i][0] for i in range(len(marks) - 1)]
        waits = [marks[i + 1] - ends[i] for i in range(len(ends))]
        return ended, waits, left

    def test_a_lost_database_opens_a_new_session(self):
        ended, waits, left = self.play([(40, True), (0, True), (0, True), (7200, False)])
        self.assertTrue(ended)
        self.assertEqual(waits, [5, 10, 20])
        self.assertEqual(left, [])
        # One line per loss, a code and never the server's message.
        self.assertEqual(self.log.getvalue().splitlines()[0], "database lost error=DATABASE_ERROR retry_in=5")

    def test_the_wait_is_capped_and_the_task_gives_up(self):
        ended, waits, left = self.play([(0, True)] * 60)
        self.assertFalse(ended)
        self.assertEqual(waits[:6], [5, 10, 20, 40, 60, 60])
        # It tried for RECONNECT_FOR seconds, not for ever.
        self.assertGreaterEqual(sum(waits), RECONNECT_FOR - 60)
        self.assertLess(sum(waits), RECONNECT_FOR + 60)
        self.assertTrue(left)
        self.assertTrue(self.log.getvalue().endswith("outcome=gave_up\n"))

    def test_a_session_that_held_starts_the_count_again(self):
        ended, waits, _ = self.play([(0, True), (0, True), (HEALTHY_AFTER, True), (0, False)])
        self.assertTrue(ended)
        self.assertEqual(waits, [5, 10, 5])

    def test_a_stopping_task_does_not_reconnect(self):
        ended, waits, left = self.play([(0, True), (0, True), (0, False)], stop_after=3)
        self.assertFalse(ended)
        self.assertEqual(len(left), 1)


class SideProcessTest(unittest.TestCase):
    """The daily pass and the image copies in a process of their own."""

    def test_the_child_is_started_watched_and_started_again_after_the_wait(self):
        now, started = [0.0], []

        class Child:
            pid = 4242

            def __init__(self):
                self.code, self.signals = None, []

            def poll(self):
                return self.code

            def terminate(self):
                self.signals.append("terminate")
                self.code = -15

            def wait(self, timeout=None):
                return self.code

        def popen(command):
            self.assertEqual(command, ["side", "command"])
            started.append(Child())
            return started[-1]

        side = SideProcess(["side", "command"], retry_after=3600, clock=lambda: now[0], popen=popen)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            side.tick()
            side.tick()
            self.assertEqual(len(started), 1)  # running: a round only looks
            started[0].code = -9  # killed by the kernel
            now[0] += 60
            side.tick()
            now[0] += 3599
            side.tick()
            self.assertEqual(len(started), 1)  # not at the next round: after the wait
            now[0] += 1
            side.tick()
            self.assertEqual(len(started), 2)
            side.stop()
        self.assertEqual(started[1].signals, ["terminate"])
        self.assertEqual(out.getvalue().count("side process exit=-9 restart_in=3600"), 1)

    def test_a_real_child_that_ends_or_hangs(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            ended = SideProcess([sys.executable, "-c", "raise SystemExit(7)"])
            ended.tick()
            ended.process.wait(timeout=30)
            ended.tick()
            ended.tick()
            self.assertIsNone(ended.process)
            # A command that cannot start waits like a child that ended.
            missing = SideProcess([str(Path(tempfile.gettempdir()) / "vega-v2-no-such-command")])
            missing.tick()
            self.assertIsNone(missing.process)
            # stop() ends a child that is still working.
            busy = SideProcess([sys.executable, "-c", "import time; time.sleep(120)"])
            busy.tick()
            child = busy.process
            busy.stop(wait=20)
            self.assertIsNotNone(child.poll())
        self.assertEqual(out.getvalue().count("side process exit=7 restart_in=3600"), 1)
        self.assertIn("side process error=WORKER_FILENOTFOUNDERROR", out.getvalue())

    def test_the_side_loop_keeps_its_rhythms_and_ends_with_the_database(self):
        calls, now = [], [0.0]
        conn = lambda: types.SimpleNamespace(closed=False)
        worker = types.SimpleNamespace(conn=conn(), calc_conn=conn(), daily=lambda: calls.append("daily"), mirror=lambda: calls.append("mirror"))

        def sleep(seconds):
            now[0] += seconds

        side_loop(worker, stop=lambda: now[0] > 300, sleep=sleep, clock=lambda: now[0])
        # Five minutes: a daily pass each minute, the image copies at the start and the end.
        self.assertEqual((calls.count("daily"), calls.count("mirror")), (6, 2))
        worker.calc_conn.closed = True
        with self.assertRaises(psycopg.OperationalError):
            side_loop(worker, stop=lambda: False, sleep=sleep, clock=lambda: now[0])

    def test_the_child_asks_to_be_the_first_killed_for_memory(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "oom_score_adj"
            self.assertTrue(prefer_as_oom_victim(str(path)))
            self.assertEqual(path.read_text(), "1000")
            self.assertFalse(prefer_as_oom_victim(str(Path(folder) / "missing" / "oom_score_adj")))

    def test_the_side_process_is_for_the_long_running_worker(self):
        for extra in (["--until-idle"], ["--max-jobs", "1"], ["--lanes", "backfill"]):
            with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                main(["--side-work", "process", *extra])


@unittest.skipUnless(DSN, "requires dedicated local vega_v2_worker_test DB")
class WorkerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_worker_test":
            raise RuntimeError("dedicated local worker DB required")
        cls.db = connect_local(DSN)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        self.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(self.db)
        # Leases are checked against the database clock: the fake clock only moves forward.
        self.now = datetime.now(timezone.utc).replace(second=0, microsecond=0) + timedelta(minutes=1)
        self.api = FakeApi()
        self.api.routes.update(
            {
                "/leagues": {"leagues": [dict(LIGUE1, seasons=["2025/2026"])]},
                "/leagues/" + LIGUE1["id"]: dict(LIGUE1, season="2025/2026"),
                "/teams/" + HOME["id"]: HOME,
                "/teams/" + AWAY["id"]: AWAY,
                "/players/" + PLAYER["id"]: PLAYER,
            }
        )
        client = PitchClient("pk_test_synthetic", interval=0, retries=0, transport=self.api, sleep=lambda _: None)
        self.worker = Worker(Store(self.db), client, clock=lambda: self.now, cohort_delay=0)

    def at(self, value):
        self.now = value
        return planner.plan(self.db, value)

    def test_connections_see_a_dead_database_within_a_minute(self):
        got = self.db.info.get_parameters()
        self.assertEqual(
            {k: got.get(k) for k in ("keepalives_idle", "keepalives_interval", "keepalives_count", "tcp_user_timeout", "connect_timeout")},
            {"keepalives_idle": "30", "keepalives_interval": "10", "keepalives_count": "3", "tcp_user_timeout": "60000", "connect_timeout": "10"},
        )

    def test_a_lost_connection_ends_the_run(self):
        lost = connect_local(DSN)
        worker = Worker(Store(lost), self.worker.client, clock=lambda: self.now, cohort_delay=0)
        lost.close()
        with self.assertRaises(psycopg.OperationalError):
            worker.run(max_jobs=1)
        # The calculator's connection alone is enough.
        calc = connect_local(DSN)
        worker = Worker(Store(self.db), self.worker.client, clock=lambda: self.now, cohort_delay=0, calc_conn=calc)
        calc.close()
        with self.assertRaises(psycopg.OperationalError):
            worker.run(max_jobs=1)

    def test_publication_advances_on_its_rhythm(self):
        x = self.db.execute
        generation = lambda: x("SELECT generation FROM api.publication").fetchone()[0]
        start = generation()
        self.assertIsNone(publish(self.db, self.now, force=True))  # nothing changed
        x("INSERT INTO ops.resource_versions(resource_kind, resource_id, version) VALUES ('match', 990, 3)")
        self.assertEqual(publish(self.db, self.now, force=True), start + 3)
        # A write a minute later waits for the rhythm: reads keep their generation meanwhile.
        x("UPDATE ops.resource_versions SET version = version + 1 WHERE resource_id = 990")
        self.assertIsNone(publish(self.db, self.now + timedelta(minutes=1)))
        self.assertEqual(generation(), start + 3)
        self.assertEqual(publish(self.db, self.now + PUBLISH_EVERY), start + 4)
        self.assertEqual(generation(), start + 4)

    def test_daily_models_follow_a_backfilled_season(self):
        x = self.db.execute
        with self.db.transaction():
            season = Store(self.db).season("2019/2020")
        x("INSERT INTO core.competitions(id,name) VALUES (900,'Old League')")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES (900,900,%s,'2019/2020')", (season,))
        x("INSERT INTO core.teams(id,name) VALUES (900,'A'),(901,'B')")
        old = self.now - timedelta(days=2000)
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date,kickoff_at,updated_at)
             VALUES (900,900,%s,'pitchapi','finished',900,901,1,0,%s,%s,%s)""", (season, old.date(), old, self.now - timedelta(hours=3)))
        self.assertEqual(due_seasons(self.db, self.now), [season])  # never computed
        x("INSERT INTO agg.calc_runs(kind,model_version,cohort_definition,status,started_at,finished_at) VALUES ('levels','m',%s,'published',%s,%s)",
          (f"season:{season}", self.now - timedelta(hours=2), self.now - timedelta(hours=2)))
        self.assertEqual(due_seasons(self.db, self.now), [])  # computed after its last change
        # The backfill went on after the computation: due, since the computation is over RECOMPUTE_AFTER old.
        x("UPDATE core.matches SET updated_at=%s WHERE id=900", (self.now - timedelta(minutes=30),))
        self.assertEqual(due_seasons(self.db, self.now), [season])
        # Changed after a computation under RECOMPUTE_AFTER old: it waits.
        x("UPDATE agg.calc_runs SET started_at=%(t)s, finished_at=%(t)s WHERE cohort_definition=%(c)s",
          {"t": self.now - RECOMPUTE_AFTER + timedelta(minutes=10), "c": f"season:{season}"})
        x("UPDATE core.matches SET updated_at=%s WHERE id=900", (self.now - timedelta(minutes=5),))
        self.assertEqual(due_seasons(self.db, self.now), [])
        # An archive season imported now is never due: the models read PitchAPI editions only.
        with self.db.transaction():
            archive = Store(self.db).season("1970/1971")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,archive_key) VALUES (901,900,%s,'1970/1971','test:1970')", (archive,))
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
             VALUES (901,901,%s,'vega','finished',900,901,2,2,'1971-01-01')""", (archive,))
        self.assertEqual(due_seasons(self.db, self.now), [])

    def due_season(self):
        """A season with a finished match and no models yet: due at once."""
        x = self.db.execute
        with self.db.transaction():
            season = Store(self.db).season("2019/2020")
        x("INSERT INTO core.competitions(id,name) VALUES (900,'Old League')")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES (900,900,%s,'2019/2020')", (season,))
        x("INSERT INTO core.teams(id,name) VALUES (900,'A'),(901,'B')")
        old = self.now - timedelta(days=2000)
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date,kickoff_at)
             VALUES (900,900,%s,'pitchapi','finished',900,901,1,0,%s,%s)""", (season, old.date(), old))
        return season

    def broken(self, module, name):
        """Replace module.name by a function that fails on a bug of ours (no database error); returns its calls."""
        calls = []

        def fail(*args, **kwargs):
            calls.append(args[1:])
            return 1 / 0

        self.addCleanup(setattr, module, name, getattr(module, name))
        setattr(module, name, fail)
        return calls

    def test_a_failing_model_waits_an_hour_instead_of_every_round(self):
        season = self.due_season()
        calls = self.broken(models, "refresh_daily")
        elo = lambda: self.db.execute("SELECT count(*) FROM agg.power_runs WHERE kind='elo'").fetchone()[0]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(self.worker.daily(), [season])  # the failure is logged, the pass returns
        self.assertEqual((calls, elo()), ([(season,)], 1))
        # The log names the error's class and where it was raised, never its text.
        self.assertRegex(out.getvalue(), rf"daily step=season {season} error=WORKER_ZERODIVISIONERROR@test_worker\.py:\d+ retry_at=")
        self.assertNotIn("division by zero", out.getvalue())
        # No models were published, so the season stays due: the next rounds leave it alone
        # (each of them ran the Elo of every match again before failing at the same place).
        self.now += timedelta(minutes=1)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.worker.daily(), [])
        self.assertEqual((calls, elo()), ([(season,)], 1))
        self.now += RETRY_DAILY_AFTER
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.worker.daily(), [season])
        self.assertEqual((calls, elo()), ([(season,)] * 2, 2))
        # Once it works again it is no longer held back.
        setattr(models, "refresh_daily", lambda conn, season, elo=True: None)
        self.now += RETRY_DAILY_AFTER
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.worker.daily(), [season])
        self.assertEqual(self.worker._retry_at, {})

    def test_the_collection_goes_on_whatever_fails_around_it(self):
        # The daily pass, the calculator and the planner all fail on a bug: the worker
        # still takes its job. Before, the first of them ended the process, and the task
        # started again only to fail at the same place before its first job.
        self.due_season()
        failed = [self.broken(models, "refresh_daily"), self.broken(calculator, "process_dirty"), self.broken(planner, "plan")]
        enqueue(self.db, "reference", "league", global_key="catalogue", run_after=self.now)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(self.worker.run(max_jobs=1), 1)
        self.assertTrue(all(failed))
        for step in ("planner", "daily step=season", "calculator"):
            self.assertIn(step, out.getvalue())
        self.assertEqual(self.db.execute("SELECT state::text FROM ops.fetch_jobs WHERE family='league'").fetchall(), [("done",)])

    def test_with_a_side_process_the_loop_leaves_the_side_work_to_it(self):
        self.due_season()
        rounds = []
        self.worker.side_process = types.SimpleNamespace(tick=lambda: rounds.append("tick"))
        self.worker.daily = lambda: self.fail("the daily pass ran in the loop")
        self.worker.mirror = lambda: self.fail("the image copies ran in the loop")
        self.worker.media_io = (None, None)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.worker.run(max_jobs=1), 1)
        self.assertEqual(rounds, ["tick"])

    def test_a_bounded_run_ends_once_nothing_is_due(self):
        # The pilot's loop (pilot.yml): 700 jobs at most, and an end when the calendars
        # give fewer. Without until_idle it waited for a 700th job that never came.
        import time

        enqueue(self.db, "reference", "league", global_key="catalogue", run_after=self.now)
        deadline = time.monotonic() + 60
        with contextlib.redirect_stdout(io.StringIO()):
            done = self.worker.run(max_jobs=700, until_idle=True, idle_sleep=0, stop=lambda: time.monotonic() > deadline)
        self.assertLess(time.monotonic(), deadline, "the run did not end by itself")
        self.assertTrue(0 < done < 700, done)
        due = self.db.execute("SELECT count(*) FROM ops.fetch_jobs WHERE state='pending' AND run_after <= %s", (self.now,)).fetchone()[0]
        self.assertEqual(due, 0)

    def test_an_error_code_never_carries_the_error_s_text(self):
        try:
            {}["a player's name"]
        except KeyError as error:
            self.assertRegex(error_code(error), r"^WORKER_KEYERROR@test_worker\.py:\d+$")
        self.assertEqual(error_code(StoreError("LEASE_LOST")), "LEASE_LOST")

    def test_partitioned_tables_are_analysed_once_a_day(self):
        calls = []
        real = self.worker.calc_conn

        class Spy:
            def __getattr__(self, name):
                return getattr(real, name)

            def execute(self, sql, *args, **kwargs):
                if "analyze_partitioned" in str(sql):
                    calls.append(sql)
                return real.execute(sql, *args, **kwargs)

        self.worker.calc_conn = Spy()
        self.worker.daily()
        self.worker.daily()
        self.assertEqual(len(calls), 1)
        self.now += timedelta(days=1)
        self.worker.daily()
        self.assertEqual(len(calls), 2)

    def test_archive_seasons_are_counted_once_a_day(self):
        x = self.db.execute
        with self.db.transaction():
            archive = Store(self.db).season("1970/1971")
        x("INSERT INTO core.competitions(id,name) VALUES (900,'Old League')")
        x("INSERT INTO core.teams(id,name) VALUES (900,'A'),(901,'B')")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,archive_key) VALUES (901,900,%s,'1970/1971','test:1970')", (archive,))
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date,archive_key)
             VALUES (901,901,%s,'vega','finished',900,901,2,1,'1971-01-01','r:test:0'),
                    (902,901,%s,'vega','canceled',901,900,NULL,NULL,'1971-01-08','r:test:1')""", (archive, archive))
        counts = "SELECT result_competitions,result_matches,results,unplayed,goal_matches,goal_events FROM agg.archive_seasons WHERE season_id=%s"
        self.worker.daily()
        self.assertEqual(x(counts, (archive,)).fetchone(), (1, 2, 1, 1, 0, 0))
        # The same day the counts stay; the next day's pass sees the goals a match received.
        x("""INSERT INTO core.match_events(season_id,match_id,seq,event_type,minute,team_id)
             VALUES (%s,901,1,'goal',10,900),(%s,901,2,'goal',50,901),(%s,901,3,'goal',80,900)""", (archive, archive, archive))
        self.worker.daily()
        self.assertEqual(x(counts, (archive,)).fetchone(), (1, 2, 1, 1, 0, 0))
        self.now += timedelta(days=1)
        self.worker.daily()
        self.assertEqual(x(counts, (archive,)).fetchone(), (1, 2, 1, 1, 1, 3))
        self.assertEqual(x("SELECT season,competitions,events,matches,latest_event::text FROM api.archive_goal_seasons").fetchall(),
                         [("1970/1971", 1, 3, 1, "1971-01-01")])

    def drain(self):
        count = 0
        while self.worker.step():
            count += 1
            self.assertLess(count, 500)
        return count

    def calendar(self, *matches, day=None):
        day = day or self.now.date()
        self.api.routes["/date/" + day.isoformat()] = {"date": day.isoformat(), "matches": list(matches)}

    def mid(self, key):
        return self.db.execute(
            "SELECT entity_id FROM core.provider_ids WHERE entity_type='match' AND provider='pitchapi' AND provider_key=%s",
            (key,),
        ).fetchone()[0]

    def watch(self, key):
        return self.db.execute(
            "SELECT state::text, next_check_at, checks FROM ops.match_watch WHERE match_id=%s", (self.mid(key),)
        ).fetchone()

    def jobs(self, key, family=None, state=None):
        return self.db.execute(
            "SELECT family::text, state::text, run_after FROM ops.fetch_jobs WHERE entity_type='match' AND entity_id=%s AND (%s::text IS NULL OR family::text=%s) AND (%s::text IS NULL OR state::text=%s) ORDER BY id",
            (self.mid(key), family, family, state, state),
        ).fetchall()

    def test_match_lifecycle_from_calendar_to_correction(self):
        start = self.now
        a_kick, b_kick = start - timedelta(hours=3), start + timedelta(hours=30)
        self.calendar(
            match("m_aaaaaa", a_kick, "finished", (2, 0)),
            match("m_bbbbbb", b_kick, "not_started"),
            match("m_cccccc", start + timedelta(hours=2), "postponed"),
        )
        counts = self.at(start)
        self.assertEqual(counts["calendar"], 9)
        self.assertEqual(counts["reference"], 1)  # the weekly league catalogue
        self.assertEqual(self.at(start).get("calendar", 0), 0)
        self.drain()
        self.assertEqual(self.watch("m_aaaaaa")[:2], ("scheduled", start))
        self.assertEqual(self.watch("m_bbbbbb")[:2], ("scheduled", b_kick + timedelta(minutes=105)))
        self.assertEqual(self.watch("m_cccccc")[:2], ("stopped", None))
        dates = sorted(p for p in self.api.calls if p.startswith("/date/"))
        self.assertEqual(len(dates), 9)
        self.assertEqual(dates[0], "/date/" + (start.date() - timedelta(days=1)).isoformat())

        # Next plan: score check of the finished match, B's lineup forecast and h2h,
        # the active edition's calendar and competition (weekly).
        self.api.routes["/matches/m_aaaaaa"] = match("m_aaaaaa", a_kick, "finished", (2, 0))
        self.api.routes.update(details("m_aaaaaa"))
        self.api.routes["/matches/m_bbbbbb/h2h"] = {"home_wins": 0, "draws": 1, "away_wins": 0, "total_matches": 1}
        self.api.routes["/leagues/l_aaaaaa/matches"] = {
            "league": {"id": "l_aaaaaa", "name": "Ligue 1"},
            "matches": [match("m_aaaaaa", a_kick, "finished", (2, 0)), match("m_bbbbbb", b_kick, "not_started")],
        }
        counts = self.at(start)
        self.assertEqual((counts["summary"], counts["lineups"], counts["h2h"], counts["reference"]), (1, 1, 1, 2))
        self.drain()
        state, next_at, checks = self.watch("m_aaaaaa")
        self.assertEqual((state, next_at, checks), ("final", start + timedelta(hours=24), 1))
        self.assertEqual(len(self.jobs("m_aaaaaa", state="done")), 13)  # summary + 12 families
        self.assertEqual([row[1] for row in self.jobs("m_aaaaaa", "summary", "pending")], ["pending"])
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.family_state WHERE match_id=%s AND status IN ('ok','unavailable')",
                (self.mid("m_aaaaaa"),),
            ).fetchone()[0],
            13,
        )
        # The lineup forecast was not published yet: a permanent failure, kept visible.
        self.assertEqual(self.jobs("m_bbbbbb", "lineups")[0][1], "failed")
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.fetch_log").fetchone()[0], len(self.api.calls))

        # Calculator: the dirty scopes of the finished match become season rows.
        self.worker.calculate()
        goals, minutes = self.db.execute(
            "SELECT s.goals_sum, s.appearances FROM agg.player_season_stats s JOIN core.provider_ids p ON p.entity_type='player' AND p.entity_id=s.player_id WHERE p.provider_key=%s",
            (PLAYER["id"],),
        ).fetchone()
        self.assertEqual((goals, minutes), (2, 1))
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.dirty_scopes").fetchone()[0], 0)

        # A at +24 h: the provider corrected the score, details are fetched once more.
        self.api.routes["/matches/m_aaaaaa"] = match("m_aaaaaa", a_kick, "finished", (2, 1))
        self.at(start + timedelta(hours=24, minutes=1))
        self.worker.lanes = ("score",)
        self.drain()
        self.assertEqual(self.watch("m_aaaaaa")[0], "corrected")
        self.assertEqual(len(self.jobs("m_aaaaaa", state="pending")), len(DETAIL_FAMILIES))
        self.assertEqual(
            self.db.execute("SELECT away_score FROM core.matches WHERE id=%s", (self.mid("m_aaaaaa"),)).fetchone()[0],
            1,
        )
        self.worker.lanes = ("score", "details", "reference")

        # B at kickoff: the failed forecast is revived, the confirmed lineups arrive.
        self.api.routes.update(details("m_bbbbbb", goals=1))
        self.assertEqual(self.at(b_kick + timedelta(minutes=1))["lineups"], 1)
        self.drain()
        self.assertEqual(self.jobs("m_bbbbbb", "lineups")[0][1], "done")

        # +105: still playing, so checks every 2 minutes; +107: finished.
        self.api.routes["/matches/m_bbbbbb"] = match("m_bbbbbb", b_kick, "in_play", (1, 1))
        self.at(b_kick + timedelta(minutes=105))
        self.drain()
        self.assertEqual(self.watch("m_bbbbbb")[:2], ("waiting_final", b_kick + timedelta(minutes=107)))
        self.api.routes["/matches/m_bbbbbb"] = match("m_bbbbbb", b_kick, "finished", (1, 1))
        self.at(b_kick + timedelta(minutes=107))
        self.drain()
        self.assertEqual(self.watch("m_bbbbbb")[0], "final")
        # lineups at kickoff, h2h before, two score checks, then the 12 families.
        self.assertEqual(len(self.jobs("m_bbbbbb", state="done")), 1 + 1 + 2 + len(DETAIL_FAMILIES))

        # The run report carries measurements only, never names or other provider values.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "worker.md"
            report(self.worker, path, jobs=1, seconds=0)
            text = path.read_text(encoding="utf-8")
        for secret in (HOME["name"], AWAY["name"], PLAYER["name"], "m_aaaaaa", "t_aaaaaa"):
            self.assertNotIn(secret, text)
        self.assertIn("## Watches", text)

    def test_rescheduled_and_never_final_watches(self):
        start = self.now
        e_kick = start - timedelta(hours=1)
        self.api.routes["/matches/m_eeeeee"] = match("m_eeeeee", e_kick, "in_play")
        self.calendar(match("m_dddddd", start + timedelta(hours=5), "postponed"), match("m_eeeeee", e_kick, "in_play"))
        self.at(start)
        self.drain()
        self.assertEqual(self.watch("m_dddddd")[0], "stopped")
        self.assertEqual(self.watch("m_eeeeee")[:2], ("scheduled", e_kick + timedelta(minutes=105)))
        self.worker.lanes = ("score",)
        self.at(e_kick + timedelta(minutes=105))
        self.drain()
        self.assertEqual(self.watch("m_eeeeee")[:2], ("waiting_final", e_kick + timedelta(minutes=107)))

        # The next day's calendar gives D a new date: the watch restarts on it. The calendar
        # is read once per UTC day, and the check above may already have crossed midnight
        # (a run started after 23:15 UTC): an hour past the same time next day, a day's
        # read is due whatever the hour this runs at.
        new_kick = start + timedelta(days=3)
        self.calendar(match("m_eeeeee", e_kick, "in_play"))
        self.calendar(match("m_dddddd", new_kick, "not_started"), day=new_kick.date())
        self.at(start + timedelta(days=1, hours=1))
        self.drain()
        self.assertEqual(self.watch("m_dddddd")[:2], ("scheduled", new_kick + timedelta(minutes=105)))

        # E never reaches a final status: hourly, then daily, then stopped at +7 days.
        self.at(e_kick + timedelta(days=7, minutes=1))
        self.drain()
        self.assertEqual(self.watch("m_eeeeee")[:2], ("stopped", None))
        self.assertEqual(
            self.db.execute("SELECT kind::text FROM ops.data_warnings WHERE match_id=%s", (self.mid("m_eeeeee"),)).fetchone()[0],
            "score_never_final",
        )

    def test_failures_retry_then_stop_and_daily_revival(self):
        start = self.now
        kick = start - timedelta(hours=2)
        self.calendar(match("m_ffffff", kick, "finished", (0, 0)))
        self.at(start)
        self.drain()
        self.worker.lanes = ("score",)
        self.api.errors["/matches/m_ffffff"] = (503, "INTERNAL_SERVER_ERROR")
        self.at(start)
        self.drain()
        family, state, run_after = self.jobs("m_ffffff", "summary")[-1]
        self.assertEqual(state, "pending")  # transient: retried with backoff
        self.assertGreater(run_after, start)
        self.assertEqual(self.watch("m_ffffff")[0], "scheduled")
        self.api.errors["/matches/m_ffffff"] = (404, "RESOURCE_NOT_FOUND")
        self.now = run_after
        self.drain()
        self.assertEqual(self.jobs("m_ffffff", "summary")[-1][1], "failed")
        self.assertEqual(self.watch("m_ffffff")[:2], ("stopped", None))
        codes = [r[0] for r in self.db.execute("SELECT error_code FROM ops.parse_failures WHERE family='summary' ORDER BY id")]
        self.assertEqual(codes, ["HTTP_SERVER_ERROR", "RESOURCE_NOT_FOUND"])
        # A permanent failure stays failed; a transient one gets a new try a day later.
        self.db.execute(
            "UPDATE ops.fetch_jobs SET state='failed', last_error_code='HTTP_SERVER_ERROR' WHERE family='calendar' AND target_date=%s",
            (start.date(),),
        )
        self.assertEqual(self.at(start + timedelta(hours=25))["revived"], 1)
        self.assertEqual(self.jobs("m_ffffff", "summary")[-1][1], "failed")

    def test_a_refused_profile_logs_the_provider_s_reason_as_a_category(self):
        # The provider answers 403 with a sentence: the log keeps its category only.
        def refuse(request, timeout):
            return 403, {}, json.dumps({"message": "Access denied for this resource: p_aaaaaa"}).encode()

        self.db.execute("INSERT INTO core.players(id,name) VALUES (901,'Synthetic Player')")
        self.db.execute("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','pitchapi','p_aaaaaa',901)")
        enqueue(self.db, "reference", "player", entity_type="player", entity_id=901, run_after=self.now)
        self.worker.client._transport = refuse
        self.worker.lanes = ("reference",)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertTrue(self.worker.step())
        self.assertRegex(out.getvalue(), r"family=player job=\d+ error=HTTP_ACCESS_DENIED reason=access_denied\n")
        self.assertNotIn("this resource", out.getvalue())

    def test_date_matches_without_edition_and_new_statuses(self):
        # Real /date responses name the competition but not the edition.
        start = self.now
        self.api.routes["/leagues/" + LIGUE1["id"]] = dict(LIGUE1, seasons=["2024/2025", "2025/2026"])
        self.calendar(
            match("m_iiiiii", start + timedelta(hours=4), "not_started", season=None),
            dict(match("m_jjjjjj", start - timedelta(hours=1), "in_play", season=None), status="abandoned"),
        )
        self.at(start)
        self.worker.lanes = ("score",)
        self.drain()
        label, current = self.db.execute(
            "SELECT cs.native_label, cs.is_current FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id WHERE m.id=%s",
            (self.mid("m_iiiiii"),),
        ).fetchone()
        self.assertEqual((label, current), ("2025/2026", True))
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM core.competition_seasons WHERE is_current").fetchone()[0], 1
        )
        self.assertEqual(self.watch("m_iiiiii")[0], "scheduled")
        # An unknown status is reported as a path and leaves the rest of the day intact.
        self.assertIsNone(self.db.execute("SELECT status FROM core.matches WHERE id=%s", (self.mid("m_jjjjjj"),)).fetchone()[0])
        self.assertEqual(
            self.db.execute("SELECT field_path FROM ops.unknown_fields WHERE family='calendar'").fetchall(),
            [("match.status.abandoned",)],
        )
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.parse_failures").fetchone()[0], 0)

    def test_summary_edition_wins_over_the_assumed_one(self):
        start = self.now
        self.api.routes["/leagues/" + LIGUE1["id"]] = dict(LIGUE1, seasons=["2024/2025", "2025/2026"])
        kick = start - timedelta(hours=3)
        self.calendar(match("m_llllll", kick, "finished", (1, 0), season=None))
        self.at(start)
        self.worker.lanes = ("score",)
        self.drain()
        # /matches/{id} says the match belongs to 2024/2025, not the current edition.
        self.api.routes["/matches/m_llllll"] = match("m_llllll", kick, "finished", (1, 0), season="2024/2025")
        self.at(start)
        self.drain()
        label = self.db.execute(
            "SELECT cs.native_label FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id WHERE m.id=%s",
            (self.mid("m_llllll"),),
        ).fetchone()[0]
        self.assertEqual((label, self.watch("m_llllll")[0]), ("2024/2025", "final"))
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.parse_failures").fetchone()[0], 0)

    def test_backfill_reads_its_leagues_before_any_catalogue(self):
        # A fresh base (first deploy, 2026-11-09): the weekly catalogue waits behind live
        # work, and a past edition is unknown until the league's profile lists it.
        # PitchAPI's league profile names only the current season; the catalogue lists them all.
        self.api.routes["/leagues/l_aaaaaa"] = dict(LIGUE1, season="2025/2026")
        self.api.routes["/leagues"] = {"leagues": [dict(LIGUE1, seasons=["2024/2025", "2025/2026"]), dict(LIGUE1, id="l_bbbbbb", seasons=["2024/2025"])]}
        backfill = Worker(self.worker.store, self.worker.client, lanes=("backfill",), clock=lambda: self.now, cohort_delay=0,
                          backfill={"first_season": 2024, "last_season": 2024, "competitions": ["l_aaaaaa"]})
        self.assertEqual(planner.plan_backfill(self.db, self.now, first_season=2024, last_season=2024, competitions=["l_aaaaaa"]), {})
        backfill.backfill_references()
        self.assertEqual(
            planner.plan_backfill(self.db, self.now, first_season=2024, last_season=2024, competitions=["l_aaaaaa"]), {"league_matches": 1}
        )
        # Only the named league is written from the catalogue.
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.provider_ids WHERE provider_key = 'l_bbbbbb'").fetchone()[0], 0)

    def test_backfill_run_until_idle_collects_calendar_then_details(self):
        # The first import test (2026-11-09): the backfill stopped after the calendar, before
        # the planner's next round could plan the finished matches' families.
        start = self.now
        old = [match(f"m_hist0{i}", start - timedelta(days=300 + i), "finished", (i % 3, 1), season="2024/2025") for i in range(1, 3)]
        self.api.routes["/leagues"] = {"leagues": [dict(LIGUE1, seasons=["2024/2025"])]}
        self.api.routes["/leagues/l_aaaaaa/matches"] = {"league": {"id": "l_aaaaaa", "name": "Ligue 1"}, "matches": old}
        for item in old:
            self.api.routes["/matches/" + item["id"]] = item
            self.api.routes.update({path.replace("m_aaaaaa", item["id"]): body for path, body in details("m_aaaaaa").items()})
        backfill = Worker(self.worker.store, self.worker.client, lanes=("backfill",), clock=lambda: self.now, cohort_delay=0,
                          backfill={"first_season": 2024, "last_season": 2024, "competitions": ["l_aaaaaa"]})
        done = backfill.run(until_idle=True, idle_sleep=0)
        self.assertEqual(done, 1 + 2 * 13)  # the calendar, then 13 families of each finished match
        self.assertEqual(planner.plan_backfill(self.db, start, first_season=2024, last_season=2024, competitions=["l_aaaaaa"]), {})

    def test_backfill_collects_history_without_watches(self):
        start = self.now
        old = [match(f"m_hist0{i}", start - timedelta(days=300 + i), "finished", (i % 3, 1), season="2024/2025") for i in range(1, 4)]
        self.api.routes["/leagues"] = {"leagues": [dict(LIGUE1, seasons=["2024/2025"])]}
        self.api.routes["/leagues/l_aaaaaa/matches"] = {"league": {"id": "l_aaaaaa", "name": "Ligue 1"}, "matches": old}
        for item in old:
            self.api.routes["/matches/" + item["id"]] = item
            self.api.routes.update({path.replace("m_aaaaaa", item["id"]): body for path, body in details("m_aaaaaa").items()})
        # The catalogue first (reference lane), then the backfill task alone.
        self.worker.lanes = ("reference",)
        planner.plan(self.db, start)
        self.drain()
        backfill = Worker(self.worker.store, self.worker.client, lanes=("backfill",), clock=lambda: self.now, cohort_delay=0,
                          backfill={"first_season": 2024, "last_season": 2024})
        self.assertEqual(planner.plan_backfill(self.db, start, first_season=2024, last_season=2024), {"league_matches": 1})
        while backfill.step():
            pass
        counts = planner.plan_backfill(self.db, start, first_season=2024, last_season=2024)
        self.assertEqual(sum(counts.values()), 3 * 13)
        while backfill.step():
            pass
        self.assertEqual(planner.plan_backfill(self.db, start, first_season=2024, last_season=2024), {})
        # History is complete, and no watch, correction or live detail job was created.
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.match_watch").fetchone()[0], 0)
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM ops.fetch_jobs WHERE lane <> 'backfill' AND entity_type = 'match'").fetchone()[0], 0
        )
        progress = self.db.execute(
            "SELECT family::text, expected, done + empty FROM ops.collection_progress WHERE family <> 'league_matches'"
        ).fetchall()
        self.assertEqual(len(progress), 13)
        self.assertTrue(all(expected == covered == 3 for _, expected, covered in progress), progress)

    def test_backfill_planner_adds_nothing_while_its_lane_is_full(self):
        # 10 November 2026: every round added 2,000 jobs whatever the lane already held,
        # 949,000 were queued at once, and each round then read all the matches for nothing.
        start = self.now
        old = [match(f"m_hist0{i}", start - timedelta(days=300 + i), "finished", (1, 0), season="2024/2025") for i in range(1, 4)]
        self.api.routes["/leagues"] = {"leagues": [dict(LIGUE1, seasons=["2024/2025"])]}
        self.api.routes["/leagues/l_aaaaaa/matches"] = {"league": {"id": "l_aaaaaa", "name": "Ligue 1"}, "matches": old}
        for item in old:
            self.api.routes["/matches/" + item["id"]] = item
            self.api.routes.update({path.replace("m_aaaaaa", item["id"]): body for path, body in details("m_aaaaaa").items()})
        scope = {"first_season": 2024, "last_season": 2024, "competitions": ["l_aaaaaa"]}
        backfill = Worker(self.worker.store, self.worker.client, lanes=("backfill",), clock=lambda: self.now, cohort_delay=0, backfill=scope)
        backfill.backfill_references()
        self.assertEqual(planner.plan_backfill(self.db, start, **scope, limit=13), {"league_matches": 1})
        self.assertEqual(backfill.step(), 1)  # the season calendar: 3 finished matches, 39 families to fetch
        pending = lambda: self.db.execute("SELECT count(*) FROM ops.fetch_jobs WHERE lane='backfill' AND state='pending'").fetchone()[0]
        self.assertEqual(sum(planner.plan_backfill(self.db, start, **scope, limit=13).values()), 13)
        self.assertEqual(planner.plan_backfill(self.db, start, **scope, limit=13), {})
        self.assertEqual(pending(), 13)
        # One job done: the lane is below a batch again and takes the next one.
        self.assertEqual(backfill.step(), 1)
        self.assertEqual(sum(planner.plan_backfill(self.db, start, **scope, limit=13).values()), 13)
        self.assertEqual(pending(), 25)
        # Nothing is lost: the whole history is collected in the end.
        self.assertEqual(backfill.run(until_idle=True, idle_sleep=0), 38)
        self.assertEqual(pending(), 0)
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.family_state WHERE status IN ('ok', 'unavailable')").fetchone()[0], 39)

    def test_queue_lookups_read_a_few_rows_of_a_long_queue(self):
        # 10 November 2026, 949,000 jobs waiting in the backfill lane: each claim read and
        # sorted them all (0.4 s), each "fetched recently?" lookup read the whole table (0.7 s).
        self.worker.lanes = ("reference",)
        planner.plan(self.db, self.now)
        self.drain()
        families = list(DETAIL_FAMILIES)
        self.db.execute(
            """INSERT INTO ops.fetch_jobs(lane, family, entity_type, entity_id, run_after, state)
               SELECT 'backfill', f::ops.fetch_family, 'match', 100000 + m, %s, 'pending'
               FROM generate_series(1, 2000) m, unnest(%s::text[]) AS f""",
            (self.now - timedelta(days=1), families),
        )
        self.db.execute("ANALYZE ops.fetch_jobs")
        queued = 2000 * len(families)
        day = self.now.date() + timedelta(days=30)
        since = self.now - timedelta(days=7)

        def rows_read(action):
            # Rows of ops.fetch_jobs read by `action`, as PostgreSQL counts them in a transaction.
            counted = "SELECT seq_tup_read + idx_tup_fetch FROM pg_stat_xact_user_tables WHERE schemaname='ops' AND relname='fetch_jobs'"
            with self.db.transaction():
                before = (self.db.execute(counted).fetchone() or (0,))[0]
                result = action()
                return result, self.db.execute(counted).fetchone()[0] - before

        job, read = rows_read(lambda: claim(self.db, "backfill", now=self.now))
        self.assertEqual((job["lane"], job["entity_id"]), ("backfill", 100001))
        leased = job["family"]
        self.assertLess(read, 20, f"a claim read {read} of {queued} queued jobs")
        # A claim of another lane does not walk through the backfill's jobs either.
        score = enqueue(self.db, "score", "calendar", target_date=day, run_after=self.now, priority=10)
        job, read = rows_read(lambda: claim(self.db, "score", now=self.now))
        self.assertEqual(job["lane"], "score")
        self.assertLess(read, 20, f"a claim read {read} of {queued} queued jobs")

        # "Fetched recently?": an active job, or one done since `since`, on that target only.
        for expected, family, target in (
            (True, "calendar", {"target_date": day}),  # queued just above
            (False, "calendar", {"target_date": day + timedelta(days=1)}),
            (True, "league", {"global_key": "catalogue"}),  # done by the reference lane
            (True, leased, {"entity_type": "match", "entity_id": 100001}),  # leased by the claim above
            (True, "shots", {"entity_type": "match", "entity_id": 100002}),  # pending
            (False, "shots", {"entity_type": "match", "entity_id": 99}),
        ):
            got, read = rows_read(lambda: planner._recent(self.db, family, since, **target))
            self.assertEqual(got, expected, (family, target))
            self.assertLess(read, 20, f"{family} {target} read {read} of {queued} queued jobs")
        # A job done before `since` no longer counts.
        self.assertFalse(planner._recent(self.db, "league", self.now + timedelta(hours=1), global_key="catalogue"))

        # A failed job is given a new try on its own target, found the same way.
        self.db.execute("UPDATE ops.fetch_jobs SET state='failed', lease_until=NULL, lease_token=NULL WHERE id=%s", (score,))
        revived, read = rows_read(lambda: enqueue_or_revive(self.db, "score", "calendar", target_date=day, run_after=self.now))
        self.assertEqual(revived, score)
        self.assertLess(read, 20, f"a revive read {read} of {queued} queued jobs")
        self.assertEqual(self.db.execute("SELECT state::text FROM ops.fetch_jobs WHERE id=%s", (score,)).fetchone()[0], "pending")

    def test_bad_match_does_not_block_the_day_and_jobs_are_pruned(self):
        start = self.now
        kick = start + timedelta(hours=6)
        self.calendar(match("m_gggggg", kick, "not_started"), match("m_kkkkkk", kick, "not_started"))
        self.at(start)
        self.drain()
        # G already has after-match facts, K only a forecast lineup.
        self.db.execute(
            "INSERT INTO ops.family_state(match_id, family, status) VALUES (%s, 'shots', 'ok'), (%s, 'lineups', 'ok')",
            (self.mid("m_gggggg"), self.mid("m_kkkkkk")),
        )
        # The provider moves G and K to another edition; H of that edition must still be
        # saved, K moves with it (its forecast is dropped), G is refused visibly.
        self.calendar(
            match("m_gggggg", kick, "not_started", season="2024/2025"),
            match("m_hhhhhh", kick, "not_started", season="2024/2025"),
            match("m_kkkkkk", kick, "not_started", season="2024/2025"),
        )
        self.at(start + timedelta(days=1))
        self.drain()
        self.assertEqual(self.watch("m_hhhhhh")[0], "scheduled")
        labels = dict(
            self.db.execute(
                "SELECT p.provider_key, cs.native_label FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id JOIN core.provider_ids p ON p.entity_type='match' AND p.entity_id=m.id"
            ).fetchall()
        )
        self.assertEqual(labels, {"m_gggggg": "2025/2026", "m_hhhhhh": "2024/2025", "m_kkkkkk": "2024/2025"})
        self.assertIsNone(
            self.db.execute("SELECT 1 FROM ops.family_state WHERE match_id=%s AND family='lineups'", (self.mid("m_kkkkkk"),)).fetchone()
        )
        self.assertEqual(
            self.db.execute("SELECT error_code FROM ops.parse_failures WHERE family='calendar'").fetchall(),
            [("MATCH_SEASON_CHANGED",)],
        )
        done = self.db.execute("SELECT count(*) FROM ops.fetch_jobs WHERE state='done'").fetchone()[0]
        self.assertGreater(done, 0)
        self.assertGreaterEqual(self.at(start + timedelta(days=16))["pruned"], done)


if __name__ == "__main__":
    unittest.main()
