import os, sys, unittest
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega_v2.backfill import catalogue_plan

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_BACKFILL_TEST_DSN")


class PlanningTest(unittest.TestCase):
    def test_native_labels_from_2021_and_invalid_catalogue(self):
        source = {
            "leagues": [
                {
                    "id": "l_123456",
                    "name": "Test",
                    "seasons": ["2020/2021", "2021/2022", "2022", "2022"],
                }
            ]
        }
        plan = catalogue_plan(source)
        self.assertEqual(plan["leagues"][0]["seasons"], ["2021/2022", "2022"])
        self.assertEqual(source["leagues"][0]["seasons"][0], "2020/2021")
        with self.assertRaises(Exception):
            catalogue_plan({"leagues": [{"id": "l_wrong", "seasons": ["2022"]}]})


@unittest.skipUnless(DSN and psycopg, "requires dedicated local backfill DB")
class BackfillTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if (
            target.hostname not in ("localhost", "127.0.0.1", "::1")
            or target.path != "/vega_v2_backfill_test"
        ):
            raise RuntimeError("dedicated local backfill DB required")
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

    def test_catalogue_and_idempotent_calendar(self):
        from vega_v2.backfill import persist_catalogue, enqueue_finished
        from vega_v2.normalize import normalize_family

        data = {
            "leagues": [
                {
                    "id": "l_123456",
                    "name": "Test",
                    "country_code": "FRA",
                    "seasons": ["2020", "2022", "2023/2024"],
                }
            ]
        }
        one = persist_catalogue(self.store, data)
        two = persist_catalogue(self.store, data)
        self.assertEqual((one["editions"], one["queued"], two["queued"]), (2, 2, 0))
        edition = self.db.execute(
            "SELECT id FROM core.competition_seasons WHERE native_label='2022'"
        ).fetchone()[0]
        raw = {
            "league": {"id": "l_123456", "season": "2022"},
            "matches": [
                {
                    "id": "m_123456",
                    "home_team": {"id": "t_123456", "name": "Home"},
                    "away_team": {"id": "t_abcdef", "name": "Away"},
                    "status": "finished",
                },
                {
                    "id": "m_abcdef",
                    "home_team": {"id": "t_123456", "name": "Home"},
                    "away_team": {"id": "t_abcdef", "name": "Away"},
                    "status": "not_started",
                },
            ],
        }
        batch = normalize_family("league_matches", raw)
        first = enqueue_finished(self.store, batch, edition)
        second = enqueue_finished(self.store, batch, edition)
        self.assertEqual(
            (first["matches"], first["finished"], first["queued"], second["queued"]),
            (2, 1, 13, 0),
        )
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE entity_type='match'"
            ).fetchone()[0],
            13,
        )

    def test_catalogue_mode_defers_match_families_then_explicit_activation(self):
        from vega_v2.backfill import (
            persist_catalogue,
            enqueue_finished,
            activate_finished,
            catalogue_report,
        )
        from vega_v2.normalize import normalize_family

        persist_catalogue(
            self.store,
            {"leagues": [{"id": "l_123456", "name": "Test", "seasons": ["2022"]}]},
        )
        edition = self.db.execute("SELECT id FROM core.competition_seasons").fetchone()[
            0
        ]
        batch = normalize_family(
            "league_matches",
            {
                "league": {"id": "l_123456"},
                "matches": [
                    {
                        "id": "m_123456",
                        "home_team": {"id": "t_123456", "name": "Home"},
                        "away_team": {"id": "t_abcdef", "name": "Away"},
                        "status": "finished",
                    },
                    {
                        "id": "m_abcdef",
                        "home_team": {"id": "t_123456", "name": "Home"},
                        "away_team": {"id": "t_abcdef", "name": "Away"},
                        "status": "not_started",
                    },
                ],
            },
        )
        first = enqueue_finished(self.store, batch, edition, schedule_details=False)
        self.assertEqual(first["queued"], 0)
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.fetch_jobs WHERE entity_type='match'"
            ).fetchone()[0],
            0,
        )
        report = catalogue_report(self.db)
        self.assertEqual(
            (
                report["finished"],
                report["upcoming"],
                report["estimated_match_family_calls_upper_bound"],
            ),
            (1, 1, 13),
        )
        result = activate_finished(self.store, limit=1)
        self.assertEqual((result["matches"], result["queued"]), (1, 13))
        self.assertIsNone(result["next_after_id"])
        self.assertEqual(activate_finished(self.store, limit=1)["queued"], 0)
