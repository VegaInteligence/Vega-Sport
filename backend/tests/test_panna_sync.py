"""The hosted runner's durable inventory, claim and recovery boundary on PostgreSQL."""
import os
from pathlib import Path
import sys
import unittest
from datetime import UTC, date, datetime

from prerequisites import required

try:
    import psycopg
except ImportError:
    psycopg = None

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infra/aws/panna"))
DSN = os.environ.get("VEGA_V2_PANNA_SYNC_TEST_DSN")


@required(DSN and psycopg, "requires VEGA_V2_PANNA_SYNC_TEST_DSN and psycopg")
class DailyQueueTest(unittest.TestCase):
    def setUp(self):
        from vega.store import connect_local

        self.db = connect_local(DSN)
        self.addCleanup(self.db.close)
        self.db.execute("DROP SCHEMA IF EXISTS panna_sync CASCADE")
        self.db.execute((ROOT / "infra/aws/panna/queue.sql").read_text())

    def test_inventory_claim_expire_and_recover_after_lost_ack(self):
        import autosync

        asset = {"origin": "github", "container": "opta-latest", "name": "opta_fixtures.parquet",
                 "sha256": "f" * 64, "bytes": 42, "asset_id": 7, "updated_at": "2026-11-28T01:00:00Z",
                 "url": "https://github.com/peteowen1/pannadata/releases/download/opta-latest/opta_fixtures.parquet"}
        t = datetime(2026, 11, 28, 1, tzinfo=UTC)
        cutoff = date(2026, 11, 28)
        queue = autosync.Queue(self.db)
        self.assertTrue(queue.discovery_due(t))
        queue.discover({"fixture": asset}, cutoff, t)
        queue.discover({"fixture": asset}, cutoff, t)
        first = queue.claim(t)
        self.assertIsNotNone(first)
        self.assertIsNone(queue.claim(t))
        self.db.execute("UPDATE panna_sync.work SET lease_until=%s", (t,))
        second = queue.claim(t)
        self.assertEqual(first["id"], second["id"])
        self.assertNotEqual(first["fence"], second["fence"])
        self.assertFalse(queue.finish(first, "verified", "PROOF", t, run_id=99))
        self.assertTrue(queue.finish(second, "verified", "PROOF", t, run_id=99))
        self.assertFalse(queue.discovery_due(t))
        self.assertEqual(self.db.execute("SELECT status,run_id FROM panna_sync.work WHERE id=%s",
                                       (second["id"],)).fetchone(), ("verified", 99))

    def test_unsupported_and_identity_dependencies_stay_open(self):
        import autosync

        t = datetime(2026, 11, 28, 1, tzinfo=UTC)
        queue = autosync.Queue(self.db)
        def make(name, sha):
            return {"origin": "github", "container": "opta-latest", "name": name, "sha256": sha,
                    "bytes": 31, "asset_id": 11, "updated_at": "2026-11-28T01:00:00Z",
                    "url": "https://github.com/peteowen1/pannadata/releases/download/opta-latest/" + name}

        queue.discover({"fixture": make("opta_fixtures.parquet", "a" * 64),
                        "event": make("events_test.parquet", "b" * 64),
                        "unsupported": make("unknown.rds", "c" * 64)}, t.date(), t)
        states = dict(self.db.execute("SELECT handler,status FROM panna_sync.work"))
        self.assertEqual(states, {"fixtures": "pending", "identity": "handler_pending",
                                 "actions": "dependency_pending", "unsupported": "handler_pending"})
        self.assertEqual(queue.claim(t)["handler"], "fixtures")
        self.assertIsNone(queue.claim(t))
