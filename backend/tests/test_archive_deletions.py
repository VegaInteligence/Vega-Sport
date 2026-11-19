"""Archive deletions, primary overlaps, durable applies and typed facts (VI-27), written before the code:
FAILURE_MODES.md §23.

The loader, the plan and the apply run for real on a disposable local PostgreSQL (VEGA_V2_ARCHIVE_DELETIONS_TEST_DSN,
database vega_v2_archive_deletions_test). The races use two real connections. The removal cases build the season's
edition directly (the reviewed-copy exclusion of the builder is 20c/20d's); the primary-overlap and stored-plan cases
run the real builders and edition.mjs.
"""

import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from vega import archives  # noqa: E402
from archive_fixtures import RECENT_GOALS, make_sources  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_ARCHIVE_DELETIONS_TEST_DSN")
NODE = shutil.which("node")
L = "2019/2020"
RU1, RU2 = "2019-20/ru.1", "2019-20/ru.2"
COPY = {RU2: RU1}
def PROVIDER(match):
    return "openfootball"


def result(competition, index, date, home, away, score):
    return {"key": f"r:{competition}:{index}", "competitionId": competition, "competition": competition, "country": "Russie",
            "date": date, "dateNote": False, "round": "Matchday 1", "team1": home, "team2": away, "score": score, "notes": [],
            "goals": None, "source": {"status": None, "ft": score, "et": None, "p": None, "neutral": False, "nonmatch": None}}


FIXTURES = [("2019-07-13", "FK Krasnodar", "FK Orenburg", [1, 0]), ("2019-07-14", "Zenit", "Spartak", [2, 2])]


def season(with_copy=True):
    competitions = [{"id": RU1, "name": "Russia Premier League 2019/20", "country": "Russie"}]
    matches = [result(RU1, n, *f) for n, f in enumerate(FIXTURES)]
    if with_copy:
        competitions.append({"id": RU2, "name": "Russia Premier League 2019/20", "country": "Russie"})
        matches += [result(RU2, n, *f) for n, f in enumerate(FIXTURES)]
    return {"season": L, "competitions": competitions, "matches": matches, "absorbed": [], "held": []}


@unittest.skipUnless(DSN and psycopg and NODE, "requires a disposable local archive deletions DB (VEGA_V2_ARCHIVE_DELETIONS_TEST_DSN), psycopg and node")
class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_archive_deletions_test":
            raise RuntimeError("dedicated local archive deletions DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        self.x = self.db.execute
        self.x("RESET ROLE")
        # (ops.archive_plan_seasons comes with migration 140: absent, the RED run still exercises each behaviour.)
        extra = ", ops.archive_plan_seasons" if self.x("SELECT to_regclass('ops.archive_plan_seasons')").fetchone()[0] else ""
        # Identities restart below: an old tombstone (§24) would refuse a new row with its id.
        extra += ", ops.archive_removals" if self.x("SELECT to_regclass('ops.archive_removals')").fetchone()[0] else ""
        self.x(f"""TRUNCATE core.matches, core.rounds, core.competition_seasons, core.competitions, core.provider_ids, core.teams,
                  core.source_revisions, ops.resource_versions, ops.parse_failures, ops.archive_plans{extra}
                  RESTART IDENTITY CASCADE""")
        self.work = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.work, True)
        self.n = 0

    def other(self):
        from vega.store import connect_local

        conn = connect_local(DSN)
        self.addCleanup(conn.close)
        return conn

    def state(self):
        return self.x("""SELECT m.archive_key, m.id, m.status::text, m.home_score, m.away_score, m.home_team_id, m.away_team_id,
                                m.home_team_name, m.revision, m.updated_at, m.xmin::text, m.competition_season_id
                         FROM core.matches m WHERE m.archive_key IS NOT NULL ORDER BY 1""").fetchall()

    def events(self):
        return self.x("""SELECT e.match_id, e.event_type::text, e.seq, e.player_name FROM core.match_events e ORDER BY 1, 3""").fetchall()

    def sources(self, goals=None):
        self.n += 1
        return make_sources(self.work / f"s{self.n}", goals)


class RemovalTest(Base):
    """23a-23e: a reviewed copy's removal binds the row, every event, its dependencies and its twin."""

    def setUp(self):
        super().setUp()
        with self.db.transaction():
            archives.Loader(self.db).season(L, season(), PROVIDER)
        self.ids = dict(self.x("SELECT archive_key, id FROM core.matches").fetchall())
        self.copy = self.ids[f"r:{RU2}:0"]

    def plan(self):
        return archives.season_plan(self.db, L, season(with_copy=False), PROVIDER, COPY)

    def apply(self, plan, conn=None):
        return archives.apply_season(conn or self.db, L, season(with_copy=False), PROVIDER, COPY, plan, {})

    def goal(self, conn, match, seq=901):
        conn.execute("""INSERT INTO core.match_events(season_id, match_id, team_id, seq, event_type, minute, score_home, score_away, player_name)
                        SELECT season_id, id, home_team_id, %s, 'goal', 12, 1, 0, 'Late observation' FROM core.matches WHERE id = %s""", (seq, match))

    def test_23d_a_clean_copy_is_removed_with_its_binding(self):
        plan = self.plan()
        removed = {r["key"]: r for r in plan["removed"]}
        self.assertEqual(sorted(removed), [f"r:{RU2}:0", f"r:{RU2}:1"])
        entry = removed[f"r:{RU2}:0"]
        self.assertEqual((entry["id"], entry["events"], entry["dependents"]), (self.copy, [], []))
        self.assertEqual(entry["row"]["home_team_name"], "FK Krasnodar")
        self.assertEqual(entry["twin"]["key"], f"r:{RU1}:0")
        self.assertEqual(entry["twin"]["id"], self.ids[f"r:{RU1}:0"])
        self.assertEqual(self.apply(plan), "applied")
        self.assertEqual(sorted(k for k, *_ in self.state()), [f"r:{RU1}:0", f"r:{RU1}:1"])
        self.assertFalse(self.x("SELECT 1 FROM core.competition_seasons WHERE archive_key = %s", (RU2,)).fetchone())

    def test_23a_a_goal_recorded_after_the_plan_refuses_the_season(self):
        plan = self.plan()
        self.goal(self.db, self.copy)
        before, events = self.state(), self.events()
        self.assertEqual(self.apply(plan), "drift")
        self.assertEqual((self.state(), self.events()), (before, events))
        # Planned again, the copy with its goal is held, never deleted.
        again = self.plan()
        self.assertNotIn(f"r:{RU2}:0", [r["key"] for r in again["removed"]])
        held = {m["key"]: m for m in again["matches"] if m["class"] == "held"}
        self.assertEqual(held[f"r:{RU2}:0"]["held"], "removal_has_dependents")
        self.assertEqual(self.apply(again), "partial")
        self.assertIn(f"r:{RU2}:0", [k for k, *_ in self.state()])
        self.assertNotIn(f"r:{RU2}:1", [k for k, *_ in self.state()])
        self.assertTrue(self.x("SELECT 1 FROM core.competition_seasons WHERE archive_key = %s", (RU2,)).fetchone())  # its edition stays
        self.assertEqual(len([e for e in self.events() if e[0] == self.copy]), 1)

    def test_23b_a_goal_inserted_during_the_apply_fails_on_its_foreign_key(self):
        plan = self.plan()
        other = self.other()
        other.execute("SET lock_timeout = '20s'")
        outcome = {}

        def late():
            try:
                self.goal(other, self.copy, 902)
                outcome["late"] = "inserted"
            except psycopg.Error as error:
                outcome["late"] = type(error).__name__

        def pause():
            thread = threading.Thread(target=late)
            thread.start()
            time.sleep(1.0)  # the late writer is now waiting on the copy's row lock
            outcome["thread"] = thread
            outcome["waiting"] = other.info.transaction_status != psycopg.pq.TransactionStatus.IDLE or thread.is_alive()

        with patch.object(archives, "_before_delete", pause):
            self.assertEqual(self.apply(plan), "applied")
        outcome["thread"].join(30)
        self.assertTrue(outcome["waiting"])
        self.assertEqual(outcome["late"], "ForeignKeyViolation")  # exposed to its writer, which retries
        self.assertFalse(self.x("SELECT 1 FROM core.match_events WHERE match_id = %s", (self.copy,)).fetchone())

    def test_23c_an_uncommitted_goal_before_the_locks_is_seen_and_refuses(self):
        plan = self.plan()
        other = self.other()
        go, inserted = threading.Event(), threading.Event()

        def writer():
            with other.transaction():
                self.goal(other, self.copy, 903)
                inserted.set()
                go.wait(30)

        thread = threading.Thread(target=writer)
        thread.start()
        inserted.wait(30)
        done = {}
        applier = threading.Thread(target=lambda: done.setdefault("outcome", self.apply(plan, self.other())))
        applier.start()
        time.sleep(1.0)
        self.assertTrue(applier.is_alive())  # waiting on the writer's lock
        go.set()
        thread.join(30)
        applier.join(60)
        self.assertEqual(done["outcome"], "drift")
        self.assertEqual(len([e for e in self.events() if e[0] == self.copy]), 1)

    def test_23e_a_provider_binding_holds_the_copy_or_refuses_the_season(self):
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match', 'vega', 'test:bound', %s)", (self.copy,))
        plan = self.plan()
        self.assertNotIn(f"r:{RU2}:0", [r["key"] for r in plan["removed"]])
        self.assertEqual({m["key"]: m["held"] for m in plan["matches"] if m["class"] == "held"}[f"r:{RU2}:0"], "removal_has_dependents")
        self.x("DELETE FROM core.provider_ids WHERE provider_key LIKE 'test:%%'")
        plan = self.plan()
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match', 'vega', 'test:late', %s)", (self.copy,))
        self.assertEqual(self.apply(plan), "drift")
        self.assertIn(f"r:{RU2}:0", [k for k, *_ in self.state()])

    def pair_copy(self):
        # football-data.co.uk's row of the copy's fixture, paired with the copy (140): Krasnodar–Orenburg 1-0, 13 July 2019.
        self.x("""INSERT INTO core.footballdata_matches(file_key, row_number, division, season_id, match_date, home_name, away_name,
                                                        home_goals, away_goals, match_id)
                  SELECT 'P1/1920', 2, 'P1', 2019, match_date, 'FK Krasnodar', 'FK Orenburg', home_score, away_score, id
                  FROM core.matches WHERE id = %s""", (self.copy,))

    def test_35ad_45f_a_football_data_pair_does_not_hold_the_copy(self):
        # FAILURE_MODES.md §45 (the owner's decision on §36's m4): the pair is ON DELETE SET NULL and the reader pairs
        # again, a pointer the next pairing gives to the twin that stays. Alone, it no longer holds a reviewed copy.
        from vega.sources import footballdata
        from vega.store import connect_local

        self.pair_copy()
        twin = self.ids[f"r:{RU1}:0"]
        plan = self.plan()
        removed = {r["key"]: r for r in plan["removed"]}
        self.assertIn(f"r:{RU2}:0", removed)
        self.assertEqual(removed[f"r:{RU2}:0"]["released"], ["core.footballdata_matches.match_id"])
        self.assertNotIn("released", removed[f"r:{RU2}:1"])  # an unpaired copy's entry as before
        self.assertNotIn(f"r:{RU2}:0", {m["key"] for m in plan["matches"] if m["class"] == "held"})
        collect = connect_local(DSN)
        self.addCleanup(collect.close)
        collect.execute("SET ROLE vega_collect")
        self.assertEqual(self.apply(plan, collect), "applied")
        self.assertNotIn(f"r:{RU2}:0", [k for k, *_ in self.state()])
        self.assertEqual(self.x("SELECT kind, id FROM ops.archive_removals WHERE kind = 'match' AND id = %s", (self.copy,)).fetchall(), [("match", self.copy)])
        pairs = "SELECT row_number, match_id FROM core.footballdata_matches WHERE file_key = 'P1/1920'"
        self.assertEqual(self.x(pairs).fetchall(), [(2, None)])  # the row is kept, unpaired
        # The reader's next pairing, under the collection role as sources.run_due runs it (one vote enough, as in 35af;
        # « Russie » stands for one of its countries): the twin that stays, then nothing more.
        with patch.dict(footballdata.DIVISIONS, {"P1": ("Russie", 1)}), patch.object(footballdata, "MIN_VOTES", 1):
            for _ in range(2):
                with collect.transaction():
                    footballdata._link(collect)
                self.assertEqual(self.x(pairs).fetchall(), [(2, twin)])
        again = self.plan()
        self.assertEqual(again["removed"], [])

    def test_45g_a_pair_with_another_dependency_still_holds_the_copy(self):
        self.pair_copy()
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match', 'vega', 'test:bound', %s)", (self.copy,))
        plan = self.plan()
        self.assertNotIn(f"r:{RU2}:0", [r["key"] for r in plan["removed"]])
        held = {m["key"]: m for m in plan["matches"] if m["class"] == "held"}[f"r:{RU2}:0"]
        self.assertEqual(held["held"], "removal_has_dependents")
        self.assertIn("core.footballdata_matches.match_id", held["before"]["dependents"])

    def test_23e_a_twin_that_differs_holds_the_copy(self):
        self.x("UPDATE core.matches SET home_score = 3 WHERE archive_key = %s", (f"r:{RU2}:1",))
        plan = self.plan()
        self.assertEqual({m["key"]: m["held"] for m in plan["matches"] if m["class"] == "held"}.get(f"r:{RU2}:1"), "twin_mismatch")
        self.assertEqual([r["key"] for r in plan["removed"]], [f"r:{RU2}:0"])


class PrimaryOverlapTest(Base):
    """23f, 23g: a PitchAPI edition of a stored archive competition holds it; it never removes it."""

    def pitchapi_edition(self):
        from vega.store import Store

        league = self.x("INSERT INTO core.competitions(name) VALUES ('Premier League') RETURNING id").fetchone()[0]
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','pitchapi','l_4WFCIZ',%s)", (league,))
        Store(self.db).season("2021/2022")
        return self.x("INSERT INTO core.competition_seasons(competition_id, season_id, native_label) VALUES (%s, 2021, '2021/2022') RETURNING id",
                      (league,)).fetchone()[0]

    def test_23f_empty_partial_or_complete_primary_editions_keep_the_archive(self):
        source = self.sources(RECENT_GOALS)
        archives.run(self.db, source, {"2021/2022"})
        before, events = self.state(), self.events()
        self.assertEqual(len(before), 2)
        edition = self.pitchapi_edition()
        teams = dict(self.x("SELECT name, id FROM core.teams").fetchall())
        cases = (
            ("empty", None),
            ("partial", ("Everton", "Watford")),
            ("complete", ("Manchester United", "Leeds United")),
        )
        for name, fixture in cases:
            with self.subTest(name):
                if fixture:
                    self.x("""INSERT INTO core.matches(competition_season_id, season_id, status, source, home_team_name, away_team_name, match_date,
                                                       home_score, away_score, home_team_id)
                              VALUES (%s, 2021, 'finished', 'pitchapi', %s, %s, '2021-08-14', 2, 0, %s)""",
                           (edition, *fixture, teams.get(fixture[0])))
                plan = archives.plan(self.db, source, {"2021/2022"})
                s = plan["seasons"]["2021/2022"]
                self.assertEqual((s["refused"], s["removed"], s["editions_removed"]), (None, [], []))
                held = {m["key"]: m["held"] for m in s["matches"] if m["class"] == "held"}
                self.assertEqual(list(held.values()), ["primary_overlap"])
                self.assertTrue(next(iter(held)).startswith("g:eng-premier-league:"))
                report = archives.apply(self.db, source, plan, {"2021/2022"})
                self.assertEqual(report["seasons"]["2021/2022"], "partial")
                self.assertEqual([r for r in self.state()], before)
                self.assertEqual(self.events(), events)

    def test_23g_no_stored_archive_edition_keeps_the_existing_route(self):
        self.pitchapi_edition()
        archives.run(self.db, self.sources(RECENT_GOALS), {"2021/2022"})
        self.assertEqual([k.split(":")[1] for k, *_ in self.state()], ["eng-fa-cup"])


class DurableApplyTest(Base):
    """23h-23k: one session per stored plan, a durable decision per season, resume, subsets, exact export."""

    SHARED = {"eng-fa-cup": [("2014-2015", "2015-01-01", "Shared FC vs. Other FC 1:0", "Someone", "Shared FC", "10", "1", "0"),
                             ("2015-2016", "2016-01-01", "Shared FC vs. Other FC 1:0", "Someone", "Shared FC", "10", "1", "0")]}
    SEASONS = {"2014/2015", "2015/2016"}

    def stored(self):
        source = self.sources(self.SHARED)
        return source, archives.store_plan(self.db, archives.plan(self.db, source, self.SEASONS))

    def decisions(self, digest):
        return self.x("SELECT label, outcome FROM ops.archive_plan_seasons WHERE sha256 = %s ORDER BY label", (digest,)).fetchall()

    def test_23h_a_second_session_cannot_apply_the_same_plan(self):
        source, digest = self.stored()
        holder = self.other()
        holder.execute("SELECT pg_advisory_lock(%s)", (archives.plan_lock_key(digest),))
        with self.assertRaises(archives.ArchiveError) as caught:
            archives.apply_stored(self.db, source, digest)
        self.assertIn("another session", str(caught.exception))
        self.assertEqual((self.state(), self.decisions(digest)), ([], []))

    def test_23i_a_crash_after_one_season_resumes_with_its_created_teams(self):
        source, digest = self.stored()
        calls = []

        def crash(label):
            calls.append(label)
            if len(calls) == 1:
                raise RuntimeError("simulated crash after the first season's commit")

        with patch.object(archives, "_after_season", crash), self.assertRaises(RuntimeError):
            archives.apply_stored(self.db, source, digest)
        self.assertEqual(self.decisions(digest), [("2014/2015", "applied")])
        self.assertIsNone(self.x("SELECT applied_at FROM ops.archive_plans WHERE sha256 = %s", (digest,)).fetchone()[0])
        report = archives.apply_stored(self.other(), source, digest)
        self.assertEqual(report["seasons"], {"2014/2015": "applied", "2015/2016": "applied"})
        self.assertEqual(report["resumed"], ["2014/2015"])
        self.assertEqual(self.decisions(digest), [("2014/2015", "applied"), ("2015/2016", "applied")])
        self.assertEqual(self.x("SELECT count(*) FROM core.teams WHERE name = 'Shared FC'").fetchone()[0], 1)
        self.assertIsNotNone(self.x("SELECT applied_at FROM ops.archive_plans WHERE sha256 = %s", (digest,)).fetchone()[0])

    def test_23j_a_subset_decides_only_its_seasons(self):
        source, digest = self.stored()
        report = archives.apply_stored(self.db, source, digest, {"2014/2015"})
        self.assertEqual(report["seasons"], {"2014/2015": "applied"})
        self.assertEqual(self.decisions(digest), [("2014/2015", "applied")])
        self.assertIsNone(self.x("SELECT applied_at FROM ops.archive_plans WHERE sha256 = %s", (digest,)).fetchone()[0])
        rest = archives.apply_stored(self.db, source, digest)
        self.assertEqual(rest["seasons"], {"2014/2015": "applied", "2015/2016": "applied"})
        self.assertIsNotNone(self.x("SELECT applied_at FROM ops.archive_plans WHERE sha256 = %s", (digest,)).fetchone()[0])
        with self.assertRaises(archives.ArchiveError):
            archives.apply_stored(self.db, source, digest)

    def test_23k_show_plan_writes_the_stored_bytes(self):
        from vega.store import connect_local

        _, digest = self.stored()
        out = io.BytesIO()

        class Stdout:
            buffer = out

            def write(self, text):
                out.write(text.encode())

            def flush(self):
                pass

        with patch.dict(os.environ, {"V2_DATABASE_URL": DSN}), patch("vega.worker.connect", connect_local), patch.object(sys, "stdout", Stdout()):
            self.assertEqual(archives.main(["--show-plan", digest]), 0)
        self.assertEqual(hashlib.sha256(out.getvalue()).hexdigest(), digest)


class PublishedFieldTest(Base):
    """23l: a stored score, status or phase value the candidate would change is held with its field."""

    def test_23l(self):
        source = self.sources()
        archives.run(self.db, source, {"2015/2016"})
        self.x("UPDATE core.matches SET home_score = 9 WHERE archive_key = 'r:2015-16/en.1:0'")
        self.x("UPDATE core.matches SET status = 'postponed' WHERE archive_key = 'r:2015-16/en.1:1'")
        self.x("UPDATE core.matches SET home_score_et = 3 WHERE archive_key = 'r:2015-16/en.1:2'")
        before = self.state()
        again = self.sources()  # one source tree for plan and apply: a zip rebuilt a second later has other bytes
        plan = archives.plan(self.db, again, {"2015/2016"})
        held = {m["key"]: m["held"] for m in plan["seasons"]["2015/2016"]["matches"] if m["class"] == "held"}
        self.assertEqual(held, {"r:2015-16/en.1:0": "score_change", "r:2015-16/en.1:1": "status_change", "r:2015-16/en.1:2": "phase_change"})
        archives.apply(self.db, again, plan, {"2015/2016"})
        self.assertEqual(self.state(), before)


class TypedShootoutTest(unittest.TestCase):
    """23m: the seven reviewed UEFA shoot-outs, typed only on an exact match of their key, date, sides and tally."""

    def test_the_reviewed_list(self):
        q = archives.VERIFIED_SHOOTOUTS
        self.assertEqual(len(q), 7)
        basel = q["g:europa-league:2013-04-11:1920"]
        self.assertEqual((basel["team1"], basel["team2"], basel["score"], basel["kicks"], basel["date"]),
                         ("FC Basel 1893", "Tottenham Hotspur", [2, 2], [4, 1], "2013-04-11"))
        self.assertTrue(all(v["document_sha256"] == "b8af4423a998ac041f90c09a8b5e6f0aaa23c65f53571b45afbfcca22f7c94a2" for v in q.values()))

    def goal_only(self, **over):
        match = {"key": "g:europa-league:2013-04-11:1920", "date": "2013-04-11", "team1": "FC Basel 1893", "team2": "Tottenham Hotspur",
                 "score": [2, 2], "notes": ["tirs au but"], "source": None}
        match.update(over)
        return match

    def test_23m_kicks_are_typed_on_an_exact_match_only(self):
        row = archives.match_row(self.goal_only())
        self.assertEqual((row["home_penalty_score"], row["away_penalty_score"], row["decided_on_penalties"]), (4, 1, None))
        self.assertEqual(archives.notes_of(row), ["tirs au but 4 – 1"])
        # The label without « i.E. »: the reviewed document still types the shoot-out.
        self.assertEqual(archives.match_row(self.goal_only(notes=[]))["home_penalty_score"], 4)
        for change in ({"score": [2, 1]}, {"date": "2013-04-12"}, {"team2": "Tottenham"}):
            with self.subTest(change=change):
                other = archives.match_row(self.goal_only(**change))
                self.assertEqual((other["home_penalty_score"], other["away_penalty_score"]), (None, None))


if __name__ == "__main__":
    unittest.main()
