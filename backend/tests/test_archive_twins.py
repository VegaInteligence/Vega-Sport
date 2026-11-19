"""Main's archive twins (goalTwins, merge_twins, 0f368fd389) under the branch's archive guarantees, written before the
code: FAILURE_MODES.md §35 (35a–35i).

The builders, edition.mjs, the loader, the plan, the apply and merge_twins run for real on a disposable local
PostgreSQL (VEGA_V2_ARCHIVE_TWINS_TEST_DSN, database vega_v2_archive_twins_test), under the collection role the worker
and the archive CLI use (vega_collect); the archive reads go through the real read API under vega_read
(tests/read_http.mjs). The twin: Leicester City–Sunderland 4–2 of 8 August 2015 in the results archive, and its goal
in the goals archive dated 11 August (three days later), which the first pass of the edition cannot attach.

Failure modes covered: the edition re-creating a match merge_twins removed (35b); a stored twin making the plan refuse
the season without saying why (35c); a quarantined, attested or ledger pair merged without its review (35d);
merge_twins waiting behind or interleaving with an archive apply (35e); one failing season stopping every later one
(35f); a removed goal-only match leaving no tombstone, so that no reviewed alias can name it (35g); a plan made before
the merge applied over it (35h).
"""

import contextlib
import copy
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import quote, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from vega import archive_attestations, archives  # noqa: E402
from archive_fixtures import GOALS, make_sources  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_ARCHIVE_TWINS_TEST_DSN")
NODE = shutil.which("node")
HTTP_READY = bool(NODE) and (ROOT / "api" / "node_modules" / "pg").is_dir()
SEASON = "2015/2016"
RESULT = "r:2015-16/en.1:1"  # Leicester City FC–Sunderland AFC 4–2, 8 August 2015 (results archive)
TWIN = "g:eng-premier-league:2015-08-11:2"  # its goal, dated 11 August (goals archive)
EVERTON = "g:eng-premier-league:2015-08-09:1"  # a goal-only match with no result: never merged
LEICESTER = ("2015-2016", "2015-08-11", "Leicester City vs. Sunderland 4:2", "Jamie Vardy", "Leicester City", "11", "1", "0")
TWIN_GOALS = {"eng-premier-league": [GOALS[0], GOALS[1], LEICESTER, GOALS[3]]}
# The same goal file with the twin's label scored 4:1: no twin, so an import stores both rows; the stored goal-only row
# is then given its true score, which is how the base holds such a pair (written before goalTwins existed).
APART_GOALS = {"eng-premier-league": [GOALS[0], GOALS[1], LEICESTER[:2] + ("Leicester City vs. Sunderland 4:1",) + LEICESTER[3:], GOALS[3]]}


@unittest.skipUnless(DSN and psycopg and NODE, "requires a disposable local archive twins DB (VEGA_V2_ARCHIVE_TWINS_TEST_DSN), psycopg and node")
class ArchiveTwinsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_archive_twins_test":
            raise RuntimeError("dedicated local archive twins DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        from vega.store import connect_local

        self.x = self.db.execute
        self.x("RESET ROLE")
        self.x("""TRUNCATE core.matches, core.rounds, core.competition_seasons, core.competitions, core.provider_ids, core.teams,
                  core.source_revisions, ops.resource_versions, ops.parse_failures, ops.archive_plans, ops.archive_removals,
                  core.archive_match_attestations, ops.match_watch RESTART IDENTITY CASCADE""")
        self.collect = connect_local(DSN)
        self.addCleanup(self.collect.close)
        self.collect.execute("SET ROLE vega_collect")
        self.work = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.work, True)
        self.n = 0

    # -- the base and its reads --
    def sources(self, goals=None):
        self.n += 1
        return make_sources(self.work / f"s{self.n}", goals or TWIN_GOALS)

    def seed_apart(self):
        """The base as the editions before goalTwins left it (production before main's merge_twins): the result
        without goals on 8 August, the goal-only match with the goal on 11 August, both 4–2."""
        archives.run(self.collect, self.sources(APART_GOALS), {SEASON})
        self.x("UPDATE core.matches SET away_score = 2 WHERE archive_key = %s", (TWIN,))
        self.assertEqual(self.rows()[TWIN][2:5], ("2015-08-11", 4, 2))
        self.assertEqual(self.rows()[RESULT][2:5], ("2015-08-08", 4, 2))

    def rows(self):
        return {r[0]: r[1:] for r in self.x(
            """SELECT archive_key, id, (SELECT count(*) FROM core.match_events e WHERE e.match_id = m.id AND e.event_type = 'goal'),
                      match_date::text, home_score, away_score, home_team_id, away_team_id
               FROM core.matches m WHERE archive_key IS NOT NULL ORDER BY 1""").fetchall()}

    def state(self):
        """Everything a write would change: rows (with revision, position and row version), events, versions, tombstones."""
        return (self.x("""SELECT archive_key, id, match_date, home_score, away_score, revision, archive_position, xmin::text
                          FROM core.matches WHERE archive_key IS NOT NULL ORDER BY 1""").fetchall(),
                self.x("SELECT match_id, seq, team_id, player_name, xmin::text FROM core.match_events ORDER BY 1, 2").fetchall(),
                self.x("SELECT resource_kind::text, resource_id, version FROM ops.resource_versions ORDER BY 1, 2").fetchall(),
                self.x("SELECT kind, id, archive_key FROM ops.archive_removals ORDER BY 1, 2").fetchall())

    def plan(self, source=None):
        return archives.plan(self.collect, source or self.sources(), {SEASON})["seasons"][SEASON]

    def merge(self):
        held = []
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            merged = archives.merge_twins(self.collect, held)
        return merged, held, out.getvalue()

    def read(self, *requests):
        done = subprocess.run([NODE, str(ROOT / "tests" / "read_http.mjs"), DSN, json.dumps(list(requests))],
                              capture_output=True, text=True, timeout=120)
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout.strip().splitlines()[-1])

    def match_read(self, key):
        return f"/api/read/archive?season={quote(SEASON)}&match={quote(key)}"

    # -- 35a --
    def test_35a_a_fresh_import_stores_the_twin_once(self):
        archives.run(self.collect, self.sources(), {SEASON})
        rows = self.rows()
        self.assertNotIn(TWIN, rows)
        self.assertEqual(rows[RESULT][1:5], (1, "2015-08-11", 4, 2))  # the goal and the goals' day
        home = rows[RESULT][5]
        self.assertEqual(self.x("SELECT team_id, player_name FROM core.match_events WHERE match_id = %s", (rows[RESULT][0],)).fetchall(),
                         [(home, "Jamie Vardy")])
        self.assertIn(EVERTON, rows)  # a goal-only match without a result stays
        self.assertEqual(self.x("SELECT count(*) FROM ops.archive_removals").fetchone()[0], 0)
        with archives.editions(self.sources(), {SEASON}) as (_inputs, _results, _goals, _labels, seasons):
            data = next(data for label, data, _p, _e in seasons if label == SEASON)
        self.assertEqual(data["absorbed"], [{"goal": TWIN, "result": RESULT, "date": "2015-08-11"}])

    # -- 35b, 35c --
    def test_35c_a_stored_twin_refuses_the_season_by_name_until_merge_twins(self):
        self.seed_apart()
        before = self.state()
        planned = self.plan()
        self.assertIsNotNone(planned["refused"])
        self.assertIn("TWIN_NOT_MERGED", planned["refused"])
        self.assertIn(TWIN, planned["refused"])
        self.assertIn(RESULT, planned["refused"])
        self.assertEqual(self.state(), before)  # read only

        merged, held, printed = self.merge()  # 35b: what main's worker does every day
        self.assertEqual((merged, held), ({SEASON: 1}, []))
        self.assertIn("archive twins merged", printed)
        rows = self.rows()
        self.assertNotIn(TWIN, rows)
        self.assertEqual(rows[RESULT][1:5], (1, "2015-08-11", 4, 2))
        after = self.plan()
        self.assertIsNone(after["refused"])
        entries = {m["key"]: m for m in after["matches"]}
        # Nothing of the pair is to write but its place in the season's order (merge_twins keeps archive_position).
        self.assertNotIn(TWIN, entries)
        self.assertIn(entries.get(RESULT, {}).get("class", "unchanged"), ("unchanged", "position"))
        self.assertEqual(after["counts"]["held"], 0)
        self.assertEqual((after["counts"]["new"], after["counts"]["changed"], after["counts"]["goals"]), (0, 0, 0))
        settled = self.state()
        self.assertEqual(self.merge()[0], {})
        self.assertEqual(self.state(), settled)

    # -- 35d --
    def test_35d_a_quarantined_pair_is_never_merged(self):
        reviewed = {"reason": "test_hold", "file": "worldclub/goals/eng-premier-league.csv", "sha256": "0" * 64, "production_id": 0}
        self.seed_apart()  # a quarantined key is a stored row, never written fresh
        with patch.dict(archives.QUARANTINE, {TWIN: reviewed}):
            before = self.state()
            planned = self.plan()
            self.assertIsNone(planned["refused"])
            self.assertEqual({m["key"]: m["held"] for m in planned["matches"] if m["class"] == "held"}.get(TWIN), "test_hold")
            self.assertIn({"goal": TWIN, "result": RESULT, "reason": "kept"}, planned["twins_held"])
            merged, held, printed = self.merge()
        self.assertEqual(merged, {})
        self.assertEqual(held, [{"season": SEASON, "goal": TWIN, "result": RESULT, "reason": "quarantine"}])
        self.assertIn("archive twins held", printed)
        self.assertEqual(self.state(), before)

    def test_35d_an_attested_result_is_never_merged(self):
        self.seed_apart()
        result = self.rows()[RESULT][0]
        self.x("""INSERT INTO core.archive_match_attestations(season_id, match_id, canonical_key, canonical_date, authority_key, proof_sha256, proof)
                  VALUES (2015, %s, %s, '2015-08-08', 'test:attested', %s, '{}'::jsonb)""", (result, RESULT, "1" * 64))
        before = self.state()
        merged, held, _ = self.merge()
        self.assertEqual(merged, {})
        self.assertEqual(held, [{"season": SEASON, "goal": TWIN, "result": RESULT, "reason": "attested"}])
        self.assertEqual(self.state(), before)

    def test_35d_a_ledger_key_is_never_merged(self):
        ledger = copy.deepcopy(archive_attestations.SCOTLAND)
        ledger["cases"] = list(ledger["cases"]) + [{"match": {"key": RESULT}}]
        with patch.object(archive_attestations, "SCOTLAND", ledger):
            self.seed_apart()
            before = self.state()
            merged, held, _ = self.merge()
        self.assertEqual(merged, {})
        self.assertEqual(held, [{"season": SEASON, "goal": TWIN, "result": RESULT, "reason": "ledger"}])
        self.assertEqual(self.state(), before)

    # -- 35e --
    def test_35e_an_apply_in_progress_stops_the_pass_without_error(self):
        from vega.store import connect_local

        self.seed_apart()
        before = self.state()
        with connect_local(DSN) as applier:
            with applier.transaction():
                applier.execute("SELECT pg_advisory_xact_lock(hashtext('vega.archives.apply'))")
                done = []
                worker = threading.Thread(target=lambda: done.append(self.merge()))
                worker.start()
                worker.join(20)
                self.assertFalse(worker.is_alive(), "merge_twins waited behind an archive apply")
        merged, held, printed = done[0]
        self.assertEqual((merged, held), ({}, []))
        self.assertIn("archive twins skipped", printed)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.merge()[0], {SEASON: 1})

    # -- 35f --
    def test_35f_one_failing_season_does_not_stop_the_later_ones(self):
        self.seed_apart()
        # An earlier season with its own twin, whose goal-only match something else still names without ON DELETE:
        # deleting it fails on its foreign key.
        comp = "t/2005/pt.1"
        goal = lambda team, minute: {"team": team, "minute": minute, "player": f"P{minute}", "score": [1, 0], "side": "home"}
        data = {"competitions": [{"id": comp, "name": "Liga", "country": "Portugal"}], "matches": [
            {"key": f"r:{comp}:1", "competitionId": comp, "date": "2006-03-05", "team1": "Sp Lisbon", "team2": "Gil Vicente", "score": [2, 0]},
            {"key": "g:por:2006-03-05:9", "competitionId": comp, "date": "2006-03-05", "team1": "Sporting CP", "team2": "Gil Vicente",
             "score": [2, 0], "goals": [goal("Sporting CP", "12"), goal("Sporting CP", "80")]},
        ]}
        with self.collect.transaction():
            archives.Loader(self.collect).season("2005/2006", data, lambda match: "engsoccerdata")
        stuck = self.x("SELECT id FROM core.matches WHERE archive_key = 'g:por:2006-03-05:9'").fetchone()[0]
        self.x("INSERT INTO ops.match_watch(match_id) VALUES (%s)", (stuck,))
        portugal = self.x("""SELECT archive_key, match_date, home_score FROM core.matches WHERE season_id = 2005 ORDER BY 1""").fetchall()
        merged, held, printed = self.merge()
        self.assertEqual(merged, {SEASON: 1})
        self.assertIn("archive twins failed season=2005/2006", printed)
        self.assertEqual(self.x("""SELECT archive_key, match_date, home_score FROM core.matches WHERE season_id = 2005 ORDER BY 1""").fetchall(),
                         portugal)
        self.assertNotIn(TWIN, self.rows())

    # -- 35ab (FAILURE_MODES.md §35.3) --
    def test_35ab_merge_twins_clears_a_football_data_pair_and_keeps_its_row(self):
        self.seed_apart()
        twin = self.rows()[TWIN][0]
        # football-data.co.uk's row of the match, paired with the goal-only row (140: unique, ON DELETE SET NULL).
        self.x("""INSERT INTO core.footballdata_matches(file_key, row_number, division, season_id, match_date, home_name, away_name,
                                                        home_goals, away_goals, match_id)
                  VALUES ('E0/2015', 2, 'E0', 2015, '2015-08-08', 'Leicester', 'Sunderland', 4, 2, %s)""", (twin,))
        merged, held, printed = self.merge()
        self.assertEqual((merged, held), ({SEASON: 1}, []))
        self.assertNotIn("archive twins failed", printed)
        self.assertEqual(self.x("SELECT row_number, match_id FROM core.footballdata_matches WHERE file_key = 'E0/2015'").fetchall(), [(2, None)])
        self.assertEqual(self.x("SELECT kind, id, archive_key FROM ops.archive_removals").fetchall(), [("match", twin, TWIN)])

    # -- 35af (FAILURE_MODES.md §35.3) --
    def test_35af_after_merge_twins_the_next_pairing_gives_the_football_data_row_the_result(self):
        from vega.sources import footballdata

        self.seed_apart()
        rows = self.rows()
        result, twin, arsenal = rows[RESULT][0], rows[TWIN][0], rows["r:2015-16/en.1:0"][0]
        # The reader pairs only the archived matches of its divisions' countries (footballdata.DIVISIONS).
        self.assertEqual(self.x("""SELECT DISTINCT cs.archive_country FROM core.matches m
                                   JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
                                   WHERE m.archive_key IS NOT NULL""").fetchall(), [("Angleterre",)])
        # Two rows of the season's file, Leicester–Sunderland on the goals archive's day; the reader's pairing under the
        # collection role, in a transaction as sources.run_due runs it, one vote enough as in its own test.
        self.x("""INSERT INTO core.footballdata_matches(file_key, row_number, division, season_id, match_date, home_name, away_name,
                                                        home_goals, away_goals)
                  VALUES ('E0/1516', 2, 'E0', 2015, '2015-08-08', 'Arsenal', 'West Ham', 0, 2),
                         ('E0/1516', 3, 'E0', 2015, '2015-08-11', 'Leicester', 'Sunderland', 4, 2)""")
        pairs = "SELECT row_number, match_id FROM core.footballdata_matches WHERE file_key = 'E0/1516' ORDER BY 1"

        def link():
            with self.collect.transaction():
                footballdata._link(self.collect)
            return dict(self.x(pairs).fetchall())

        with patch.object(footballdata, "MIN_VOTES", 1):
            before = link()
            self.assertEqual(before[2], arsenal)
            self.assertIn(before[3], (twin, None))  # the goal-only twin's, or none (two candidates)
            merged, held, printed = self.merge()
            self.assertEqual((merged, held), ({SEASON: 1}, []))
            self.assertNotIn("archive twins failed", printed)
            self.assertEqual(dict(self.x(pairs).fetchall()), {2: arsenal, 3: None})
            self.assertEqual(link(), {2: arsenal, 3: result})
        self.assertEqual(self.rows()[RESULT][0], result)

    # -- 35g --
    @unittest.skipUnless(HTTP_READY, "requires backend/api/node_modules")
    def test_35g_links_after_the_merge(self):
        self.seed_apart()
        rows = self.rows()
        result, twin = rows[RESULT][0], rows[TWIN][0]
        self.assertEqual(self.merge()[0], {SEASON: 1})
        self.assertEqual(self.x("SELECT kind, id, season_id, archive_key, plan_sha256 FROM ops.archive_removals").fetchall(),
                         [("match", twin, 2015, TWIN, None)])
        self.assertEqual(self.rows()[RESULT][0], result)  # the result keeps its row and id
        kept, gone = self.read({"path": self.match_read(RESULT)}, {"path": self.match_read(TWIN)})
        self.assertEqual(kept["status"], 200)
        self.assertEqual((kept["body"]["data"]["match"]["key"], kept["body"]["data"]["match"]["date"]), (RESULT, "2015-08-11"))
        self.assertEqual([g["player"] for g in kept["body"]["data"]["match"]["goals"]], ["Jamie Vardy"])
        self.assertEqual(gone["status"], 404)  # as on main: the merged goal-only key is not an alias by itself
        # The tombstone lets a reviewed alias name the removed key later (149), and the alias answers.
        self.x("""INSERT INTO core.archive_match_attestations(season_id, match_id, canonical_key, former_key, former_id, canonical_date,
                                                              authority_key, proof_sha256, proof)
                  VALUES (2015, %s, %s, %s, %s, '2015-08-11', 'test:alias', %s, '{}'::jsonb)""", (result, RESULT, TWIN, twin, "2" * 64))
        by_key, by_id = self.read({"path": self.match_read(TWIN)}, {"path": self.match_read(f"m_v{twin:07d}")})
        self.assertEqual((by_key["status"], by_id["status"]), (200, 200))
        self.assertEqual(by_key["body"]["data"]["match"]["key"], RESULT)
        # A late reference to the removed id is refused (141).
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            with self.collect.transaction():
                self.collect.execute("INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('match', %s)", (twin,))

    # -- 35h --
    def test_35h_a_plan_made_before_the_merge_is_refused_without_a_write(self):
        self.seed_apart()
        source = self.sources()
        approved = archives.plan(self.collect, source, {SEASON})
        # The plan the code before this merge made: its parser manifest had no twins.mjs and another archive.js.
        older = copy.deepcopy(approved)
        older["inputs"]["code"].pop("archives/twins.mjs", None)
        older["inputs"]["code"]["shared/archive.js"] = "0" * 64
        before = self.state()
        with self.assertRaises(archives.ArchiveError) as caught:
            archives.apply(self.collect, source, older, {SEASON})
        self.assertIn("differ from the reviewed plan", str(caught.exception))
        self.assertEqual(self.state(), before)
        # The plan made now, stored, then the rows merged under it: its season is decided without a write.
        digest = archives.store_plan(self.collect, approved)
        self.assertEqual(self.merge()[0], {SEASON: 1})
        merged = self.state()
        report = archives.apply_stored(self.collect, source, digest)
        self.assertIn(report["seasons"][SEASON], ("refused", "drift"))
        self.assertEqual(self.state(), merged)
        decided = self.x("SELECT outcome, receipt FROM ops.archive_plan_seasons WHERE sha256 = %s", (digest,)).fetchone()
        self.assertEqual(decided[0], report["seasons"][SEASON])
        self.assertTrue(decided[1].get("refused") or decided[1].get("reason"))


if __name__ == "__main__":
    unittest.main()
