"""Receipts of the five content-tagged selections, end to end (FAILURE_MODES_OPTIMISATIONS.md GH137R, migration 183).

The worker's real round (Worker.publish: the fold, then the receipts) prepares them on a base seeded with the read API's
fixtures (backend/api/test/seed.py, the league history's 2015/16 Bundesliga, a player's transfers read, a round for
PitchAPI's 2021/22 Bundesliga matches); each request is then a fresh read API process (read_conditional.mjs) holding the
tag a cache holds. "Cheap": a 304 with exactly that tag after one statement that, replayed as vega_read, reads no row of
a core or agg table. "Base": the base commit's path (its reads). Cases GH137R-a to l and o; m in GH137R-b.
"""
import json
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prerequisites import required  # noqa: E402
from vega import receipts  # noqa: E402
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
SELECTIONS = {LH: ("league-history", "l_1Isor4|2015"), MD_NOW: ("matchdays", "l_3FJFUl|2025/2026"),
              MD_OLD: ("matchdays", "l_1Isor4|2021/2022"), ST: ("standings", "l_3FJFUl|2025/2026"),
              CUP: ("cup-edition", "l_v0000003|2024"), TR: ("transfers", "p_aaaab2")}
TRANSFERS_FIXTURE = """
INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','transfermarkt','987654',102) ON CONFLICT DO NOTHING;
INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at, read_at) VALUES ('transfers','987654',3,'2026-12-16','2026-11-16');
INSERT INTO core.player_transfers(player_id,transfer_date,from_team_id,to_team_id,kind,fee_eur,source,as_of,source_key,from_provider_club,to_provider_club,pending)
VALUES (102,'2021-01-15',2,1,'loan',250000,'transfermarkt','2026-11-16','50','900','901',false);
"""


def pg_text(value):
    """A parameter as node-postgres sends it (text), for replaying a statement the read API ran."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        quote = lambda v: "NULL" if v is None else '"' + pg_text(v).replace("\\", "\\\\").replace('"', '\\"') + '"'
        return "{" + ",".join(quote(v) for v in value) + "}"
    if isinstance(value, dict):
        return json.dumps(value)
    return str(value)


@required(READY, "VEGA_V2_RECEIPTS_TEST_DSN (a local vega_v2_receipts_test base), node and backend/api/node_modules")
class ReadReceiptsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_receipts_test":
            raise RuntimeError("dedicated local vega_v2_receipts_test required")
        seed = subprocess.run([sys.executable, str(ROOT / "api" / "test" / "seed.py"), DSN], capture_output=True, text=True)
        assert seed.returncode == 0, seed.stderr
        history = subprocess.run([NODE, "--input-type=module", "-e",
                                  "const m = await import(process.argv[1]); m.seedLeagueHistory();",
                                  (ROOT / "api" / "test" / "league-history-fixture.mjs").as_uri()],
                                 env={**os.environ, "VEGA_V2_API_NODE_TEST_DSN": DSN}, capture_output=True, text=True)
        assert history.returncode == 0, history.stderr
        cls.db = psycopg.connect(DSN, autocommit=True)
        with cls.db.transaction():
            cls.db.execute(TRANSFERS_FIXTURE)
            # PitchAPI's 2021/22 Bundesliga (the league history's fixture): its two matches given a round, so that a past
            # season's matchdays answers 200.
            rid = cls.db.execute("INSERT INTO core.rounds(competition_season_id, name) VALUES (9727, '1. Spieltag') RETURNING id").fetchone()[0]
            cls.db.execute("UPDATE core.matches SET round_id = %s WHERE competition_season_id = 9727", (rid,))
        cls.worker = Worker(Store(cls.db), SimpleNamespace(), receipts_dsn=DSN)
        first = cls.ask_many([{"path": p} for p in PATHS])
        cls.tags = {r["path"]: r["etag"] for r in first}
        cls.bodies = {r["path"]: r["body"] for r in first}
        for r in first:
            assert r["status"] == 200, (r["path"], r["status"])

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    # Helpers ---------------------------------------------------------------

    @staticmethod
    def ask_many(entries, env=None):
        done = subprocess.run([NODE, str(Path(__file__).resolve().parent / "read_conditional.mjs"), DSN, json.dumps(entries)],
                              env={**os.environ, "VEGA_RELEASE": "receipts-e2e", **(env or {})}, capture_output=True, text=True, timeout=120)
        assert done.returncode == 0, done.stderr
        return json.loads(done.stdout.strip().splitlines()[-1])

    def one(self, path, etag=None, method="GET", env=None):
        entry = {"path": path, "method": method}
        if etag:
            entry["etag"] = etag
        return self.ask_many([entry], env)[0]

    def payload(self, statement):
        """The core and agg tables a statement reads, replayed as vega_read (pg_stat_xact_user_tables)."""
        with psycopg.connect(DSN) as c:
            c.execute("SET ROLE vega_read")
            res = c.pgconn.exec_params(statement["sql"].encode(), [None if p is None else p.encode()
                                                                    for p in map(pg_text, statement["params"])])
            self.assertIn(res.status, (psycopg.pq.ExecStatus.TUPLES_OK, psycopg.pq.ExecStatus.COMMAND_OK), res.get_error_message())
            c.execute("RESET ROLE")
            read = c.execute("""SELECT schemaname || '.' || relname FROM pg_stat_xact_user_tables
                WHERE schemaname IN ('core', 'agg') AND coalesce(seq_scan, 0) + coalesce(idx_scan, 0) > 0 ORDER BY 1""").fetchall()
            c.rollback()
        return [r[0] for r in read]

    def cheap(self, path, tag=None, method="GET", env=None):
        tag = tag or self.tags[path]
        r = self.one(path, tag, method, env)
        self.assertEqual((r["status"], r["etag"]), (304 if method == "GET" or tag else 200, tag), path)
        self.assertEqual(len(r["statements"]), 1, f"{path}: {[s['sql'][:60] for s in r['statements']]}")
        self.assertEqual(self.payload(r["statements"][0]), [], f"{path}: no row of the selection read")
        return r

    def base(self, path, tag=None, status=304, env=None):
        tag = tag or self.tags[path]
        r = self.one(path, tag, env=env)
        self.assertEqual(r["status"], status, path)
        if status == 304:
            self.assertEqual(r["etag"], tag, path)
        self.assertTrue(any(self.payload(s) for s in r["statements"]), f"{path}: the base path reads its selection")
        return r

    def receipt(self, path):
        route, selector = SELECTIONS[path]
        return self.db.execute("SELECT digest, version FROM ops.read_receipts WHERE route = %s AND selector = %s", (route, selector)).fetchone()

    def prepared(self, rounds=12):
        """The worker's rounds until every fixture selection has a receipt that is current."""
        for _ in range(rounds):
            self.worker.publish()
            fresh = self.db.execute("""SELECT count(*) FROM ops.read_receipts r WHERE (r.route, r.selector) IN
                (SELECT * FROM unnest(%s::text[], %s::text[])) AND r.digest IS NOT NULL
                AND r.version = ops.receipt_version(r.relations, r.scopes)""",
                ([s[0] for s in SELECTIONS.values()], [s[1] for s in SELECTIONS.values()])).fetchone()[0]
            if fresh == len(SELECTIONS):
                return
        self.fail("the worker's rounds left a fixture selection without a current receipt")

    def modern_match(self):
        return self.db.execute("SELECT id, home_score FROM core.matches WHERE season_id = 2025 AND home_score IS NOT NULL ORDER BY id LIMIT 1").fetchone()

    def archived_match(self):
        return self.db.execute("""SELECT m.id, m.home_score FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
            WHERE cs.archive_key = '2015-16/de.1' AND cs.season_id = 2015 AND m.home_score IS NOT NULL ORDER BY m.id LIMIT 1""").fetchone()

    def score(self, match, value):
        self.db.execute("UPDATE core.matches SET home_score = %s WHERE id = %s", (value, match))

    # GH137R ---------------------------------------------------------------

    def test_GH137R_a_without_a_receipt_the_base_commit_s_path(self):
        self.db.execute("DELETE FROM ops.read_receipts")
        for path in PATHS:
            with self.subTest(path=path):
                self.base(path)

    def test_GH137R_b_m_prepared_by_the_worker_s_round_cheap_from_a_fresh_process(self):
        self.prepared()
        for path in PATHS:
            with self.subTest(path=path):
                self.cheap(path)
                # GH137R-m: the digest the worker wrote is the read API's own.
                self.assertEqual(self.receipt(path)[0], self.tags[path].rsplit("-", 1)[1].rstrip('"'))

    def test_GH137R_c_another_season_s_match_written(self):
        self.prepared()
        match, home = self.modern_match()
        self.score(match, home + 1)
        self.addCleanup(self.score, match, home)
        # The archived season and the past season's matchdays read no row of 2025; the transfers no match at all.
        for path in (LH, MD_OLD, TR):
            with self.subTest(path=path):
                self.cheap(path)
        # 2025/26 is the written season (matchdays); the standings and the cups count their matches whole.
        for path in (MD_NOW, ST, CUP):
            with self.subTest(path=path):
                self.base(path)
        self.db.execute("SELECT ops.fold_data_changes()")
        self.prepared()
        for path in (MD_NOW, ST, CUP):
            with self.subTest(path=path, after="round"):
                self.cheap(path)

    def test_GH137R_d_the_selection_s_own_rows_corrected_then_reversed(self):
        self.prepared()
        match, home = self.archived_match()
        original = self.tags[LH]
        self.score(match, home + 3)
        self.addCleanup(self.score, match, home)
        corrected = self.base(LH, original, status=200)
        self.assertNotEqual(corrected["etag"], original)
        self.assertNotEqual(corrected["body"], self.bodies[LH])
        self.prepared()
        self.cheap(LH, corrected["etag"])
        self.score(match, home)
        back = self.base(LH, corrected["etag"], status=200)
        self.assertEqual((back["etag"], back["body"]), (original, self.bodies[LH]), "reversed: the original answer and tag")
        self.base(LH, original)
        self.prepared()
        self.cheap(LH, original)

    def test_GH137R_e_a_replay_a_rollback_and_a_fold_keep_it(self):
        self.prepared()
        match, home = self.archived_match()
        self.score(match, home)  # the same value: no change, no mark
        with self.assertRaises(RuntimeError):
            with self.db.transaction():
                self.score(match, home + 1)
                raise RuntimeError("rolled back")
        self.db.execute("SELECT ops.fold_data_changes()")
        for path in PATHS:
            with self.subTest(path=path):
                self.cheap(path)

    def test_GH137R_e2_noop_and_savepoint_do_not_consume_the_committed_scope_mark(self):
        self.prepared()
        match, home = self.archived_match()
        self.addCleanup(self.score, match, home)
        with self.db.transaction():
            self.score(match, home)
            with self.assertRaises(RuntimeError):
                with self.db.transaction():
                    self.score(match, home + 1)
                    raise RuntimeError("savepoint rolled back")
            self.score(match, home + 2)
        r = self.base(LH, status=200)
        self.assertNotEqual(r["body"], self.bodies[LH])

    def test_GH137R_f_a_shared_table_written(self):
        self.prepared()
        team = self.db.execute("SELECT id, name FROM core.teams WHERE id = 9701").fetchone()
        self.db.execute("UPDATE core.teams SET updated_at = updated_at + interval '1 second' WHERE id = %s", (team[0],))
        # The matchdays read no team; every other selection reads core.teams whole: its base path, the same answer.
        for path in (MD_NOW, MD_OLD):
            with self.subTest(path=path):
                self.cheap(path)
        for path in (LH, ST, CUP, TR):
            with self.subTest(path=path):
                self.base(path)
        self.prepared()
        for path in PATHS:
            with self.subTest(path=path, after="round"):
                self.cheap(path)

    def test_GH137R_g_another_player_s_read_and_this_player_s(self):
        self.prepared()
        self.db.execute("INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at, read_at) VALUES ('transfers','111111',3,'2026-12-16','2026-11-17')")
        self.addCleanup(self.db.execute, "DELETE FROM ops.transfermarkt_reads WHERE provider_key = '111111'")
        self.cheap(TR)
        self.db.execute("UPDATE ops.transfermarkt_reads SET read_at = read_at + interval '1 day' WHERE provider_key = '987654' AND kind = 'transfers'")
        self.addCleanup(self.db.execute, "UPDATE ops.transfermarkt_reads SET read_at = '2026-11-16' WHERE provider_key = '987654' AND kind = 'transfers'")
        self.base(TR)
        self.prepared()
        self.cheap(TR)

    def test_GH137R_h_the_read_api_s_code_another_one(self):
        self.prepared()
        for path in PATHS:
            with self.subTest(path=path):
                self.base(path, env={"VEGA_CODE_DIGEST": "0" * 64})

    def test_GH137R_i_a_write_committed_while_the_receipt_is_prepared(self):
        self.prepared()
        match, home = self.archived_match()
        route, selector = SELECTIONS[LH]
        relations, scopes, code = self.db.execute(
            "SELECT relations, scopes, representation FROM ops.read_receipts WHERE route = %s AND selector = %s", (route, selector)).fetchone()
        digest = self.receipt(LH)[0]
        preparer = psycopg.connect(DSN, autocommit=True)
        self.addCleanup(preparer.close)
        self.addCleanup(self.score, match, home)
        with preparer.transaction():
            preparer.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            preparer.execute("SELECT count(*) FROM core.matches")  # the snapshot of the reads that made `digest`
            self.score(match, home + 1)  # committed by another session after that snapshot
            self.assertTrue(preparer.execute("SELECT ops.put_read_receipt(%s, %s, %s, %s, %s::text[], %s)",
                                             (route, selector, code, relations, scopes, digest)).fetchone()[0])
        # Its version is its snapshot's: not the current one, so the corrected answer is built, never a 304.
        r = self.base(LH, self.tags[LH], status=200)
        self.assertNotEqual(r["etag"], self.tags[LH])

    def test_GH137R_j_other_tags_the_wildcard_and_head(self):
        self.prepared()
        # Another release's league-history resource: the base path's 200 (its tag names the release).
        self.base(LH, self.tags[LH], status=200, env={"VEGA_RELEASE": "another-release"})
        for path in (LH, ST, TR):
            with self.subTest(path=path):
                forged = self.tags[path][:-65] + "0" * 64 + '"'
                r = self.one(path, forged)
                self.assertEqual((r["status"], r["etag"]), (200, self.tags[path]))
                star = self.one(path, "*")
                self.assertEqual((star["status"], star["etag"], len(star["statements"])), (304, self.tags[path], 1))
                self.assertEqual(self.payload(star["statements"][0]), [])
                head = self.one(path, method="HEAD")
                self.assertEqual((head["status"], head["etag"], len(head["statements"])), (200, self.tags[path], 1))
                self.assertEqual(self.payload(head["statements"][0]), [])

    def test_GH137R_k_a_version_unknown(self):
        self.prepared()
        self.db.execute("INSERT INTO ops.data_changes(relation) SELECT 'core.teams' FROM generate_series(1, 10001)")
        self.addCleanup(self.db.execute, "DELETE FROM ops.data_changes WHERE relation = 'core.teams'")
        self.base(LH)
        self.db.execute("DELETE FROM ops.data_changes WHERE relation = 'core.teams'")
        self.cheap(LH)
        self.db.execute("INSERT INTO ops.schema_migrations(version, checksum) VALUES ('999_receipts_test.sql', '\\x00')")
        self.addCleanup(self.db.execute, "SELECT ops.track_data_changes()")
        self.addCleanup(self.db.execute, "DELETE FROM ops.schema_migrations WHERE version = '999_receipts_test.sql'")
        self.base(LH)

    def test_GH137R_l_a_round_is_bounded(self):
        self.db.execute("DELETE FROM ops.read_receipts")
        receipts.refresh(DSN, budget=2, check=200, list_missing=True)
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.read_receipts").fetchone()[0], 2)
        # A route's cap: league-history keeps 100; the oldest gives way.
        relations, scopes, code = ["api.league_history_edition"], [], "c" * 64
        self.db.execute("""INSERT INTO ops.read_receipts(route, selector, representation, relations, scopes, version, digest, prepared_at, checked_at)
            SELECT 'league-history', 'x|' || g, %s, %s, '{}', 'v', NULL, now() - g * interval '1 minute', now()
            FROM generate_series(1, 100) g""", (code, relations))
        with self.db.transaction():
            self.db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            self.assertTrue(self.db.execute("SELECT ops.put_read_receipt('league-history', 'l_1Isor4|2015', %s, %s, %s::text[], NULL)",
                                            (code, relations, scopes)).fetchone()[0])
        held = self.db.execute("SELECT count(*), bool_or(selector = 'x|100') FROM ops.read_receipts WHERE route = 'league-history'").fetchone()
        self.assertEqual(held, (100, False), "at most 100, the oldest gone")
        self.db.execute("DELETE FROM ops.read_receipts")

    def test_GH137R_o_privileges(self):
        owner = self.db.execute("SELECT current_user").fetchone()[0]
        grantees = lambda kind, name: {r[0] for r in self.db.execute(
            f"""SELECT coalesce(g.rolname, 'PUBLIC') FROM {kind} o CROSS JOIN LATERAL aclexplode(o.{'relacl' if kind == 'pg_class' else 'proacl'}) a
                LEFT JOIN pg_roles g ON g.oid = a.grantee WHERE o.oid = %s::{'regclass' if kind == 'pg_class' else 'regprocedure'}""", (name,))}
        for table in ("ops.read_receipts", "ops.read_receipt_discovery", "ops.data_versions", "ops.data_changes"):
            self.assertEqual(grantees("pg_class", table), {owner}, table)
        self.assertEqual(grantees("pg_proc", "api.read_receipt(text,text,text)"), {owner, "vega_read"})
        self.assertEqual(grantees("pg_proc", "ops.put_read_receipt(text,text,text,text[],text[],text)"), {owner, "vega_calc"})
        self.assertEqual(grantees("pg_proc", "ops.check_read_receipts(text,integer)"), {owner, "vega_calc"})
        self.assertEqual(grantees("pg_proc", "ops.receipt_version(text[],text[])"), {owner})
        member = self.db.execute("""SELECT m.inherit_option, m.set_option FROM pg_auth_members m
            WHERE m.roleid = 'vega_read'::regrole AND m.member = 'vega_calc'::regrole""").fetchall()
        self.assertEqual(member, [(False, True)], "vega_calc may act as vega_read, never inherits it")
        for helper in ("api.matchday_editions(text,text)", "api.player_transfer_scope(text)"):
            self.assertEqual(grantees("pg_proc", helper), {owner, "vega_read"}, helper)


if __name__ == "__main__":
    unittest.main()
