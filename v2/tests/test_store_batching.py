"""Real v2 fact batching: exact rows, rollback and bounded DB round trips."""

import copy
import os
from pathlib import Path
import sys
import time
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega_v2.normalize import normalize_family
from vega_v2.store import Store, StoreError, connect_local, migrate
import psycopg

DSN = os.environ.get("VEGA_V2_BATCH_TEST_DSN")


class CountingConnection:
    def __init__(self, connection):
        self.connection = connection
        self.calls = 0
        self.batches = 0

    def __getattr__(self, key):
        return getattr(self.connection, key)

    def execute(self, *args, **kwargs):
        self.calls += 1
        return self.connection.execute(*args, **kwargs)

    def cursor(self, *args, **kwargs):
        parent = self
        inner = self.connection.cursor(*args, **kwargs)

        class Cursor:
            def __enter__(self):
                inner.__enter__()
                return self

            def __exit__(self, *args):
                return inner.__exit__(*args)

            def executemany(self, *args, **kwargs):
                parent.calls += 1
                parent.batches += 1
                return inner.executemany(*args, **kwargs)

            def __getattr__(self, key):
                return getattr(inner, key)

        return Cursor()


@unittest.skipUnless(DSN, "requires dedicated local batching database")
class BatchingTest(unittest.TestCase):
    def test_existing_season_does_not_advance_smallint_identity(self):
        before = self.db.execute(
            "SELECT last_value FROM core.seasons_id_seq"
        ).fetchone()[0]
        with self.db.transaction():
            values = [self.store.season("2025/2026") for _ in range(20)]
        self.assertEqual(len(set(values)), 1)
        self.assertEqual(
            self.db.execute("SELECT last_value FROM core.seasons_id_seq").fetchone()[0],
            before,
        )

    @classmethod
    def setUpClass(cls):
        p = urlparse(DSN)
        if (
            p.hostname not in ("localhost", "127.0.0.1", "::1")
            or p.path != "/vega_v2_store_batch_test"
        ):
            raise RuntimeError("isolated local batching DB required")
        cls.db = connect_local(DSN)
        if cls.db.execute(
            "SELECT to_regnamespace('core') IS NOT NULL OR to_regnamespace('agg') IS NOT NULL OR to_regnamespace('ops') IS NOT NULL"
        ).fetchone()[0]:
            raise RuntimeError("test DB must be empty")
        migrate(cls.db)
        cls.counted = CountingConnection(cls.db)
        cls.store = Store(cls.counted)
        cls.store.save_references(
            normalize_family(
                "league", {"id": "l_111111", "name": "League", "season": "2025/2026"}
            )
        )
        eid = cls.db.execute("SELECT id FROM core.competition_seasons").fetchone()[0]
        match = {
            "id": "m_111111",
            "home_team": {"id": "t_111111", "name": "Home"},
            "away_team": {"id": "t_222222", "name": "Away"},
            "status": "finished",
            "date": "2026-01-01",
            "score_home": 1,
            "score_away": 0,
        }
        cls.mid = cls.store.save_matches(
            normalize_family("summary", match, match_id="m_111111"), eid
        )[0]

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS ops,agg,core CASCADE")
        cls.db.close()

    def test_100_shots_exact_and_failed_replacement_does_not_pollute_cache(self):
        player = {"id": "p_111111", "name": "Player"}
        source = {
            "periods": [
                {
                    "period": "FirstHalf",
                    "shots": [
                        {
                            "id": "s_" + str(i).zfill(6),
                            "team_id": "t_111111",
                            "player": player,
                            "minute": i % 45,
                            "expected_goals": 0.25,
                            "event_type": "Goal",
                            "situation": "RegularPlay",
                            "shot_type": "RightFoot",
                        }
                        for i in range(100)
                    ],
                }
            ]
        }
        batch = normalize_family("shots", source)
        self.counted.calls = 0
        self.counted.batches = 0
        start = time.perf_counter()
        self.assertTrue(self.store.save_family(self.mid, "shots", batch))
        elapsed = time.perf_counter() - start
        calls = self.counted.calls
        print(
            f"BATCH_TEST_DRIVER_CALLS={calls} BATCHES={self.counted.batches} ELAPSED_MS={elapsed*1000:.1f}"
        )
        self.assertLessEqual(
            calls, 45, "100 shots should not cause per-row DB round trips"
        )
        self.assertGreaterEqual(self.counted.batches, 1)
        self.assertEqual(
            self.db.execute("SELECT count(*),sum(xg) FROM core.shots").fetchone(),
            (100, 25.0),
        )
        before = self.db.execute(
            "SELECT revision FROM core.matches WHERE id=%s", (self.mid,)
        ).fetchone()[0]
        self.assertFalse(self.store.save_family(self.mid, "shots", batch))
        self.assertEqual(
            self.db.execute(
                "SELECT revision FROM core.matches WHERE id=%s", (self.mid,)
            ).fetchone()[0],
            before,
        )
        bad = copy.deepcopy(source)
        bad["periods"][0]["shots"][0]["player"] = {
            "id": "p_222222",
            "name": "New Player",
        }
        changed = normalize_family("shots", bad)
        changed.rows["core.shots"][0]["unknown_column"] = 1
        with self.assertRaises(StoreError):
            self.store.save_family(self.mid, "shots", changed)
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM core.shots").fetchone()[0], 100
        )
        self.assertFalse(
            self.db.execute(
                "SELECT 1 FROM core.provider_ids WHERE entity_type='player' AND provider_key='p_222222'"
            ).fetchone()
        )
        duplicate = normalize_family("shots", bad)
        duplicate.rows["core.shots"][1]["shot_no"] = duplicate.rows["core.shots"][0][
            "shot_no"
        ]
        with self.assertRaises(psycopg.errors.UniqueViolation):
            self.store.save_family(self.mid, "shots", duplicate)
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM core.shots").fetchone()[0], 100
        )
        self.assertFalse(
            self.db.execute(
                "SELECT 1 FROM core.provider_ids WHERE entity_type='player' AND provider_key='p_222222'"
            ).fetchone()
        )
        self.assertTrue(
            self.store.save_family(self.mid, "shots", normalize_family("shots", bad))
        )
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM core.shots").fetchone()[0], 100
        )

    def test_calendar_existing_matches_no_op_and_lock_order(self):
        eid = self.db.execute("SELECT id FROM core.competition_seasons").fetchone()[0]
        home = {"id": "t_111111", "name": "Home"}
        away = {"id": "t_222222", "name": "Away"}
        matches = [
            {
                "id": "m_" + str(i).zfill(6),
                "home_team": home,
                "away_team": away,
                "status": "finished",
                "date": "2026-01-02",
                "score_home": 1,
                "score_away": 0,
            }
            for i in range(60)
        ]
        batch = normalize_family("league_matches", {"matches": matches})
        self.store.save_matches(batch, eid, family="league_matches")
        versions = self.db.execute(
            "SELECT resource_kind,resource_id,version FROM ops.resource_versions ORDER BY 1,2"
        ).fetchall()
        physical = self.db.execute(
            "SELECT id,ctid::text FROM core.matches ORDER BY id"
        ).fetchall()
        self.counted.calls = 0
        start = time.perf_counter()
        self.store.save_matches(batch, eid, family="league_matches")
        elapsed = time.perf_counter() - start
        print(
            f"CALENDAR_EXISTING_DRIVER_CALLS={self.counted.calls} ELAPSED_MS={elapsed*1000:.1f}"
        )
        self.assertLessEqual(
            self.counted.calls, 30, "calendar no-op should avoid per-match round trips"
        )
        self.assertEqual(
            self.db.execute(
                "SELECT resource_kind,resource_id,version FROM ops.resource_versions ORDER BY 1,2"
            ).fetchall(),
            versions,
        )
        self.assertEqual(
            self.db.execute(
                "SELECT id,ctid::text FROM core.matches ORDER BY id"
            ).fetchall(),
            physical,
        )
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM core.matches WHERE match_date='2026-01-02'"
            ).fetchone()[0],
            60,
        )

    def test_calendar_duplicate_identity_preserves_last_observation(self):
        eid = self.db.execute("SELECT id FROM core.competition_seasons").fetchone()[0]
        a = {
            "id": "m_999999",
            "home_team": {"id": "t_111111", "name": "Home"},
            "away_team": {"id": "t_222222", "name": "Away"},
            "status": "finished",
            "date": "2026-02-01",
            "score_home": 1,
            "score_away": 0,
        }
        b = copy.deepcopy(a)
        b["score_home"] = 2
        ids = self.store.save_matches(
            normalize_family("league_matches", {"matches": [a, b]}),
            eid,
            family="league_matches",
        )
        self.assertEqual(ids[0], ids[1])
        self.assertEqual(
            self.db.execute(
                "SELECT home_score,revision FROM core.matches WHERE id=%s", (ids[0],)
            ).fetchone(),
            (2, 2),
        )

    def test_calendar_overlapping_reverse_input_does_not_deadlock(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier

        eid = self.db.execute("SELECT id FROM core.competition_seasons").fetchone()[0]
        home = {"id": "t_111111", "name": "Home"}
        away = {"id": "t_222222", "name": "Away"}
        matches = [
            {
                "id": "m_" + str(i).zfill(6),
                "home_team": home,
                "away_team": away,
                "status": "finished",
                "date": "2026-01-02",
                "score_home": 1,
                "score_away": 0,
            }
            for i in range(10)
        ]
        batches = [
            normalize_family("league_matches", {"matches": matches}),
            normalize_family("league_matches", {"matches": list(reversed(matches))}),
        ]
        barrier = Barrier(2, timeout=10)

        def save(index):
            conn = connect_local(DSN)
            try:
                conn.execute("SET lock_timeout='5s'")
                store = Store(conn)
                barrier.wait()
                return store.save_matches(batches[index], eid, family="league_matches")
            finally:
                conn.close()

        with ThreadPoolExecutor(max_workers=2) as pool:
            jobs = [pool.submit(save, i) for i in range(2)]
            self.assertEqual([len(job.result(timeout=20)) for job in jobs], [10, 10])

    def test_unchanged_asset_url_does_not_rewrite_asset_row(self):
        profile = normalize_family(
            "team",
            {
                "id": "t_111111",
                "name": "Home",
                "image_url": "https://assets.example.test/crest.png",
            },
        )
        self.store.save_references(profile, family="team")
        before = self.db.execute(
            "SELECT id,ctid::text FROM core.assets WHERE source_url=%s",
            ("https://assets.example.test/crest.png",),
        ).fetchone()
        self.store.save_references(profile, family="team")
        after = self.db.execute(
            "SELECT id,ctid::text FROM core.assets WHERE source_url=%s",
            ("https://assets.example.test/crest.png",),
        ).fetchone()
        self.assertEqual(after, before)


if __name__ == "__main__":
    unittest.main()
