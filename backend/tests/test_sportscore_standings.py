"""SportScore official standings through sources.run_due, PostgreSQL and api.standing_rows:
the cases of docs/calculs/09-audit-2026-11/FAILURE_MODES_SPORTSCORE.md §3 (sportscore_cases.py).
The widget answers from memory; the end-to-end replay of the same cases over HTTPS and the read
API is the VI-27 track's script."""

import os
from pathlib import Path
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from vega import sources
from vega.sources import SourceError, sportscore
from sportscore_cases import CASES
import sportscore_replay as replay

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_SOURCES_TEST_DSN")


@unittest.skipUnless(DSN and psycopg, "requires disposable local sources DB and psycopg")
class SportScoreStandingsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import Store, connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_sources_test":
            raise RuntimeError("dedicated local sources DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        with cls.db.transaction():
            replay.build(cls.db, Store(cls.db))

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def test_every_case(self):
        for index, case in enumerate(CASES, 1):
            flipped = False
            for number, step in enumerate(case["steps"]):
                with self.subTest(case=case["id"], step=number, note=case["note"]):
                    for event in step["before"]:
                        replay.apply(self.db, index, event)
                        flipped |= event[0] == "flip"

                    def get(url, body=step["body"]):
                        answer = replay.widget(body, replay.slug_of(url))
                        if isinstance(answer, int):
                            raise SourceError(f"HTTP_{answer}")
                        return answer

                    code = replay.play(sources, sportscore, self.db, case, step, get)
                    seen = replay.observe(self.db, index, case, code, flipped)
                    self.assertEqual(replay.compare(step["expect"], seen), {})
        # A refusal names what it refused, for whoever reads ops.parse_failures (S4).
        rows = self.db.execute(
            "SELECT error_code, message FROM ops.parse_failures WHERE message LIKE %s", ("sportscore:standings:l_0ALvwF:%",)
        ).fetchall()
        self.assertEqual([r[0] for r in rows], ["UNMATCHED_TEAMS"])
        self.assertIn("Ghost Wanderers", rows[0][1])
        self.assertIn("Harbour United", rows[0][1])


if __name__ == "__main__":
    unittest.main()
