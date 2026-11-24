"""The run of backend/account/sql by the migration task (backend/account/FAILURE_MODES.md M1 to M9, written before
these tests).

The real `python -m vega.migrate`, as the task vega-v2-migrate runs it, on a disposable local PostgreSQL
(VEGA_V2_ACCOUNT_MIGRATE_TEST_DSN, database vega_v2_account_migrate_test): first without V2_ACCOUNT_PASSWORD (every
football suite, and the task until the account is switched on), then with it, twice, then without it again. The edited,
failing and missing files run on a copy of backend/ (vega/, sql/, account/sql/). The login vega_v2_account is a role of
the whole server: it is dropped before and after (test_roles counts the vega_v2_* logins).
"""

import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.parse import urlparse, urlunparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from prerequisites import required  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_ACCOUNT_MIGRATE_TEST_DSN")
FILES = sorted(p for p in (ROOT / "account/sql").glob("*.sql"))
FIRST, SECOND = "pw-account-1'quote", "pw-account-2"
LINE = re.compile(r"migrations applied=(\d+) total=(\d+) logins=unchanged")
ROLES = ("vega_account", "vega_read", "vega_collect", "vega_calc", "public")


def run(backend, password=None):
    """The production migration task's command, on `backend` (a copy of backend/ or backend/ itself)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("V2_")}
    env.update(V2_MIGRATION_DATABASE_URL=DSN, PYTHONPATH=str(backend), PYTHONDONTWRITEBYTECODE="1")
    if password is not None:
        env["V2_ACCOUNT_PASSWORD"] = password
    return subprocess.run([sys.executable, "-m", "vega.migrate"], cwd=backend, env=env, capture_output=True, text=True, timeout=600)


def last_line(done):
    if done.returncode:
        raise AssertionError(done.stdout + done.stderr)
    return done.stdout.strip().splitlines()[-1]


def copy_backend(tmp, account_files=True):
    """A copy of backend/ holding what the image holds: vega/, sql/ and account/sql/."""
    backend = tmp / "backend"
    shutil.copytree(ROOT / "vega", backend / "vega", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(ROOT / "sql", backend / "sql")
    if account_files:
        shutil.copytree(ROOT / "account/sql", backend / "account/sql")
    return backend


def login_url(password):
    target = urlparse(DSN)
    return urlunparse(target._replace(netloc=f"vega_v2_account:{password}@{target.hostname}:{target.port or 5432}"))


@required(DSN and psycopg, "requires a disposable local account migration DB (VEGA_V2_ACCOUNT_MIGRATE_TEST_DSN) and psycopg")
class AccountMigrationsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_account_migrate_test":
            raise RuntimeError("dedicated local account migration DB required")
        db = cls.db = connect_local(DSN)
        cls.wipe()
        x = db.execute
        cls.first = last_line(run(ROOT))
        cls.absent_after_first = x("SELECT to_regnamespace('account'), to_regnamespace('account_admin')").fetchone()
        cls.on = last_line(run(ROOT, FIRST))
        cls.records = x("SELECT name, sha256, applied_at FROM account_admin.applied ORDER BY name").fetchall()
        secret = "SELECT rolpassword FROM pg_authid WHERE rolname = 'vega_v2_account'"
        cls.secret_on = x(secret).fetchone()[0]
        cls.again = last_line(run(ROOT, SECOND))
        cls.records_again = x("SELECT name, sha256, applied_at FROM account_admin.applied ORDER BY name").fetchall()
        cls.secret_again = x(secret).fetchone()[0]
        cls.off = last_line(run(ROOT))
        cls.records_off = x("SELECT name, sha256, applied_at FROM account_admin.applied ORDER BY name").fetchall()
        # The login, with the second password, as the store connects.
        with psycopg.connect(login_url(SECOND), autocommit=True) as login:
            cls.login_reads = login.execute("SELECT count(*) FROM account.accounts").fetchone()[0]
            try:
                login.execute("SELECT 1 FROM core.matches LIMIT 1")
                cls.login_football = "allowed"
            except psycopg.errors.InsufficientPrivilege:
                cls.login_football = "denied"
            try:
                login.execute("SELECT 1 FROM account_admin.applied LIMIT 1")
                cls.login_record = "allowed"
            except psycopg.errors.InsufficientPrivilege:
                cls.login_record = "denied"

    @classmethod
    def tearDownClass(cls):
        cls.wipe()
        cls.db.close()

    @classmethod
    def wipe(cls):
        x = cls.db.execute
        x("DROP SCHEMA IF EXISTS api,ops,agg,core,account,account_admin CASCADE")
        x("DROP ROLE IF EXISTS vega_v2_account")

    def records_now(self):
        return self.db.execute("SELECT name, sha256, applied_at FROM account_admin.applied ORDER BY name").fetchall()

    def tmp(self):
        tmp = Path(tempfile.mkdtemp(prefix="vega-account-migrations-"))
        self.addCleanup(shutil.rmtree, tmp, True)
        return tmp

    def test_m1_without_the_password_nothing_of_the_account_runs(self):
        found = LINE.fullmatch(self.first)
        self.assertIsNotNone(found, self.first)
        self.assertEqual(found.group(1), found.group(2))
        self.assertEqual(self.absent_after_first, (None, None))
        self.assertEqual(self.off, f"migrations applied=0 total={found.group(2)} logins=unchanged")
        self.assertEqual(self.records_off, self.records)

    def test_m2_each_file_once_with_its_record(self):
        total = LINE.fullmatch(self.first).group(2)
        self.assertEqual(self.on, f"migrations applied=0 total={total} account applied={len(FILES)} total={len(FILES)} logins=vega_v2_account")
        self.assertEqual([(n, s) for n, s, _ in self.records], [(p.name, hashlib.sha256(p.read_bytes()).hexdigest()) for p in FILES])
        self.assertEqual([p.name for p in FILES][:2], ["001_accounts.sql", "002_account_api.sql"])
        x = self.db.execute
        self.assertEqual([r for (r,) in x("SELECT tablename FROM pg_tables WHERE schemaname = 'account' ORDER BY 1").fetchall()],
                         ["accounts", "erasures", "preferences", "stripe_customers", "stripe_events", "subscriptions"])

    def test_m3_a_second_run_changes_nothing_but_the_password(self):
        total = LINE.fullmatch(self.first).group(2)
        self.assertEqual(self.again, f"migrations applied=0 total={total} account applied=0 total={len(FILES)} logins=vega_v2_account")
        self.assertEqual(self.records_again, self.records)
        # The password is set again (a local server may trust 127.0.0.1, so its stored verifier is compared).
        self.assertTrue(self.secret_on.startswith("SCRAM-SHA-256$"))
        self.assertNotEqual(self.secret_again, self.secret_on)

    def test_m4_an_edited_applied_file_stops_the_run(self):
        backend = copy_backend(self.tmp())
        with open(backend / "account/sql/001_accounts.sql", "a", encoding="utf-8") as f:
            f.write("-- edited after it was applied\n")
        (backend / "account/sql/003_after.sql").write_text("CREATE TABLE account.after_edit (id integer);\n")
        done = run(backend, SECOND)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("ACCOUNT_SQL_CHANGED 001_accounts.sql", done.stderr)
        self.assertIsNone(self.db.execute("SELECT to_regclass('account.after_edit')").fetchone()[0])
        self.assertEqual(self.records_now(), self.records)

    def test_m5_a_failing_file_is_not_recorded_and_runs_once_fixed(self):
        backend = copy_backend(self.tmp())
        name = "003_half.sql"
        self.addCleanup(self.db.execute, "DELETE FROM account_admin.applied WHERE name = %s", (name,))
        self.addCleanup(self.db.execute, "DROP TABLE IF EXISTS account.half")
        (backend / "account/sql" / name).write_text("CREATE TABLE account.half (id integer);\nSELECT 1 / 0;\n")
        done = run(backend, SECOND)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("division by zero", done.stderr)
        self.assertIsNone(self.db.execute("SELECT to_regclass('account.half')").fetchone()[0])
        self.assertEqual(self.records_now(), self.records)
        (backend / "account/sql" / name).write_text("CREATE TABLE account.half (id integer);\n")
        self.assertRegex(last_line(run(backend, SECOND)), r" account applied=1 total=3 logins=vega_v2_account$")
        self.assertIsNotNone(self.db.execute("SELECT to_regclass('account.half')").fetchone()[0])
        self.assertEqual([n for n, *_ in self.records_now()], [p.name for p in FILES] + [name])

    def test_m6_two_runs_at_once_apply_a_file_once(self):
        from vega import migrate
        from vega.store import connect_local

        directory = copy_backend(self.tmp()) / "account/sql"
        name = "003_slow.sql"
        self.addCleanup(self.db.execute, "DELETE FROM account_admin.applied WHERE name = %s", (name,))
        self.addCleanup(self.db.execute, "DROP TABLE IF EXISTS account.slow")
        (directory / name).write_text("SELECT pg_sleep(1);\nCREATE TABLE account.slow (id integer);\n")
        results, errors = [], []

        def one_run():
            try:
                with connect_local(DSN) as conn:
                    results.append(migrate.migrate_account(conn, directory))
            except Exception as error:  # noqa: BLE001 - reported below
                errors.append(repr(error))

        threads = [threading.Thread(target=one_run) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(30)
        self.assertEqual(errors, [])
        self.assertEqual(sorted(applied for applied, _ in results), [[], [name]])
        self.assertEqual([total for _, total in results], [len(FILES) + 1] * 2)

    def test_m7_the_password_without_the_files_fails_before_any_migration(self):
        probe = "999_account_probe.sql"
        self.addCleanup(self.db.execute, "DELETE FROM ops.schema_migrations WHERE version = %s", (probe,))
        self.addCleanup(self.db.execute, "DROP TABLE IF EXISTS ops.account_probe")
        for files in ("none", "empty"):
            with self.subTest(files=files):
                backend = copy_backend(self.tmp(), account_files=False)
                (backend / "sql" / probe).write_text("CREATE TABLE ops.account_probe (id integer);\n")
                if files == "empty":
                    (backend / "account/sql").mkdir(parents=True)
                done = run(backend, SECOND)
                self.assertNotEqual(done.returncode, 0)
                self.assertIn("ACCOUNT_SQL_MISSING", done.stderr)
                self.assertIn(str(backend / "account/sql"), done.stderr)
                self.assertIsNone(self.db.execute("SELECT to_regclass('ops.account_probe')").fetchone()[0])
                self.assertEqual(self.records_now(), self.records)

    def test_m8_the_record_is_nobody_s(self):
        x = self.db.execute
        owner = x("SELECT current_user").fetchone()[0]
        self.assertEqual(x("SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'account_admin'").fetchone()[0], owner)
        self.assertEqual(x("SELECT tableowner FROM pg_tables WHERE schemaname = 'account_admin' AND tablename = 'applied'").fetchone()[0], owner)
        self.assertEqual([t for (t,) in x("SELECT tablename FROM pg_tables WHERE schemaname = 'account_admin'").fetchall()], ["applied"])
        self.assertIsNone(x("SELECT to_regclass('account.applied')").fetchone()[0])
        for role in ROLES:
            with self.subTest(role=role):
                self.assertFalse(x("SELECT has_schema_privilege(%s, 'account_admin', 'USAGE')", (role,)).fetchone()[0])
                self.assertFalse(x("SELECT has_table_privilege(%s, 'account_admin.applied', 'SELECT')", (role,)).fetchone()[0])
        self.assertEqual(self.login_record, "denied")

    def test_m9_a_football_rebuild_keeps_the_account(self):
        x = self.db.execute
        self.addCleanup(x, "DELETE FROM account.accounts WHERE account_id = 'm9-person'")
        x("INSERT INTO account.accounts (account_id) VALUES ('m9-person')")
        # What some sixty football suites do on their own base, then the task as it runs today.
        x("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        self.assertIsNotNone(LINE.fullmatch(last_line(run(ROOT))))
        self.assertEqual(x("SELECT count(*) FROM account.accounts WHERE account_id = 'm9-person'").fetchone()[0], 1)
        self.assertEqual(self.records_now(), self.records)

    def test_m10_the_login_joins_the_group_with_its_limit(self):
        from vega import migrate

        row = self.db.execute(
            """SELECT r.rolcanlogin, r.rolconnlimit, array_agg(g.rolname ORDER BY g.rolname) FROM pg_roles r
               JOIN pg_auth_members m ON m.member = r.oid JOIN pg_roles g ON g.oid = m.roleid
               WHERE r.rolname = 'vega_v2_account' GROUP BY 1, 2""").fetchone()
        self.assertEqual(row, (True, migrate.CONNECTION_LIMITS["account"], ["vega_account"]))
        self.assertEqual(self.login_reads, 0)
        self.assertEqual(self.login_football, "denied")


class FootballSuitesTest(unittest.TestCase):
    def test_m9_no_python_suite_or_football_migration_drops_an_account_schema(self):
        own = Path(__file__).resolve()
        statement = re.compile(r"DROP\s+(?:SCHEMA|OWNED)\b[^;\"']*", re.I)
        for path in sorted((ROOT / "tests").glob("*.py")) + sorted((ROOT / "sql").glob("*.sql")):
            if path == own:
                continue
            for found in statement.findall(path.read_text(encoding="utf-8")):
                with self.subTest(path=path.name, statement=found):
                    self.assertNotRegex(found, r"(?i)\baccount", path.name)
                    self.assertNotRegex(found, r"(?i)\bOWNED\b", path.name)


if __name__ == "__main__":
    unittest.main()
