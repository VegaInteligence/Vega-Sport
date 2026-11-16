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
