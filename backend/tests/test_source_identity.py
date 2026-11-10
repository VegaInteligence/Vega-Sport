"""SportsAPI rankings (real captures), the site data of dashboard/shared as rows (zones,
cup logos, SportScore ids) and one team per real team across cup sources."""

from datetime import datetime, timezone
import gzip
import json
import os
from pathlib import Path
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega.sources import curated, identity, sportsapi

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_SOURCES_TEST_DSN")
CAPTURES = ROOT / "tests/fixtures/rankings"
NOW = datetime(2026, 11, 9, 6, tzinfo=timezone.utc)


def capture(kind):
    """The SportsAPI response main read on 2026-11-01, rebuilt from its kept rows."""
    edition = json.loads(gzip.open(CAPTURES / f"raw__rankings__{kind}__2026-11-01.sportsapi.json.gz").read())
    return {"data": [r["sourceRow"] for r in edition["rows"]], "meta": {"updatedAt": edition["sourceUpdatedAt"]}}


class ParseTest(unittest.TestCase):
    def test_real_responses(self):
        rows = sportsapi.parse(capture("fifa-men"))
        self.assertEqual(rows[0], ("293151", "Spain", "ESP", 1, 1, 2011.571862, "https://cdn.sportsapi.app/v2/teams/293151/logo"))
        self.assertEqual(len(sportsapi.parse(capture("uefa-associations"))), 55)
        self.assertEqual(sportsapi.parse(capture("uefa-associations"))[0][:2], ("EN", "England"))
        self.assertEqual(len(sportsapi.parse(capture("uefa-clubs"))), 415)

    def test_country_names_follow_the_site(self):
        import re

        js = (ROOT.parent / "dashboard/frontend/src/services/competition-selector.js").read_text()
        block = js[js.index("export const COUNTRY_NAMES = {"):]
        block = block[:block.index("}")]
        self.assertEqual(dict(re.findall(r'^\s*"?([A-Z0-9-]+)"?:\s*"([^"]+)"', block, re.M)), curated.COUNTRY_NAMES_FR)

    def test_the_top_seven_is_the_site_s_europe_focus(self):
        import re

        scope = (ROOT.parent / "dashboard/shared/competition-scope.js").read_text()
        focus = re.findall(r'\{ id: "(l_[A-Za-z0-9]+)"', scope[scope.index("export const EUROPE_FOCUS = ["):].split("];")[0])
        self.assertEqual(list(curated.EDITORIAL_LISTS["top_seven"][1]), focus[:7])

    def test_national_competitions_are_mains(self):
        import re

        js = (ROOT.parent / "dashboard/frontend/src/services/player-team-seasons.js").read_text()
        block = re.search(r"const NATIONAL_COMPETITIONS = new Set\(\[(.*?)\]\)", js, re.S).group(1)
        # Its other entries are cup-source editions, national by their cup key (identity._candidates).
        self.assertEqual(re.findall(r'"(l_[A-Za-z0-9]+)"', block), list(curated.NATIONAL_COMPETITIONS))
        scopes = list(curated.scopes(NOW))
        self.assertLess(scopes.index("national_teams"), scopes.index("team_identity"))  # the merge reads the flag

    def test_club_core_names(self):
        self.assertEqual(identity.club_core("West Ham United FC"), identity.club_core("West Ham United"))
        self.assertEqual(identity.club_core("1. FC Köln"), "koln")
        self.assertNotEqual(identity.club_core("Racing Club de Lens"), identity.club_core("Racing Club de Strasbourg"))
        # The club-form words are kept apart: they can refuse a match, never make one.
        self.assertEqual(identity.club_parts("CA Bastia"), ("bastia", frozenset({"ca"})))
        self.assertEqual(identity.club_parts("1. FK Příbram"), ("pribram", frozenset({"fc"})))
        self.assertEqual(identity.club_parts("FC"), ("", frozenset({"fc"})))

    def test_archive_teams_are_matched_in_their_country(self):
        exact = {("angleterre", "westhamunited"): {20}, (None, "westhamunited"): {20}, ("france", "scbastia"): {24}, (None, "scbastia"): {24},
                 ("espagne", "racing"): {21, 22}, (None, "racing"): {21, 22}, ("portugal", "fcporto"): {28}}
        core = {("angleterre", "westhamunited"): {20: {frozenset()}}, (None, "westhamunited"): {20: {frozenset()}},
                ("france", "bastia"): {24: {frozenset({"sc"})}}, (None, "bastia"): {24: {frozenset({"sc"})}},
                ("portugal", "porto"): {28: {frozenset({"fc"})}}, ("russie", "krasnodar"): {29: {frozenset({"fc"})}},
                ("italie", "sassuolo"): {30: {frozenset()}}}
        match = lambda name, country: identity.match_archive_team((exact, core), name, country)
        self.assertEqual(match("West Ham United", "angleterre"), 20)
        self.assertEqual(match("West Ham United FC", "angleterre"), 20)  # the form says nothing against
        self.assertEqual(match("West Ham United FC", "europe"), 20)  # a European cup: among every club
        self.assertIsNone(match("West Ham United FC", "ecosse"))  # another country's club
        self.assertIsNone(match("CA Bastia", "france"))  # CA is not SC
        self.assertEqual(match("SC Bastia", "france"), 24)
        self.assertIsNone(match("Bastia", "france"))  # the word PitchAPI keeps tells two clubs apart
        self.assertEqual(match("SC Bastia Calcio", "france"), 24)
        self.assertEqual(match("Porto", "portugal"), 28)  # a reviewed spelling
        self.assertEqual(match("FK Krasnodar", "russie"), 29)  # FK is how some sources write FC
        self.assertEqual(match("US Sassuolo Calcio", "italie"), 30)
        self.assertIsNone(match("Racing", "espagne"))  # two clubs answer
        self.assertIsNone(match("FC", "france"))  # nothing left of the name
        self.assertIsNone(match("West Ham United", ""))

    def test_no_key_no_scope(self):
        os.environ.pop("V2_SPORTSAPI_API_KEY", None)
        self.assertEqual(sportsapi.scopes(NOW), {})


@unittest.skipUnless(DSN and psycopg, "requires disposable local sources DB and psycopg")
class SourceIdentityTest(unittest.TestCase):
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
            Store(cls.db).season("2026/2027")
        x = cls.db.execute
        x("INSERT INTO core.countries(code) VALUES ('ESP'), ('GER'), ('SCO'), ('ITA'), ('ENG')")
        x("""INSERT INTO core.teams(id, name, country_code, is_national) VALUES (1, 'Spain', 'ESP', true), (2, 'Germany', 'GER', true),
             (3, 'Scotland', 'SCO', true), (4, 'Bayern München', 'GER', false)""")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) SELECT 'team', 'pitchapi', 't_aaaaa' || id, id FROM core.teams")
        x("INSERT INTO core.teams(id, name) SELECT 100 + t, 'Club ' || t FROM generate_series(1, 20) t")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) SELECT 'team', 'pitchapi', 't_c' || lpad(id::text, 5, '0'), id FROM core.teams WHERE id > 100")
        # Serie A (l_0ALvwF: 20 teams, 3 relegated) and the World Cup (l_1XLtP0), PitchAPI competitions.
        x("INSERT INTO core.competitions(id, name, kind) VALUES (1, 'Serie A', 'league'), (2, 'World Cup', 'international')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','pitchapi','l_0ALvwF',1), ('competition','pitchapi','l_1XLtP0',2)")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current) VALUES (1, 1, 2026, '2026/2027', true), (2, 2, 2026, '2026', true)")
        x("INSERT INTO core.team_seasons(team_id, competition_season_id) SELECT id, 1 FROM core.teams WHERE id > 100")
        # A PitchAPI match Germany - Scotland.
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score, match_date)
             VALUES (1, 2, 2026, 'pitchapi', 'finished', 2, 3, 5, 1, '2026-06-14')""")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match','pitchapi','m_aaaaa1',1)")
        # UEFA rows the SportsAPI rows are linked through.
        x("INSERT INTO core.ranking_editions(id, kind, provider, label) VALUES (1, 'uefa_clubs', 'uefa', '2025/2026'), (2, 'uefa_associations', 'uefa', '2025/2026')")
        x("INSERT INTO core.ranking_rows(edition_id, row_no, team_id, position, entity_name, provider_key) VALUES (1, 1, 4, 1, 'FC Bayern München', '50037')")
        x("INSERT INTO core.ranking_rows(edition_id, row_no, country_code, position, entity_name, provider_key) VALUES (2, 1, 'ENG', 1, 'England', '1')")
        x("SELECT setval(pg_get_serial_sequence('core.teams', 'id'), 1000)")
        for table in ("matches", "competitions", "competition_seasons", "ranking_editions"):
            x(f"SELECT setval(pg_get_serial_sequence('core.{table}', 'id'), 1000)")

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def test_sportsapi_snapshots_link_like_the_official_sources(self):
        for name, kind in sportsapi.KINDS.items():
            body = capture({"uefa-countries": "uefa-associations"}.get(name, name))  # main's file names
            with self.db.transaction():
                written, unmatched = sportsapi.save(self.db, kind, "2026-11-01", sportsapi.parse(body), sportsapi.BASE + name, body["meta"]["updatedAt"])
            # The known ones only: Spain, Germany, Scotland; England; Bayern.
            self.assertEqual(written, {"fifa_men": 3, "uefa_associations": 1, "uefa_clubs": 1}[kind], kind)
            self.assertEqual(written + unmatched, {"fifa_men": 211, "uefa_associations": 55, "uefa_clubs": 415}[kind])
        rows = self.db.execute(
            """SELECT e.kind::text, r.team_id, r.country_code, r.position FROM core.ranking_rows r JOIN core.ranking_editions e ON e.id = r.edition_id
               WHERE e.provider = 'sportsapi' AND r.position = 1 ORDER BY 1"""
        ).fetchall()
        self.assertEqual(rows, [("fifa_men", 1, None, 1), ("uefa_associations", None, "ENG", 1), ("uefa_clubs", 4, None, 1)])
        self.assertEqual(self.db.execute("SELECT provider_key FROM core.provider_ids WHERE provider='sportsapi' AND entity_id=4").fetchone()[0], "4441")
        # Served under its date; an official edition of the same date is served first.
        self.db.execute("INSERT INTO core.ranking_editions(kind, provider, label) VALUES ('fifa_men', 'fifa', '2026-11-01')")
        served = self.db.execute("SELECT provider, official_edition FROM api.ranking_editions WHERE kind='fifa-men' AND edition='2026-11-01'").fetchall()
        self.assertEqual(served, [("FIFA", True)])
        self.assertEqual(self.db.execute("SELECT provider FROM api.ranking_editions WHERE kind='uefa-clubs' AND edition='2026-11-01'").fetchone()[0], "SportsAPI")

    def test_scopes_naming_provider_ids_are_recorded(self):
        # SportScore scopes carry PitchAPI league ids (upper case): their status rows must be
        # written, and one source's failure must not stop the others (worker log 2026-11-09).
        from vega import sources
        from vega.sources import SourceError

        def unavailable(url, **kwargs):
            raise SourceError("HTTP_503")

        results = sources.run_due(self.db, unavailable, NOW, names={"sportscore"})
        self.assertIn(("sportscore", "standings:l_0ALvwF"), results)
        recorded = self.db.execute("SELECT count(*), count(*) FILTER (WHERE scope ~ '[A-Z]') FROM ops.source_runs WHERE source = 'sportscore'").fetchone()
        self.assertEqual(recorded[0], len(results))
        self.assertGreater(recorded[1], 0)

    def test_shared_site_data_as_rows(self):
        with self.db.transaction():
            curated.league_zones(self.db)
            curated.cup_logos(self.db)
            curated.sportscore_ids(self.db)
        zones = self.db.execute("SELECT zone::text, position_from, position_to FROM core.competition_zones WHERE competition_season_id=1 ORDER BY 2").fetchall()
        self.assertEqual(zones, [("relegation", 18, 20)])  # Serie A: 20 teams, 3 relegated
        logo = self.db.execute("SELECT a.source_url FROM core.competitions c JOIN core.assets a ON a.id = c.logo_asset_id WHERE c.id = 2").fetchone()[0]
        self.assertTrue(logo.startswith("https://img.thesports.com/"))
        slugs = dict(self.db.execute("SELECT entity_id, provider_key FROM core.provider_ids WHERE provider='sportscore'").fetchall())
        self.assertEqual(slugs, {1: "italian-serie-a", 2: "fifa-world-cup"})

    def test_editorial_lists_as_rows(self):
        # Serie A is the only listed entity the seed knows: twelfth league of the title
        # race, fourth of the Top 7; the other entries wait for PitchAPI.
        with self.db.transaction():
            written, unmatched = curated.editorial_lists(self.db)
        self.assertEqual((written, unmatched), (2, 29 + 17 + 6))
        rows = self.db.execute("SELECT list_kind, entity_type, entity_key, seq FROM api.editorial_lists ORDER BY 1").fetchall()
        self.assertEqual(rows, [("title_race_leagues", "competition", "l_0ALvwF", 11), ("top_seven", "competition", "l_0ALvwF", 3)])
        with self.db.transaction():
            self.assertEqual(curated.editorial_lists(self.db), (0, 52))  # nothing changed, nothing written
        # An entry gone from the list goes away.
        with self.db.transaction():
            self.db.execute("INSERT INTO core.editorial_lists(list_kind, entity_type, entity_id, seq) VALUES ('featured_clubs', 'team', 4, 0)")
            curated.editorial_lists(self.db)
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.editorial_lists WHERE list_kind = 'featured_clubs'").fetchone()[0], 0)

    def test_archive_teams_merge_into_the_club_of_their_country(self):
        x = self.db.execute
        x("INSERT INTO core.countries(code) VALUES ('NED'), ('FRA')")
        # PitchAPI clubs.
        x("""INSERT INTO core.teams(id, name, country_code) VALUES (20, 'West Ham United', 'ENG'), (21, 'Racing', 'ESP'), (22, 'Racing', 'ESP'),
             (23, 'Telstar', 'NED'), (24, 'SC Bastia', 'FRA'), (25, 'Wimbledon', 'ENG'), (26, 'Grimsby Town', 'ENG'), (27, 'Rochdale', 'ENG')""")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) SELECT 'team', 'pitchapi', 't_aaaa' || id, id FROM core.teams WHERE id BETWEEN 20 AND 27")
        # Archive teams, keyed as archives.Loader keys them: the country and the name, spaces kept.
        archive = {30: ("angleterre", "West Ham United FC"), 31: ("espagne", "Racing"), 32: ("angleterre", "Leicester City FC"),
                   33: ("pays bas", "SC Telstar"), 34: ("france", "CA Bastia"), 35: ("angleterre", "Wimbledon FC"),
                   36: ("angleterre", "AFC Wimbledon"), 37: ("europe", "Grimsby Town FC"), 38: ("angleterre", "Rochdale AFC"),
                   39: ("angleterre", "Rochdale"), 40: ("angleterre", "West Ham United")}
        from vega import archives

        for team, (country, name) in archive.items():
            x("INSERT INTO core.teams(id, name) VALUES (%s, %s)", (team, name))
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'vega', %s, %s)",
              (f"archive:{country}:{archives.normalize(name)}", team))
        with self.db.transaction():
            from vega.store import Store

            Store(self.db).season("2015/2016")
        x("INSERT INTO core.competitions(id, name) VALUES (50, 'English Premier League')")
        x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, archive_key, archive_name, archive_country)
             VALUES (50, 50, 2015, '2015/2016', '2015-16/en.1', 'English Premier League 2015/16', 'Angleterre')""")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score,
               match_date, archive_key, home_team_name, away_team_name)
             VALUES (50, 50, 2015, 'openfootball', 'finished', 30, 32, 2, 1, '2015-08-09', 'r:2015-16/en.1:0', 'West Ham United FC', 'Leicester City FC'),
                    (51, 50, 2015, 'openfootball', 'finished', 38, 39, 0, 0, '2015-08-10', 'r:2015-16/en.1:1', 'Rochdale AFC', 'Rochdale'),
                    (52, 50, 2015, 'openfootball', 'finished', 40, 32, 1, 1, '2015-08-16', 'r:2015-16/en.1:2', 'West Ham United', 'Leicester City FC')""")
        x("""INSERT INTO core.match_events(season_id, match_id, team_id, seq, event_type, minute, player_name)
             VALUES (2015, 50, 30, 0, 'goal', 12, 'Cheikhou Kouyaté')""")
        x("INSERT INTO core.team_match_stats(season_id, match_id, team_id, period) VALUES (2015, 50, 30, 'all')")
        with self.db.transaction():
            curated.country_names(self.db)
        # Something computed still names the archive Telstar: its merge waits, the others go on.
        run = x("INSERT INTO agg.power_runs(kind, method_version) VALUES ('elo', 'test') RETURNING id").fetchone()[0]
        x("INSERT INTO agg.team_power(season_id, team_id, scope, elo, elo_change, matches, rank, run_id) VALUES (2015, 33, 'clubs', 1500, 0, 1, 1, %s)", (run,))
        # As the worker does it: the collect role, which reads and writes core and ops only.
        x("SET ROLE vega_collect")
        self.addCleanup(x, "RESET ROLE")
        with self.db.transaction():
            self.assertEqual(identity.run(self.db, None, "teams", NOW), (3, 8))
        x("RESET ROLE")
        self.assertEqual(x("SELECT count(*) FROM core.teams WHERE id = 33").fetchone()[0], 1)
        x("DELETE FROM agg.team_power WHERE team_id = 33")
        x("SET ROLE vega_collect")
        with self.db.transaction():
            self.assertEqual(identity.run(self.db, None, "teams", NOW), (1, 7))
        x("RESET ROLE")
        # West Ham under its two spellings, Telstar ("pays bas" is Pays-Bas) and Grimsby (a
        # European cup names no country). Racing names two Spanish clubs, Leicester none, CA
        # Bastia is not SC Bastia, "Wimbledon" cannot be both Wimbledon FC and AFC Wimbledon,
        # and the two Rochdale played each other: they stay.
        owner = lambda team: self.db.execute(
            "SELECT entity_id FROM core.provider_ids WHERE entity_type = 'team' AND provider = 'vega' AND provider_key = %s",
            ("archive:%s:%s" % (archive[team][0], archives.normalize(archive[team][1])),)).fetchone()[0]
        self.assertEqual({team: owner(team) for team in archive},
                         {30: 20, 40: 20, 33: 23, 37: 26, 31: 31, 32: 32, 34: 34, 35: 35, 36: 36, 38: 38, 39: 39})
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.teams WHERE id = ANY(%s)", (list(archive),)).fetchone()[0], 7)
        # Its matches and their facts are the club's.
        self.assertEqual(self.db.execute("SELECT id, home_team_id, away_team_id FROM core.matches WHERE id IN (50, 51, 52) ORDER BY id").fetchall(),
                         [(50, 20, 32), (51, 38, 39), (52, 20, 32)])
        self.assertEqual(self.db.execute("SELECT team_id FROM core.match_events WHERE match_id = 50").fetchone()[0], 20)
        self.assertEqual(self.db.execute("SELECT team_id FROM core.team_match_stats WHERE match_id = 50").fetchone()[0], 20)
        # One club, two archive spellings: two keys, one of them current.
        self.assertEqual(self.db.execute(
            "SELECT count(*), count(*) FILTER (WHERE is_current) FROM core.provider_ids WHERE entity_type = 'team' AND entity_id = 20 AND provider = 'vega'"
        ).fetchone(), (2, 1))
        self.assertEqual(self.db.execute("SELECT provider_key FROM core.provider_ids WHERE entity_type = 'team' AND entity_id = 20 AND provider = 'pitchapi' AND is_current").fetchone()[0], "t_aaaa20")
        spellings = self.db.execute("SELECT name FROM core.entity_names WHERE entity_type = 'team' AND entity_id = 20 AND kind = 'source_spelling' ORDER BY 1").fetchall()
        self.assertEqual(spellings, [("West Ham United",), ("West Ham United FC",)])
        # The archive reads keep the source's names.
        self.assertEqual(self.db.execute("SELECT team1, team2 FROM api.archive_matches WHERE match_id IN (50, 52) ORDER BY match_id").fetchall(),
                         [("West Ham United FC", "Leicester City FC"), ("West Ham United", "Leicester City FC")])
        self.assertEqual(self.db.execute("SELECT team FROM api.archive_goals WHERE match_id = 50").fetchone()[0], "West Ham United FC")
        # A later run finds nothing new to merge.
        with self.db.transaction():
            self.assertEqual(identity.run(self.db, None, "teams", NOW), (0, 7))

    def test_national_teams_come_from_the_world_cup(self):
        x = self.db.execute
        x("INSERT INTO core.teams(id, name) VALUES (60, 'Atlantis'), (61, 'Lemuria')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','pitchapi','t_aaaa60',60), ('team','pitchapi','t_aaaa61',61)")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, match_date)
             VALUES (60, 2, 2026, 'pitchapi', 'not_started', 60, 61, '2026-06-20')""")
        x("UPDATE core.competitions SET kind = NULL WHERE id = 2")  # as PitchAPI leaves it
        with self.db.transaction():
            # The competition, and the two teams not flagged yet (Germany and Scotland are).
            self.assertEqual(curated.run(self.db, None, "national_teams", NOW), (3, 0))
        self.assertEqual(self.db.execute("SELECT kind::text FROM core.competitions WHERE id = 2").fetchone()[0], "international")
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.teams WHERE is_national").fetchone()[0], 5)
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.teams WHERE id > 100 AND is_national").fetchone()[0], 0)  # Serie A clubs
        with self.db.transaction():
            self.assertEqual(curated.run(self.db, None, "national_teams", NOW), (0, 0))

    def test_cup_teams_merge_into_the_same_pitchapi_teams(self):
        from vega.sources import cups

        # Vega knows Germany under another name too; the source writes both.
        self.db.execute("""INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
                           VALUES ('team', 2, 'Deutschland', 'deutschland', 'alias', 'vega')""")
        body = {"name": "World Cup 2026", "season": "2026", "source": {"name": "OpenFootball", "url": "https://github.com/openfootball/worldcup.json"},
                "matches": [{"round": "Matchday 1", "date": "2026-06-14", "team1": "Germany", "team2": "Scotland", "score": {"ft": [5, 2]}},
                            {"round": "Matchday 1", "date": "2026-06-15", "team1": "Narnia", "team2": "Germany"},
                            {"round": "Matchday 2", "date": "2026-06-19", "team1": "Deutschland", "team2": "Narnia"}]}
        with self.db.transaction():
            cups.save(self.db, "open-cups", "world-cup-history", "2026", body, NOW)
        with self.db.transaction():
            merged, unmatched = identity.run(self.db, None, "teams", NOW)
        self.assertEqual(merged, 3)  # Germany under its two names, and Scotland; Narnia names nobody and stays
        narnia = self.db.execute("SELECT entity_id FROM core.provider_ids WHERE provider='openfootball' AND provider_key='name:Narnia'").fetchone()[0]
        self.assertEqual(self.db.execute("SELECT name FROM core.teams WHERE id=%s", (narnia,)).fetchone()[0], "Narnia")
        owners = dict(self.db.execute("SELECT provider_key, entity_id FROM core.provider_ids WHERE entity_type='team' AND provider='openfootball'").fetchall())
        self.assertEqual((owners["name:Germany"], owners["name:Deutschland"], owners["name:Scotland"]), (2, 2, 3))
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.teams WHERE name IN ('Germany', 'Scotland', 'Deutschland')").fetchone()[0], 2)
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM core.provider_ids WHERE entity_type = 'team' AND entity_id = 2 AND provider = 'openfootball' AND is_current").fetchone()[0], 1)
        # The cup read keeps the source's spelling and key, each match once; the duplicate and
        # the score gap are noted.
        cup = self.db.execute("SELECT home, home_key, away, away_key FROM api.cup_matches ORDER BY date").fetchall()
        self.assertEqual(cup, [("Germany", "name:Germany", "Scotland", "name:Scotland"), ("Narnia", "name:Narnia", "Germany", "name:Germany"),
                               ("Deutschland", "name:Deutschland", "Narnia", "name:Narnia")])
        warnings = dict(self.db.execute("SELECT kind::text, detail FROM ops.data_warnings").fetchall())
        self.assertEqual(warnings, {"duplicate_match": "m_aaaaa1", "score_disagreement": "m_aaaaa1 5-1 / 5-2"})
        # A later read of the same source does not rename the PitchAPI team, nor make a new one.
        teams = self.db.execute("SELECT count(*) FROM core.teams").fetchone()[0]
        with self.db.transaction():
            cups.save(self.db, "open-cups", "world-cup-history", "2026", dict(body, name="World Cup 2026 (refreshed)"), NOW)
        self.assertEqual(self.db.execute("SELECT name FROM core.teams WHERE id = 2").fetchone()[0], "Germany")
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.teams").fetchone()[0], teams)
        self.assertEqual(self.db.execute("SELECT count(*), count(DISTINCT match_id) FROM api.cup_matches").fetchone(), (3, 3))

if __name__ == "__main__":
    unittest.main()
