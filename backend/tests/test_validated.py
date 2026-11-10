"""Rules added when aligning the prototype with the validated design document."""

import os, sys, unittest
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_VALIDATED_TEST_DSN")

from vega.seasons import season_id, sporting_season
from vega.store import round_stage


class SeasonRuleTest(unittest.TestCase):
    def test_tournaments_belong_to_the_season_that_ends_with_them(self):
        world_cup = ("l_1XLtP0", "World Cup")
        self.assertEqual(sporting_season("2026", *world_cup), "2025/2026")
        self.assertEqual(sporting_season("2022", *world_cup), "2022/2023")
        self.assertEqual(sporting_season("2018", *world_cup), "2017/2018")
        self.assertEqual(sporting_season("2024", None, "UEFA Euro"), "2023/2024")
        self.assertEqual(sporting_season("2020", None, "UEFA Euro"), "2020/2021")
        self.assertEqual(sporting_season("2025", None, "Africa Cup of Nations"), "2025/2026")
        self.assertEqual(sporting_season("2025", None, "Club World Cup"), "2024/2025")

    def test_calendar_year_leagues_and_qualifiers_keep_their_year(self):
        self.assertEqual(sporting_season("2026", "l_0eg6C9", "Major League Soccer"), "2026/2027")
        self.assertEqual(sporting_season("2026", None, "World Cup Qualification"), "2026/2027")
        self.assertEqual(sporting_season("2025/2026", None, "Ligue 1"), "2025/2026")

    def test_invalid_editions_are_refused(self):
        for label in ("2025/2027", "26", "", None, "1700"):
            self.assertIsNone(sporting_season(label, None, "League"))
        self.assertEqual(season_id("2025/2026"), 2025)
        self.assertIsNone(season_id("2026"))

    def test_round_stages(self):
        cases = {
            "Regular Season - 12": "regular",
            "Matchday 5": "regular",
            "Quarter-finals": "knockout",
            "Quarter-final": "knockout",
            "Semi-finals": "knockout",
            "Round of 16": "knockout",
            "1/8 finale": "knockout",
            "Final": "final",
            "Finale": "final",
            "Group A": "group",
            "League phase - 3": "group",
            "Qualification Round 2": "qualifying",
            "Knockout round play-offs": "playoff",
        }
        for name, stage in cases.items():
            self.assertEqual(round_stage(name), stage, name)


@unittest.skipUnless(DSN and psycopg, "requires disposable local validated DB and psycopg")
class ValidatedStoreTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if (
            target.hostname not in ("localhost", "127.0.0.1", "::1")
            or target.path != "/vega_v2_validated_test"
        ):
            raise RuntimeError("dedicated local validated DB required")
        from vega.store import connect_local, migrate, Store
        from vega.normalize import normalize_family

        cls.normalize = staticmethod(normalize_family)
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

    def rejects(self, statement, params=()):
        with self.assertRaises(psycopg.Error):
            with self.db.transaction():
                self.db.execute(statement, params)

    def edition(self, key, name, label):
        self.store.save_references(
            self.normalize("league", {"id": key, "name": name, "season": label})
        )
        return self.db.execute(
            "SELECT cs.id,cs.season_id,cs.native_label,s.label FROM core.competition_seasons cs JOIN core.seasons s ON s.id=cs.season_id JOIN core.provider_ids p ON p.entity_type='competition' AND p.entity_id=cs.competition_id WHERE p.provider_key=%s AND cs.native_label=%s",
            (key, label),
        ).fetchone()

    def test_calendar_year_edition_is_stored_under_its_sporting_season(self):
        eid, sid, native, label = self.edition("l_0eg6C9", "Major League Soccer", "2026")
        self.assertEqual((sid, native, label), (2026, "2026", "2026/2027"))
        match = {
            "id": "m_mls001",
            "home_team": {"id": "t_mls001", "name": "Home"},
            "away_team": {"id": "t_mls002", "name": "Away"},
            "status": "finished",
            "date": "2026-05-01",
            "score_home": 2,
            "score_away": 2,
            "season": "2026",
            "round": "Regular Season - 10",
        }
        mid = self.store.save_matches(self.normalize("summary", match, match_id="m_mls001"), eid)[0]
        rid, season = self.db.execute(
            "SELECT round_id,season_id FROM core.matches WHERE id=%s", (mid,)
        ).fetchone()
        self.assertEqual(season, 2026)
        self.assertEqual(
            self.db.execute("SELECT name,stage FROM core.rounds WHERE id=%s", (rid,)).fetchone(),
            ("Regular Season - 10", "regular"),
        )
        self.assertTrue(
            self.db.execute("SELECT to_regclass('core.shots_s2026') IS NOT NULL").fetchone()[0]
        )

    def test_world_cup_2026_is_season_2025_2026(self):
        _, sid, native, label = self.edition("l_1XLtP0", "World Cup", "2026")
        self.assertEqual((sid, native, label), (2025, "2026", "2025/2026"))

    def test_archive_seasons_share_one_partition(self):
        with self.db.transaction():
            self.assertEqual(self.store.season("1990/1991"), 1990)
            self.assertEqual(self.store.season("1871/1872"), 1871)
        names = {
            r[0]
            for r in self.db.execute(
                "SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid JOIN pg_class p ON p.oid=i.inhparent WHERE p.relname='shots'"
            )
        }
        self.assertIn("shots_archive", names)
        self.assertFalse(any(n in ("shots_s1990", "shots_s1871") for n in names))
        self.rejects("INSERT INTO core.seasons(id,label) VALUES(2030,'2031/2032')")

    def test_homonyms_are_separate_identities(self):
        with self.db.transaction():
            first = self.db.execute(
                "INSERT INTO core.coaches(name) VALUES('Luis Garcia') RETURNING id"
            ).fetchone()[0]
            second = self.db.execute(
                "INSERT INTO core.coaches(name) VALUES('Luis Garcia') RETURNING id"
            ).fetchone()[0]
            self.db.execute(
                "INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES('coach','pitchapi','Luis Garcia',%s),('coach','wikidata','Q1',%s),('coach','wikidata','Q2',%s)",
                (first, first, second),
            )
        self.assertNotEqual(first, second)
        self.assertEqual(self.store.resolve("coach", "Luis Garcia"), first)
        # One current key per provider; former keys stay as history.
        self.rejects(
            "INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES('coach','wikidata','Q3',%s)",
            (first,),
        )
        with self.db.transaction():
            self.db.execute(
                "INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id,is_current) VALUES('coach','wikidata','Q0',%s,false)",
                (first,),
            )

    def test_new_reference_tables_enforce_their_shape(self):
        with self.db.transaction():
            team = self.db.execute("INSERT INTO core.teams(name) VALUES('Club') RETURNING id").fetchone()[0]
            self.db.execute("INSERT INTO core.countries(code) VALUES('FRA') ON CONFLICT DO NOTHING")
            edition = self.db.execute(
                "INSERT INTO core.ranking_editions(kind,provider,label) VALUES('uefa_clubs','uefa','2026') RETURNING id"
            ).fetchone()[0]
            self.db.execute(
                "INSERT INTO core.ranking_rows(edition_id,row_no,team_id,position,points) VALUES(%s,1,%s,1,120.5)",
                (edition, team),
            )
        # A row is a club or an association, never both or neither.
        self.rejects(
            "INSERT INTO core.ranking_rows(edition_id,row_no,team_id,country_code) VALUES(%s,2,%s,'FRA')",
            (edition, team),
        )
        self.rejects(
            "INSERT INTO core.ranking_rows(edition_id,row_no) VALUES(%s,3)", (edition,)
        )
        self.rejects(
            "INSERT INTO core.entity_names(entity_type,entity_id,name,normalized,kind,source) VALUES('player',1,'CR7','CR7','alias','vega')"
        )
        self.rejects(
            "INSERT INTO core.competition_zones(competition_season_id,zone,position_from,position_to,source) VALUES(1,'relegation',18,17,'vega')"
        )
