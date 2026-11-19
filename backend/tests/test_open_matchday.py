"""open-matchday competitions (real files of github.com/oladeeayo/open-matchday, trimmed):
read like main's collector, written as typed matches and team statistics, read back as
main's catalogue rows."""

from datetime import datetime, timedelta, timezone
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
from vega.sources import SourceError, open_matchday

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


# The leagues PitchAPI holds (VI-21, 17 Nov 2026): open-matchday's copies of them are not read.
COPIES = {
    "AUT_1_bundesliga", "BEL_1_pro-league", "CRO_1_hnl", "CZE_1_chance-liga", "DEN_1_superliga",
    "ENG_1_premier-league", "ENG_2_championship", "ENG_3_league-one", "ENG_4_league-two",
    "ESP_1_la-liga", "ESP_2_segunda-division", "FIN_1_veikkausliiga", "FRA_1_ligue-1", "FRA_2_ligue-2",
    "GER_1_bundesliga", "GER_2_2-bundesliga", "GER_3_3-liga", "GRE_1_super-league", "ITA_1_serie-a", "ITA_2_serie-b",
    "NED_1_eredivisie", "NED_2_eerste-divisie", "NOR_1_eliteserien", "POL_1_ekstraklasa", "POR_1_primeira-liga",
    "ROU_1_liga-1", "RUS_1_premier-liga", "SCO_1_premiership", "SUI_1_super-league", "SVK_1_nike-liga",
    "SWE_1_allsvenskan", "TUR_1_super-lig", "UEFA_1_champions-league", "UEFA_1_europa-league", "UEFA_1_conference-league",
}
# What only open-matchday gives: the domestic cups and the leagues PitchAPI does not hold.
OWN = {
    "AUT_CUP_ofb-cup", "ENG_CUP_efl-cup", "ENG_CUP_fa-cup", "ESP_CUP_copa-del-rey", "GER_CUP_dfb-pokal", "ITA_CUP_coppa-italia",
    "NED_CUP_knvb-beker", "POR_CUP_taca-de-portugal", "SCO_CUP_league-cup", "SCO_CUP_scottish-cup", "SUI_CUP_swiss-cup",
    "BEL_U21_pro-league", "CYP_1_first-division", "ENG_5_national-league", "ENG_6_national-league-north", "ENG_6_national-league-south",
    "ENG_7_northern-premier-league", "IRE_2_first-division", "IRE_3_national-league", "KAZ_1_premier-league", "POL_2_division-1",
    "POL_3_division-2", "SCO_2_championship", "SCO_3_league-one", "SCO_4_league-two", "SVN_1_prva-liga", "UKR_1_premier-league",
    "WAL_1_cymru-premier", "WAL_2_cymru-north", "WAL_3_cymru-south",
}


class PureTest(unittest.TestCase):
    def test_a_league_pitchapi_holds_is_named_with_its_pitchapi_key(self):
        self.assertEqual(set(open_matchday.COVERED), COPIES)
        self.assertTrue(all(re.fullmatch(r"l_[A-Za-z0-9]{6}", key) for key in open_matchday.COVERED.values()))
        self.assertEqual(len(set(open_matchday.COVERED.values())), len(COPIES))  # one PitchAPI league each
        self.assertFalse(OWN & set(open_matchday.COVERED))  # every cup and every league PitchAPI lacks stays read

    def test_a_folder_s_country_is_the_base_s(self):
        # open-matchday writes Ireland « IRE »; the base (and PitchAPI) « IRL »: a club of the same
        # name in two countries is never linked (Cork City, 17 Nov 2026). UEFA folders name no country.
        self.assertEqual(open_matchday.country_of("IRE_2_first-division"), "IRL")
        self.assertEqual(open_matchday.country_of("ENG_5_national-league"), "ENG")
        self.assertEqual(open_matchday.country_of("GER_CUP_dfb-pokal"), "GER")
        self.assertIsNone(open_matchday.country_of("UEFA_1_champions-league"))

    def test_season_label(self):
        self.assertEqual(open_matchday.season_label("2627"), "2026/2027")
        with self.assertRaises(SourceError):
            open_matchday.season_label("26/27")


@unittest.skipUnless(DSN and psycopg, "requires disposable local sources DB and psycopg")
class OpenMatchdayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

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

    def test_zz_a_club_the_source_writes_two_ways_is_one_club(self):
        # open-matchday writes some Scottish clubs one way in its results and another in its fixtures and cups
        # (« Airdrie Utd » and « Airdrieonians », « Queen of Sth » and « Queen of South », « Raith » for Raith Rovers):
        # two clubs for the base, phantom rows in a table, a fixture without a forecast. One club, under its full name,
        # in every folder (reviewed spellings, 17 Nov 2026).
        x = self.db.execute
        results = [{"home": "Airdrie Utd", "away": "Queen of Sth", "date": "2026-10-04", "ft_home": "2", "ft_away": "1", "gw": "8"}]
        fixtures = [{"home": "Queen of South", "away": "Airdrieonians", "date": "2026-12-05", "gw": "16"}]
        with self.db.transaction():
            open_matchday.save(self.db, "SCO_3_league-one", "Scottish League One", "2026/2027", results, fixtures, NOW)
            open_matchday.save(self.db, "SCO_CUP_scottish-cup", "Scottish Cup", "2026/2027", [],
                               [{"home": "Raith", "away": "Morton", "date": "2026-11-28", "gw": "3"}], NOW)
        self.addCleanup(lambda: x("DELETE FROM core.matches WHERE competition_season_id IN (SELECT id FROM core.competition_seasons WHERE cup_key LIKE 'open-matchday:SCO_%%')"))
        rows = x("""SELECT m.home_team_name, m.away_team_name, h.name, a.name, m.home_team_id, m.away_team_id FROM core.matches m
                    JOIN core.teams h ON h.id = m.home_team_id JOIN core.teams a ON a.id = m.away_team_id
                    JOIN core.competition_seasons cs ON cs.id = m.competition_season_id WHERE cs.cup_key LIKE 'open-matchday:SCO_%%' ORDER BY m.match_date""").fetchall()
        self.assertEqual([r[:4] for r in rows], [
            ("Airdrieonians", "Queen of the South", "Airdrieonians", "Queen of the South"),
            ("Raith Rovers", "Greenock Morton", "Raith Rovers", "Greenock Morton"),
            ("Queen of the South", "Airdrieonians", "Queen of the South", "Airdrieonians"),
        ])
        self.assertEqual((rows[0][4], rows[0][5]), (rows[2][5], rows[2][4]))  # the same two clubs
        self.assertEqual(open_matchday.SPELLINGS["Inverness"], "Inverness Caledonian Thistle")

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

    # -- §45 (FAILURE_MODES.md): a copy goes only when the native edition covers it, match by match --
    COPY_KEY = "open-matchday:ENG_1_premier-league:2026/2027"

    def collect_run(self):
        """open_matchday.run as the worker runs it: under the collection role, in its own transaction."""
        with self.db.transaction():
            self.db.execute("SET LOCAL ROLE vega_collect")
            out = open_matchday.run(self.db, fake_get, "europe", NOW)
            self.db.execute("RESET ROLE")
        return out

    def copy_then_native(self):
        """The Premier League copy written while PitchAPI did not hold the league, then PitchAPI's edition of
        2026/2027 created by the catalogue, without a match yet: (native edition, the copy's matches)."""
        from vega.store import Store

        x = self.db.execute
        x("DELETE FROM core.matches; DELETE FROM core.provider_ids; DELETE FROM core.rounds; DELETE FROM core.competition_seasons; "
          "DELETE FROM core.competitions; DELETE FROM ops.parse_failures")
        self.assertEqual(self.collect_run(), (5 + 3 + 7 + 4, 0))
        comp = x("INSERT INTO core.competitions(name, country_code) VALUES ('Premier League', NULL) RETURNING id").fetchone()[0]
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','pitchapi','l_4WFCIZ',%s)", (comp,))
        native = x("INSERT INTO core.competition_seasons(competition_id, season_id, native_label) VALUES (%s,%s,'2026/2027') RETURNING id",
                   (comp, Store(self.db).season("2026/2027"))).fetchone()[0]
        return native, self.copy()

    def copy(self):
        return self.db.execute(
            """SELECT m.id, m.status::text, m.match_date, m.home_team_id, m.away_team_id, m.home_team_name, m.away_team_name, m.home_score, m.away_score
               FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
               WHERE cs.cup_key = %s ORDER BY m.match_date, m.id""", (self.COPY_KEY,)).fetchall()

    def cover(self, native, matches, *, skip=(), shift=None, swap=()):
        """PitchAPI's own clubs (the copy's teams merged into them by the identities) and its matches of the copy's
        days: `skip` left out, `shift` {index: days}, `swap` with the sides the other way round."""
        x = self.db.execute
        clubs = {}
        for team in sorted({t for m in matches for t in (m[3], m[4])}):
            name = x("SELECT name FROM core.teams WHERE id = %s", (team,)).fetchone()[0]
            clubs[team] = x("INSERT INTO core.teams(name) VALUES (%s) RETURNING id", (f"PitchAPI {name}",)).fetchone()[0]
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','pitchapi',%s,%s)", (f"t_{clubs[team]:06d}", clubs[team]))
            x("UPDATE core.teams SET merged_into = %s WHERE id = %s", (clubs[team], team))
        for n, (_, status, day, home, away, _h, _a, hs, aws) in enumerate(matches):
            if n in skip:
                continue
            home, away, hs, aws = (clubs[away], clubs[home], aws, hs) if n in swap else (clubs[home], clubs[away], hs, aws)
            x("""INSERT INTO core.matches(competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score, match_date)
                 VALUES (%s, 2026, 'pitchapi', %s, %s, %s, %s, %s, %s)""",
              (native, status, home, away, hs, aws, day + timedelta(days=(shift or {}).get(n, 0))))

    def traces(self):
        return self.db.execute("SELECT error_code, message FROM ops.parse_failures WHERE error_code = 'COPY_NOT_COVERED' ORDER BY id").fetchall()

    def test_45a_an_empty_native_edition_keeps_the_copy(self):
        # The catalogue creates the native edition before its matches are collected (a season change): the copy's
        # results stay, the reason is traced once, the next passes try again.
        try:
            with self.db.transaction():
                native, before = self.copy_then_native()
                self.assertEqual(len(before), 5 + 3)
                for _ in range(2):
                    self.assertEqual(self.collect_run(), (7 + 4, 0))  # the copy is not read: PitchAPI holds its league
                    self.assertEqual(self.copy(), before)
                    self.assertEqual(self.db.execute("SELECT count(*) FROM core.competition_seasons WHERE cup_key = %s", (self.COPY_KEY,)).fetchone()[0], 1)
                    self.assertEqual(self.db.execute(
                        "SELECT count(*) FROM core.provider_ids WHERE provider = 'vega' AND provider_key = 'cup:open-matchday:ENG_1_premier-league'").fetchone()[0], 1)
                    traces = self.traces()
                    self.assertEqual(len(traces), 1)
                    self.assertTrue(traces[0][1].startswith(f"{self.COPY_KEY}: 8 of 8 match(es) without a native match: 2026-08-21 Arsenal–Coventry"), traces[0][1])
                raise psycopg.Rollback()
        except psycopg.Rollback:
            pass

    def test_45b_a_copy_written_before_is_removed_once_the_native_edition_covers_it(self):
        # The copies read before VI-21 (17 Nov 2026) go once PitchAPI's edition holds each of their matches (the same
        # clubs once the identities are resolved, a day apart at most, either side at home): matches, rounds, edition,
        # competition and their ids; the cup of the same summary stays as it is.
        try:
            with self.db.transaction():
                native, before = self.copy_then_native()
                self.cover(native, before, shift={1: 1, 6: -1}, swap={2})
                written, _ = self.collect_run()
                self.assertEqual(written, 7 + 4)
                left = self.db.execute("SELECT split_part(cup_key, ':', 2) FROM core.competition_seasons WHERE cup_key IS NOT NULL").fetchall()
                self.assertEqual(left, [("AUT_CUP_ofb-cup",)])
                self.assertEqual(self.db.execute("SELECT count(*) FROM core.matches WHERE source = 'open_matchday'").fetchone()[0], 7 + 4)
                self.assertEqual(self.db.execute("SELECT count(*) FROM core.provider_ids WHERE provider = 'vega' AND provider_key = 'cup:open-matchday:ENG_1_premier-league'").fetchone()[0], 0)
                self.assertEqual(self.db.execute("SELECT count(*) FROM core.competitions WHERE name = 'Premier League'").fetchone()[0], 1)  # PitchAPI's alone
                self.assertEqual(self.db.execute(
                    "SELECT count(*) FROM core.provider_ids p WHERE p.entity_type = 'match' AND p.provider = 'open_matchday' AND NOT EXISTS (SELECT 1 FROM core.matches m WHERE m.id = p.entity_id)"
                ).fetchone()[0], 0)
                self.assertEqual(self.db.execute("SELECT count(*) FROM core.matches WHERE competition_season_id = %s", (native,)).fetchone()[0], 8)
                self.assertEqual(self.traces(), [])
                raise psycopg.Rollback()
        except psycopg.Rollback:
            pass

    def test_45c_45d_a_copy_partly_covered_stays_whole(self):
        # One match of eight without its native match (45c), or with it two days away (45d): nothing of the copy goes.
        for case, options in (("45c", {"skip": {4}}), ("45d", {"shift": {4: 2}})):
            with self.subTest(case=case):
                try:
                    with self.db.transaction():
                        native, before = self.copy_then_native()
                        self.cover(native, before, **options)
                        self.collect_run()
                        self.assertEqual(self.copy(), before)
                        traces = self.traces()
                        self.assertEqual(len(traces), 1)
                        self.assertEqual(traces[0][1], f"{self.COPY_KEY}: 1 of 8 match(es) without a native match: 2026-08-22 Nott'm Forest–Leeds")
                        raise psycopg.Rollback()
                except psycopg.Rollback:
                    pass

    def test_45e_a_kept_copy_is_not_read_by_the_elo(self):
        # Kept beside a native edition that covers part of it, the copy counts nothing twice: the Elo never reads a
        # COVERED folder.
        from vega import power

        try:
            with self.db.transaction():
                native, before = self.copy_then_native()
                self.cover(native, before, skip={4})
                self.collect_run()
                self.assertEqual(len(self.copy()), 8)
                ids = {r[0] for r in power.elo_matches(self.db.execute(power.ELO_MATCHES).fetchall())}
                self.assertFalse(ids & {m[0] for m in before})
                self.assertEqual(len(ids & {r[0] for r in self.db.execute("SELECT id FROM core.matches WHERE competition_season_id = %s AND status = 'finished'", (native,))}), 4)
                raise psycopg.Rollback()
        except psycopg.Rollback:
            pass

    def test_a_removed_league_is_not_read_and_what_was_written_goes(self):
        # The user removed some leagues (18 Nov 2026, scope.REMOVED_FOLDERS). One read before the
        # removal (here the fixture's Premier League stands in for one): the next read does not
        # fetch its files, the purge removes its edition, matches and ids, the cup stays.
        from vega import scope

        calls = []

        def get(url, as_text=False):
            calls.append(url)
            return fake_get(url, as_text)

        before = dict(scope.REMOVED_FOLDERS)
        try:
            with self.db.transaction():
                self.db.execute("DELETE FROM core.matches; DELETE FROM core.provider_ids; DELETE FROM core.rounds; DELETE FROM core.competition_seasons; DELETE FROM core.competitions")
                open_matchday.run(self.db, get, "europe", NOW)
                scope.REMOVED_FOLDERS["ENG_1_premier-league"] = "Premier League (stand-in)"
                calls.clear()
                written, unmatched = open_matchday.run(self.db, get, "europe", NOW)
                self.assertEqual((written, unmatched), (7 + 4, 0))
                self.assertFalse([url for url in calls if "/ENG_1_premier-league/" in url])
                self.assertEqual(scope.purge(self.db, self.db), {"competitions": 1, "editions": 1, "matches": 5 + 3})
                left = self.db.execute("SELECT split_part(cup_key, ':', 2) FROM core.competition_seasons WHERE cup_key IS NOT NULL").fetchall()
                self.assertEqual(left, [("AUT_CUP_ofb-cup",)])
                self.assertEqual(self.db.execute("SELECT count(*) FROM core.matches WHERE source = 'open_matchday'").fetchone()[0], 7 + 4)
                self.assertEqual(self.db.execute(
                    "SELECT count(*) FROM core.provider_ids WHERE provider_key LIKE 'ENG_1_premier-league:%%' OR provider_key = 'cup:open-matchday:ENG_1_premier-league'"
                ).fetchone()[0], 0)
                self.assertEqual(scope.purge(self.db, self.db), {})
                raise psycopg.Rollback()
        except psycopg.Rollback:
            pass
        finally:
            scope.REMOVED_FOLDERS.clear()
            scope.REMOVED_FOLDERS.update(before)

    def test_a_league_pitchapi_holds_this_season_is_not_read(self):
        # PitchAPI holds the Premier League in 2026/2027: open-matchday's copy is skipped, its cup still read.
        # Without that edition (an earlier season only), the copy is read: PitchAPI's coverage decides, not the list alone.
        from vega.store import Store

        for held_season, read_league in (("2026/2027", False), ("2025/2026", True)):
            with self.subTest(held_season=held_season):
                try:
                    with self.db.transaction():
                        self.db.execute("DELETE FROM core.matches; DELETE FROM core.provider_ids; DELETE FROM core.competition_seasons; DELETE FROM core.competitions")
                        comp = self.db.execute("INSERT INTO core.competitions(name, country_code) VALUES ('Premier League', NULL) RETURNING id").fetchone()[0]
                        self.db.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','pitchapi','l_4WFCIZ',%s)", (comp,))
                        season = Store(self.db).season(held_season)
                        self.db.execute("INSERT INTO core.competition_seasons(competition_id, season_id, native_label) VALUES (%s,%s,%s)", (comp, season, held_season))
                        written, unmatched = open_matchday.run(self.db, fake_get, "europe", NOW)
                        folders = {r[0] for r in self.db.execute("SELECT split_part(cup_key, ':', 2) FROM core.competition_seasons WHERE cup_key IS NOT NULL")}
                        self.assertEqual("ENG_1_premier-league" in folders, read_league)
                        self.assertIn("AUT_CUP_ofb-cup", folders)
                        self.assertEqual((written, unmatched), (5 + 3 + 7 + 4 if read_league else 7 + 4, 0))
                        raise psycopg.Rollback()
                except psycopg.Rollback:
                    pass


if __name__ == "__main__":
    unittest.main()
