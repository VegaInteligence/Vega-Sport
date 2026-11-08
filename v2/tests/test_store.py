"""Transactional integration tests against a disposable local v2 DB only."""

import os, sys, unittest
from pathlib import Path
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_STORE_TEST_DSN")


@unittest.skipUnless(DSN and psycopg, "requires disposable local store DB and psycopg")
class StoreTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if (
            target.hostname not in ("localhost", "127.0.0.1", "::1")
            or target.path != "/vega_v2_store_test"
        ):
            raise RuntimeError("dedicated local store DB required")
        from vega_v2.store import connect_local, migrate, Store
        from vega_v2.normalize import normalize_family, NormalizationError
        from vega_v2.jobs import enqueue, claim

        cls.Store, cls.normalize, cls.NormalizationError = (
            Store,
            staticmethod(normalize_family),
            NormalizationError,
        )
        cls.enqueue, cls.claim = staticmethod(enqueue), staticmethod(claim)
        cls.db = connect_local(DSN)
        if (
            cls.db.execute(
                "SELECT to_regnamespace('core') IS NULL AND to_regnamespace('agg') IS NULL AND to_regnamespace('ops') IS NULL"
            ).fetchone()[0]
            is not True
        ):
            raise RuntimeError("test DB must be empty")
        migrate(cls.db)
        cls.store = Store(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS ops,agg,core CASCADE")
        cls.db.close()

    def test_transactional_lifecycle(self):
        from vega_v2.store import StoreError

        league = {
            "id": "l_123456",
            "name": "League",
            "country_code": "FRA",
            "season": "2025/2026",
        }
        self.store.save_references(self.normalize("league", league))
        edition = self.db.execute("SELECT id FROM core.competition_seasons").fetchone()[
            0
        ]
        match = {
            "id": "m_123456",
            "home_team": {"id": "t_123456", "name": "Home"},
            "away_team": {"id": "t_abcdef", "name": "Away"},
            "status": "finished",
            "date": "2026-01-01",
            "score_home": 1,
            "score_away": 0,
        }
        batch = self.normalize("summary", match, match_id="m_123456")
        mid = self.store.save_matches(batch, edition)[0]
        rev = lambda: self.db.execute(
            "SELECT revision FROM core.matches WHERE id=%s", (mid,)
        ).fetchone()[0]
        self.assertEqual(self.store.save_matches(batch, edition), [mid])
        r = rev()
        self.assertEqual(self.store.save_matches(batch, edition), [mid])
        self.assertEqual(rev(), r)

        def stats(pid, team, goals):
            return self.normalize(
                "players",
                [
                    {
                        "player": {"id": pid, "name": pid},
                        "team_id": team,
                        "stats": [
                            {
                                "stats": {
                                    "Goals": {
                                        "key": "goals",
                                        "stat": {"type": "integer", "value": goals},
                                    }
                                }
                            }
                        ],
                    }
                ],
                match_id="m_123456",
            )

        one = stats("p_123456", "t_123456", 1)
        self.assertTrue(self.store.save_family(mid, "player_stats", one))
        after = rev()
        self.assertFalse(self.store.save_family(mid, "player_stats", one))
        self.assertEqual(rev(), after)
        two = stats("p_abcdef", "t_abcdef", 2)
        self.assertTrue(self.store.save_family(mid, "player_stats", two))
        self.assertEqual(rev(), after + 1)
        rows = self.db.execute(
            "SELECT p.provider_key,s.goals FROM core.player_match_stats s JOIN core.provider_ids p ON p.entity_type='player' AND p.entity_id=s.player_id WHERE s.match_id=%s",
            (mid,),
        ).fetchall()
        self.assertEqual(rows, [("p_abcdef", 2)])
        dirty = self.db.execute(
            "SELECT p.provider_key FROM ops.dirty_scopes d JOIN core.provider_ids p ON p.entity_type='player' AND p.entity_id=d.player_id WHERE d.scope_kind='player_season' ORDER BY p.provider_key"
        ).fetchall()
        self.assertEqual(dirty, [("p_123456",), ("p_abcdef",)])
        with self.assertRaises(self.NormalizationError):
            stats("p_654321", "t_123456", 1.5)
        self.store.record_failure(mid, "player_stats", "INVALID_NUMBER")
        self.assertEqual(
            self.db.execute(
                "SELECT goals FROM core.player_match_stats WHERE match_id=%s", (mid,)
            ).fetchall(),
            [(2,)],
        )
        self.assertEqual(
            self.db.execute(
                "SELECT player_stats FROM core.match_coverage WHERE match_id=%s", (mid,)
            ).fetchone()[0],
            "ok",
        )
        before_recovery = rev()
        self.assertFalse(self.store.save_family(mid, "player_stats", two))
        self.assertEqual(rev(), before_recovery)
        self.assertEqual(
            self.db.execute(
                "SELECT status FROM ops.family_state WHERE match_id=%s AND family='player_stats'",
                (mid,),
            ).fetchone()[0],
            "ok",
        )
        self.store.record_failure(mid, "summary", "TRANSPORT_ERROR")
        self.store.save_matches(batch, edition)
        self.assertEqual(
            self.db.execute(
                "SELECT status FROM ops.family_state WHERE match_id=%s AND family='summary'",
                (mid,),
            ).fetchone()[0],
            "ok",
        )
        player = self.store.resolve("player", "p_abcdef")
        version = self.db.execute(
            "SELECT version FROM ops.resource_versions WHERE resource_kind='player' AND resource_id=%s",
            (player,),
        ).fetchone()[0]
        corrected = stats("p_abcdef", "t_abcdef", 2)
        corrected.references[0].fields["name"] = "Corrected display name"
        self.assertFalse(self.store.save_family(mid, "player_stats", corrected))
        self.assertEqual(rev(), before_recovery)
        self.assertGreater(
            self.db.execute(
                "SELECT version FROM ops.resource_versions WHERE resource_kind='player' AND resource_id=%s",
                (player,),
            ).fetchone()[0],
            version,
        )
        r = rev()
        bad = stats("p_123456", "t_123456", 3)
        bad.rows["core.player_match_stats"][0]["not_a_column"] = 7
        with self.assertRaises(StoreError):
            self.store.save_family(mid, "player_stats", bad)
        self.assertEqual(rev(), r)
        self.assertEqual(
            self.db.execute(
                "SELECT goals FROM core.player_match_stats WHERE match_id=%s", (mid,)
            ).fetchall(),
            [(2,)],
        )
        invalid = stats("p_123456", "t_123456", 4)
        invalid.rows["core.player_match_stats"][0]["player_id"] = None
        with self.assertRaises(psycopg.IntegrityError):
            self.store.save_family(mid, "player_stats", invalid)
        self.assertEqual(rev(), r)
        self.assertEqual(
            self.db.execute(
                "SELECT goals FROM core.player_match_stats WHERE match_id=%s", (mid,)
            ).fetchall(),
            [(2,)],
        )
        self.db.execute(
            "INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES('player','pitchapi','p_ffff00',999999)"
        )
        broken_fk = stats("p_ffff00", "t_123456", 5)
        broken_fk.references = [
            ref for ref in broken_fk.references if ref.provider_key != "p_ffff00"
        ]
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            self.store.save_family(mid, "player_stats", broken_fk)
        self.assertEqual(rev(), r)
        self.assertEqual(
            self.db.execute(
                "SELECT goals FROM core.player_match_stats WHERE match_id=%s", (mid,)
            ).fetchall(),
            [(2,)],
        )
        now = datetime.now(timezone.utc)
        job = self.enqueue(
            self.db,
            "details",
            "player_stats",
            entity_type="match",
            entity_id=mid,
            run_after=now - timedelta(seconds=5),
        )
        leased = self.claim(
            self.db, "details", now=now - timedelta(seconds=4), lease_seconds=1
        )
        with self.assertRaisesRegex(StoreError, "LEASE_LOST"):
            self.store.save_family(
                mid, "player_stats", one, lease=(job, leased["lease_token"])
            )
        with self.assertRaisesRegex(StoreError, "LEASE_LOST"):
            self.store.record_failure(
                mid,
                "player_stats",
                "TRANSPORT_ERROR",
                lease=(job, leased["lease_token"]),
            )
        self.assertEqual(rev(), r)
        self.assertEqual(
            self.db.execute(
                "SELECT goals FROM core.player_match_stats WHERE match_id=%s", (mid,)
            ).fetchall(),
            [(2,)],
        )

        recovered = self.claim(
            self.db, "details", now=datetime.now(timezone.utc), lease_seconds=120
        )
        self.assertTrue(
            self.store.save_family(
                mid, "player_stats", one, lease=(job, recovered["lease_token"])
            )
        )
        self.assertEqual(
            self.db.execute(
                "SELECT state FROM ops.fetch_jobs WHERE id=%s", (job,)
            ).fetchone()[0],
            "done",
        )
        from vega_v2.normalize import NormalizedFamily

        combined = NormalizedFamily(
            rows={
                "core.player_match_stats": one.rows["core.player_match_stats"]
                + two.rows["core.player_match_stats"]
            },
            references=one.references + two.references,
        )
        self.assertTrue(self.store.save_family(mid, "player_stats", combined))
        ordered = rev()
        combined.rows["core.player_match_stats"].reverse()
        self.assertFalse(self.store.save_family(mid, "player_stats", combined))
        self.assertEqual(rev(), ordered)
