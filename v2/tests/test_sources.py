"""Source adapters other than PitchAPI, against small synthetic response samples."""

import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega_v2 import sources
from vega_v2.sources import SourceError, cups, curated, fifa, honours, normalize, sportscore, uefa, wikidata
sys.path.insert(0, str(ROOT / "tests"))
from cup_samples import SAMPLES

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_SOURCES_TEST_DSN")
NOW = datetime(2026, 11, 9, 8, tzinfo=timezone.utc)


def uefa_page(members, total, updated="2026-11-06T22:00:00Z"):
    return {"data": {"members": members, "lastUpdateDate": updated}, "meta": {"collection": {"totalElements": total}}}


def club(ident, name, country, position, value, official=None):
    return {"member": {"id": ident, "displayName": name, "countryCode": country, "displayOfficialName": official,
                       "logoUrl": f"https://img.uefa.com/{ident}.png"},
            "overallRanking": {"position": position, "totalValue": value, "totalPoints": value - 1, "numberOfTeamsStillInPlaying": 1},
            "seasonRankings": [{"seasonYear": 2027, "totalPoints": 9.5, "nationalAssociationPoints": 2.0, "numberOfTeamsStillInPlaying": 1}]}


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

    def test_curated_club_aliases_match_main(self):
        text = (ROOT.parent / "dashboard/scripts/collect_rankings.py").read_text()
        body = re.search(r"aliases=(\{.*?\})\n", text).group(1)
        self.assertEqual(dict(re.findall(r"'([^']+)':'([^']+)'", body)), curated.CLUB_ALIASES)

    def test_sportscore_leagues_match_the_site(self):
        text = (ROOT.parent / "dashboard/frontend/src/services/sportscore-standings.js").read_text()
        body = re.search(r"SPORTSCORE_LEAGUES = Object\.freeze\(\{(.*?)\}\);", text, re.S).group(1)
        self.assertEqual(dict(re.findall(r'(l_[A-Za-z0-9]{6}): "([a-z0-9-]+)"', body)), sportscore.LEAGUES)

    def test_cup_editions_match_main(self):
        # The editions main refreshes (scripts/aws_refresh_sources.mjs) and its national cup archives.
        text = (ROOT.parent / "dashboard/scripts/aws_refresh_sources.mjs").read_text()
        archives = (ROOT.parent / "dashboard/frontend/src/services/cup-archives.js").read_text()
        self.assertEqual(re.findall(r'key: "([a-z-]+)"', archives), list(cups.NATIONAL_CUP_ARCHIVES))
        before = text.split('jobs.push(["open-cups", { competition: "world-cup-history"')[0]
        years = before.rsplit("for (const season of [", 1)[1]
        self.assertEqual(tuple(re.findall(r'"(\d{4})"', years)), cups.WORLD_CUP_YEARS)
        for kind, competition, season in cups.EDITIONS:
            if competition.endswith("-archive"):
                continue
            self.assertIn(competition, text)
            self.assertIn(f'"{season}"', text)

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
            ("MEN_CLUB", 2027, 1): uefa_page([club(10, "Lyon", "FRA", 9, 80.5), club(11, "Atletico de Madrid", "ESP", 5, 95.0)], 5),
            ("MEN_CLUB", 2027, 2): uefa_page([club(12, "Racing", "FRA", 60, 12.0), club(13, "Celta Vigo", "ESP", 120, 8.5),
                                              club(14, "R. Sociedad", "ESP", 30, 40.0, official="Real Sociedad")], 5),
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
        self.assertEqual(links["14"], 5)  # by its official UEFA name
        self.assertEqual(self.db.execute(
            "SELECT rows_written, unmatched, status FROM ops.source_runs WHERE scope='uefa_clubs:2027'"
        ).fetchone(), (5, 2, "ok"))
        # The facts the site reads: the source's name, id, logo, earned points, each season.
        self.assertEqual(self.db.execute(
            """SELECT r.provider_key, r.entity_name, r.earned_points, r.teams_still_playing, a.source_url, s.season_year, s.points
               FROM core.ranking_rows r JOIN core.ranking_editions e ON e.id=r.edition_id AND e.kind='uefa_clubs'
               LEFT JOIN core.assets a ON a.id=r.image_asset_id
               LEFT JOIN core.ranking_season_points s ON s.edition_id=r.edition_id AND s.row_no=r.row_no WHERE r.team_id=1"""
        ).fetchone(), ("10", "Lyon", 79.5, 1, "https://img.uefa.com/10.png", 2027, 9.5))
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
        self.assertEqual(sources.run_due(self.db, None, NOW, names={"vega"}), {("vega", scope): "ok" for scope in ("player_aliases", "club_aliases", "stadium_plans", "league_zones", "cup_logos", "sportscore_ids", "country_names", "team_identity")})
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

    def test_sportscore_official_tables(self):
        from vega_v2.store import Store

        x = self.db.execute
        with self.db.transaction():
            Store(self.db).season("2025/2026")
        x("INSERT INTO core.competitions(id, name, country_code, kind) VALUES (70, 'Ligue 1', 'FRA', 'league')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','pitchapi','l_3FJFUl',70)")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current) VALUES (70, 70, 2025, '2025/2026', true)")
        x("""INSERT INTO core.teams(id, name, short_name, country_code) VALUES (30, 'Paris Saint-Germain', 'PSG', 'FRA'),
             (31, 'Olympique de Marseille', 'Marseille', 'FRA'), (32, 'AS Monaco', NULL, 'FRA')""")
        x("INSERT INTO core.team_seasons(team_id, competition_season_id) SELECT id, 70 FROM core.teams WHERE id IN (30, 31, 32)")
        table = [{"team": "Paris Saint Germain", "pos": 1, "p": 12, "w": 9, "d": 2, "l": 1, "gf": 30, "ga": 8, "gd": 22, "pts": 29},
                 {"team": "Marseille", "pos": 2, "p": 12, "w": 8, "d": 2, "l": 2, "gf": 25, "ga": 12, "gd": 13, "pts": 26},
                 {"team": "Monaco FC", "pos": 3, "p": 12, "w": 7, "d": 3, "l": 2, "gf": 20, "ga": 11, "gd": 9, "pts": 24}]
        payload = {"sport": "football", "competition_slug": "french-ligue-1", "competition": "Ligue 1", "tables": [{"group": "", "rows": table}]}
        calls = []

        def get(url):
            calls.append(url)
            if "slug=french-ligue-1" not in url:
                raise AssertionError("only the collected competition is called")
            return json.loads(json.dumps(payload))

        def standings():
            return x("SELECT team_id, position, points FROM core.standings_official WHERE competition_season_id=70 ORDER BY position").fetchall()

        def version():
            row = x("SELECT version FROM ops.resource_versions WHERE resource_kind='competition_season' AND resource_id=70").fetchone()
            return row and row[0]

        with self.db.transaction():
            self.assertEqual(sportscore.run(self.db, get, "standings:l_3FJFUl", NOW), (3, 0))
        # Name, short name, and Monaco as the last team left.
        self.assertEqual(standings(), [(30, 1, 29), (31, 2, 26), (32, 3, 24)])
        published = version()
        with self.db.transaction():
            self.assertEqual(sportscore.run(self.db, get, "standings:l_3FJFUl", NOW), (0, 0))
        self.assertEqual(version(), published)  # unchanged table: no new publication
        # Another league without a current v2 edition: no call at all.
        with self.db.transaction():
            self.assertEqual(sportscore.run(self.db, get, "standings:l_4WFCIZ", NOW), (0, 0))
        self.assertEqual(len(calls), 2)
        # A table naming clubs of another season: nothing official is kept.
        table[1]["team"], table[2]["team"] = "Paris FC", "Le Havre"
        with self.db.transaction():
            self.assertEqual(sportscore.run(self.db, get, "standings:l_3FJFUl", NOW), (0, 2))
        self.assertEqual(standings(), [])
        self.assertGreater(version(), published)
        payload["competition_slug"] = "other"
        with self.assertRaises(SourceError):
            sportscore.run(self.db, get, "standings:l_3FJFUl", NOW)

    def test_wikidata_clubs_stadiums_portraits_and_plans(self):
        from vega_v2.store import Store

        x = self.db.execute
        with self.db.transaction():
            Store(self.db).season("2025/2026")
        x("INSERT INTO core.countries(code) VALUES ('ESP') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.competitions(id, name) VALUES (80, 'Liga Test')")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, is_current) VALUES (80, 80, 2025, true)")
        x("INSERT INTO core.teams(id, name, country_code) VALUES (40, 'Club Un', 'FRA'), (41, 'Club Bis', 'ESP')")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
             ('team','pitchapi','t_club40',40), ('team','pitchapi','t_club41',41), ('team','uefa','777',40)""")
        x("INSERT INTO core.team_seasons(team_id, competition_season_id) VALUES (40, 80), (41, 80)")
        x("INSERT INTO core.matches(id, competition_season_id, season_id, source, home_team_id, away_team_id) VALUES (900, 80, 2025, 'pitchapi', 41, 40)")
        x("INSERT INTO core.coaches(id, name) VALUES (90, 'Coach B')")
        x("INSERT INTO core.lineups(season_id, match_id, team_id, side, coach_id) VALUES (2025, 900, 41, 'home', 90)")
        photo = {"url": "https://upload.wikimedia.org/wikipedia/commons/a/a1/A.jpg", "sourceUrl": "https://commons.wikimedia.org/wiki/File:A.jpg",
                 "author": "Someone", "license": "CC BY-SA 4.0"}
        answers = {
            ("club", "777"): {"sourceUrl": "https://www.wikidata.org/entity/Q1", "fetchedAt": "2026-11-09T08:00:00.000Z", "stadium": "Stade A",
                              "stadiumId": "Q11", "stadiumAlias": None, "coach": {"name": "Coach A", "photo": photo}, "founded": "1950"},
            ("identity", "Club Bis", "ESP"): "Q2",
            ("club", "Q2"): {"sourceUrl": "https://www.wikidata.org/entity/Q2", "fetchedAt": "2026-11-09T08:00:00.000Z", "stadium": None,
                             "stadiumId": None, "stadiumAlias": None, "coach": {"name": "Coach B", "photo": None}, "founded": None},
            ("stadium", "Q11"): {"id": "Q11", "sourceUrl": "https://www.wikidata.org/wiki/Q11", "fetchedAt": "2026-11-09T08:00:00.000Z",
                                 "capacity": 40000, "capacityAsOf": "2019", "opened": "1998-01-28", "created": None,
                                 "coordinates": {"lat": 48.84, "lon": 2.25}},
            ("portraits", '["Coach B"]'): {"Coach B": dict(photo, url="https://upload.wikimedia.org/wikipedia/commons/b/b1/B.jpg")},
            ("plans",): {"Q11": [{"title": "Plan", "source": "Club Un", "url": "https://club.example/plan", "format": "Plan"}],
                         "Q999": [{"title": "Elsewhere", "url": "https://x.example"}]},
        }
        calls = []

        def fake(command, *args):
            calls.append((command, *args))
            return answers.get((command, *args))

        original, wikidata.bridge = wikidata.bridge, fake
        try:
            results = sources.run_due(self.db, None, NOW, names={"wikidata"})
            self.assertEqual(results, {("wikidata", "clubs"): "ok", ("wikidata", "stadiums"): "ok", ("wikidata", "portraits"): "ok"})
            with self.db.transaction():
                self.assertEqual(curated.stadium_plans(self.db), (1, 1))  # Q999 is not a known stadium yet
        finally:
            wikidata.bridge = original
        # The UEFA id is used as it is; the club without one is resolved by name and country.
        self.assertIn(("club", "777"), calls)
        self.assertIn(("identity", "Club Bis", "ESP"), calls)
        self.assertEqual(x("SELECT founded_year, (SELECT provider_key FROM core.provider_ids WHERE entity_type='team' AND provider='wikidata' AND entity_id=40) FROM core.teams WHERE id=40").fetchone(), (1950, "Q1"))
        self.assertEqual(x("""SELECT v.name, v.capacity, v.capacity_observed, v.opened, v.latitude::numeric(5,2)::float8 FROM core.teams t
                              JOIN core.venues v ON v.id=t.home_venue_id WHERE t.id=40""").fetchone(), ("Stade A", 40000, "2019", "1998-01-28", 48.84))
        coaches = x("""SELECT t.team_id, c.name, a.source_url FROM core.team_coach_tenures t JOIN core.coaches c ON c.id=t.coach_id
                       LEFT JOIN core.assets a ON a.id=c.photo_asset_id WHERE t.end_date IS NULL ORDER BY 1""").fetchall()
        self.assertEqual(coaches, [(40, "Coach A", photo["url"]), (41, "Coach B", "https://upload.wikimedia.org/wikipedia/commons/b/b1/B.jpg")])
        self.assertEqual(x("SELECT title, url FROM core.venue_plans").fetchall(), [("Plan", "https://club.example/plan")])
        # Fetched this week: nothing is due again an hour later.
        calls.clear()
        wikidata.bridge = fake
        try:
            sources.run_due(self.db, None, NOW + timedelta(hours=2), names={"wikidata"})
        finally:
            wikidata.bridge = original
        self.assertEqual(calls, [])

    def test_cup_editions_typed_and_kept_on_failure(self):
        x = self.db.execute
        answers = {}
        for kind, competition, season, body in SAMPLES:
            from urllib.parse import urlencode
            query = urlencode({"competition": competition, "season": season} if kind != "nations-results" else {"season": season})
            answers[(kind, query)] = {"status": 200, "body": body}
        original, cups.bridge = cups.bridge, lambda command, kind, query: answers.get((kind, query), {"status": 502, "body": None})
        try:
            done = sources.run_due(self.db, None, NOW, names={"openfootball", "openligadb", "international_results"})
            self.assertEqual(done[("openfootball", "open-cups:euro:2024")], "ok")
            self.assertEqual(done[("openfootball", "open-cups:euro:2020")], "HTTP_502")  # not in the answers
            self.assertEqual(x("SELECT rows_written FROM ops.source_runs WHERE scope='open-cups:euro:2024'").fetchone(), (3,))
            rows = x("""SELECT m.home_score, m.away_score, m.home_score_90, m.home_score_et, m.home_penalty_score, s.label
                        FROM core.matches m JOIN core.seasons s ON s.id=m.season_id JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
                        WHERE cs.cup_key='open-cups:euro:2024' ORDER BY m.archive_position""").fetchall()
            # Euro 2024 belongs to 2023/2024; a match decided after extra time keeps its 90-minute score.
            self.assertEqual(rows, [(5, 1, None, None, None, "2023/2024"), (0, 0, 0, 0, 3, "2023/2024"), (2, 1, None, None, None, "2023/2024")])
            # Unchanged content: nothing rewritten. A failing source keeps the edition.
            later = NOW + timedelta(days=8)
            self.assertEqual(sources.run_due(self.db, None, later, names={"openfootball"})[("openfootball", "open-cups:euro:2024")], "ok")
            self.assertEqual(x("SELECT rows_written FROM ops.source_runs WHERE scope='open-cups:euro:2024'").fetchone(), (0,))
            answers.clear()
            sources.run_due(self.db, None, NOW + timedelta(days=16), names={"openfootball"})
            self.assertEqual(x("SELECT count(*) FROM api.cup_matches m JOIN api.cup_editions e USING (competition_season_id) WHERE e.season='2024'").fetchone(), (3,))
        finally:
            cups.bridge = original

    def test_player_honours(self):
        from vega_v2.store import Store

        x = self.db.execute
        with self.db.transaction():
            Store(self.db).season("2025/2026")
        x("INSERT INTO core.competitions(id, name) VALUES (85, 'Liga H')")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id) VALUES (85, 85, 2025)")
        x("INSERT INTO core.teams(id, name) VALUES (85, 'Inter Miami')")
        x("INSERT INTO core.players(id, name) VALUES (60, 'Lionel Messi'), (61, 'Common Name')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player','pitchapi','p_1mZO3B',60), ('player','pitchapi','p_other2',61)")
        x("INSERT INTO core.matches(id, competition_season_id, season_id, source, match_date) VALUES (950, 85, 2025, 'pitchapi', '2025-10-01')")
        x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2025, 950, 85, 60, 90), (2025, 950, 85, 61, 90)")
        body = {"available": True, "source": "Wikipédia", "identitySourceUrl": "https://www.wikidata.org/wiki/Q615",
                "sourceUrl": "https://en.wikipedia.org/w/index.php?title=Lionel_Messi&oldid=1#Honours", "revision": 1, "fetchedAt": "2026-11-09T08:00:00+00:00",
                "honours": [{"name": "FIFA World Cup", "team": "Argentina", "category": "team", "seasons": ["2022"]},
                            {"name": "Ballon d'Or", "team": None, "category": "individual", "seasons": ["2009", "2010"]}]}
        seen = []

        def fake(name, observations):
            seen.append((name, observations))
            return body if name == "Lionel Messi" else None

        original, honours.collect = honours.collect, fake
        try:
            self.assertEqual(sources.run_due(self.db, None, NOW, names={"wikimedia"}), {("wikimedia", "players"): "ok"})
        finally:
            honours.collect = original
        self.assertEqual(seen[0], ("Lionel Messi", [{"team": "Inter Miami", "date": "2025-10-01"}]))  # Messi first
        self.assertEqual(x("SELECT category, name, team, seasons FROM core.player_honour_titles WHERE player_id=60 ORDER BY seq").fetchall(),
                         [("team", "FIFA World Cup", "Argentina", ["2022"]), ("individual", "Ballon d'Or", None, ["2009", "2010"])])
        self.assertEqual(x("SELECT provider_key FROM core.provider_ids WHERE entity_type='player' AND provider='wikidata' AND entity_id=60").fetchone(), ("Q615",))
        self.assertEqual(x("SELECT honours_fetched_at IS NULL, honours_checked_at IS NOT NULL FROM core.players WHERE id=61").fetchone(), (True, True))
        self.assertEqual(x("SELECT rows_written, unmatched FROM ops.source_runs WHERE source='wikimedia'").fetchone(), (1, 1))


if __name__ == "__main__":
    unittest.main()
