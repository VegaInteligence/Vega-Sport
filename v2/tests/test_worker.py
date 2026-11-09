import json, os, sys, unittest
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_WORKER_TEST_DSN")


@unittest.skipUnless(DSN and psycopg, "requires dedicated local worker DB")
class WorkerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if (
            target.hostname not in ("localhost", "127.0.0.1", "::1")
            or target.path != "/vega_v2_worker_test"
        ):
            raise RuntimeError("dedicated local worker DB required")
        from vega_v2.store import connect_local, migrate, Store

        cls.db = connect_local(DSN)
        if not cls.db.execute(
            "SELECT to_regnamespace('core') IS NULL AND to_regnamespace('agg') IS NULL AND to_regnamespace('ops') IS NULL"
        ).fetchone()[0]:
            raise RuntimeError("DB must be empty")
        migrate(cls.db)
        cls.store = Store(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        self.tx = self.db.transaction(force_rollback=True)
        self.tx.__enter__()

    def tearDown(self):
        self.tx.__exit__(None, None, None)

    def test_bounded_catalogue_calendar_and_resume(self):
        from vega_v2.backfill import enqueue_catalogue
        from vega_v2.pitchapi import PitchClient
        from vega_v2.worker import Worker

        match = {
            "id": "m_123456",
            "home_team": {"id": "t_123456", "name": "Home"},
            "away_team": {"id": "t_abcdef", "name": "Away"},
            "status": "finished",
        }
        bodies = {
            "/leagues": {
                "leagues": [
                    {
                        "id": "l_123456",
                        "name": "League",
                        "country_code": "FRA",
                        "seasons": ["2022"],
                    }
                ]
            },
            "/leagues/l_123456/matches": {
                "league": {"id": "l_123456", "season": "2022"},
                "matches": [match],
            },
            "/matches/m_123456": match,
        }
        paths = []

        def transport(req, timeout):
            path = urlparse(req.full_url).path.removeprefix("/v1")
            paths.append(path)
            if path not in bodies:
                raise AssertionError("unexpected path")
            return 200, {}, json.dumps({"data": bodies[path]}).encode()

        client = PitchClient(
            "pk_test_fixture", interval=0, transport=transport, sleep=lambda _: None
        )
        with self.db.transaction():
            enqueue_catalogue(self.db)
        first = Worker(
            self.store,
            client,
            max_requests=2,
            max_seconds=30,
            lanes=("reference", "backfill"),
        ).run()
        self.assertEqual((first["requests"], first["done"]), (2, 2))
        self.assertEqual(paths, ["/leagues", "/leagues/l_123456/matches"])
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE entity_type='match' AND state='pending'"
            ).fetchone()[0],
            13,
        )
        second = Worker(
            self.store, client, max_requests=1, max_seconds=30, lanes=("backfill",)
        ).run()
        self.assertEqual((second["requests"], second["done"]), (1, 1))
        self.assertEqual(paths[-1], "/matches/m_123456")
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE family='summary' AND state='done'"
            ).fetchone()[0],
            1,
        )
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM ops.fetch_log").fetchone()[0], 3
        )

    def test_request_budget_bounds_retries_and_preserves_pending(self):
        from vega_v2.backfill import enqueue_catalogue
        from vega_v2.pitchapi import PitchClient
        from vega_v2.worker import Worker

        calls = []

        def transport(*_):
            calls.append(1)
            return 521, {}, b"<html>private</html>"

        client = PitchClient(
            "pk_test_fixture", interval=0, transport=transport, sleep=lambda _: None
        )
        with self.db.transaction():
            enqueue_catalogue(self.db)
        result = Worker(
            self.store, client, max_requests=2, max_seconds=30, lanes=("reference",)
        ).run()
        self.assertEqual(len(calls), 2)
        self.assertEqual(result["requests"], 2)
        self.assertEqual(
            self.db.execute(
                "SELECT state FROM ops.fetch_jobs WHERE global_key='catalogue'"
            ).fetchone()[0],
            "pending",
        )
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_log WHERE error_code='HTTP_SERVER_ERROR'"
            ).fetchone()[0],
            2,
        )

    def test_lost_lease_cannot_publish_response(self):
        from vega_v2.backfill import enqueue_catalogue
        from vega_v2.pitchapi import PitchClient
        from vega_v2.worker import Worker
        from vega_v2.store import StoreError

        with self.db.transaction():
            job = enqueue_catalogue(self.db)

        def transport(*_):
            self.db.execute(
                "UPDATE ops.fetch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=%s",
                (job,),
            )
            return (
                200,
                {},
                json.dumps(
                    {
                        "data": {
                            "leagues": [
                                {
                                    "id": "l_123456",
                                    "name": "League",
                                    "seasons": ["2022"],
                                }
                            ]
                        }
                    }
                ).encode(),
            )

        client = PitchClient(
            "pk_test_fixture", interval=0, transport=transport, sleep=lambda _: None
        )
        with self.assertRaisesRegex(StoreError, "LEASE_LOST"):
            Worker(
                self.store, client, max_requests=1, max_seconds=30, lanes=("reference",)
            ).run()
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM core.competitions").fetchone()[0], 0
        )

    def test_score_transition_enqueues_details_and_correction(self):
        from vega_v2.backfill import persist_catalogue, enqueue_finished
        from vega_v2.normalize import normalize_family
        from vega_v2.jobs import enqueue
        from vega_v2.pitchapi import PitchClient
        from vega_v2.worker import Worker

        persist_catalogue(
            self.store,
            {"leagues": [{"id": "l_123456", "name": "League", "seasons": ["2022"]}]},
        )
        edition = self.db.execute(
            "SELECT id FROM core.competition_seasons WHERE native_label='2022'"
        ).fetchone()[0]
        original = {
            "id": "m_123456",
            "home_team": {"id": "t_123456", "name": "Home"},
            "away_team": {"id": "t_abcdef", "name": "Away"},
            "status": "not_started",
            "time_utc": "2022-01-01T12:00:00Z",
        }
        enqueue_finished(
            self.store,
            normalize_family(
                "league_matches", {"league": {"id": "l_123456"}, "matches": [original]}
            ),
            edition,
        )
        mid = self.store.resolve("match", "m_123456")
        with self.db.transaction():
            enqueue(self.db, "score", "summary", entity_type="match", entity_id=mid)
        completed = {**original, "status": "finished", "score_home": 1, "score_away": 0}
        client = PitchClient(
            "pk_test_fixture",
            interval=0,
            transport=lambda *_: (200, {}, json.dumps({"data": completed}).encode()),
            sleep=lambda _: None,
        )
        result = Worker(
            self.store, client, max_requests=1, max_seconds=30, lanes=("score",)
        ).run()
        self.assertEqual(result["done"], 1)
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE lane='details' AND entity_id=%s AND state='pending'",
                (mid,),
            ).fetchone()[0],
            12,
        )
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE lane='score' AND family='summary' AND entity_id=%s AND state='pending'",
                (mid,),
            ).fetchone()[0],
            1,
        )

    def test_missing_profile_404_keeps_known_facts_and_retries_later(self):
        from vega_v2.pitchapi import PitchClient
        from vega_v2.worker import Worker

        with self.db.transaction():
            player = self.store.entity("player", "p_123456", {"name": "Known"})
        client = PitchClient(
            "pk_test_fixture",
            interval=0,
            transport=lambda *_: (404, {}, b'{"error":{"code":"RESOURCE_NOT_FOUND"}}'),
            sleep=lambda _: None,
        )
        result = Worker(
            self.store, client, max_requests=1, max_seconds=30, lanes=("reference",)
        ).run()
        self.assertEqual((result["requests"], result["failed"]), (1, 1))
        self.assertEqual(
            self.db.execute(
                "SELECT name FROM core.players WHERE id=%s", (player,)
            ).fetchone()[0],
            "Known",
        )
        state = self.db.execute(
            "SELECT state,run_after>clock_timestamp()+interval '59 minutes' FROM ops.fetch_jobs WHERE family='player' AND entity_id=%s",
            (player,),
        ).fetchone()
        self.assertEqual(state, ("pending", True))

    def test_catalogue_phase_never_fetches_profiles_or_details(self):
        from vega_v2.backfill import enqueue_catalogue
        from vega_v2.pitchapi import PitchClient
        from vega_v2.worker import Worker

        match = {
            "id": "m_123456",
            "home_team": {"id": "t_123456", "name": "Home"},
            "away_team": {"id": "t_abcdef", "name": "Away"},
            "status": "finished",
        }
        bodies = {
            "/leagues": {
                "leagues": [{"id": "l_123456", "name": "League", "seasons": ["2022"]}]
            },
            "/leagues/l_123456/matches": {
                "league": {"id": "l_123456", "season": "2022"},
                "matches": [match],
            },
        }
        paths = []

        def transport(req, timeout):
            path = urlparse(req.full_url).path.removeprefix("/v1")
            paths.append(path)
            if path not in bodies:
                raise AssertionError("unapproved call")
            return 200, {}, json.dumps({"data": bodies[path]}).encode()

        client = PitchClient(
            "pk_test_fixture", interval=0, transport=transport, sleep=lambda _: None
        )
        with self.db.transaction():
            enqueue_catalogue(self.db)
        result = Worker(
            self.store, client, max_requests=20, max_seconds=30, phase="catalogue"
        ).run()
        self.assertEqual(result["requests"], 2)
        self.assertEqual(paths, ["/leagues", "/leagues/l_123456/matches"])
        self.assertEqual(client.interval, 0.5)
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE entity_type='match'"
            ).fetchone()[0],
            0,
        )
        self.assertGreater(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE family='team' AND state='pending'"
            ).fetchone()[0],
            0,
        )

    def test_auth_denial_stops_run_and_does_not_poison_other_jobs(self):
        from vega_v2.backfill import enqueue_catalogue
        from vega_v2.jobs import enqueue
        from vega_v2.pitchapi import PitchClient, PitchError
        from vega_v2.worker import Worker

        with self.db.transaction():
            enqueue_catalogue(self.db)
            self.db.execute("INSERT INTO core.competitions(id,name) VALUES(1,'Test')")
            self.db.execute(
                "INSERT INTO core.seasons(id,label,start_year) VALUES(1,'2022',2022)"
            )
            self.db.execute(
                "INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(1,1,1,'2022')"
            )
            enqueue(self.db, "backfill", "league_matches", competition_season_id=1)
        client = PitchClient(
            "pk_test_fixture",
            interval=0,
            transport=lambda *_: (401, {}, b'{"error":{"code":"UNAUTHORIZED"}}'),
            sleep=lambda _: None,
        )
        with self.assertRaises(PitchError):
            Worker(
                self.store, client, max_requests=20, max_seconds=30, phase="catalogue"
            ).run()
        self.assertEqual(client.requests, 1)
        self.assertEqual(
            self.db.execute(
                "SELECT state FROM ops.fetch_jobs WHERE family='league_matches'"
            ).fetchone()[0],
            "pending",
        )

    def test_capacity_gate_blocks_claim_and_network(self):
        from vega_v2.backfill import enqueue_catalogue
        from vega_v2.pitchapi import PitchClient
        from vega_v2.worker import Worker
        from vega_v2.store import StoreError

        with self.db.transaction():
            enqueue_catalogue(self.db)
        client = PitchClient(
            "pk_test_fixture",
            interval=0,
            transport=lambda *_: self.fail("network must not start"),
            sleep=lambda _: None,
        )

        def full(_):
            raise StoreError("V2_CAPACITY_LOW")

        with self.assertRaisesRegex(StoreError, "V2_CAPACITY_LOW"):
            Worker(
                self.store,
                client,
                max_requests=5,
                max_seconds=30,
                phase="catalogue",
                capacity_check=full,
            ).run()
        self.assertEqual(client.requests, 0)
        self.assertEqual(
            self.db.execute(
                "SELECT state FROM ops.fetch_jobs WHERE global_key='catalogue'"
            ).fetchone()[0],
            "pending",
        )

    def test_catalogue_tbd_and_nameless_team_need_no_profile_fetch(self):
        from vega_v2.backfill import enqueue_catalogue
        from vega_v2.pitchapi import PitchClient
        from vega_v2.worker import Worker

        bodies = {
            "/leagues": {
                "leagues": [{"id": "l_123456", "name": "League", "seasons": ["2022"]}]
            },
            "/leagues/l_123456/matches": {
                "league": {"id": "l_123456", "season": "2022"},
                "matches": [
                    {
                        "id": "m_123456",
                        "home_team": None,
                        "away_team": {"id": "t_abcdef", "name": ""},
                        "status": "not_started",
                    }
                ],
            },
        }
        paths = []

        def transport(req, timeout):
            path = urlparse(req.full_url).path.removeprefix("/v1")
            paths.append(path)
            if path not in bodies:
                raise AssertionError("unexpected profile request")
            return 200, {}, json.dumps({"data": bodies[path]}).encode()

        with self.db.transaction():
            enqueue_catalogue(self.db)
        client = PitchClient(
            "pk_test_fixture", interval=0, transport=transport, sleep=lambda _: None
        )
        result = Worker(
            self.store, client, max_requests=5, max_seconds=30, phase="catalogue"
        ).run()
        self.assertEqual((result["requests"], result["done"]), (2, 2))
        self.assertEqual(paths, ["/leagues", "/leagues/l_123456/matches"])
        home, away = self.db.execute(
            "SELECT home_team_id,away_team_id FROM core.matches"
        ).fetchone()
        self.assertIsNone(home)
        self.assertIsNotNone(away)
        self.assertIn(
            self.db.execute(
                "SELECT name FROM core.teams WHERE id=%s", (away,)
            ).fetchone()[0],
            (None, ""),
        )
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE family='team' AND entity_id=%s AND state='pending'",
                (away,),
            ).fetchone()[0],
            1,
        )

    def test_correction_refreshes_detail_families_once(self):
        from vega_v2.backfill import persist_catalogue, enqueue_finished
        from vega_v2.normalize import normalize_family
        from vega_v2.jobs import enqueue
        from vega_v2.pitchapi import PitchClient
        from vega_v2.worker import Worker

        persist_catalogue(
            self.store,
            {"leagues": [{"id": "l_123456", "name": "League", "seasons": ["2022"]}]},
        )
        edition = self.db.execute(
            "SELECT id FROM core.competition_seasons WHERE native_label='2022'"
        ).fetchone()[0]
        match = {
            "id": "m_123456",
            "home_team": {"id": "t_123456", "name": "Home"},
            "away_team": {"id": "t_abcdef", "name": "Away"},
            "status": "finished",
        }
        enqueue_finished(
            self.store,
            normalize_family(
                "league_matches", {"league": {"id": "l_123456"}, "matches": [match]}
            ),
            edition,
            schedule_details=False,
        )
        mid = self.store.resolve("match", "m_123456")
        self.db.execute(
            "UPDATE core.matches SET first_finished_at=clock_timestamp()-interval '25 hours' WHERE id=%s",
            (mid,),
        )
        with self.db.transaction():
            enqueue(self.db, "score", "summary", entity_type="match", entity_id=mid)
        client = PitchClient(
            "pk_test_fixture",
            interval=0,
            transport=lambda *_: (200, {}, json.dumps({"data": match}).encode()),
            sleep=lambda _: None,
        )
        result = Worker(
            self.store, client, max_requests=1, max_seconds=30, lanes=("score",)
        ).run()
        self.assertEqual(result["done"], 1)
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE lane='details' AND entity_id=%s AND state='pending'",
                (mid,),
            ).fetchone()[0],
            12,
        )
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE lane='score' AND entity_id=%s AND state='pending'",
                (mid,),
            ).fetchone()[0],
            0,
        )

    def test_attempt_receipt_survives_capacity_pause(self):
        from vega_v2.backfill import enqueue_catalogue
        from vega_v2.pitchapi import PitchClient
        from vega_v2.worker import Worker
        from vega_v2.store import StoreError

        blocked = [False]

        def guard(_):
            if blocked[0]:
                raise StoreError("V2_CAPACITY_LOW")

        def transport(*_):
            blocked[0] = True
            return 200, {}, b'{"data":{"leagues":[]}}'

        with self.db.transaction():
            enqueue_catalogue(self.db)
        client = PitchClient(
            "pk_test_fixture", interval=0, transport=transport, sleep=lambda _: None
        )
        result = Worker(
            self.store,
            client,
            max_requests=2,
            max_seconds=30,
            phase="catalogue",
            capacity_check=guard,
        ).run()
        self.assertEqual((result["requests"], result["failed"]), (1, 1))
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM ops.fetch_log").fetchone()[0], 1
        )
        self.assertEqual(
            self.db.execute(
                "SELECT state FROM ops.fetch_jobs WHERE global_key='catalogue'"
            ).fetchone()[0],
            "pending",
        )


class WorkerCliTest(unittest.TestCase):
    def test_plan_uses_structured_connector_without_url(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from unittest.mock import patch
        from vega_v2.worker import main

        calls = []

        class Conn:
            def execute(self, sql, *args):
                self.query = sql
                return self

            def fetchone(self):
                return (0, 0, 0, 0, 0) if "WITH latest" in self.query else (0, 0, 0)

            def fetchall(self):
                return (
                    [("pending", 2)]
                    if "family='league_matches'" in self.query
                    else [("backfill", "pending", 2)]
                )

            def close(self):
                calls.append("closed")

        def connector(dsn):
            calls.append(dsn)
            return Conn()

        with patch.dict(os.environ, {}, clear=True), patch(
            "vega_v2.store.Store", lambda conn: object()
        ), redirect_stdout(StringIO()) as output:
            self.assertEqual(main(["plan"], connect=connector), 0)
        self.assertEqual(calls, [None, "closed"])
        self.assertIn("backfill", output.getvalue())

    def test_run_wires_guard_before_worker(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from unittest.mock import patch
        from vega_v2.worker import main

        events = []

        class Conn:
            def close(self):
                events.append("closed")

        conn = Conn()

        class Guard:
            def __init__(self, c):
                self.conn = c
                events.append("guard_init")

            def __call__(self, c):
                self.assert_same(c)
                events.append("guard_check")

            def assert_same(self, c):
                if c is not self.conn:
                    raise AssertionError("wrong connection")

        class StubWorker:
            def __init__(self, store, client, **kwargs):
                self.guard = kwargs["capacity_check"]
                events.append("worker_init")

            def run(self):
                self.guard(conn)
                return {"requests": 0, "done": 0, "failed": 0}

        with patch.dict(
            os.environ, {"PITCHAPI_API_KEY": "pk_test_fixture"}, clear=True
        ), patch("vega_v2.store.Store", lambda c: object()), patch(
            "vega_v2.capacity.CapacityGuard", Guard
        ), patch(
            "vega_v2.worker.PitchClient", lambda key: object()
        ), patch(
            "vega_v2.worker.Worker", StubWorker
        ), redirect_stdout(
            StringIO()
        ):
            self.assertEqual(
                main(
                    [
                        "run",
                        "--phase",
                        "backfill",
                        "--duration-seconds",
                        "10",
                        "--max-requests",
                        "1",
                    ],
                    connect=lambda dsn: conn,
                ),
                0,
            )
        self.assertEqual(
            events,
            ["guard_init", "guard_check", "worker_init", "guard_check", "closed"],
        )
