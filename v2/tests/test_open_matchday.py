"""open-matchday competitions (real files of github.com/oladeeayo/open-matchday, trimmed):
read like main's collector, written as typed matches and team statistics, read back as
main's catalogue rows."""

from datetime import datetime, timezone
import csv
import json
import os
from pathlib import Path
import re
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega_v2.sources import SourceError, open_matchday

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_SOURCES_TEST_DSN")
FIXTURES = ROOT / "tests/fixtures/open_matchday"
NOW = datetime(2026, 11, 9, 6, tzinfo=timezone.utc)


def fake_get(url, as_text=False):
    name = url.removeprefix(open_matchday.RAW)
    if name == "build_summary.json":
        return json.loads((FIXTURES / name).read_text())
    folder, file = name.removeprefix("data/").split("/")
    path = FIXTURES / f"{folder}.{file}"
    if not path.exists():
        raise SourceError("HTTP_404")
    return path.read_text()


class PureTest(unittest.TestCase):
    def test_europe_follows_main(self):
        text = (ROOT.parent / "dashboard/scripts/collect_open_matchday.py").read_text()
        codes = re.search(r"EUROPE = set\('([A-Z ]+)'\.split\(\)\)", text).group(1).split()
        self.assertEqual(set(codes), open_matchday.EUROPE)

    def test_season_label(self):
        self.assertEqual(open_matchday.season_label("2627"), "2026/2027")
        with self.assertRaises(SourceError):
            open_matchday.season_label("26/27")


@unittest.skipUnless(DSN and psycopg, "requires disposable local sources DB and psycopg")
class OpenMatchdayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega_v2.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_sources_test":
            raise RuntimeError("dedicated local sources DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def test_european_competitions_round_trip(self):
        with self.db.transaction():
            written, unmatched = open_matchday.run(self.db, fake_get, "europe", NOW)
        self.assertEqual((written, unmatched), (5 + 3 + 7 + 4, 0))  # Brazil is not European: not read
        editions = self.db.execute("SELECT split_part(cup_key, ':', 2), native_label, cup_name FROM core.competition_seasons ORDER BY 1").fetchall()
        self.assertEqual(editions, [("AUT_CUP_ofb-cup", "2026/2027", "OFB Cup"), ("ENG_1_premier-league", "2026/2027", "Premier League")])
        for folder in ("ENG_1_premier-league", "AUT_CUP_ofb-cup"):
            source = list(csv.DictReader(open(FIXTURES / f"{folder}.results_2627.csv", newline="")))
            rows = self.db.execute(
                "SELECT * FROM api.cup_table_rows WHERE competition=%s AND status='finished' ORDER BY position", (folder,)
            ).fetchall()
            self.assertEqual(len(rows), len(source))
        stats = self.db.execute(
            """SELECT s.period::text, s.total_shots, s.shots_on_target, s.fouls, s.corners, s.yellow_cards, s.red_cards
               FROM core.team_match_stats s JOIN core.matches m ON m.id = s.match_id
               WHERE m.home_team_name = 'Arsenal' AND s.team_id = m.home_team_id ORDER BY 1"""
        ).fetchall()
        self.assertEqual(stats, [("all", 20, 6, 10, 8, 1, 0), ("first_half", None, None, None, 5, None, None), ("second_half", None, None, None, 3, None, None)])
        self.assertEqual(self.db.execute("SELECT revision FROM core.source_revisions WHERE source='open-matchday'").fetchone()[0], "2026-11-09T05:30:38Z")
        # A second read replaces the edition: same matches, no duplicates.
        with self.db.transaction():
            open_matchday.run(self.db, fake_get, "europe", NOW)
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.matches WHERE source='open_matchday'").fetchone()[0], 19)


if __name__ == "__main__":
    unittest.main()
