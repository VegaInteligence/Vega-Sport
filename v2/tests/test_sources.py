"""Source adapters other than PitchAPI, against small synthetic response samples."""

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega_v2 import sources
from vega_v2.sources import SourceError, curated, fifa, normalize, uefa

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_SOURCES_TEST_DSN")
NOW = datetime(2026, 11, 9, 8, tzinfo=timezone.utc)


def uefa_page(members, total, updated="2026-11-06T22:00:00Z"):
    return {"data": {"members": members, "lastUpdateDate": updated}, "meta": {"collection": {"totalElements": total}}}


def club(ident, name, country, position, value):
    return {"member": {"id": ident, "displayName": name, "countryCode": country},
            "overallRanking": {"position": position, "totalValue": value, "totalPoints": value - 1}}


class FakeSource:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    def __call__(self, url):
        query = parse_qs(urlparse(url).query)
        key = (query["coefficientType"][0], int(query["seasonYear"][0]), int(query["page"][0]))
        self.calls.append(key)
        if key not in self.pages:
            raise SourceError("HTTP_404")
        return json.loads(json.dumps(self.pages[key]))


class PureTest(unittest.TestCase):
    def test_normalize_and_scopes(self):
        self.assertEqual(normalize("Atlético  de Madrid"), "atleticodemadrid")
        self.assertEqual(sorted(uefa.scopes(NOW)), sorted([
            "uefa_clubs:2027", "uefa_associations:2027", "uefa_clubs:2026", "uefa_associations:2026",
        ]))

    def test_curated_aliases_match_the_site(self):
        # dashboard/shared/player-aliases.js: `const ALIASES = Object.freeze({ key: Object.freeze([...]) })`.
        text = (ROOT.parent / "dashboard/shared/player-aliases.js").read_text()
        body = re.search(r"const ALIASES = Object\.freeze\(\{(.*?)\}\);", text, re.S).group(1)
        site = {key: tuple(re.findall(r'"([^"]+)"', values)) for key, values in re.findall(r"(p_[A-Za-z0-9]{6}): Object\.freeze\(\[(.*?)\]\)", body)}
        self.assertEqual(site, curated.PLAYER_ALIASES)

    def test_pagination_must_be_complete(self):
        get = FakeSource({("MEN_CLUB", 2027, 1): uefa_page([club(1, "A", "FRA", 1, 10)], 3)})
        with self.assertRaises(SourceError):
            uefa.fetch(get, "uefa_clubs", 2027)


@unittest.skipUnless(DSN and psycopg, "requires disposable local sources DB and psycopg")
class UefaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega_v2.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_sources_test":
            raise RuntimeError("dedicated local sources DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        x = cls.db.execute
        x("INSERT INTO core.countries(code) VALUES ('FRA'), ('ESP')")
        x("""INSERT INTO core.teams(id, name, country_code) VALUES
             (1, 'Olympique Lyonnais', 'FRA'), (2, 'Atlético de Madrid', 'ESP'),
             (3, 'Racing', 'FRA'), (4, 'Racing', 'FRA'), (5, 'Real Sociedad', 'ESP')""")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id)
             SELECT 'team', 'pitchapi', 't_aaaaa' || id, id FROM core.teams""")
        x("INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source) VALUES ('team', 1, 'Lyon', 'lyon', 'alias', 'wikidata')")
        x("SELECT setval(pg_get_serial_sequence('core.teams', 'id'), 100)")

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def test_coefficients_linking_and_reconciliation(self):
        pages = {
            ("MEN_CLUB", 2027, 1): uefa_page([club(10, "Lyon", "FRA", 9, 80.5), club(11, "Atletico de Madrid", "ESP", 5, 95.0)], 4),
            ("MEN_CLUB", 2027, 2): uefa_page([club(12, "Racing", "FRA", 60, 12.0), club(13, "Celta Vigo", "ESP", 120, 8.5)], 4),
            ("MEN_ASSOCIATION", 2027, 1): uefa_page([{"member": {"id": 1, "displayName": "France", "countryCode": "FRA"}, "overallRanking": {"position": 5, "totalValue": 72.3}}], 1),
        }
        get = FakeSource(pages)
        results = sources.run_due(self.db, get, NOW, names={"uefa"})
        self.assertEqual(results[("uefa", "uefa_clubs:2027")], "ok")
        self.assertEqual(results[("uefa", "uefa_associations:2027")], "ok")
        self.assertEqual(results[("uefa", "uefa_clubs:2026")], "HTTP_404")  # an error is recorded, the others ran
        links = dict(self.db.execute(
            "SELECT provider_key, entity_id FROM core.provider_ids WHERE provider='uefa' ORDER BY 1"
        ).fetchall())
        # Alias "Lyon" (FRA) and accents (ESP) link; two "Racing" in France are ambiguous; Celta is unknown.
        self.assertEqual((links["10"], links["11"]), (1, 2))
        self.assertNotIn(links["12"], (3, 4))
        self.assertGreater(links["13"], 100)
        self.assertEqual(self.db.execute(
            "SELECT rows_written, unmatched, status FROM ops.source_runs WHERE scope='uefa_clubs:2027'"
        ).fetchone(), (4, 2, "ok"))
        points = dict(self.db.execute(
            "SELECT r.team_id, r.points FROM core.ranking_rows r JOIN core.ranking_editions e ON e.id=r.edition_id WHERE e.kind='uefa_clubs' AND e.is_current"
        ).fetchall())
        self.assertAlmostEqual(points[1], 80.5)
        self.assertEqual(self.db.execute(
            "SELECT country_code, position FROM core.ranking_rows r JOIN core.ranking_editions e ON e.id=r.edition_id WHERE e.kind='uefa_associations'"
        ).fetchall(), [("FRA", 5)])
        # Run again the same day: nothing is due.
        self.assertNotIn(("uefa", "uefa_clubs:2027"), sources.run_due(self.db, get, NOW, names={"uefa"}))
        # PitchAPI now observes Celta: the UEFA-only club merges into it, rows follow.
        self.db.execute("INSERT INTO core.teams(id, name, country_code) VALUES (6, 'Celta Vigo', 'ESP')")
        self.db.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','pitchapi','t_celta1',6)")
        celta_uefa_only = links["13"]
        with self.db.transaction():
            self.assertEqual(uefa.reconcile_teams(self.db), 1)
        self.assertEqual(self.db.execute("SELECT entity_id FROM core.provider_ids WHERE provider='uefa' AND provider_key='13'").fetchone()[0], 6)
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.ranking_rows WHERE team_id=6").fetchone()[0], 1)
        self.assertIsNone(self.db.execute("SELECT 1 FROM core.teams WHERE id=%s", (celta_uefa_only,)).fetchone())

    def test_curated_aliases(self):
        x = self.db.execute
        x("INSERT INTO core.players(id, name) VALUES (50, 'Cristiano Ronaldo'), (51, 'Cristiano Ronaldo')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player','pitchapi','p_3yEwhj',50), ('player','pitchapi','p_other1',51)")
        x("INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source) VALUES ('player', 50, 'Old', 'old', 'alias', 'vega'), ('player', 50, 'CR', 'cr', 'alias', 'wikidata')")
        self.assertEqual(sources.run_due(self.db, None, NOW, names={"vega"}), {("vega", "player_aliases"): "ok"})
        names = self.db.execute("SELECT entity_id, normalized, source::text FROM core.entity_names WHERE entity_type='player' ORDER BY 1, 2").fetchall()
        # The homonym gets nothing; the removed Vega alias goes; Wikidata's stays.
        self.assertEqual(names, [(50, "cr", "wikidata"), (50, "cr7", "vega")])

    def test_fifa_editions(self):
        x = self.db.execute
        x("INSERT INTO core.countries(code) VALUES ('FRA') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.teams(id, name, country_code, is_national) VALUES (20, 'France', 'FRA', true)")
        dates = [{"id": "FRS_Male_Football_20261007", "date": "2026-10-07"}, {"id": "id14870", "date": "2025-09-18"},
                 {"id": "FRS_future", "date": "2027-01-01"}, {"id": "id2", "date": "1993-08-08"}]
        page = '<html><script id="__NEXT_DATA__" type="application/json">' + json.dumps(
            {"props": {"pageProps": {"pageData": {"ranking": {"allAvailableDates": dates}}}}}) + "</script></html>"
        overview = {"rankings": [
            {"rankingItem": {"idTeam": "43969", "name": "Spain", "countryCode": "ESP", "rank": 1, "previousRank": 2, "totalPoints": 1875.37}},
            {"rankingItem": {"idTeam": "43946", "name": "France", "countryCode": "FRA", "rank": 2, "previousRank": 1, "totalPoints": 1870.0}},
        ]}
        native = {"Results": [
            {"IdTeam": "43946", "TeamName": [{"Description": "France"}], "IdCountry": "FRA", "Rank": 1, "PrevRank": 2, "TotalPoints": 2011.5},
            {"IdTeam": "43969", "TeamName": [{"Description": "Spain"}], "IdCountry": "ESP", "Rank": 2, "PrevRank": 0, "TotalPoints": 1995.8},
        ]}
        calls = []

        def get(url, as_text=False):
            calls.append(url)
            if url == fifa.PAGE:
                return page
            query = parse_qs(urlparse(url).query)
            if url.startswith(fifa.OVERVIEW):
                return overview if query["dateId"] == ["id14870"] else {"rankings": []}
            if url.startswith(fifa.SCHEDULE):
                return native
            raise SourceError("HTTP_404")

        self.assertEqual(sources.run_due(self.db, get, NOW, names={"fifa"}), {("fifa", "fifa_men:editions"): "ok"})
        editions = x("SELECT label, is_current FROM core.ranking_editions WHERE kind='fifa_men' ORDER BY label").fetchall()
        self.assertEqual(editions, [("2025-09-18", False), ("2026-10-07", True)])  # 1993 and the future are left out
        rows = x("""SELECT r.position, r.previous_position, r.team_id, r.country_code FROM core.ranking_rows r
                    JOIN core.ranking_editions e ON e.id = r.edition_id WHERE e.label = '2026-10-07' ORDER BY r.position""").fetchall()
        # France is the national team (not the club of the same country); Spain keeps its code; no previous rank 0.
        self.assertEqual(rows, [(1, 2, 20, None), (2, None, None, "ESP")])
        self.assertEqual(x("SELECT entity_id FROM core.provider_ids WHERE provider='fifa' AND provider_key='43946'").fetchone(), (20,))
        self.assertEqual(x("SELECT rows_written, unmatched FROM ops.source_runs WHERE source='fifa'").fetchone(), (4, 2))
        # Published editions are not read again.
        calls.clear()
        later = NOW.replace(day=NOW.day + 1)
        sources.run_due(self.db, get, later, names={"fifa"})
        self.assertEqual(calls, [fifa.PAGE])


if __name__ == "__main__":
    unittest.main()
