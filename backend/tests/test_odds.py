"""Bookmakers' odds of the coming matches (vega/sources/odds.py), against small synthetic
responses: reading them, naming the match, keeping the latest and the opening prices."""
from datetime import datetime, timezone
import os
from pathlib import Path
import sys
import unittest
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from vega.sources import SourceError, odds

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_SOURCES_TEST_DSN")
NOW = datetime(2026, 11, 15, 8, tzinfo=timezone.utc)


def event(ident, home, away, kickoff, books):
    return {"id": ident, "sport_key": "soccer_france_ligue_one", "commence_time": kickoff, "home_team": home, "away_team": away,
            "bookmakers": [{"key": key, "title": title, "last_update": "2026-11-15T07:00:00Z",
                            "markets": [{"key": "h2h", "outcomes": [{"name": home, "price": h}, {"name": away, "price": a}, {"name": "Draw", "price": d}]}]}
                           for key, title, h, d, a in books]}


class PureTest(unittest.TestCase):
    def test_no_key_nothing_due(self):
        os.environ.pop("V2_ODDS_API_KEY", None)
        self.assertEqual(odds.scopes(NOW), {})
        os.environ["V2_ODDS_API_KEY"] = "test"
        try:
            due = odds.scopes(NOW)
            self.assertEqual(len(due), len(odds.LEAGUES))
            self.assertEqual(due["odds:soccer_france_ligue_one"].total_seconds(), 24 * 3600)
        finally:
            os.environ.pop("V2_ODDS_API_KEY", None)

    def test_a_response_is_read_by_outcome_name(self):
        body = [event("e1", "Troyes", "Le Havre", "2026-11-20T19:45:00Z", [("betclic_fr", "Betclic", 2.0, 3.4, 3.5)])]
        body[0]["bookmakers"].append({"key": "broken", "markets": [{"key": "h2h", "outcomes": [{"name": "Troyes", "price": 2.0}]}]})
        [(ident, kickoff, home, away, books)] = odds.parse(body)
        self.assertEqual((ident, home, away, kickoff.hour), ("e1", "Troyes", "Le Havre", 19))
        self.assertEqual(books, [("betclic_fr", "Betclic", datetime(2026, 11, 15, 7, tzinfo=timezone.utc), 2.0, 3.4, 3.5)])
        with self.assertRaises(SourceError):
            odds.parse({"message": "quota"})

    def test_two_spellings_of_one_club(self):
        self.assertTrue(odds.same_club("Paris Saint Germain", "Paris Saint-Germain"))
        self.assertTrue(odds.same_club("Troyes", "ESTAC Troyes"))
        self.assertFalse(odds.same_club("Paris FC", "Paris Saint-Germain"))
        self.assertFalse(odds.same_club("", "Lens"))


@unittest.skipUnless(DSN and psycopg, "requires disposable local sources DB and psycopg")
class OddsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_sources_test":
            raise RuntimeError("dedicated local sources DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        x = cls.db.execute
        x("INSERT INTO core.countries(code) VALUES ('FRA')")
        x("INSERT INTO core.seasons(id, label) VALUES (2026, '2026/2027') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.competitions(id, name, country_code, kind) VALUES (30, 'Ligue 1', 'FRA', 'league')")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label) VALUES (30, 30, 2026, '2026/2027')")
        x("INSERT INTO core.teams(id, name, country_code) VALUES (1, 'Troyes', 'FRA'), (2, 'Le Havre', 'FRA'), (3, 'Lens', 'FRA'), (4, 'Nice', 'FRA')")
        x("SELECT core.ensure_season_partitions(2026)")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
             VALUES (500, 30, 2026, 'pitchapi', 'not_started', 1, 2, '2026-11-20T19:45:00Z', '2026-11-20'),
                    (501, 30, 2026, 'pitchapi', 'not_started', 3, 4, '2026-11-21T16:00:00Z', '2026-11-21')""")

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def test_odds_are_linked_and_kept_with_their_opening_line(self):
        os.environ["V2_ODDS_API_KEY"] = "test-key"
        try:
            calls = []

            def get(url):
                query = parse_qs(urlparse(url).query)
                calls.append((urlparse(url).path, query["regions"], query["markets"]))
                return responses.pop(0)

            responses = [[
                event("e1", "ESTAC Troyes", "Le Havre AC", "2026-11-20T19:45:00Z", [("betclic_fr", "Betclic", 2.0, 3.4, 3.5), ("winamax_fr", "Winamax", 1.95, 3.35, 3.6)]),
                event("e9", "Monaco", "Lille", "2026-11-22T20:00:00Z", [("betclic_fr", "Betclic", 2.1, 3.3, 3.2)]),  # no such match
            ], [
                event("e1", "ESTAC Troyes", "Le Havre AC", "2026-11-20T19:45:00Z", [("betclic_fr", "Betclic", 1.9, 3.5, 3.8)]),
            ]]
            with self.db.transaction():
                self.assertEqual(odds.run(self.db, get, "odds:soccer_france_ligue_one", NOW), (2, 1))
            self.assertEqual(calls[0], ("/v4/sports/soccer_france_ligue_one/odds/", ["fr"], ["h2h"]))
            self.assertEqual(self.db.execute("SELECT entity_id FROM core.provider_ids WHERE entity_type='match' AND provider='oddsapi' AND provider_key='e1'").fetchone(), (500,))
            # A second read moves the latest prices; the opening ones stay.
            with self.db.transaction():
                self.assertEqual(odds.run(self.db, get, "odds:soccer_france_ligue_one", NOW), (1, 0))
            row = self.db.execute("SELECT home, draw, away, first_home, first_away FROM core.match_odds WHERE match_id=500 AND bookmaker='betclic_fr'").fetchone()
            self.assertEqual(tuple(round(v, 2) for v in row), (1.9, 3.5, 3.8, 2.0, 3.5))
            chances = self.db.execute("SELECT home_chance + draw_chance + away_chance FROM api.match_odds WHERE match_key=500").fetchall()
            self.assertTrue(all(abs(c - 1) < 1e-9 for (c,) in chances))
        finally:
            os.environ.pop("V2_ODDS_API_KEY", None)


if __name__ == "__main__":
    unittest.main()
