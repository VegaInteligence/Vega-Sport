"""Concurrent Store publication on a dedicated local PostgreSQL database."""

import os
from pathlib import Path
import sys
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega_v2.normalize import normalize_family
from vega_v2.store import Store, connect_local, migrate

DSN = os.environ.get("VEGA_V2_CONCURRENCY_TEST_DSN")


@unittest.skipUnless(DSN, "requires disposable local concurrency database")
class ConcurrentPublicationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if (
            target.hostname not in ("localhost", "127.0.0.1", "::1")
            or target.path != "/vega_v2_concurrency_test"
        ):
            raise RuntimeError("dedicated local vega_v2_concurrency_test required")
        cls.admin = connect_local(DSN)
        if cls.admin.execute(
            "SELECT to_regnamespace('core') IS NOT NULL OR to_regnamespace('agg') IS NOT NULL OR to_regnamespace('ops') IS NOT NULL"
        ).fetchone()[0]:
            raise RuntimeError("test DB must be empty")
        migrate(cls.admin)
        store = Store(cls.admin)
        league = normalize_family(
            "league", {"id": "l_111111", "name": "League", "season": "2025/2026"}
        )
        store.save_references(league)
        edition = cls.admin.execute(
            "SELECT id FROM core.competition_seasons"
        ).fetchone()[0]
        home = {"id": "t_111111", "name": "Home"}
        away = {"id": "t_222222", "name": "Away"}
        cls.mids = []
        for key in ("m_111111", "m_222222"):
            match = {
                "id": key,
                "home_team": home,
                "away_team": away,
                "status": "finished",
                "date": "2026-01-01",
                "score_home": 1,
                "score_away": 0,
            }
            cls.mids.append(
                store.save_matches(
                    normalize_family("summary", match, match_id=key), edition
                )[0]
            )

    @classmethod
    def tearDownClass(cls):
        cls.admin.execute("DROP SCHEMA IF EXISTS ops,agg,core CASCADE")
        cls.admin.close()

    def test_two_matches_shared_player_commit_and_replay_without_duplicate_versions(
        self,
    ):
        def batch(players):
            return normalize_family(
                "players",
                [
                    {
                        "player": {"id": player, "name": "Synthetic " + player},
                        "team_id": "t_111111",
                        "stats": [
                            {
                                "stats": {
                                    "goals": {
                                        "key": "goals",
                                        "stat": {"type": "integer", "value": 1},
                                    }
                                }
                            }
                        ],
                    }
                    for player in players
                ],
            )

        batches = [batch(("p_111111", "p_222222")), batch(("p_222222", "p_333333"))]

        def run_pair():
            barrier = Barrier(2, timeout=10)

            def save(index):
                conn = connect_local(DSN)
                try:
                    conn.execute("SET lock_timeout='5s'")
                    conn.execute("SET statement_timeout='12s'")
                    store = Store(conn)
                    barrier.wait()
                    return store.save_family(
                        self.mids[index], "player_stats", batches[index]
                    )
                finally:
                    conn.close()

            with ThreadPoolExecutor(max_workers=2) as pool:
                jobs = [pool.submit(save, i) for i in range(2)]
                return [job.result(timeout=20) for job in jobs]

        self.assertEqual(run_pair(), [True, True])
        rows = self.admin.execute(
            "SELECT m.provider_key,p.provider_key,s.goals FROM core.player_match_stats s JOIN core.provider_ids m ON m.entity_type='match' AND m.entity_id=s.match_id JOIN core.provider_ids p ON p.entity_type='player' AND p.entity_id=s.player_id ORDER BY 1,2"
        ).fetchall()
        self.assertEqual(
            rows,
            [
                ("m_111111", "p_111111", 1),
                ("m_111111", "p_222222", 1),
                ("m_222222", "p_222222", 1),
                ("m_222222", "p_333333", 1),
            ],
        )
        revisions = self.admin.execute(
            "SELECT id,revision FROM core.matches ORDER BY id"
        ).fetchall()
        versions = self.admin.execute(
            "SELECT resource_kind,resource_id,version FROM ops.resource_versions ORDER BY 1,2"
        ).fetchall()
        self.assertEqual(run_pair(), [False, False])
        self.assertEqual(
            self.admin.execute(
                "SELECT id,revision FROM core.matches ORDER BY id"
            ).fetchall(),
            revisions,
        )
        self.assertEqual(
            self.admin.execute(
                "SELECT resource_kind,resource_id,version FROM ops.resource_versions ORDER BY 1,2"
            ).fetchall(),
            versions,
        )
        self.assertEqual(
            self.admin.execute(
                "SELECT count(*) FROM core.player_match_stats"
            ).fetchone()[0],
            4,
        )


if __name__ == "__main__":
    unittest.main()
