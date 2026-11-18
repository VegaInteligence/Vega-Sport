"""SportScore official standings through sources.run_due, PostgreSQL and api.standing_rows:
the cases of docs/calculs/09-audit-2026-11/FAILURE_MODES_SPORTSCORE.md §3 (sportscore_cases.py).
The widget answers from memory; the end-to-end replay of the same cases over HTTPS and the read
API is the VI-27 track's script."""

import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from vega import sources
from vega.sources import SourceError, sportscore
from sportscore_cases import CASES, H, START, T0, replace, tables, without
import sportscore_replay as replay

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_SOURCES_TEST_DSN")


@unittest.skipUnless(DSN and psycopg, "requires disposable local sources DB and psycopg")
class SportScoreDatabase(unittest.TestCase):
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


class SportScoreStandingsTest(SportScoreDatabase):
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


class SportScoreWriterQualificationTest(SportScoreDatabase):
    def setUp(self):
        transaction = self.db.transaction()
        transaction.__enter__()
        self.addCleanup(transaction.__exit__, psycopg.Rollback, psycopg.Rollback(), None)

    def write(self, rows, hours=0):
        body = tables((None, rows))
        return replay.play(sources, sportscore, self.db, CASES[0], {"at": T0 + hours * H},
                           lambda url: replay.widget(body, replay.slug_of(url)))

    def read(self):
        return self.db.execute("""SELECT s.team_id,s.team_name,s.played,s.won,s.drawn,s.lost,s.points,s.source,r.version
                                  FROM api.standings s JOIN ops.resource_versions r
                                    ON r.resource_kind='competition_season' AND r.resource_id=s.competition_season_id
                                 WHERE s.competition_season_id=5001 ORDER BY s.position""").fetchall()

    def alias(self, name):
        self.db.execute("""INSERT INTO core.entity_names(entity_type,entity_id,name,normalized,kind,source)
                           VALUES ('team',101,%s,%s,'source_spelling','sportscore') ON CONFLICT DO NOTHING""",
                        (name, sources.normalize(name)))

    def aliases(self):
        return self.db.execute("""SELECT entity_id,name FROM core.entity_names
                                 WHERE entity_type='team' AND entity_id BETWEEN 101 AND 103 ORDER BY 1,2""").fetchall()

    def assert_refused(self, rows, hours, code):
        prior, aliases = self.read(), self.aliases()
        outcome = self.write(rows, hours)
        self.assertEqual(self.read(), prior)
        self.assertEqual(self.aliases(), aliases)
        self.assertEqual(outcome, code)
        failure = self.db.execute("SELECT error_code,message FROM ops.parse_failures ORDER BY id DESC LIMIT 1").fetchone()
        self.assertEqual(failure[0], code)
        self.assertIn(rows[0]["team"], failure[1])

    def test_impossible_complete_and_partial_counts_keep_the_published_table(self):
        self.assertIsNone(self.write(without(START, 0, "l")))
        for step, changes in enumerate(({"w": 17}, {"w": 1}, {"w": 3, "d": 2, "l": None}), 1):
            with self.subTest(changes=changes):
                try:
                    with self.db.transaction():
                        self.assert_refused(replace(START, 0, **changes), step * 3, "INVALID_ROW")
                        raise psycopg.Rollback()
                except psycopg.Rollback:
                    pass
        corrected = replace(START, 0, w=2, d=2, pts=9)
        self.assertIsNone(self.write(corrected, 12))
        observed = self.read()
        self.assertEqual(observed[0][:8], (101, "Aster City", 4, 2, 2, 0, 9, "sportscore"))
        self.assertIsNone(self.write(corrected, 15))
        self.assertEqual(self.read(), observed)

    def test_known_good_partial_counts_and_points_deduction_are_published(self):
        self.assertIsNone(self.write(without(START, 0, "l")))
        self.assertEqual(self.read()[0][:8], (101, "Aster City", 4, 3, 1, None, 8, "sportscore"))

    def test_new_and_previously_learned_reserve_aliases_are_refused_for_a_first_team(self):
        self.assertIsNone(self.write(START))
        for step, name in enumerate(("Aster City II", "Aster City B", "Aster City U-21"), 1):
            with self.subTest(spelling=name):
                self.assert_refused(replace(START, 0, team=name, pts=9), step * 3, "UNMATCHED_TEAMS")
        self.alias("Aster City II")
        self.assert_refused(replace(START, 0, team="Aster City II", pts=9), 12, "UNMATCHED_TEAMS")
        self.assert_refused(replace(START, 0, team="AsterCityII", pts=9), 15, "UNMATCHED_TEAMS")

    def test_a_real_reserve_accepts_its_own_name_and_variant_but_not_its_first_team(self):
        self.db.execute("UPDATE core.teams SET name='Aster City II' WHERE id=101")
        self.assertIsNone(self.write(replace(START, 0, team="Aster City II")))
        self.assertIsNone(self.write(replace(START, 0, team="Aster City B", pts=9), 3))
        self.assertIn((101, "Aster City B"), self.aliases())
        self.assert_refused(replace(START, 0, pts=10), 6, "UNMATCHED_TEAMS")
        self.alias("Aster City")
        self.assert_refused(replace(START, 0, pts=10), 9, "UNMATCHED_TEAMS")
        self.assert_refused(replace(START, 0, team="Aster City U21", pts=10), 12, "UNMATCHED_TEAMS")

    def test_reviewed_spellings_stay_bound_to_their_canonical_identities(self):
        cases = (
            ("t_1ekXAt", "Gent U23", "Gent B", "Gent"),
            ("t_48QCy0", "Genk U23", "Jong Genk", "Genk"),
            ("t_4YXkkv", "Celta Fortuna", "Celta Vigo B", "Celta Vigo"),
            ("t_1XzLP9", "Juan Pablo II College", "Juan Pablo II", None),
            ("t_2UPrdj", "Heart of Midlothian", "Heart of Midlothian F.C.", None),
        )
        for key, canonical, spelling, first in cases:
            with self.subTest(spelling=spelling):
                with self.db.transaction():
                    self.db.execute("UPDATE core.teams SET name=%s WHERE id=101", (canonical,))
                    self.db.execute("UPDATE core.provider_ids SET provider_key=%s WHERE entity_type='team' AND provider='pitchapi' AND entity_id=101",
                                    (key,))
                    self.assertIsNone(self.write(replace(START, 0, team=spelling)))
                    self.assertEqual(self.read()[0][:2], (101, canonical))
                    self.assertIn((101, spelling), self.aliases())
                    if first:
                        self.assert_refused(replace(START, 0, team=first, pts=9), 3, "UNMATCHED_TEAMS")
                    raise psycopg.Rollback()

    def test_a_reviewed_spelling_does_not_belong_to_an_unrelated_homonym(self):
        self.db.execute("UPDATE core.teams SET name='Gent U23' WHERE id=101")
        self.assertIsNone(self.write(replace(START, 0, team="Gent U23")))
        self.assert_refused(replace(START, 0, team="Gent B", pts=9), 3, "UNMATCHED_TEAMS")

    def test_gender_of_a_learned_name_cannot_contradict_the_edition(self):
        self.assertIsNone(self.write(START))
        self.assert_refused(replace(START, 0, team="Aster City Women", pts=9), 3, "UNMATCHED_TEAMS")
        self.alias("Aster City Women")
        self.assert_refused(replace(START, 0, team="Aster City Women", pts=9), 6, "UNMATCHED_TEAMS")
        self.alias("Aster City WFC")
        names = ("Aster City (W)", "Aster City Féminines", "Aster City Femenino", "Aster City Femminile", "Aster City WFC")
        for hours, name in enumerate(names, 3):
            with self.subTest(name=name):
                self.assert_refused(replace(START, 0, team=name, pts=9), hours * 3, "UNMATCHED_TEAMS")

    def test_a_canonical_wfc_club_name_stays_admissible(self):
        self.db.execute("UPDATE core.teams SET name='Aster City W.F.C.' WHERE id=101")
        self.assertIsNone(self.write(replace(START, 0, team="Aster City WFC")))
        self.assertEqual(self.read()[0][:2], (101, "Aster City W.F.C."))

    def test_womens_edition_admits_unmarked_and_explicit_womens_names(self):
        self.db.execute("UPDATE core.competitions SET name='Saudi Women’s Premier League' WHERE id=401")
        self.assertIsNone(self.write(START))
        self.assertIsNone(self.write(replace(START, 0, team="Aster City Women", pts=9), 3))
        self.assertEqual(self.read()[0][:2], (101, "Aster City"))
        self.assertIn((101, "Aster City Women"), self.aliases())
        self.assert_refused(replace(START, 0, team="Aster City Men", pts=10), 6, "UNMATCHED_TEAMS")
        self.assert_refused(replace(START, 0, team="Aster City Männer", pts=10), 9, "UNMATCHED_TEAMS")

    def test_an_exact_homonym_is_ambiguous(self):
        self.assertIsNone(self.write(START))
        self.db.execute("INSERT INTO core.teams(id,name) VALUES (199,'Aster-City')")
        self.db.execute("INSERT INTO core.team_seasons VALUES (199,5001)")
        self.assert_refused(replace(START, 0, pts=9), 3, "UNMATCHED_TEAMS")


class SportScoreFreshnessTest(SportScoreDatabase):
    def setUp(self):
        self.db.execute("DELETE FROM core.standings_official WHERE competition_season_id=5001 AND source='sportscore'")
        self.db.execute("DELETE FROM ops.resource_versions WHERE resource_kind='competition_season' AND resource_id=5001")
        self.scope = "standings:" + CASES[0]["key"]
        self.db.execute("DELETE FROM ops.source_runs WHERE source='sportscore' AND scope=%s", (self.scope,))

    def read(self):
        return self.db.execute("""SELECT team_id,points,as_of,version FROM api.standings s
                                   JOIN ops.resource_versions v ON v.resource_kind='competition_season'
                                   AND v.resource_id=s.competition_season_id
                                   WHERE s.competition_season_id=5001 ORDER BY position""").fetchall()

    def attempt(self):
        return self.db.execute("""SELECT last_attempt_at,last_success_at,status,error_code,rows_written
                                  FROM ops.source_runs WHERE source='sportscore' AND scope=%s""", (self.scope,)).fetchone()

    def run_scope(self, conn, get, instant):
        return sources.run_due(conn, get, instant, names={"sportscore"})[("sportscore", self.scope)]

    def answer(self, rows, url):
        return replay.widget(tables((None, rows)), replay.slug_of(url))

    def test_first_publisher_remains_current_when_the_older_observation_finishes_last(self):
        from vega.store import connect_local

        with patch.object(sportscore, "scopes", lambda _: {self.scope: sportscore.PERIOD}), connect_local(DSN) as writer:
            for delay in (3, 0):
                with self.subTest(delay=delay):
                    self.setUp()
                    later = T0 + delay * H
                    published = []

                    def delayed(url):
                        self.assertIsNone(self.attempt())
                        self.assertEqual(self.run_scope(writer, lambda u: self.answer(replace(START, 0, pts=9), u), later), "ok")
                        published.extend(self.read())
                        return self.answer(START, url)

                    self.assertEqual(self.run_scope(self.db, delayed, T0), "STALE_OBSERVATION")
                    self.assertEqual(self.read(), published)
                    self.assertEqual(published[0], (101, 9, later, 1))
                    self.assertEqual(self.attempt(), (later, later, "ok", None, 3))

    def test_an_older_transport_failure_cannot_replace_a_new_success_and_a_fresh_retry_works(self):
        from vega.store import connect_local

        with patch.object(sportscore, "scopes", lambda _: {self.scope: sportscore.PERIOD}), connect_local(DSN) as writer:
            def fail(_):
                raise SourceError("HTTP_503")

            def delayed(url):
                self.assertEqual(self.run_scope(writer, lambda u: self.answer(replace(START, 0, pts=9), u), T0 + 3 * H), "ok")
                return fail(url)

            self.assertEqual(self.run_scope(self.db, delayed, T0), "HTTP_503")
            self.assertEqual(self.attempt(), (T0 + 3 * H, T0 + 3 * H, "ok", None, 3))
            self.assertEqual(self.run_scope(self.db, fail, T0 + 6 * H), "HTTP_503")
            self.assertEqual(self.attempt(), (T0 + 6 * H, T0 + 3 * H, "error", "HTTP_503", 0))
            self.assertEqual(self.run_scope(self.db, lambda u: self.answer(START, u), T0 + 7 * H), "ok")
            self.assertEqual(self.read()[0], (101, 8, T0 + 7 * H, 2))


if __name__ == "__main__":
    unittest.main()
