"""Archive statuses, reviewed copies, stable goal keys and the replay guard (VI-27 lot 2), written
before the code: FAILURE_MODES.md §20.

Inputs are real 2019/20 football.json rows (openfootball, CC0, revision e6744429) and scorer rows in
the worldclub layout. The builders, edition.mjs and the loader run for real; the replay tests use a
disposable local PostgreSQL (VEGA_V2_ARCHIVE_REPAIR_TEST_DSN, database vega_v2_archive_repair_test).
"""

import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlparse
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from vega import archives  # noqa: E402
from archive_fixtures import make_sources  # noqa: E402
from template_base import fresh  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_ARCHIVE_REPAIR_TEST_DSN")
NODE = shutil.which("node")

# Real rows of 2019-20/en.3.json and 2019-20/ru.1.json (football.json e6744429).
EN3 = {"name": "English League One 2019/20", "matches": [
    {"round": "Matchday 1", "date": "2019-08-03", "team1": "Bristol Rovers", "team2": "Coventry City", "score": {"ft": [2, 2], "ht": [1, 1]}},
    {"round": "Matchday 38", "date": "2020-03-14", "team1": "Bristol Rovers", "team2": "Ipswich Town", "score": {}, "status": "cancelled"},
    {"round": "Matchday 38", "date": "2020-03-14", "team1": "Port Vale FC", "team2": "Crawley Town", "score": {}, "status": "cancelled"},
]}
RU1 = {"name": "Russia Premier League 2019/20", "matches": [
    {"round": "Matchday 1", "date": "2019-07-13", "team1": "FK Krasnodar", "team2": "FK Orenburg", "score": {"ft": [1, 0]}},
    {"round": "Matchday 24", "date": "2020-06-27", "team1": "FK Orenburg", "team2": "FK Krasnodar", "score": {"ft": [0, 3]}, "status": "awarded"},
]}


def builder():
    spec = importlib.util.spec_from_file_location("build_openfootball_history", ROOT / "archives/builders/build_openfootball_history.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def football_zip(path, files):
    """A football.json snapshot zip: {"2019-20/en.3.json": body (dict, or exact bytes)}."""
    with zipfile.ZipFile(path, "w") as z:
        for name, body in files.items():
            z.writestr(f"football.json-test/{name}", body if isinstance(body, bytes) else json.dumps(body))
    return path


@unittest.skipUnless(NODE, "requires node")
class StatusTest(unittest.TestCase):
    """20a, 20b, 20e: the source's status through the builder, edition.mjs and match_row."""

    def edition(self, files):
        work = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, work, True)
        builder().build(football_zip(work / "in.zip", files), work / "out")
        return archives.edition(work / "out/2019-2020.json.gz", None)

    def rows(self, files):
        return {(m["team1"], m["team2"]): archives.match_row(m) for m in self.edition(files)["matches"]}

    def test_20a_a_cancelled_match_is_canceled_without_a_score(self):
        rows = self.rows({"2019-20/en.3.json": EN3})
        for pair in (("Bristol Rovers", "Ipswich Town"), ("Port Vale FC", "Crawley Town")):
            self.assertEqual((rows[pair]["status"], rows[pair]["home_score"], rows[pair]["away_score"]), ("canceled", None, None), pair)
        self.assertEqual((rows[("Bristol Rovers", "Coventry City")]["status"], rows[("Bristol Rovers", "Coventry City")]["home_score"]), ("finished", 2))
        canceled = copy.deepcopy(EN3)
        canceled["matches"][1]["status"] = "canceled"
        self.assertEqual(self.rows({"2019-20/en.3.json": canceled})[("Bristol Rovers", "Ipswich Town")]["status"], "canceled")

    def test_20b_an_awarded_result_keeps_its_score(self):
        rows = self.rows({"2019-20/ru.1.json": RU1})
        awarded = rows[("FK Orenburg", "FK Krasnodar")]
        self.assertEqual((awarded["status"], awarded["home_score"], awarded["away_score"]), ("awarded", 0, 3))
        self.assertEqual(rows[("FK Krasnodar", "FK Orenburg")]["status"], "finished")

    def test_20e_a_contradictory_or_unknown_status_refuses_the_season(self):
        for change in ({"status": "cancelled", "score": {"ft": [1, 0]}}, {"status": "awarded", "score": {}}, {"status": "postponed"}):
            with self.subTest(change=change):
                body = copy.deepcopy(EN3)
                body["matches"][1].update(change)
                edition = self.edition({"2019-20/en.3.json": body})
                with self.assertRaises(archives.ArchiveError):
                    for match in edition["matches"]:
                        archives.match_row(match)


class ReviewedCopyTest(unittest.TestCase):
    """20c, 20d: ru.2 left out only at its reviewed hash; no other identical pair passes."""

    def build(self, files, reviewed=None):
        work = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, work, True)
        module = builder()
        if reviewed is not None:
            module.REVIEWED_COPIES = reviewed
        module.build(football_zip(work / "in.zip", files), work / "out")
        index = json.loads((work / "out/index.json").read_text())
        season = json.loads(__import__("gzip").decompress((work / "out/2019-2020.json.gz").read_bytes()))
        return index, [c["id"] for c in season["competitions"]]

    def test_20c_the_reviewed_copy_is_left_out_and_listed(self):
        self.assertEqual(builder().REVIEWED_COPIES["2019-20/ru.2.json"]["sha256"], "7eda7c911d458f248b24954d093fbf0790a1eab889de6030fe5cdfd220146597")
        copy_bytes = json.dumps(RU1).encode()
        reviewed = {"2019-20/ru.2.json": {"sha256": hashlib.sha256(copy_bytes).hexdigest(), "copy_of": "2019-20/ru.1.json", "note": "test"}}
        index, competitions = self.build({"2019-20/ru.1.json": RU1, "2019-20/ru.2.json": copy_bytes}, reviewed)
        self.assertEqual(competitions, ["2019-20/ru.1"])
        self.assertEqual(index["excluded"], [{"file": "2019-20/ru.2.json", "sha256": hashlib.sha256(copy_bytes).hexdigest(),
                                              "copy_of": "2019-20/ru.1.json", "note": "test"}])

    def test_20d_other_bytes_or_an_unreviewed_identical_pair_fail_the_build(self):
        other = copy.deepcopy(RU1)
        other["matches"][0]["score"] = {"ft": [2, 0]}
        reviewed = {"2019-20/ru.2.json": {"sha256": "0" * 64, "copy_of": "2019-20/ru.1.json", "note": "test"}}
        with self.assertRaises(ValueError):
            self.build({"2019-20/ru.1.json": RU1, "2019-20/ru.2.json": other}, reviewed)
        with self.assertRaises(ValueError):
            self.build({"2019-20/fr.1.json": EN3, "2019-20/fr.2.json": EN3}, {})
        index, competitions = self.build({"2019-20/fr.1.json": EN3, "2019-20/fr.2.json": RU1}, {})  # 20m: different competitions
        self.assertEqual(sorted(competitions), ["2019-20/fr.1", "2019-20/fr.2"])


@unittest.skipUnless(DSN and psycopg and NODE, "requires a disposable local archive repair DB (VEGA_V2_ARCHIVE_REPAIR_TEST_DSN), psycopg and node")
class ReplayTest(unittest.TestCase):
    """20h, 20j, 20k, 20l, 20n, 20o: the loader on a real base."""

    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_archive_repair_test":
            raise RuntimeError("dedicated local archive repair DB required")
        cls.db = fresh(DSN)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        self.x = self.db.execute
        self.x("""TRUNCATE core.matches, core.rounds, core.competition_seasons, core.competitions, core.provider_ids, core.teams,
                  core.source_revisions, ops.resource_versions, ops.parse_failures RESTART IDENTITY CASCADE""")
        self.work = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.work, True)

    def sources(self, files, goals=None, name="s"):
        root = self.work / name
        make_sources(root, goals)
        football_zip(root / "openfootball/football-json-test.zip", files)
        return root

    def state(self):
        return self.x("""SELECT m.archive_key, m.id, m.status::text, m.home_score, m.away_score, m.home_team_id, m.away_team_id,
                                m.home_team_name, m.revision, m.updated_at, m.archive_position,
                                (SELECT count(*) FROM core.match_events e WHERE e.match_id = m.id)
                         FROM core.matches m WHERE m.archive_key IS NOT NULL ORDER BY 1""").fetchall()

    def version(self):
        row = self.x("SELECT version FROM ops.resource_versions WHERE resource_kind = 'archive_season' AND resource_id = 2019").fetchone()
        return row and row[0]

    def test_20j_a_stored_season_is_repaired_in_place_once(self):
        files = {"2019-20/en.3.json": EN3, "2019-20/ru.1.json": RU1}
        archives.run(self.db, self.sources(files), {"2019/2020"})
        # As the baseline stored it: the cancellations and the awarded result finished.
        self.x("UPDATE core.matches SET status = 'finished' WHERE status IN ('canceled', 'awarded')")
        before, version = self.state(), self.version()
        archives.run(self.db, self.sources(files, name="again"), {"2019/2020"})
        after = self.state()
        self.assertEqual([r[:2] for r in after], [r[:2] for r in before])  # same keys, same ids
        repaired = {r[0] for r in after if r[2] in ("canceled", "awarded")}
        self.assertEqual(len(repaired), 3)
        for old, new in zip(before, after):
            self.assertEqual(new[8], old[8] + (1 if new[0] in repaired else 0), new[0])
        self.assertGreater(self.version(), version)
        settled, version = self.state(), self.version()
        archives.run(self.db, self.sources(files, name="third"), {"2019/2020"})
        self.assertEqual((self.state(), self.version()), (settled, version))

    def test_20k_a_missing_family_or_unexplained_removal_is_refused(self):
        archives.run(self.db, self.sources({"2019-20/en.3.json": EN3, "2019-20/ru.1.json": RU1}), {"2019/2020"})
        before, version = self.state(), self.version()
        with self.assertRaises(archives.ArchiveError):
            archives.run(self.db, self.sources({"2019-20/en.3.json": EN3}, name="partial"), {"2019/2020"})
        truncated = copy.deepcopy(EN3)
        truncated["matches"] = truncated["matches"][:1]
        with self.assertRaises(archives.ArchiveError):
            archives.run(self.db, self.sources({"2019-20/en.3.json": truncated, "2019-20/ru.1.json": RU1}, name="short"), {"2019/2020"})
        self.assertEqual((self.state(), self.version()), (before, version))

    def test_20l_matches_shifted_by_a_new_competition_move_position_only(self):
        archives.run(self.db, self.sources({"2019-20/ru.1.json": RU1}), {"2019/2020"})
        before = {r[0]: r for r in self.state()}
        later = {"name": "Late League 2019/20", "matches": [
            {"round": "1", "date": "2020-07-30", "team1": "Late A", "team2": "Late B", "score": {"ft": [1, 1]}}]}
        archives.run(self.db, self.sources({"2019-20/ru.1.json": RU1, "2019-20/nl.1.json": later}, name="more"), {"2019/2020"})
        after = {r[0]: r for r in self.state()}
        moved = [k for k in before if after[k][10] != before[k][10]]
        self.assertTrue(moved)
        for key in before:
            self.assertEqual(after[key][1:10], before[key][1:10], key)  # id, values, revision, updated_at

    def test_20h_an_unparsed_label_names_no_team(self):
        goals = {"eng-premier-league": [
            ("2015-2016", "2015-08-22", "no readable label here", "Somebody", "Somewhere", "10", "1", "0"),
        ]}
        archives.run(self.db, self.sources({}, goals), {"2015/2016"})
        rows = self.x("SELECT home_team_id, away_team_id, home_team_name FROM core.matches WHERE archive_key LIKE 'g:%'").fetchall()
        self.assertIn((None, None, "no readable label here"), rows)
        self.assertFalse(self.x("SELECT 1 FROM core.teams WHERE name = 'no readable label here'").fetchone())

    def test_20o_an_absorption_is_held_with_or_without_dependents(self):
        # §22 replaces §20's guarded deletion: one match captured twice, once with layout whitespace and once
        # clean. The legacy reading published two goal-only rows; the corrected reading would merge them. Both
        # rows stay, with their goals, whatever depends on them.
        goals = {"eng-premier-league": [
            ("2015-2016", "2015-08-08", "Arsenal vs. West Ham United 0:2 \t\t\n\t(Hinspiel 1:1)", "Mauro Zárate", "West Ham United", "57", "0", "2"),
            ("2015-2016", "2015-08-08", "Arsenal vs. West Ham United 0:2 (Hinspiel 1:1)", "Cheikhou Kouyaté", "West Ham United", "43", "0", "1"),
        ]}
        source = self.sources({}, goals)
        results, goals_dir = archives.build_sources(source, self.work / "built")
        index = json.loads((goals_dir / "index.json").read_text())
        edition = archives.edition(None, goals_dir / Path(index["seasons"][0]["path"]).name)
        self.assertEqual(edition["absorbed"], [])
        [held] = edition["held"]
        self.assertEqual(held["reason"], "absorption")
        archives.run(self.db, source, {"2015/2016"})
        before = self.state()
        self.assertTrue(set(held["legacy"]) <= {r[0] for r in before})
        legacy = self.x("SELECT id FROM core.matches WHERE archive_key = %s", (held["legacy"][0],)).fetchone()[0]
        self.x("INSERT INTO ops.data_warnings(match_id, kind, detail) VALUES (%s, 'duplicate_match', 'test')", (legacy,))
        archives.run(self.db, self.sources({}, goals, name="again"), {"2015/2016"})
        self.assertEqual(self.state(), before)
        self.x("DELETE FROM ops.data_warnings WHERE match_id = %s", (legacy,))
        archives.run(self.db, self.sources({}, goals, name="third"), {"2015/2016"})
        self.assertEqual(self.state(), before)

    def test_20n_the_plan_reads_only_and_is_deterministic(self):
        files = {"2019-20/en.3.json": EN3, "2019-20/ru.1.json": RU1}
        archives.run(self.db, self.sources(files), {"2019/2020"})
        self.x("UPDATE core.matches SET status = 'finished' WHERE status IN ('canceled', 'awarded')")
        seq = lambda: self.x("SELECT last_value FROM core.matches_id_seq").fetchone()[0]  # noqa: E731
        before, last = self.state(), seq()
        frozen_inputs = self.sources(files, name="p1")
        first = archives.plan(self.db, frozen_inputs, {"2019/2020"})
        again = archives.plan(self.db, frozen_inputs, {"2019/2020"})
        self.assertEqual(archives.canonical(first), archives.canonical(again))
        # The files in another order: another archive (its own hash), the same season plans.
        second = archives.plan(self.db, self.sources(dict(reversed(list(files.items()))), name="p2"), {"2019/2020"})
        self.assertEqual(archives.canonical(first["seasons"]), archives.canonical(second["seasons"]))
        self.assertEqual((self.state(), seq()), (before, last))
        changed = [m for m in first["seasons"]["2019/2020"]["matches"] if m["class"] == "changed"]
        expected = sorted(r[0] for r in before if r[3] is None or (r[7] == "FK Orenburg" and r[3] == 0))
        self.assertEqual(sorted(m["key"] for m in changed), expected)
        self.assertEqual({m["after"]["row"]["status"] for m in changed}, {"canceled", "awarded"})  # §22: whole rows bound
        self.assertTrue(all(m["id"] and m["revision"] for m in changed))


if __name__ == "__main__":
    unittest.main()
