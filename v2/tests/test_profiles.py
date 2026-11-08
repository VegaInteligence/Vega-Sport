"""Test first-seen profile lifecycle against only its dedicated local DB."""

import os, sys, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_PROFILES_TEST_DSN")


@unittest.skipUnless(
    DSN and psycopg, "requires disposable local profile DB and psycopg"
)
class ProfileTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if (
            target.hostname not in ("localhost", "127.0.0.1", "::1")
            or target.path != "/vega_v2_profiles_test"
        ):
            raise RuntimeError("dedicated local profile DB required")
        from vega_v2.store import connect_local, migrate, Store

        cls.db = connect_local(DSN)
        if not cls.db.execute(
            "SELECT to_regnamespace('core') IS NULL AND to_regnamespace('agg') IS NULL AND to_regnamespace('ops') IS NULL"
        ).fetchone()[0]:
            raise RuntimeError("test DB must be empty")
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

    def test_first_seen_enrichment_due_and_fencing(self):
        from vega_v2.profiles import (
            queue_first_seen,
            save_profile,
            record_failure,
            enqueue_due,
        )
        from vega_v2.jobs import claim
        from vega_v2.normalize import normalize_family
        from vega_v2.store import StoreError

        now = datetime.now(timezone.utc)
        with self.db.transaction():
            team = self.store.entity("team", "t_123456", {"name": "Observed"})
        pending = self.db.execute(
            "SELECT status FROM ops.reference_state WHERE entity_type='team' AND entity_id=%s",
            (team,),
        ).fetchone()
        self.assertEqual(pending[0], "pending")
        self.assertIsNone(queue_first_seen(self.db, "team", team))
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE family='team' AND entity_id=%s",
                (team,),
            ).fetchone()[0],
            1,
        )
        with self.db.transaction():
            player = self.store.entity(
                "player", "p_123456", {"name": "Observed player"}
            )
        job = claim(self.db, "reference", family="team", lease_seconds=120)
        self.assertEqual(job["entity_id"], team)
        payload = normalize_family(
            "team",
            {
                "id": "t_123456",
                "name": "Official",
                "image_url": "https://cdn.pitchapi.dev/teams/a.webp",
            },
        )
        self.assertEqual(
            save_profile(
                self.store,
                "team",
                "t_123456",
                payload,
                lease=(job["id"], job["lease_token"]),
                now=now,
            ),
            team,
        )
        state = self.db.execute(
            "SELECT status,fingerprint,last_success_at,next_due FROM ops.reference_state WHERE entity_type='team' AND entity_id=%s",
            (team,),
        ).fetchone()
        self.assertEqual(state[0], "ok")
        self.assertEqual(len(state[1]), 32)
        self.assertEqual(state[2], now)
        self.assertEqual(state[3], now + timedelta(days=30))
        self.assertEqual(
            self.db.execute(
                "SELECT name FROM core.teams WHERE id=%s", (team,)
            ).fetchone()[0],
            "Official",
        )
        self.assertEqual(
            self.db.execute(
                "SELECT state FROM ops.fetch_jobs WHERE id=%s", (job["id"],)
            ).fetchone()[0],
            "done",
        )
        with self.assertRaises(StoreError):
            save_profile(
                self.store,
                "team",
                "t_123456",
                normalize_family("team", {"id": "t_abcdef", "name": "Wrong"}),
            )
        self.assertEqual(
            self.db.execute(
                "SELECT name FROM core.teams WHERE id=%s", (team,)
            ).fetchone()[0],
            "Official",
        )
        self.assertEqual(enqueue_due(self.db, now=now + timedelta(days=29)), [])
        due = enqueue_due(self.db, now=now + timedelta(days=30))
        self.assertEqual(len(due), 1)
        self.assertEqual(enqueue_due(self.db, now=now + timedelta(days=30)), [])
        expired = claim(
            self.db,
            "reference",
            family="team",
            now=now + timedelta(days=30),
            lease_seconds=1,
        )
        # Deliberately invalidate the token without waiting or changing system time.
        self.db.execute(
            "UPDATE ops.fetch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=%s",
            (expired["id"],),
        )
        with self.assertRaisesRegex(StoreError, "LEASE_LOST"):
            save_profile(
                self.store,
                "team",
                "t_123456",
                payload,
                lease=(expired["id"], expired["lease_token"]),
            )
        self.assertEqual(
            self.db.execute(
                "SELECT name FROM core.teams WHERE id=%s", (team,)
            ).fetchone()[0],
            "Official",
        )
        record_failure(
            self.store,
            "team",
            "t_123456",
            "UPSTREAM_ERROR",
            now=now + timedelta(days=30),
        )
        self.assertEqual(
            self.db.execute(
                "SELECT name FROM core.teams WHERE id=%s", (team,)
            ).fetchone()[0],
            "Official",
        )
        self.assertEqual(
            self.db.execute(
                "SELECT status FROM ops.reference_state WHERE entity_type='team' AND entity_id=%s",
                (team,),
            ).fetchone()[0],
            "error",
        )
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE family='player' AND entity_id=%s",
                (player,),
            ).fetchone()[0],
            1,
        )

    def test_direct_hydration_finishes_only_pending_job(self):
        from vega_v2.profiles import save_profile
        from vega_v2.jobs import claim
        from vega_v2.normalize import normalize_family

        payload = normalize_family("player", {"id": "p_456789", "name": "Hydrated"})
        player = save_profile(self.store, "player", "p_456789", payload)
        self.assertEqual(
            self.db.execute(
                "SELECT state FROM ops.fetch_jobs WHERE family='player' AND entity_id=%s",
                (player,),
            ).fetchone()[0],
            "done",
        )
        with self.db.transaction():
            other = self.store.entity("team", "t_987654", {"name": "First sight"})
        leased = claim(self.db, "reference", family="team", lease_seconds=120)
        self.assertEqual(leased["entity_id"], other)
        save_profile(
            self.store,
            "team",
            "t_987654",
            normalize_family("team", {"id": "t_987654", "name": "Hydrated"}),
        )
        self.assertEqual(
            self.db.execute(
                "SELECT state,lease_token FROM ops.fetch_jobs WHERE id=%s",
                (leased["id"],),
            ).fetchone(),
            ("leased", leased["lease_token"]),
        )
