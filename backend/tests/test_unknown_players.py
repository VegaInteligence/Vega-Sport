"""Observed provider player IDs remain usable when no profile is available."""

import os, sys, unittest
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_UNKNOWN_TEST_DSN")


@unittest.skipUnless(DSN and psycopg, "requires disposable local unknown-player DB")
class UnknownPlayerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if (
            target.hostname not in ("localhost", "127.0.0.1", "::1")
            or target.path != "/vega_v2_unknown_test"
        ):
            raise RuntimeError("dedicated local unknown DB required")
        from vega.store import connect_local, migrate, Store

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

    def test_unknown_identity_facts_atomic_and_eventual_enrichment(self):
        from vega.normalize import normalize_family
        from vega.store import StoreError
        from vega.profiles import save_profile

        self.store.save_references(
            normalize_family(
                "league", {"id": "l_123456", "name": "League", "season": "2025/2026"}
            )
        )
        edition = self.db.execute("SELECT id FROM core.competition_seasons").fetchone()[
            0
        ]
        mid = self.store.save_matches(
            normalize_family(
                "summary",
                {
                    "id": "m_123456",
                    "home_team": {"id": "t_123456", "name": "Home"},
                    "away_team": {"id": "t_abcdef", "name": "Away"},
                    "status": "finished",
                },
            ),
            edition,
        )[0]
        event = normalize_family(
            "events",
            {
                "events": [
                    {
                        "event_type": "Goal",
                        "team_id": "t_123456",
                        "player": {"id": "p_123456", "name": ""},
                        "minute": 12,
                    }
                ]
            },
            match_id="m_123456",
        )
        shot = normalize_family(
            "shots",
            {
                "periods": [
                    {
                        "period": "FirstHalf",
                        "shots": [
                            {
                                "id": "s_123456",
                                "team_id": "t_123456",
                                "player": {"id": "p_123456"},
                                "minute": 12,
                                "event_type": "Goal",
                            }
                        ],
                    }
                ]
            },
            match_id="m_123456",
        )
        self.store.save_family(mid, "events", event)
        self.store.save_family(mid, "shots", shot)
        player = self.store.resolve("player", "p_123456")
        self.assertEqual(
            self.db.execute(
                "SELECT name FROM core.players WHERE id=%s", (player,)
            ).fetchone()[0],
            None,
        )
        self.assertEqual(
            self.db.execute(
                "SELECT player_id FROM core.match_events WHERE match_id=%s", (mid,)
            ).fetchone()[0],
            player,
        )
        self.assertEqual(
            self.db.execute(
                "SELECT player_id FROM core.shots WHERE match_id=%s", (mid,)
            ).fetchone()[0],
            player,
        )
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE family='player' AND entity_id=%s AND state='pending'",
                (player,),
            ).fetchone()[0],
            1,
        )
        bad = normalize_family(
            "events",
            {
                "events": [
                    {
                        "event_type": "Goal",
                        "team_id": "t_123456",
                        "player": {"id": "p_abcdef"},
                        "minute": 1,
                    }
                ]
            },
        )
        bad.rows["core.match_events"][0]["not_a_column"] = 1
        with self.assertRaises(StoreError):
            self.store.save_family(mid, "events", bad)
        self.assertFalse(self.store.has("player", "p_abcdef"))
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE family='player' AND entity_id=%s",
                (player,),
            ).fetchone()[0],
            1,
        )
        save_profile(
            self.store,
            "player",
            "p_123456",
            normalize_family("player", {"id": "p_123456", "name": "Known later"}),
        )
        self.assertEqual(self.store.resolve("player", "p_123456"), player)
        self.assertEqual(
            self.db.execute(
                "SELECT name FROM core.players WHERE id=%s", (player,)
            ).fetchone()[0],
            "Known later",
        )
        self.assertEqual(
            self.db.execute(
                "SELECT player_id FROM core.match_events WHERE match_id=%s", (mid,)
            ).fetchone()[0],
            player,
        )
        self.assertEqual(
            self.db.execute(
                "SELECT player_id FROM core.shots WHERE match_id=%s", (mid,)
            ).fetchone()[0],
            player,
        )
