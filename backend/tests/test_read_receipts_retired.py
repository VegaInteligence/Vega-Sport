"""The receipts of migration 183 retired, end to end (FAILURE_MODES_OPTIMISATIONS.md GH137R.3, migration 184; written
before the migration and the code that removes them).

Two bases in turn on the receipts' own disposable database (VEGA_V2_RECEIPTS_TEST_DSN, vega_v2_receipts_test):

- MigrationRetiresReceiptsTest (GH137R-s, t, u, x, y): the real `python -m vega.migrate` of a copy of this backend holding
  the files up to 183 only, then rows as production holds them (receipts, a discovery cursor, scoped and whole-table
  marks, pending and folded), then the real `python -m vega.migrate` of this tree (184), started while a read holds one
  of the tables it locks.
- RetiredRoutesTest (GH137R-p, v): the read API's fixtures (backend/api/test/seed.py, the league history's 2015/16
  Bundesliga, a player's transfers read, a round for a past season's matchdays), each request a fresh read API process
  (read_conditional.mjs), then the worker's real round (Worker.publish).
"""
import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from urllib.parse import urlparse

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prerequisites import required  # noqa: E402
from vega.store import Store  # noqa: E402
from vega.worker import Worker  # noqa: E402

DSN = os.environ.get("VEGA_V2_RECEIPTS_TEST_DSN")
NODE = shutil.which("node")
READY = bool(DSN) and NODE is not None and (ROOT / "api" / "node_modules").exists()
LH = "/api/league-history?competition=l_1Isor4&season=2015%2F2016"
MD_NOW = "/api/matchdays?competition=l_3FJFUl&season=2025%2F2026"
MD_OLD = "/api/matchdays?competition=l_1Isor4&season=2021%2F2022"
ST = "/api/standings?competition=l_3FJFUl&season=2025%2F2026"
CUP = "/api/cups/edition?competition=l_v0000003&season=2024"
TR = "/api/players/p_aaaab2/transfers"
PATHS = (LH, MD_NOW, MD_OLD, ST, CUP, TR)
TRANSFERS_FIXTURE = """
INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','transfermarkt','987654',102) ON CONFLICT DO NOTHING;
INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at, read_at) VALUES ('transfers','987654',3,'2026-12-16','2026-11-16');
INSERT INTO core.player_transfers(player_id,transfer_date,from_team_id,to_team_id,kind,fee_eur,source,as_of,source_key,from_provider_club,to_provider_club,pending)
VALUES (102,'2021-01-15',2,1,'loan',250000,'transfermarkt','2026-11-16','50','900','901',false);
"""
# What 183 added and 184 removes (GH137R.3): the tables it scoped, its functions, its tables.
SCOPED = ("core.matches", "core.match_events", "core.league_player_seasons", "core.player_transfers", "ops.transfermarkt_reads")
REMOVED_FUNCTIONS = (("ops", "mark_scoped_change"), ("ops", "receipt_version"), ("api", "read_receipt"), ("ops", "put_read_receipt"),
                     ("ops", "check_read_receipts"), ("ops", "missing_history_receipts"), ("ops", "discover_read_receipts"),
                     ("api", "player_transfer_scope"))
REMOVED_TABLES = ("ops.read_receipts", "ops.read_receipt_discovery")
KEPT_FUNCTIONS = (("ops", "scoped_data_version"), ("api", "data_version"), ("api", "matchday_editions"), ("api", "matchday_rounds"),
                  ("ops", "fold_data_changes"))
EDITION, LEAGUE_KEY, SEASON = 9801, "l_v0009801", "2025/2026"


def local(dsn):
    target = urlparse(dsn)
    if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_receipts_test":
        raise RuntimeError("dedicated local vega_v2_receipts_test required")


def migrate(backend, *flags, wait=True):
    """The migration task's command on `backend` (a copy of backend/ with its sql/ and vega/, or this tree's)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("V2_")}
    env.update(V2_MIGRATION_DATABASE_URL=DSN, PYTHONPATH=str(backend), PYTHONDONTWRITEBYTECODE="1")
    command = [sys.executable, "-m", "vega.migrate", *flags]
    if not wait:
        return subprocess.Popen(command, cwd=backend, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return subprocess.run(command, cwd=backend, env=env, capture_output=True, text=True, timeout=600)


@required(bool(DSN), "VEGA_V2_RECEIPTS_TEST_DSN (a local vega_v2_receipts_test base)")
class MigrationRetiresReceiptsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        local(DSN)
        db = cls.db = psycopg.connect(DSN, autocommit=True)
        cls.addClassCleanup(db.close)
        db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        tmp = Path(tempfile.mkdtemp(prefix="vega-receipts-retired-"))
        cls.addClassCleanup(shutil.rmtree, tmp, True)
        before = tmp / "backend"
        shutil.copytree(ROOT / "vega", before / "vega", ignore=shutil.ignore_patterns("__pycache__"))
        (before / "sql").mkdir()
        names = sorted(p.name for p in (ROOT / "sql").glob("*.sql"))
        cls.added = [n for n in names if n >= "184"]
        for name in names:
            if name < "184":
                shutil.copyfile(ROOT / "sql" / name, before / "sql" / name)
        at_183 = migrate(before)
        assert at_183.returncode == 0, at_183.stdout + at_183.stderr
        cls.seed()
        cls.before = cls.state()
        cls.rounds_before = cls.rounds()
        # GH137R-x's order: the online run first (refused: 184 is not marked), then the full run, then again.
        cls.online = migrate(ROOT, "--online")
        cls.after_online = cls.state()
        cls.deployed = cls.migrate_beside_a_read()
        assert cls.deployed.returncode == 0, cls.deployed.stdout + cls.deployed.stderr
        cls.again = migrate(ROOT)
        cls.after = cls.state()
        cls.rounds_after = cls.rounds()

    @classmethod
    def migrate_beside_a_read(cls):
        """GH137R-y: the full run, started while a read's transaction holds core.match_events. What the two reads of
        core.matches met while the migration waited is kept in cls.beside."""
        def read(conn):
            try:
                return conn.execute("SELECT count(*) FROM core.matches").fetchone()[0]
            except psycopg.Error as error:
                return type(error).__name__
        with psycopg.connect(DSN) as holder, psycopg.connect(DSN, autocommit=True) as other:
            cls.matches_then = read(other)
            holder.execute("SELECT count(*) FROM core.match_events")  # read, its transaction left open: the table is held
            running = migrate(ROOT, wait=False)
            # Until the migration is at 184's locks: waiting on one, or between two attempts.
            deadline = time.monotonic() + 60
            while running.poll() is None and time.monotonic() < deadline and not other.execute(
                    """SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
                       AND (wait_event_type = 'Lock' OR wait_event = 'PgSleep')""").fetchone()[0]:
                time.sleep(0.02)
            time.sleep(0.3)  # several attempts
            still_running = running.poll() is None
            exclusive = other.execute("""SELECT count(*) FROM pg_locks WHERE locktype = 'relation' AND mode = 'AccessExclusiveLock'
                                         AND granted AND pid <> pg_backend_pid()""").fetchone()[0]
            other.execute("SET statement_timeout = '2s'")
            holder.execute("SET LOCAL statement_timeout = '5s'")
            cls.beside = {"migration waiting": still_running, "exclusive locks it holds": exclusive,
                          "another session's read": read(other), "the holder's next read": read(holder)}
            holder.rollback()
        out, err = running.communicate(timeout=600)
        return subprocess.CompletedProcess(running.args, running.returncode, out, err)

    @classmethod
    def seed(cls):
        x = cls.db.execute
        with cls.db.transaction():
            assert Store(cls.db).season(SEASON) == 2025
            x("INSERT INTO core.competitions(id, name, kind) VALUES (%s, 'League 9801', 'league')", (EDITION,))
            x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label) VALUES (%s, %s, 2025, %s)", (EDITION, EDITION, SEASON))
            x("INSERT INTO core.teams(id, name) VALUES (9801, 'Club 9801'), (9802, 'Club 9802')")
            x("INSERT INTO core.players(id, name) VALUES (9801, 'P9801')")
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', '98010', 9801)")
            cls.round_id = x("INSERT INTO core.rounds(competition_season_id, name) VALUES (%s, 'Round 1') RETURNING id", (EDITION,)).fetchone()[0]
            x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, round_id, home_team_id, away_team_id, home_score, away_score, match_date)
                 VALUES (9801, %s, 2025, 'pitchapi', 'finished', %s, 9801, 9802, 1, 0, '2025-09-01')""", (EDITION, cls.round_id))
        # Receipts as the worker of 183 wrote them (ops.put_read_receipt asks for its snapshot), and its discovery cursor.
        with cls.db.transaction():
            x("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            for route, relations, scopes in (("standings", ["api.standing_rows"], "{}"),
                                             ("matchdays", ["api.matchday_rounds"], "{{core.matches,*},{core.matches,2025}}")):
                saved = x("SELECT ops.put_read_receipt(%s, %s, 'code', %s, %s::text[], %s)",
                          (route, f"{LEAGUE_KEY}|{SEASON}", relations, scopes, "a" * 64)).fetchone()[0]
                assert saved, route
        x("INSERT INTO ops.read_receipt_discovery(route, after_key) VALUES ('standings', '12')")
        # Marks folded (whole-table and scoped), then marks pending (both again).
        x("UPDATE core.matches SET home_score = 2 WHERE id = 9801")
        x("SELECT ops.fold_data_changes()")
        x("UPDATE core.matches SET home_score = 3 WHERE id = 9801")

    @classmethod
    def state(cls):
        q = lambda sql, *params: cls.db.execute(sql, params or None).fetchall()  # noqa: E731
        return SimpleNamespace(
            migrations=[r[0] for r in q("SELECT version FROM ops.schema_migrations ORDER BY 1")],
            functions={tuple(r) for r in q("SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('api', 'ops')")},
            tables=[t for t in REMOVED_TABLES if q("SELECT to_regclass(%s)", t)[0][0] is not None],
            # On the tables themselves; a partition holds its parent's row triggers again (tgparentid).
            scope_triggers=q("SELECT tgrelid::regclass::text, count(*) FROM pg_trigger WHERE left(tgname, 11) = 'vega_scope_' AND tgparentid = 0 GROUP BY 1 ORDER BY 1"),
            scope_triggers_anywhere=q("SELECT count(*) FROM pg_trigger WHERE left(tgname, 11) = 'vega_scope_'")[0][0],
            change_triggers=q("""SELECT tgrelid::regclass::text, count(*) FROM pg_trigger WHERE left(tgname, 12) = 'vega_change_'
                                  AND tgrelid::regclass::text = ANY(%s) GROUP BY 1 ORDER BY 1""", list(SCOPED)),
            scoped_marks=q("SELECT count(*) FROM ops.data_changes WHERE scope <> ''")[0][0],
            scoped_versions=q("SELECT count(*) FROM ops.data_versions WHERE scope <> ''")[0][0],
            whole_marks=q("SELECT relation, count(*) FROM ops.data_changes WHERE scope = '' GROUP BY 1 ORDER BY 1"),
            whole_versions=q("SELECT relation, version FROM ops.data_versions WHERE scope = '' ORDER BY 1"),
            member=q("SELECT pg_has_role('vega_calc', 'vega_read', 'MEMBER'), pg_has_role('vega_calc', 'vega_read', 'SET')")[0],
        )

    @classmethod
    def rounds(cls):
        with psycopg.connect(DSN) as c:
            c.execute("SET ROLE vega_read")
            return c.execute("SELECT name, playoff FROM api.matchday_rounds(%s, %s)", (LEAGUE_KEY, SEASON)).fetchall()

    def marks(self, relation):
        whole, scoped = self.db.execute("""SELECT count(*) FILTER (WHERE scope = ''), count(*) FILTER (WHERE scope <> '')
            FROM ops.data_changes WHERE relation = %s""", (relation,)).fetchone()
        return whole, scoped

    def version(self, relation):
        reader = self.db.execute("""SELECT min(s.relation) FROM ops.data_sources s JOIN ops.data_relations r USING (relation)
            WHERE s.source = %s AND r.clock IS DISTINCT FROM 'time'""", (relation,)).fetchone()[0]
        self.assertIsNotNone(reader, f"{relation}: an api relation reads it")
        version = self.db.execute("SELECT api.data_version(ARRAY[%s])", (reader,)).fetchone()[0]
        self.assertIsNotNone(version, f"{reader}: a version")
        return version

    # GH137R ---------------------------------------------------------------

    def test_GH137R_s_the_base_at_183_held_what_184_removes(self):
        # The premise: without it the cases below would pass on a base that never had the receipts.
        b = self.before
        self.assertEqual(b.migrations[-1], "183_read_receipts.sql")
        self.assertEqual(b.tables, list(REMOVED_TABLES))
        self.assertLessEqual(set(REMOVED_FUNCTIONS), b.functions)
        self.assertEqual(sorted(b.scope_triggers), sorted((t, 4) for t in SCOPED))
        self.assertGreater(b.scoped_marks, 0)
        self.assertGreater(b.scoped_versions, 0)
        self.assertTrue(b.whole_marks and b.whole_versions)
        self.assertEqual(b.member, (True, True))
        self.assertEqual(self.rounds_before, [("Round 1", False)])

    def test_GH137R_s_184_removes_the_receipts_and_keeps_the_whole_table_versions(self):
        a, b = self.after, self.before
        self.assertEqual([m for m in a.migrations if m not in b.migrations], self.added)
        self.assertEqual(self.added[:1], ["184_retire_read_receipts.sql"])
        self.assertEqual(a.tables, [])
        self.assertEqual(set(REMOVED_FUNCTIONS) & a.functions, set())
        self.assertLessEqual(set(KEPT_FUNCTIONS), a.functions)
        self.assertEqual((a.scope_triggers, a.scope_triggers_anywhere), ([], 0))
        self.assertEqual(a.change_triggers, b.change_triggers)
        self.assertEqual(sorted(a.change_triggers), sorted((t, 4) for t in SCOPED))
        self.assertEqual((a.scoped_marks, a.scoped_versions), (0, 0))
        self.assertEqual(a.whole_marks, b.whole_marks)
        self.assertEqual(a.whole_versions, b.whole_versions)

    def test_GH137R_t_a_write_marks_its_table_whole_and_nothing_else(self):
        x = self.db.execute
        writes = {
            "core.matches": (
                f"""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, round_id, home_team_id, away_team_id)
                    VALUES (9802, {EDITION}, 2025, 'pitchapi', 'not_started', {self.round_id}, 9802, 9801)""",
                "UPDATE core.matches SET home_score = 5 WHERE id = 9802", "DELETE FROM core.matches WHERE id = 9802"),
            "core.match_events": (
                "INSERT INTO core.match_events(season_id, match_id, seq, minute) VALUES (2025, 9801, 1, 10)",
                "UPDATE core.match_events SET minute = 11 WHERE match_id = 9801 AND seq = 1",
                "DELETE FROM core.match_events WHERE match_id = 9801 AND seq = 1"),
            "core.league_player_seasons": (
                f"""INSERT INTO core.league_player_seasons(competition_id, season_id, player_key, player_name, club_key, club_name, matches, minutes,
                      goals, assists, yellow_cards, red_cards) VALUES ({EDITION}, 2015, '11', 'P', '22', 'C', 1, 90, 0, 0, 0, 0)""",
                "UPDATE core.league_player_seasons SET goals = 1 WHERE player_key = '11'",
                "DELETE FROM core.league_player_seasons WHERE player_key = '11'"),
            "core.player_transfers": (
                "INSERT INTO core.player_transfers(player_id, source, as_of) VALUES (9801, 'other', '2026-11-16')",  # Transfermarkt's rows are kept from deletion
                "UPDATE core.player_transfers SET as_of = '2026-11-17' WHERE player_id = 9801",
                "DELETE FROM core.player_transfers WHERE player_id = 9801"),
            "ops.transfermarkt_reads": (
                "INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at) VALUES ('transfers', '98010', 3, '2026-12-16')",
                "UPDATE ops.transfermarkt_reads SET priority = 4 WHERE provider_key = '98010'",
                "DELETE FROM ops.transfermarkt_reads WHERE provider_key = '98010'"),
        }
        self.assertEqual(tuple(writes), SCOPED)
        # Each write in its own transaction; the truncations last, from the leaves (the matches' takes their events).
        steps = [(relation, sql) for relation, statements in writes.items() for sql in statements]
        steps += [(relation, f"TRUNCATE {relation} CASCADE") for relation in reversed(SCOPED)]
        for relation, sql in steps:
            with self.subTest(relation=relation, write=sql.split()[0]):
                whole, _ = self.marks(relation)
                version = self.version(relation)
                with self.db.transaction():
                    self.assertNotEqual(x(sql).rowcount, 0, sql)
                self.assertEqual(self.marks(relation), (whole + 1, 0))
                self.assertNotEqual(self.version(relation), version)
        self.assertEqual(x("SELECT count(*) FROM ops.data_changes WHERE scope <> ''").fetchone()[0], 0)
        x("SELECT ops.fold_data_changes()")
        self.assertEqual(x("SELECT count(*) FROM ops.data_versions WHERE scope <> ''").fetchone()[0], 0)

    def test_GH137R_u_the_matchdays_read_stays_and_the_grants_go(self):
        self.assertEqual(self.after.member, (False, False))
        with psycopg.connect(DSN) as c:
            c.execute("SET ROLE vega_read")
            with self.assertRaises(psycopg.errors.UndefinedFunction):
                c.execute("SELECT api.read_receipt('standings', %s, 'code')", (f"{LEAGUE_KEY}|{SEASON}",))
            c.rollback()
            c.execute("SET ROLE vega_read")
            self.assertEqual(c.execute("SELECT count(*) FROM api.matchday_editions(%s, %s)", (LEAGUE_KEY, SEASON)).fetchone()[0], 1)
        # As the calc login itself (SET ROLE asks the session's own role): 183 let it take the read role.
        with psycopg.connect(DSN) as c:
            c.execute("SET SESSION AUTHORIZATION vega_calc")
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                c.execute("SET ROLE vega_read")

    def test_GH137R_u_the_rounds_a_matchdays_read_gave_before(self):
        # Both read in setUpClass: this class's other cases truncate the matches.
        self.assertEqual(self.rounds_after, self.rounds_before)
        self.assertEqual(self.rounds_after, [("Round 1", False)])

    def test_GH137R_x_the_online_run_refuses_184_and_the_full_run_applies_it_once(self):
        self.assertEqual(self.online.returncode, 3, self.online.stdout + self.online.stderr)
        self.assertIn("184_retire_read_receipts.sql", self.online.stderr)
        self.assertEqual(self.after_online.migrations, self.before.migrations)
        self.assertEqual(self.after_online.tables, list(REMOVED_TABLES))
        self.assertRegex(self.deployed.stdout.strip().splitlines()[-1], rf"^migrations applied={len(self.added)} total=\d+ ")
        self.assertRegex(self.again.stdout.strip().splitlines()[-1], r"^migrations applied=0 total=\d+ ")


    def test_GH137R_y_184_holds_no_table_while_a_read_holds_one(self):
        self.assertGreater(self.matches_then, 0)
        self.assertEqual(self.beside, {"migration waiting": True, "exclusive locks it holds": 0,
                                       "another session's read": self.matches_then, "the holder's next read": self.matches_then})
        self.assertEqual(self.deployed.returncode, 0)


@required(READY, "VEGA_V2_RECEIPTS_TEST_DSN (a local vega_v2_receipts_test base), node and backend/api/node_modules")
class RetiredRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        local(DSN)
        seed = subprocess.run([sys.executable, str(ROOT / "api" / "test" / "seed.py"), DSN], capture_output=True, text=True)
        assert seed.returncode == 0, seed.stderr
        history = subprocess.run([NODE, "--input-type=module", "-e",
                                  "const m = await import(process.argv[1]); m.seedLeagueHistory();",
                                  (ROOT / "api" / "test" / "league-history-fixture.mjs").as_uri()],
                                 env={**os.environ, "VEGA_V2_API_NODE_TEST_DSN": DSN}, capture_output=True, text=True)
        assert history.returncode == 0, history.stderr
        cls.db = psycopg.connect(DSN, autocommit=True)
        cls.addClassCleanup(cls.db.close)
        with cls.db.transaction():
            cls.db.execute(TRANSFERS_FIXTURE)
            # PitchAPI's 2021/22 Bundesliga (the league history's fixture): its two matches given a round, so that a past
            # season's matchdays answers 200.
            rid = cls.db.execute("INSERT INTO core.rounds(competition_season_id, name) VALUES (9727, '1. Spieltag') RETURNING id").fetchone()[0]
            cls.db.execute("UPDATE core.matches SET round_id = %s WHERE competition_season_id = 9727", (rid,))
        cls.first = {r["path"]: r for r in cls.ask_many([{"path": p} for p in PATHS])}
        for path, r in cls.first.items():
            assert r["status"] == 200 and r["etag"], (path, r["status"])

    @staticmethod
    def ask_many(entries):
        done = subprocess.run([NODE, str(Path(__file__).resolve().parent / "read_conditional.mjs"), DSN, json.dumps(entries)],
                              env={**os.environ, "VEGA_RELEASE": "receipts-retired-e2e"}, capture_output=True, text=True, timeout=120)
        assert done.returncode == 0, done.stderr
        return json.loads(done.stdout.strip().splitlines()[-1])

    def test_GH137R_p_the_five_routes_answer_by_their_own_reads(self):
        for path in PATHS:
            plain = self.first[path]
            tag = plain["etag"]
            other = re.sub(r'[0-9a-f]{64}"$', "0" * 64 + '"', tag)
            self.assertNotEqual(other, tag)
            asked = self.ask_many([{"path": path, "etag": tag}, {"path": path, "etag": "*"}, {"path": path, "etag": other},
                                   {"path": path, "method": "HEAD"}, {"path": path}])
            expected = ((304, None), (304, None), (200, plain["body"]), (200, None), (200, plain["body"]))
            for kind, r, (status, body) in zip(("its tag", "*", "another tag", "HEAD", "GET"), asked, expected):
                with self.subTest(path=path, request=kind):
                    self.assertEqual((r["status"], r["etag"]), (status, tag))
                    self.assertEqual(r["body"], body)
                    self.assertTrue(r["statements"], "the route's own reads")
                    self.assertFalse([s["sql"] for s in r["statements"] if "receipt" in s["sql"].lower()], "no receipt probe")
                    # Sorted: a route's reads start together, in any order.
                    self.assertEqual(sorted(s["sql"] for s in r["statements"]), sorted(s["sql"] for s in plain["statements"]),
                                     "the statements of the plain GET")

    def test_GH137R_v_the_worker_s_round_folds_and_starts_no_process(self):
        self.assertIsNone(importlib.util.find_spec("vega.receipts"))
        with self.assertRaises(TypeError):
            Worker(Store(self.db), SimpleNamespace(), receipts_dsn=DSN)
        worker = Worker(Store(self.db), SimpleNamespace())
        match, home = self.db.execute("SELECT id, home_score FROM core.matches WHERE season_id = 2025 AND home_score IS NOT NULL ORDER BY id LIMIT 1").fetchone()
        self.db.execute("UPDATE core.matches SET home_score = %s WHERE id = %s", (home + 1, match))
        self.addCleanup(self.db.execute, "UPDATE core.matches SET home_score = %s WHERE id = %s", (home, match))
        self.assertGreater(self.db.execute("SELECT count(*) FROM ops.data_changes").fetchone()[0], 0)
        empty = tempfile.mkdtemp(prefix="vega-no-node-")
        self.addCleanup(shutil.rmtree, empty, True)
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"PATH": empty}), mock.patch("subprocess.Popen", side_effect=AssertionError("a process started")) as started, \
                contextlib.redirect_stdout(out):
            worker.publish()
        started.assert_not_called()
        self.assertNotIn("error", out.getvalue())
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.data_changes").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
