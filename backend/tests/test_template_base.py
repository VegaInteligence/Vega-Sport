"""A suite's base cloned from a template instead of the migrations replayed (backend/tests/template_base.py).

On 27 Nov 2026 the Python suites spent about 850 of their 1 086 seconds rebuilding bases: 102 classes and every test
of 8 others dropped the schemas and replayed the 189 files (4.5 to 5.5 s each time), and each of the 58 files of the
read API's suite did it once more in seed.py. A clone of a base migrated once takes about 0.1 s.

Failure modes guarded here:
- C1 the template is built again at every call, or a clone carries what the previous test wrote;
- C2 another process (seed.py, once per file of the read API's suite) builds its own template instead of reusing it;
- C3 a migration added or edited and the suites still run on the older schema; older templates pile up on the server;
- C4 a build that failed half-way is cloned as if it were whole;
- C5 a session left on the suite's base (a test's second connection, a reader) blocks the rebuild;
- C6 a server that is not local, or a base that is not a suite's own, is dropped;
- C7 two suites started together both build the template, and one of them fails;
- K1 the key misses a file `store.migrate` applies, or changes with the optional file it leaves out;
- F1 a clone is not what `store.migrate` leaves on a new base (a relation, a column, a function, a trigger, an index,
  a constraint, a grant, a reference row or a recorded migration differs), or `store.migrate` has something left to
  apply or to track on it;
- F2 the migrations are replayed although their files did not change.
"""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlparse

import template_base

DSN = os.environ.get("VEGA_V2_CLONE_TEST_DSN")
HERE = Path(__file__).resolve().parent
SCHEMAS = "('core','agg','ops','api')"


def probe(log=None):
    """A builder standing for the migrations: one table, one row, and a line in `log` each time it runs."""
    def build(db):
        if log is not None:
            log.append(1)
        db.execute("CREATE TABLE public.probe(x integer)")
        db.execute("INSERT INTO public.probe VALUES (1)")
    return build


class KeyTest(unittest.TestCase):
    def test_K1_every_applied_file_s_name_and_bytes_and_nothing_of_the_optional_one(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            (folder / "001_a.sql").write_text("SELECT 1;")
            (folder / "002_b.sql").write_text("SELECT 2;")
            first = template_base.migrations_key(folder)
            self.assertRegex(first, r"^[0-9a-f]{16}$")
            self.assertEqual(template_base.migrations_key(folder), first)
            (folder / "004_vector_optional.sql").write_text("CREATE EXTENSION vector;")
            self.assertEqual(template_base.migrations_key(folder), first, "the file store.migrate leaves out")
            (folder / "notes.md").write_text("not a migration")
            self.assertEqual(template_base.migrations_key(folder), first)
            (folder / "002_b.sql").write_text("SELECT 3;")
            edited = template_base.migrations_key(folder)
            self.assertNotEqual(edited, first, "one byte of a file")
            (folder / "003_c.sql").write_text("")
            added = template_base.migrations_key(folder)
            self.assertNotEqual(added, edited, "a file added, even empty")
            (folder / "003_c.sql").rename(folder / "003_d.sql")
            self.assertNotEqual(template_base.migrations_key(folder), added, "a file renamed")

    def test_K1_the_real_key_is_the_one_of_the_files_store_migrate_reads(self):
        sql = HERE.parent / "sql"
        self.assertEqual(template_base.migrations_key(), template_base.migrations_key(sql))


@unittest.skipUnless(DSN, "requires dedicated local vega_v2_clone_test DB")
class CloneTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_clone_test":
            raise RuntimeError("dedicated local vega_v2_clone_test required")
        import psycopg

        cls.admin = psycopg.connect(target._replace(path="/postgres").geturl(), autocommit=True)

    @classmethod
    def tearDownClass(cls):
        cls.admin.close()

    def setUp(self):
        self.addCleanup(self.forget)
        self.forget()

    def forget(self):
        for (name,) in self.templates():
            self.admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')

    def templates(self):
        return self.admin.execute(
            "SELECT datname FROM pg_database WHERE datname LIKE 'vega\\_v2\\_template\\_probe\\_%' ORDER BY 1").fetchall()

    def clone(self, key, build, previous=None):
        db = template_base.clone(DSN, "probe", key * 16, build, previous)
        self.addCleanup(db.close)
        return db

    def test_C1_the_builder_runs_once_and_each_clone_starts_from_what_it_built(self):
        log = []
        first = self.clone("a", probe(log))
        self.assertEqual(first.execute("SELECT current_database()").fetchone()[0], "vega_v2_clone_test")
        first.execute("INSERT INTO public.probe VALUES (2)")
        first.execute("CREATE TABLE public.left_by_a_test()")
        second = self.clone("a", probe(log), first)
        self.assertEqual(log, [1], "built once")
        self.assertTrue(first.closed, "the previous connection is closed")
        self.assertEqual(second.execute("SELECT x FROM public.probe").fetchall(), [(1,)])
        self.assertIsNone(second.execute("SELECT to_regclass('public.left_by_a_test')").fetchone()[0])
        self.assertTrue(second.autocommit, "as store.connect_local opens it")
        self.assertEqual(self.templates(), [("vega_v2_template_probe_" + "a" * 16,)])

    def test_C2_another_process_reuses_the_template(self):
        self.clone("a", probe()).close()
        script = (
            "import sys, template_base\n"
            "def build(db): raise SystemExit('built again')\n"
            "db = template_base.clone(sys.argv[1], 'probe', 'a' * 16, build)\n"
            "print(db.execute('SELECT x FROM public.probe').fetchall())\n"
        )
        done = subprocess.run([sys.executable, "-c", script, DSN], cwd=HERE, capture_output=True, text=True,
                              env={**os.environ, "PYTHONPATH": os.pathsep.join([str(HERE), str(HERE.parent)])})
        self.assertEqual((done.returncode, done.stdout.strip()), (0, "[(1,)]"), done.stderr)

    def test_C3_another_key_another_template_and_the_older_one_is_dropped(self):
        self.clone("a", probe()).close()

        def newer(db):
            db.execute("CREATE TABLE public.probe(x integer, y integer)")

        db = self.clone("b", newer)
        self.assertEqual(
            db.execute("SELECT count(*) FROM information_schema.columns WHERE table_name = 'probe'").fetchone()[0], 2)
        self.assertEqual(self.templates(), [("vega_v2_template_probe_" + "b" * 16,)], "the older template is gone")

    def test_C4_a_failed_build_leaves_no_template(self):
        def broken(db):
            db.execute("CREATE TABLE public.half_built()")
            raise RuntimeError("the build stops here")

        with self.assertRaisesRegex(RuntimeError, "the build stops here"):
            template_base.clone(DSN, "probe", "a" * 16, broken)
        self.assertEqual(self.templates(), [], "nothing to clone from")
        db = self.clone("a", probe())
        self.assertIsNone(db.execute("SELECT to_regclass('public.half_built')").fetchone()[0])
        self.assertEqual(db.execute("SELECT x FROM public.probe").fetchall(), [(1,)])

    def test_C5_a_session_left_on_the_suite_s_base_does_not_block_the_next_clone(self):
        import psycopg
        from vega.store import connect_local

        self.clone("a", probe()).close()
        left = connect_local(DSN)
        self.addCleanup(left.close)
        # A session in a transaction that holds the table, as a writer a test forgot.
        left.execute("BEGIN")
        left.execute("LOCK TABLE public.probe IN ACCESS EXCLUSIVE MODE")
        db = self.clone("a", probe())
        self.assertEqual(db.execute("SELECT x FROM public.probe").fetchall(), [(1,)])
        with self.assertRaises(psycopg.OperationalError):
            left.execute("SELECT 1")

    def test_C6_only_a_suite_s_own_base_on_a_local_server(self):
        from vega.store import StoreError

        here = urlparse(DSN)
        refused = (
            here._replace(netloc=here.netloc.replace(here.hostname, "db.example.com")).geturl(),
            here._replace(path="/postgres").geturl(),
            here._replace(path="/vega").geturl(),
            here._replace(path="/vega_v2_template_probe_" + "a" * 16).geturl(),
            DSN + "?options=-csearch_path%3Dpublic",
        )
        log = []
        for dsn in refused:
            with self.subTest(dsn=urlparse(dsn)._replace(netloc="…").geturl()):
                with self.assertRaises(StoreError):
                    template_base.clone(dsn, "probe", "a" * 16, probe(log))
        for kind, key in (("Probe", "a" * 16), ("probe", "A" * 16), ("probe", "a" * 15), ('probe"x', "a" * 16)):
            with self.subTest(kind=kind, key=key), self.assertRaises(ValueError):
                template_base.clone(DSN, kind, key, probe(log))
        self.assertEqual((log, self.templates()), ([], []), "refused before anything is built")

    def test_C7_two_suites_started_together_build_the_template_once(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / "builds"
            script = (
                "import sys, time, template_base\n"
                "def build(db):\n"
                "    open(sys.argv[2], 'a').write('built\\n')\n"
                "    db.execute('CREATE TABLE public.probe(x integer)')\n"
                "    time.sleep(1)\n"
                "template_base.clone(sys.argv[1], 'probe', 'a' * 16, build).close()\n"
            )
            env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(HERE), str(HERE.parent)])}
            other = urlparse(DSN)._replace(path="/vega_v2_clone_test_b").geturl()
            self.addCleanup(self.admin.execute, 'DROP DATABASE IF EXISTS "vega_v2_clone_test_b" WITH (FORCE)')
            both = [subprocess.Popen([sys.executable, "-c", script, dsn, str(log)], cwd=HERE, env=env,
                                     stderr=subprocess.PIPE, text=True) for dsn in (DSN, other)]
            errors = [p.communicate(timeout=60)[1] for p in both]
            self.assertEqual([p.returncode for p in both], [0, 0], errors)
            self.assertEqual(log.read_text(), "built\n")


def fingerprint(db):
    """What a base is made of, without the object identifiers and the dates a build gives: its relations and their
    grants, columns, functions, triggers, indexes, constraints, extensions, each table's row count and the migrations
    recorded."""
    x = lambda sql: db.execute(sql).fetchall()  # noqa: E731
    tables = x(f"""SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname IN {SCHEMAS} AND c.relkind IN ('r', 'p') ORDER BY 1, 2""")
    return {
        "relations": x(f"""SELECT n.nspname, c.relname, c.relkind, c.relacl::text, c.relrowsecurity, c.reloptions::text
                           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                           WHERE n.nspname IN {SCHEMAS} ORDER BY 1, 2"""),
        "schemas": x(f"SELECT nspname, nspacl::text FROM pg_namespace WHERE nspname IN {SCHEMAS} ORDER BY 1"),
        "columns": x(f"""SELECT table_schema, table_name, ordinal_position, column_name, data_type, udt_name,
                                is_nullable, column_default, generation_expression
                         FROM information_schema.columns WHERE table_schema IN {SCHEMAS} ORDER BY 1, 2, 3"""),
        "functions": x(f"""SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), md5(p.prosrc),
                                  p.prosecdef, p.proconfig::text, p.proacl::text
                           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                           WHERE n.nspname IN {SCHEMAS} ORDER BY 1, 2, 3"""),
        "triggers": x(f"""SELECT n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid)
                          FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                          JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE NOT t.tgisinternal AND n.nspname IN {SCHEMAS} ORDER BY 1, 2, 3"""),
        "indexes": x(f"SELECT schemaname, indexname, indexdef FROM pg_indexes WHERE schemaname IN {SCHEMAS} ORDER BY 1, 2"),
        "constraints": x(f"""SELECT n.nspname, c.relname, k.conname, pg_get_constraintdef(k.oid)
                             FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
                             JOIN pg_namespace n ON n.oid = c.relnamespace
                             WHERE n.nspname IN {SCHEMAS} ORDER BY 1, 2, 3"""),
        "views": x(f"SELECT schemaname, viewname, md5(definition) FROM pg_views WHERE schemaname IN {SCHEMAS} ORDER BY 1, 2"),
        "types": x(f"""SELECT n.nspname, t.typname, (SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)::text
                                                      FROM pg_enum e WHERE e.enumtypid = t.oid)
                       FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                       WHERE n.nspname IN {SCHEMAS} AND t.typtype IN ('e', 'd') ORDER BY 1, 2"""),
        "extensions": x("SELECT extname, extversion FROM pg_extension ORDER BY 1"),
        "rows": [(schema, table, db.execute(f'SELECT count(*) FROM "{schema}"."{table}"').fetchone()[0])
                 for schema, table in tables],
        "migrations": [(version, bytes(checksum)) for version, checksum in
                       x("SELECT version, checksum FROM ops.schema_migrations ORDER BY 1")],
        "tracking stale": x("SELECT ops.data_tracking_stale()"),
    }


@unittest.skipUnless(DSN, "requires dedicated local vega_v2_clone_test DB")
class FreshTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_clone_test":
            raise RuntimeError("dedicated local vega_v2_clone_test required")
        import psycopg

        cls.admin = psycopg.connect(target._replace(path="/postgres").geturl(), autocommit=True)
        cls.addClassCleanup(cls.admin.close)
        cls.addClassCleanup(
            cls.admin.execute, 'DROP DATABASE IF EXISTS "vega_v2_template_probe_0000000000000000" WITH (FORCE)')

    def template(self):
        return self.admin.execute("SELECT oid, datname FROM pg_database WHERE datname LIKE 'vega\\_v2\\_template\\_migrated\\_%'").fetchall()

    def test_F1_a_fresh_base_is_what_the_migrations_leave_on_a_new_one(self):
        from vega.store import migrate

        # A new base (a template of nothing), the 189 files replayed on it: what every suite did before.
        replayed = template_base.clone(DSN, "probe", "0" * 16, lambda db: None)
        self.assertEqual(replayed.execute(f"SELECT count(*) FROM pg_namespace WHERE nspname IN {SCHEMAS}").fetchone()[0], 0)
        migrate(replayed)
        expected = fingerprint(replayed)
        self.assertGreater(len(expected["relations"]), 300)
        self.assertGreater(len(expected["migrations"]), 180)
        self.assertEqual(expected["tracking stale"], [(False,)])

        db = template_base.fresh(DSN, replayed)
        self.addCleanup(db.close)
        self.assertTrue(replayed.closed)
        got = fingerprint(db)
        for part, value in expected.items():
            with self.subTest(part=part):
                self.assertEqual(got[part], value)
        # Nothing left for store.migrate to apply or to track: the recorded migrations and the triggers stay as cloned.
        migrate(db)
        self.assertEqual(fingerprint(db), got)

    def test_F2_the_second_fresh_base_comes_from_the_same_template(self):
        first = template_base.fresh(DSN)
        first.execute("CREATE TABLE core.left_by_a_test()")
        built = self.template()
        self.assertEqual([name for _, name in built], ["vega_v2_template_migrated_" + template_base.migrations_key()])
        second = template_base.fresh(DSN, first)
        self.addCleanup(second.close)
        self.assertEqual(self.template(), built, "the same database, not one built again")
        self.assertIsNone(second.execute("SELECT to_regclass('core.left_by_a_test')").fetchone()[0])


if __name__ == "__main__":
    unittest.main()
