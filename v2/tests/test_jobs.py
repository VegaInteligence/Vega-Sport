import os, sys, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega_v2.jobs import (
    enqueue,
    claim,
    ack,
    fail,
    next_score_check,
    after_finished,
    LeaseLost,
    DETAIL_FAMILIES,
)

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_JOBS_TEST_DSN")
NOW = datetime(2026, 11, 8, 12, tzinfo=timezone.utc)


class CadenceTests(unittest.TestCase):
    def test_score_cadence(self):
        kickoff = NOW
        self.assertEqual(
            next_score_check(kickoff, kickoff), kickoff + timedelta(minutes=105)
        )
        self.assertEqual(
            next_score_check(kickoff, kickoff + timedelta(minutes=105)),
            kickoff + timedelta(minutes=120),
        )
        self.assertEqual(
            next_score_check(kickoff, kickoff + timedelta(minutes=149)),
            kickoff + timedelta(minutes=150),
        )
        self.assertEqual(
            next_score_check(kickoff, kickoff + timedelta(minutes=150)),
            kickoff + timedelta(minutes=210),
        )
        with self.assertRaises(ValueError):
            next_score_check(datetime(2026, 1, 1), NOW)


@unittest.skipUnless(
    DSN and psycopg, "requires dedicated local jobs test DB and psycopg"
)
class QueueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if (
            target.hostname not in ("localhost", "127.0.0.1", "::1")
            or target.path != "/vega_v2_jobs_test"
        ):
            raise RuntimeError("dedicated local jobs test DB required")
        cls.db = psycopg.connect(DSN)
        if not cls.db.execute(
            "SELECT to_regnamespace('core') IS NULL AND to_regnamespace('agg') IS NULL AND to_regnamespace('ops') IS NULL"
        ).fetchone()[0]:
            raise RuntimeError("test DB must be empty")
        for name in ("001_core.sql", "002_aggregates.sql", "003_ops.sql"):
            cls.db.execute((ROOT / "sql" / name).read_text(encoding="utf-8"))
        cls.db.execute(
            "INSERT INTO core.seasons(id,label,start_year) VALUES(1,'2025/2026',2025)"
        )
        cls.db.execute("INSERT INTO core.competitions(id,name) VALUES(1,'Test')")
        cls.db.execute(
            "INSERT INTO core.competition_seasons(id,competition_id,season_id) VALUES(1,1,1)"
        )
        cls.db.execute(
            "INSERT INTO core.matches(id,competition_season_id,season_id,source) VALUES(1,1,1,'pitchapi')"
        )

    @classmethod
    def tearDownClass(cls):
        cls.db.rollback()
        cls.db.close()

    def setUp(self):
        self.db.execute("SAVEPOINT test_case")

    def tearDown(self):
        self.db.execute("ROLLBACK TO SAVEPOINT test_case")

    def test_dedup_and_expired_lease_fencing(self):
        job = enqueue(
            self.db, "score", "summary", entity_type="match", entity_id=1, run_after=NOW
        )
        self.assertIsNone(
            enqueue(
                self.db,
                "score",
                "summary",
                entity_type="match",
                entity_id=1,
                run_after=NOW,
            )
        )
        a = claim(self.db, "score", now=NOW, lease_seconds=30)
        self.assertEqual(a["id"], job)
        self.assertIsNone(claim(self.db, "score", now=NOW + timedelta(seconds=1)))
        b = claim(self.db, "score", now=NOW + timedelta(seconds=31), lease_seconds=30)
        self.assertNotEqual(a["lease_token"], b["lease_token"])
        with self.assertRaises(LeaseLost):
            ack(self.db, job, a["lease_token"], now=NOW + timedelta(seconds=32))
        with self.assertRaises(LeaseLost):
            fail(
                self.db, job, a["lease_token"], "ERROR", now=NOW + timedelta(seconds=32)
            )
        ack(self.db, job, b["lease_token"], now=NOW + timedelta(seconds=32))
        self.assertIsNotNone(
            enqueue(
                self.db,
                "score",
                "summary",
                entity_type="match",
                entity_id=1,
                run_after=NOW,
            )
        )

    def test_retry_and_finished_hooks(self):
        job = enqueue(
            self.db, "score", "summary", entity_type="match", entity_id=1, run_after=NOW
        )
        a = claim(self.db, "score", now=NOW, lease_seconds=120)
        fail(
            self.db,
            job,
            a["lease_token"],
            "RATE_LIMIT_EXCEEDED",
            now=NOW,
            base_seconds=30,
        )
        self.assertIsNone(claim(self.db, "score", now=NOW + timedelta(seconds=29)))
        b = claim(self.db, "score", now=NOW + timedelta(seconds=30), lease_seconds=120)
        ack(self.db, job, b["lease_token"], now=NOW + timedelta(seconds=30))
        result = after_finished(self.db, 1, NOW + timedelta(seconds=30))
        self.assertEqual(len(result["details"]), len(DETAIL_FAMILIES))
        self.assertTrue(all(result["details"]))
        self.assertIsNotNone(result["correction"])
        self.assertEqual(
            self.db.execute(
                "SELECT run_after FROM ops.fetch_jobs WHERE id=%s",
                (result["correction"],),
            ).fetchone()[0],
            NOW + timedelta(days=1, seconds=30),
        )

    def test_invalid_targets_are_rejected(self):
        with self.assertRaises(ValueError):
            enqueue(
                self.db,
                "score",
                "shots",
                entity_type="player",
                entity_id=1,
                run_after=NOW,
            )
        with self.assertRaises(ValueError):
            enqueue(
                self.db,
                "score",
                "summary",
                entity_type="match",
                entity_id=1,
                target_date=NOW.date(),
                run_after=NOW,
            )
