"""Removal guards that hold after the commit (VI-27), written before the code: FAILURE_MODES.md §24.

Real PostgreSQL 18 (VEGA_V2_ARCHIVE_GUARDS_TEST_DSN, database vega_v2_archive_guards_test), the real loader, plan and
apply, the apply and the competing writers under their production roles (vega_collect, vega_calc), each on its own
connection. The season's edition is built directly, as in test_archive_deletions (the builder's reviewed-copy exclusion
is 20c/20d's).
"""

import os
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from vega import archives  # noqa: E402
from test_archive_deletions import COPY, L, PROVIDER, RU1, RU2, season  # noqa: E402
from template_base import fresh  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_ARCHIVE_GUARDS_TEST_DSN")


@unittest.skipUnless(DSN and psycopg, "requires a disposable local archive guards DB (VEGA_V2_ARCHIVE_GUARDS_TEST_DSN) and psycopg")
class GuardTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_archive_guards_test":
            raise RuntimeError("dedicated local archive guards DB required")
        cls.db = fresh(DSN)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        self.x = self.db.execute
        self.x("RESET ROLE")
        extra = ", ops.archive_removals" if self.x("SELECT to_regclass('ops.archive_removals')").fetchone()[0] else ""
        self.x(f"""TRUNCATE core.matches, core.rounds, core.competition_seasons, core.competitions, core.provider_ids, core.teams,
                   core.source_revisions, ops.resource_versions, ops.archive_plans, ops.archive_plan_seasons{extra} RESTART IDENTITY CASCADE""")
        with self.db.transaction():
            archives.Loader(self.db).season(L, season(), PROVIDER)
        self.ids = dict(self.x("SELECT archive_key, id FROM core.matches").fetchall())
        self.copy = self.ids[f"r:{RU2}:0"]
        self.edition = self.x("SELECT id FROM core.competition_seasons WHERE archive_key = %s", (RU2,)).fetchone()[0]

    def other(self, role="vega_collect"):
        from vega.store import connect_local

        conn = connect_local(DSN)
        self.addCleanup(conn.close)
        conn.execute(f"SET ROLE {role}")
        conn.execute("SET lock_timeout = '20s'")
        return conn

    def plan(self, with_copy=False):
        return archives.season_plan(self.db, L, season(with_copy=with_copy), PROVIDER, COPY)

    def apply(self, plan, conn=None, with_copy=False):
        return archives.apply_season(conn or self.db, L, season(with_copy=with_copy), PROVIDER, COPY, plan, {})

    def bind_match(self, conn, key):
        conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match', 'vega', %s, %s)",
                     (key, self.copy))

    def test_24a_a_writer_blocked_by_the_deletion_fails_after_its_commit(self):
        plan = self.plan()
        writer, outcome = self.other(), {}

        def late():
            try:
                self.bind_match(writer, "test:blocked")
                outcome["late"] = "inserted"
            except psycopg.Error as error:
                outcome["late"] = type(error).__name__

        def pause():
            thread = threading.Thread(target=late)
            thread.start()
            time.sleep(1.0)
            outcome["waiting"] = thread.is_alive()  # blocked by the SHARE lock of core.provider_ids
            outcome["thread"] = thread

        with patch.object(archives, "_after_locks", pause):
            self.assertEqual(self.apply(plan), "applied")
        outcome["thread"].join(30)
        self.assertTrue(outcome["waiting"])
        self.assertEqual(outcome["late"], "ForeignKeyViolation")
        self.assertFalse(self.x("SELECT 1 FROM core.provider_ids WHERE entity_type = 'match' AND entity_id = %s", (self.copy,)).fetchone())

    def test_24b_a_writer_after_the_removal_is_refused(self):
        self.assertEqual(self.apply(self.plan()), "applied")
        writer = self.other()
        for statement, args in (
            ("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match', 'vega', 'test:after', %s)", (self.copy,)),
            ("INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('match', %s)", (self.copy,)),
            ("INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('competition_season', %s)", (self.edition,)),
        ):
            with self.subTest(statement=statement[:60]), self.assertRaises(psycopg.errors.ForeignKeyViolation):
                with writer.transaction():
                    writer.execute(statement, args)
        removed = self.x("SELECT kind, id FROM ops.archive_removals ORDER BY 1, 2").fetchall()
        self.assertIn(("match", self.copy), removed)
        self.assertIn(("edition", self.edition), removed)

    def test_24c_an_edition_with_a_dependent_stays(self):
        self.x("INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('competition_season', %s)", (self.edition,))
        plan = self.plan()
        self.assertEqual(plan["editions_removed"], [])
        self.assertEqual([e["held"] for e in plan["editions"] if e.get("key") == RU2], ["edition_has_dependents"])
        self.assertEqual(sorted(r["key"] for r in plan["removed"]), [f"r:{RU2}:0", f"r:{RU2}:1"])
        self.assertEqual(self.apply(plan), "applied")
        self.assertTrue(self.x("SELECT 1 FROM core.competition_seasons WHERE id = %s", (self.edition,)).fetchone())
        self.assertFalse(self.x("SELECT 1 FROM core.matches WHERE competition_season_id = %s", (self.edition,)).fetchone())
        # An emblem is a dependency too.
        self.x("DELETE FROM ops.resource_versions")
        asset = self.x("INSERT INTO core.assets(kind, source_url) VALUES ('logo', 'https://cdn.pitchapi.dev/images/x.png') RETURNING id").fetchone()[0]
        self.x("UPDATE core.competition_seasons SET emblem_asset_id = %s WHERE id = %s", (asset, self.edition))
        self.assertEqual(self.plan()["editions_removed"], [])

    def test_24d_a_twin_whose_stored_row_differs_holds_the_copy(self):
        self.x("UPDATE core.matches SET home_team_name = 'Zenit St Petersburg' WHERE archive_key = %s", (f"r:{RU1}:1",))
        plan = self.plan()
        self.assertEqual({m["key"]: m["held"] for m in plan["matches"] if m["class"] == "held"}.get(f"r:{RU2}:1"), "twin_mismatch")
        twin = next(r for r in plan["removed"] if r["key"] == f"r:{RU2}:0")["twin"]
        self.assertEqual((twin["key"], twin["row"]["id"]), (f"r:{RU1}:0", self.ids[f"r:{RU1}:0"]))

    def test_27_reviewed_copy_deletion_and_twin_reordering_commit_together(self):
        twin = self.ids[f"r:{RU1}:0"]
        self.x("UPDATE core.matches SET archive_position=500 WHERE id=%s", (twin,))
        expected = self.plan()
        self.assertIn((twin, "position"), [(m.get("id"), m["class"]) for m in expected["matches"]])
        self.assertEqual(len(expected["removed"]), 2)
        self.assertEqual(self.apply(expected, self.other()), "applied")
        self.assertFalse(self.x("SELECT 1 FROM core.matches WHERE id=%s", (self.copy,)).fetchone())
        self.assertEqual(self.x("SELECT archive_position FROM core.matches WHERE id=%s", (twin,)).fetchone()[0], 0)
        self.assertEqual(self.plan()["removed"], [])

    def test_24e_the_plan_state_is_read_after_its_lock(self):
        digest = archives.store_plan(self.db, {"inputs": {}, "seasons": {L: self.plan()}})
        self.x("UPDATE ops.archive_plans SET applied_at = now(), receipt = '{}'::jsonb WHERE sha256 = %s", (digest,))
        real = archives._stored

        def stale(conn, sha):  # what an applier read just before another one finished
            plan, _ = real(conn, sha)
            return plan, None

        with patch.object(archives, "_stored", stale), self.assertRaises(archives.ArchiveError) as caught:
            archives.apply_stored(self.db, "/nonexistent", digest)
        self.assertIn("applied", str(caught.exception))
        self.assertEqual(self.x("SELECT count(*) FROM ops.archive_plan_seasons").fetchone()[0], 0)

    def test_24f_an_edition_rename_is_published(self):
        self.x("UPDATE core.competition_seasons SET archive_name = 'Old name' WHERE archive_key = %s", (RU1,))
        version = lambda: self.x("SELECT version FROM ops.resource_versions WHERE resource_kind = 'archive_season' AND resource_id = 2019").fetchone()  # noqa: E731
        before = version()
        plan = self.plan(with_copy=True)
        self.assertEqual([e["class"] for e in plan["editions"] if e["key"] == RU1], ["changed"])
        self.assertEqual(self.apply(plan, with_copy=True), "applied")
        self.assertEqual(version()[0], (before or (0,))[0] + 1)

    def test_24g_a_deadlock_is_never_applied(self):
        plan = self.plan()
        writer = self.other("postgres")
        writer.execute("SET deadlock_timeout = '12s'")
        writer.execute("SET ROLE vega_collect")
        team = self.x("SELECT home_team_id FROM core.matches WHERE id = %s", (self.copy,)).fetchone()[0]
        done = {}

        def second_step():
            try:
                writer.execute("UPDATE core.matches SET note = note WHERE id = %s", (self.copy,))  # waits on the apply's row lock
                writer.execute("COMMIT")
                done["writer"] = "committed"
            except psycopg.Error as error:
                done["writer"] = type(error).__name__

        writer.execute("BEGIN")
        writer.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'uefa', 'test:deadlock', %s)",
                       (team,))

        applier = self.other("postgres")
        applier.execute("SET deadlock_timeout = '4s'")
        applier.execute("SET ROLE vega_collect")
        watcher = self.other("postgres")

        def waiting(pid):
            # Put the apply in its wait before creating the cycle. The unequal detector delays keep
            # the chosen victim observable even when the two connections are scheduled together.
            for _ in range(100):
                if watcher.execute("SELECT 1 FROM pg_locks WHERE pid = %s AND NOT granted", (pid,)).fetchone():
                    return
                time.sleep(0.05)

        def pause():
            thread = threading.Thread(target=lambda: (waiting(applier.info.backend_pid), second_step()))
            thread.start()
            done["thread"] = thread

        with patch.object(archives, "_before_delete", pause):
            done["apply"] = self.apply(plan, applier)
        done["thread"].join(30)
        self.assertEqual((done["apply"], done["writer"]), ("lock_timeout", "committed"))
        self.assertTrue(self.x("SELECT 1 FROM core.matches WHERE id = %s", (self.copy,)).fetchone())

    def test_24h_every_unprotected_reference_has_the_guard(self):
        unprotected = self.x("""
            SELECT DISTINCT n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            WHERE n.nspname IN ('core', 'agg', 'ops') AND c.relkind IN ('r', 'p') AND NOT c.relispartition
              AND ((a.attname = 'match_id' OR a.attname LIKE '%%\\_match\\_id' ESCAPE '\\') AND a.atttypid IN ('integer'::regtype, 'bigint'::regtype)
                    AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f' AND k.confrelid = 'core.matches'::regclass
                                      AND a.attnum = ANY(k.conkey))
                   OR a.attname = 'competition_season_id'
                    AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f'
                                      AND k.confrelid = 'core.competition_seasons'::regclass AND a.attnum = ANY(k.conkey))
                   OR a.attname = 'entity_id' AND EXISTS (SELECT 1 FROM pg_attribute t WHERE t.attrelid = c.oid AND t.attname = 'entity_type'))
            ORDER BY 1""").fetchall()
        guarded = {t for (t,) in self.x("""SELECT DISTINCT tgrelid::regclass::text FROM pg_trigger
                                           WHERE tgname LIKE 'archive\\_removed\\_%%' AND NOT tgisinternal""").fetchall()}
        self.assertTrue(unprotected)
        self.assertEqual([t for (t,) in unprotected if t not in guarded], [])
        self.assertIn("ops.resource_versions", guarded)


if __name__ == "__main__":
    unittest.main()
