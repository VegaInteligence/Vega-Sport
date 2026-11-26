"""The statements' statistics of vega_v2, the logins' passwords and the PostgreSQL log (FAILURE_MODES_OPTIMISATIONS.md
GH171, written before these tests).

On a disposable local PostgreSQL 18 whose server preloads pg_stat_statements as database.yaml does
(VEGA_V2_STATEMENTS_TEST_DSN, database vega_v2_statements_test; CI preloads it too): the real `python -m vega.migrate`
of a copy of this backend without 179 (production before the change), then of this tree, twice; the read API's real
handler (backend/tests/read_http.mjs) and a worker login for activity; a second base of the same server with its own
activity (GH171-k). The server's log is read from its container for GH171-l (VEGA_V2_PG_CONTAINER: a container name or
id for `docker logs`; CI's service container), outside the repository for GH171-h (evidence). Rerun:
PYTHONPATH=backend:backend/tests python3 -m unittest -v test_statement_statistics
"""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import signal
import time
import unittest
from urllib.parse import urlsplit, urlunsplit

from prerequisites import required

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
MIGRATION = "179_statement_statistics.sql"
DSN = os.environ.get("VEGA_V2_STATEMENTS_TEST_DSN")
CONTAINER = os.environ.get("VEGA_V2_PG_CONTAINER")
NODE = shutil.which("node")
DATABASE_YAML = (REPO / "infra/aws/database.yaml").read_text()
ROLES_YAML = (REPO / "infra/aws/deploy-roles.yaml").read_text()
CI = (REPO / ".github/workflows/ci.yml").read_text()
PASSWORDS = {"V2_COLLECT_PASSWORD": "collectPWmarker" + "c" * 24, "V2_CALC_PASSWORD": "calcPWmarker" + "k" * 24,
             "V2_READ_PASSWORD": "readPWmarker" + "r" * 24}
COLUMNS = ["queryid", "command", "login", "toplevel", "calls", "rows", "total_ms", "mean_ms", "max_ms",
           "shared_blks_hit", "shared_blks_read", "temp_blks_written"]

try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None


def local(dsn):
    target = urlsplit(dsn or "")
    return target.hostname in ("127.0.0.1", "localhost", "::1") and target.path == "/vega_v2_statements_test"


def sibling(name):
    """The same server, another database (created and dropped by these tests)."""
    return urlunsplit(urlsplit(DSN)._replace(path="/" + name))


def recreate(name):
    with psycopg.connect(sibling("postgres"), autocommit=True) as c:
        c.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        c.execute(f'CREATE DATABASE "{name}"')


def run_migrate(backend, dsn, passwords=None, check=True):
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PYTHONPATH": str(backend), "V2_MIGRATION_DATABASE_URL": dsn,
           **(passwords or {})}
    done = subprocess.run([sys.executable, "-m", "vega.migrate"], cwd=backend, env=env, capture_output=True, text=True, timeout=600)
    if not check:
        return done
    assert done.returncode == 0, done.stdout + done.stderr
    return done.stdout.strip()


# What a server can hold of a role's password statement: its clear password, or a verifier (SCRAM or MD5).
VERIFIER = re.compile(r"SCRAM-SHA-256\$|md5[0-9a-f]{32}")
# The old rotation's clear passwords (vega/migrate.py until 179), and RDS's administrator played by a login that is not
# a superuser (CREATEROLE, ADMIN on the logins and roles it rotates, as RDS's master holds them). Fictitious values.
LEGACY = {"collect": "legacyCollectClear" + "c" * 10, "calc": "legacyCalcClear" + "k" * 10, "read": "legacyReadClear" + "r" * 10}
ADMIN, ADMIN_PASSWORD = "vega_statements_admin", "adminFictive" + "a" * 20
# The worst settings a server can hold before its group applies (GH171-l, n).
WORST = {"pg_stat_statements.track": "all", "pg_stat_statements.track_utility": "on", "log_statement": "all",
         "log_min_duration_statement": "0", "log_error_verbosity": "verbose", "log_lock_waits": "on",
         "log_parameter_max_length": "-1", "log_parameter_max_length_on_error": "-1", "log_min_error_statement": "info",
         "deadlock_timeout": "200ms"}


def group_settings():
    """database.yaml's parameter group, the values a base can take (GH171-m): RDS's settings, not invented ones."""
    group = re.search(r"\n  Parameters:\n    Type: AWS::RDS::DBParameterGroup\n(?:    .*\n)+", DATABASE_YAML).group(0)
    values = dict(re.findall(r"\n        ([a-z_.]+): '?([^'\n]+)'?", group))
    # shared_preload_libraries (static) and rds.* (RDS's own) are not a base's settings.
    return {k: v for k, v in values.items() if k != "shared_preload_libraries" and not k.startswith("rds.")}


def as_login(login, password):
    target = urlsplit(DSN)
    return urlunsplit(target._replace(netloc=f"{login}:{password}@{target.hostname}:{target.port}"))


def logs_in(login, password):
    try:
        with psycopg.connect(as_login(login, password), autocommit=True) as c:
            return c.execute("SELECT current_user").fetchone()[0] == login
    except psycopg.OperationalError:
        return False


def server_log(since):
    """The server's log (its container's output) from `since` (epoch seconds) on."""
    done = subprocess.run(["docker", "logs", "--since", str(since), CONTAINER], capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr[-500:]
    return done.stdout + done.stderr


def backend_without(target, *names):
    """A copy of this backend's code and migrations, without the files named (production's tree before them)."""
    shutil.copytree(ROOT / "vega", target / "vega", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(ROOT / "sql", target / "sql", ignore=shutil.ignore_patterns(*names))
    if (ROOT / "account").exists():
        shutil.copytree(ROOT / "account" / "sql", target / "account" / "sql")
    return target


def preloaded(conn):
    return "pg_stat_statements" in conn.execute("SHOW shared_preload_libraries").fetchone()[0]


def recorded(conn, needle):
    """Statements of the whole server holding `needle` (as a superuser sees them)."""
    return conn.execute(
        f"SELECT query FROM {extension_schema(conn)}.pg_stat_statements(true) WHERE strpos(query, %s) > 0", (needle,)).fetchall()


def extension_schema(conn):
    row = conn.execute("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace "
                       "WHERE e.extname = 'pg_stat_statements'").fetchone()
    return row[0] if row else None


@required(psycopg is not None and local(DSN), "VEGA_V2_STATEMENTS_TEST_DSN, a local vega_v2_statements_test base, and psycopg")
class StatementStatisticsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        recreate("vega_v2_statements_test")
        # The logins are the server's, not the base's: the ones these tests create are dropped after them
        # (test_roles counts the vega_v2_* logins of the whole server).
        with psycopg.connect(DSN, autocommit=True) as c:
            cls.logins_before = {r for (r,) in c.execute("SELECT rolname FROM pg_roles WHERE rolname LIKE 'vega\\_v2\\_%'").fetchall()}
        cls.tmp = Path(tempfile.mkdtemp(prefix="vega-statements-"))
        before = backend_without(cls.tmp / "before", MIGRATION)
        # Production before 179: every earlier file applied, the logins set as every Deploy sets them.
        cls.at_production = run_migrate(before, DSN, PASSWORDS)
        cls.db = psycopg.connect(DSN, autocommit=True)
        cls.preloaded = preloaded(cls.db)
        # What earlier Deploys left in the module's memory (GH171-f): the old rotation's statements, run by the admin
        # identity exactly as vega/migrate.py wrote them until 179; beside them, what must stay: innocent reads naming a
        # role, a user and a password, another login's statement, another role's password statement.
        if cls.preloaded:
            from psycopg import sql
            for role, password in LEGACY.items():
                cls.db.execute(sql.SQL("ALTER ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(f"vega_v2_{role}"), sql.Literal(password)))
            for _ in range(2):
                cls.db.execute("SELECT 'r' AS role, 'p' AS password").fetchone()
                cls.db.execute("SELECT current_user AS \"user\", 'x' AS password").fetchone()
            with psycopg.connect(as_login("vega_v2_collect", LEGACY["collect"]), autocommit=True) as c:
                c.execute("SELECT 'c' AS role, 'p' AS password").fetchone()
            cls.db.execute("DROP ROLE IF EXISTS vega_statements_probe")
            cls.db.execute("CREATE ROLE vega_statements_probe LOGIN PASSWORD 'otherRoleSecret000000000'")
        # GH171-k: another base of the same server, with its own activity and its own password statement, and this
        # base's own statements, before 179 (the other base holds the extension, to read the module before 179).
        cls.other = {}
        if cls.preloaded:
            recreate("vega_v2_statements_other")
            with psycopg.connect(sibling("vega_v2_statements_other"), autocommit=True) as o:
                o.execute("CREATE EXTENSION pg_stat_statements")
                for _ in range(3):
                    o.execute("SELECT 4242 AS other_marker_gh171k").fetchone()
                o.execute("DROP ROLE IF EXISTS vega_statements_other_probe")
                o.execute("CREATE ROLE vega_statements_other_probe PASSWORD 'otherBaseSecret000000000'")
                for _ in range(2):
                    cls.db.execute("SELECT 4243 AS ours_marker_gh171k").fetchone()
                cls.other["reset_before"] = o.execute("SELECT stats_reset FROM pg_stat_statements_info").fetchone()[0]
        cls.deployed = run_migrate(ROOT, DSN, PASSWORDS)
        cls.again = run_migrate(ROOT, DSN, PASSWORDS)
        if cls.preloaded:
            with psycopg.connect(sibling("vega_v2_statements_other"), autocommit=True) as o:
                cls.other["reset_after"] = o.execute("SELECT stats_reset FROM pg_stat_statements_info").fetchone()[0]
                cls.other["entries"] = o.execute(
                    "SELECT d.datname, s.query, s.calls FROM pg_stat_statements s JOIN pg_database d ON d.oid = s.dbid "
                    "WHERE s.query LIKE '%marker_gh171k%' OR s.query LIKE '%otherBaseSecret%'").fetchall()
        # Everything read from the module is read here, before the other tests migrate other bases.
        cls.hits, cls.kept = {}, []
        if cls.preloaded and extension_schema(cls.db):
            for needle in (*PASSWORDS.values(), *LEGACY.values(), "PWmarker"):
                cls.hits[needle] = recorded(cls.db, needle)
            cls.kept = cls.entries()
        cls.activity, cls.activity_error = None, None
        if cls.preloaded and NODE and (ROOT / "api" / "node_modules").exists() and extension_schema(cls.db):
            requests = '[{"path": "/api/search?q=paris&season=2026/2027"}, {"path": "/api/search?q=lyon&season=2026/2027"}]'
            done = subprocess.run([NODE, str(ROOT / "tests" / "read_http.mjs"), DSN, requests], cwd=REPO, capture_output=True, text=True, timeout=120)
            cls.answers = done.stdout
            if done.returncode:
                cls.activity_error = done.stderr
            else:
                target = urlsplit(DSN)
                collect = urlunsplit(target._replace(netloc=f"vega_v2_collect:{PASSWORDS['V2_COLLECT_PASSWORD']}@{target.hostname}:{target.port}"))
                with psycopg.connect(collect, autocommit=True) as worker:
                    worker.execute("SELECT count(*) FROM ops.fetch_jobs").fetchone()
                cls.activity = cls.db.execute("SELECT queryid, command, login, calls FROM ops.statement_stats").fetchall()
                # The search's statement, found by its text as the owner sees it (the view never shows it).
                cls.search_ids = {q for (q,) in cls.db.execute(
                    f"SELECT queryid FROM {extension_schema(cls.db)}.pg_stat_statements(true) WHERE query LIKE 'WITH alias_hits AS MATERIALIZED%%'").fetchall()}

    @classmethod
    def entries(cls):
        """This base's entries of the module: (login, text with spaces folded, calls)."""
        return [(login, re.sub(r"\s+", " ", q), calls) for login, q, calls in cls.db.execute(
            f"SELECT r.rolname, s.query, s.calls FROM {extension_schema(cls.db)}.pg_stat_statements(true) s "
            "JOIN pg_roles r ON r.oid = s.userid WHERE s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())").fetchall()]

    @classmethod
    def tearDownClass(cls):
        cls.drop_administrator()
        cls.db.execute("DROP ROLE IF EXISTS vega_statements_probe")
        cls.db.execute("DROP ROLE IF EXISTS vega_statements_other_probe")
        with psycopg.connect(sibling("postgres"), autocommit=True) as c:
            c.execute('DROP DATABASE IF EXISTS "vega_v2_statements_other" WITH (FORCE)')
        for login in sorted({"vega_v2_collect", "vega_v2_calc", "vega_v2_read"} - cls.logins_before):
            cls.db.execute(f'DROP ROLE IF EXISTS "{login}"')
        cls.db.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # --- GH171-a, b: the migration, once ----------------------------------------------------------------------------

    def test_GH171_a_the_extension_and_the_view_without_the_text(self):
        self.assertTrue(self.at_production.startswith("migrations applied="), self.at_production)
        self.assertRegex(self.deployed, r"^migrations applied=1 total=\d+ ")
        self.assertIsNotNone(extension_schema(self.db), "no pg_stat_statements in vega_v2")
        columns = [c for (c,) in self.db.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'ops' AND table_name = 'statement_stats' "
            "ORDER BY ordinal_position").fetchall()]
        self.assertEqual(columns, COLUMNS)
        source = (ROOT / "sql" / MIGRATION).read_text()
        self.assertRegex(source, r"(?m)^-- vega:online$", "179 is additive: applied while the collection runs (GH157)")

    def test_GH171_b_applied_once_and_on_a_base_holding_the_extension(self):
        self.assertRegex(self.again, r"^migrations applied=0 total=\d+ ")
        # A base where the owner created the extension by hand, elsewhere than public, before 179.
        recreate("vega_v2_statements_test_b")
        other = sibling("vega_v2_statements_test_b")
        self.addCleanup(recreate, "vega_v2_statements_test_b")
        with psycopg.connect(other, autocommit=True) as c:
            c.execute("CREATE SCHEMA monitoring")
            c.execute("CREATE EXTENSION pg_stat_statements SCHEMA monitoring")
        line = run_migrate(ROOT, other)
        self.assertTrue(line.startswith("migrations applied="), line)
        with psycopg.connect(other, autocommit=True) as c:
            self.assertEqual(extension_schema(c), "monitoring")
            if preloaded(c):
                c.execute("SELECT count(*) FROM ops.statement_stats").fetchone()

    # --- GH171-c, d: reading it ------------------------------------------------------------------------------------

    def test_GH171_c_without_the_preload_the_view_says_so(self):
        if self.preloaded:
            self.db.execute("SELECT count(*) FROM ops.statement_stats").fetchone()
            return
        with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):
            self.db.execute("SELECT count(*) FROM ops.statement_stats").fetchone()

    @required(NODE is not None and (ROOT / "api" / "node_modules").exists(), "node and backend/api/node_modules (npm ci --prefix backend/api)")
    def test_GH171_d_activity_by_label_and_login(self):
        self.assertTrue(self.preloaded, "the server must preload pg_stat_statements, as database.yaml does (ci.yml)")
        self.assertIsNone(self.activity_error)
        self.assertIsNotNone(self.activity, "no activity read (no extension in vega_v2)")
        self.assertEqual([a["status"] for a in json.loads(self.answers)], [200, 200])
        rows = self.activity
        search = [(command, login, calls) for queryid, command, login, calls in rows if queryid in self.search_ids]
        self.assertEqual([(command, login) for command, login, _ in search], [("WITH", "vega_read")], rows)
        self.assertEqual(search[0][2], 2)
        self.assertIn("vega_v2_collect", {login for _, _, login, _ in rows})
        self.assertFalse([command for _, command, *_ in rows if command not in {"SELECT", "WITH", "INSERT", "UPDATE", "DELETE", "MERGE", "COPY", "CALL", "OTHER"}])

    # --- GH171-e, f, g: who reads it, and no password ------------------------------------------------------------------

    def test_GH171_e_no_grant_of_the_view_or_the_extension(self):
        schema = extension_schema(self.db)
        x = self.db.execute
        x("DROP ROLE IF EXISTS vega_statements_nobody")
        x("CREATE ROLE vega_statements_nobody")
        self.addCleanup(x, "DROP ROLE IF EXISTS vega_statements_nobody")
        for role in ("vega_statements_nobody", "vega_collect", "vega_calc", "vega_read"):
            with self.subTest(role=role):
                self.assertFalse(x("SELECT has_table_privilege(%s, 'ops.statement_stats', 'SELECT')", (role,)).fetchone()[0])
                for view in ("pg_stat_statements", "pg_stat_statements_info"):
                    self.assertFalse(x("SELECT has_table_privilege(%s, %s, 'SELECT')", (role, f"{schema}.{view}")).fetchone()[0], view)
                for function in ("pg_stat_statements(boolean)", "pg_stat_statements_info()", "pg_stat_statements_reset(oid,oid,bigint,boolean)"):
                    self.assertFalse(x("SELECT has_function_privilege(%s, %s, 'EXECUTE')", (role, f"{schema}.{function}")).fetchone()[0], function)

    def test_GH171_f_the_old_rotation_s_statements_go_and_nothing_else(self):
        self.assertTrue(self.preloaded, "the server must preload pg_stat_statements, as database.yaml does (ci.yml)")
        for password in LEGACY.values():
            self.assertEqual(self.hits.get(password, "no extension"), [], "the old rotation's statement is reset")
        kept = {(login, text): calls for login, text, calls in self.kept}
        admin = self.db.execute("SELECT current_user").fetchone()[0]
        self.assertEqual(kept.get((admin, "SELECT $1 AS role, $2 AS password")), 2, kept)
        self.assertEqual(kept.get((admin, 'SELECT current_user AS "user", $1 AS password')), 2, kept)
        self.assertEqual(kept.get(("vega_v2_collect", "SELECT $1 AS role, $2 AS password")), 1, kept)
        self.assertTrue([t for _, t, _ in self.kept if t.startswith("CREATE ROLE vega_statements_probe LOGIN PASSWORD")],
                        "another role's password statement is its owner's history: kept")

    def test_GH171_g_the_logins_work_and_no_password_is_recorded(self):
        self.assertTrue(self.preloaded, "the server must preload pg_stat_statements, as database.yaml does (ci.yml)")
        target = urlsplit(DSN)
        for role, key in (("collect", "V2_COLLECT_PASSWORD"), ("calc", "V2_CALC_PASSWORD"), ("read", "V2_READ_PASSWORD")):
            with self.subTest(role=role):
                login = urlunsplit(target._replace(netloc=f"vega_v2_{role}:{PASSWORDS[key]}@{target.hostname}:{target.port}"))
                with psycopg.connect(login, autocommit=True) as c:
                    self.assertEqual(c.execute("SELECT current_user").fetchone()[0], f"vega_v2_{role}")
                self.assertEqual(len(self.hits.get(PASSWORDS[key], ["no extension"])), 0, f"the password of vega_v2_{role} is in pg_stat_statements")
        self.assertEqual(len(self.hits.get("PWmarker", ["no extension"])), 0)

    # --- GH171-k, l: no other base's history erased, no secret of a rotation kept ---------------------------------------

    def test_GH171_k_the_other_base_and_this_one_keep_their_counts(self):
        self.assertTrue(self.preloaded, "the server must preload pg_stat_statements, as database.yaml does (ci.yml)")
        entries = {(db, re.sub(r"\s+", " ", q)): calls for db, q, calls in self.other["entries"]}
        self.assertEqual(entries.get(("vega_v2_statements_other", "SELECT $1 AS other_marker_gh171k")), 3, entries)
        self.assertEqual(entries.get(("vega_v2_statements_test", "SELECT $1 AS ours_marker_gh171k")), 2, entries)
        self.assertTrue([q for db, q in entries if db == "vega_v2_statements_other" and "otherBaseSecret" in q],
                        "the other base's own statement is its history: kept")
        self.assertEqual(self.other["reset_after"], self.other["reset_before"], "no reset of the whole module")

    # Helpers of GH171-l, m, n: settings for this base's new sessions, the administrator, a rotation, a held row, and
    # what the module and the log hold of the secrets.
    def settle(self, settings):
        for key, value in settings.items():
            self.db.execute(f"ALTER DATABASE vega_v2_statements_test SET {key} = '{value}'")
        self.addCleanup(self.db.execute, "ALTER DATABASE vega_v2_statements_test RESET ALL")

    @classmethod
    def drop_administrator(cls):
        if cls.db.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (ADMIN,)).fetchone():
            cls.db.execute(f"DROP OWNED BY {ADMIN}")  # its grants in this base
            cls.db.execute(f"DROP ROLE {ADMIN}")

    def administrator(self):
        from psycopg import sql
        x = self.db.execute
        self.drop_administrator()
        x(sql.SQL("CREATE ROLE {} LOGIN CREATEROLE NOSUPERUSER PASSWORD {}").format(sql.Identifier(ADMIN), sql.Literal(ADMIN_PASSWORD)))
        for role in ("vega_v2_collect", "vega_v2_calc", "vega_v2_read", "vega_collect", "vega_calc", "vega_read"):
            x(f"GRANT {role} TO {ADMIN} WITH ADMIN OPTION")
        x(f"GRANT USAGE ON SCHEMA ops TO {ADMIN}")
        x(f"GRANT SELECT ON ops.schema_migrations TO {ADMIN}")
        self.assertFalse(x(f"SELECT rolsuper FROM pg_roles WHERE rolname = '{ADMIN}'").fetchone()[0])
        return as_login(ADMIN, ADMIN_PASSWORD)

    def rotation(self, dsn, passwords, wait=True):
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PYTHONPATH": str(ROOT), "V2_MIGRATION_DATABASE_URL": dsn, **passwords}
        process = subprocess.Popen([sys.executable, "-m", "vega.migrate"], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if not wait:
            return process
        out, err = process.communicate(timeout=300)
        return process.returncode, out + err

    def hold(self, login):
        """Another session holds the login's row until rolled back."""
        holder = psycopg.connect(DSN)
        holder.execute(f"ALTER ROLE {login} CONNECTION LIMIT 7")
        self.addCleanup(holder.close)
        return holder

    def waiting(self, user, timeout=20):
        """The pid of `user`'s backend once it waits on a lock."""
        for _ in range(int(timeout / 0.02)):
            row = self.db.execute("SELECT pid FROM pg_stat_activity WHERE usename = %s AND wait_event_type = 'Lock'", (user,)).fetchone()
            if row:
                return row[0]
            time.sleep(0.02)
        self.fail(f"{user} never waited on a lock")

    def assert_nothing_kept(self, secrets, since, what):
        texts = [q for (q,) in self.db.execute(
            f"SELECT query FROM {extension_schema(self.db)}.pg_stat_statements(true) "
            "WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())").fetchall()]
        for text in texts:
            self.assertFalse([s for s in secrets if s in text] or VERIFIER.search(text), f"{what}: pg_stat_statements holds {text[:200]}")
        time.sleep(0.5)
        for line in server_log(since).splitlines():
            self.assertFalse([s for s in secrets if s in line] or VERIFIER.search(line), f"{what}: the log holds {line[:200]}")

    @required(CONTAINER is not None and shutil.which("docker") is not None,
              "VEGA_V2_PG_CONTAINER (the local server's container) and docker, to read the server's log")
    def test_GH171_l_an_administrator_without_the_secure_mode_is_refused_before_anything_is_sent(self):
        self.assertTrue(self.preloaded, "the server must preload pg_stat_statements, as database.yaml does (ci.yml)")
        since = int(time.time()) - 2
        admin = self.administrator()
        self.settle(WORST)
        rotated = {"V2_COLLECT_PASSWORD": "lCollectPWmarkerRot" + "c" * 12, "V2_CALC_PASSWORD": "lCalcPWmarkerRot" + "k" * 12,
                   "V2_READ_PASSWORD": "lReadPWmarkerRot" + "r" * 12}
        holder = self.hold("vega_v2_read")
        try:
            code, out = self.rotation(admin, rotated)
        finally:
            holder.rollback()
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"LOGINS_REFUSED .*log_error_verbosity is verbose")
        self.assertRegex(out, r"pg_stat_statements\.track_utility is on")
        self.assert_nothing_kept(list(rotated.values()), since, "refused")
        for role, key in (("collect", "V2_COLLECT_PASSWORD"), ("calc", "V2_CALC_PASSWORD"), ("read", "V2_READ_PASSWORD")):
            self.assertTrue(logs_in(f"vega_v2_{role}", PASSWORDS[key]), f"vega_v2_{role} keeps its password")

    @required(CONTAINER is not None and shutil.which("docker") is not None,
              "VEGA_V2_PG_CONTAINER (the local server's container) and docker, to read the server's log")
    def test_GH171_m_an_administrator_under_the_group_s_settings_fails_cancels_and_retries_without_a_trace(self):
        self.assertTrue(self.preloaded, "the server must preload pg_stat_statements, as database.yaml does (ci.yml)")
        since = int(time.time()) - 2
        admin = self.administrator()
        group = group_settings()
        self.assertEqual((group["pg_stat_statements.track_utility"], group["log_error_verbosity"]), ("0", "terse"))
        self.settle({**group, "deadlock_timeout": "4s"})  # a lock wait long enough to act during it
        before = {(login, text): calls for login, text, calls in self.entries()}
        secrets, old = [], dict(PASSWORDS)

        def passwords(tag):
            new = {"V2_COLLECT_PASSWORD": f"m{tag}CollectPWmarker" + "c" * 10, "V2_CALC_PASSWORD": f"m{tag}CalcPWmarker" + "k" * 10,
                   "V2_READ_PASSWORD": f"m{tag}ReadPWmarker" + "r" * 10}
            secrets.extend(new.values())
            return new

        def still(passwords_now, what):
            for role, key in (("collect", "V2_COLLECT_PASSWORD"), ("calc", "V2_CALC_PASSWORD"), ("read", "V2_READ_PASSWORD")):
                self.assertTrue(logs_in(f"vega_v2_{role}", passwords_now[key]), f"{what}: vega_v2_{role}'s password")

        # The last login's row held: the first two set, the third refused, all rolled back.
        holder = self.hold("vega_v2_read")
        code, out = self.rotation(admin, passwords("a"))
        holder.rollback()
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"the password of vega_v2_read could not be set \(55P03\)")
        self.assert_nothing_kept(secrets, since, "failed on the last login")
        still(old, "failed on the last login")
        # Cancelled during its nested statement (the client's cancel).
        holder = self.hold("vega_v2_read")
        process = self.rotation(admin, passwords("b"), wait=False)
        pid = self.waiting(ADMIN)
        self.db.execute("SELECT pg_cancel_backend(%s)", (pid,))
        out = "".join(process.communicate(timeout=60))
        holder.rollback()
        self.assertEqual(process.returncode, 1, out)
        self.assertRegex(out, r"the password of vega_v2_read could not be set \(57014\)")
        self.assert_nothing_kept(secrets, since, "cancelled")
        still(old, "cancelled")
        # Stopped by its own statement_timeout.
        self.db.execute(f"ALTER ROLE {ADMIN} SET statement_timeout = '700ms'")
        holder = self.hold("vega_v2_read")
        code, out = self.rotation(admin, passwords("c"))
        holder.rollback()
        self.db.execute(f"ALTER ROLE {ADMIN} RESET statement_timeout")
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"the password of vega_v2_read could not be set \(57014\)")
        self.assert_nothing_kept(secrets, since, "timed out")
        still(old, "timed out")
        # Its client killed mid-rotation, the server's session left to end.
        holder = self.hold("vega_v2_read")
        process = self.rotation(admin, passwords("d"), wait=False)
        pid = self.waiting(ADMIN)
        process.send_signal(signal.SIGKILL)
        process.communicate(timeout=60)
        holder.rollback()
        for _ in range(500):
            if not self.db.execute("SELECT 1 FROM pg_stat_activity WHERE pid = %s", (pid,)).fetchone():
                break
            time.sleep(0.02)
        self.assert_nothing_kept(secrets, since, "client killed")
        still(old, "client killed")
        # Two rotations at once: one of them at least sets its passwords.
        a, b = passwords("e"), passwords("f")
        first, second = self.rotation(admin, a, wait=False), self.rotation(admin, b, wait=False)
        outs = ["".join(p.communicate(timeout=120)) for p in (first, second)]
        self.assertIn(0, (first.returncode, second.returncode), outs)
        self.assert_nothing_kept(secrets, since, "two at once")
        # The retry, then a second rotation: the new passwords log in, innocent entries keep their counts (no purge).
        for tag in ("g", "h"):
            new = passwords(tag)
            code, out = self.rotation(admin, new)
            self.assertEqual(code, 0, out)
            self.assertRegex(out, r"logins=vega_v2_collect,vega_v2_calc,vega_v2_read$")
            self.assert_nothing_kept(secrets, since, f"rotation {tag}")
            still(new, f"rotation {tag}")
        after = {(login, text): calls for login, text, calls in self.entries()}
        innocent = [key for key in before if "AS role" in key[1] or "AS password" in key[1]]
        self.assertTrue(innocent, before)
        for key in innocent:
            self.assertEqual(after.get(key), before[key], f"{key}: an innocent entry kept its count")
        # The logins as the class found them, for the other tests.
        self.assertEqual(self.rotation(DSN, PASSWORDS)[0], 0)

    @required(CONTAINER is not None and shutil.which("docker") is not None,
              "VEGA_V2_PG_CONTAINER (the local server's container) and docker, to read the server's log")
    def test_GH171_n_a_superuser_sets_the_secure_mode_for_its_transaction(self):
        self.assertTrue(self.preloaded, "the server must preload pg_stat_statements, as database.yaml does (ci.yml)")
        since = int(time.time()) - 2
        self.settle(WORST)
        failing = {"V2_COLLECT_PASSWORD": "nFailCollectPWmarker" + "c" * 10, "V2_CALC_PASSWORD": "nFailCalcPWmarker" + "k" * 10,
                   "V2_READ_PASSWORD": "nFailReadPWmarker" + "r" * 10}
        holder = self.hold("vega_v2_read")
        code, out = self.rotation(DSN, failing)
        holder.rollback()
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"the password of vega_v2_read could not be set \(55P03\)")
        self.assert_nothing_kept(list(failing.values()), since, "failed")
        done = {"V2_COLLECT_PASSWORD": "nDoneCollectPWmarker" + "c" * 10, "V2_CALC_PASSWORD": "nDoneCalcPWmarker" + "k" * 10,
                "V2_READ_PASSWORD": "nDoneReadPWmarker" + "r" * 10}
        code, out = self.rotation(DSN, done)
        self.assertEqual(code, 0, out)
        self.assert_nothing_kept(list(failing.values()) + list(done.values()), since, "succeeded")
        self.assertTrue(logs_in("vega_v2_read", done["V2_READ_PASSWORD"]))
        # The logins as the class found them, for the other tests.
        self.assertEqual(self.rotation(DSN, PASSWORDS)[0], 0)

    # --- GH171-i, j: the templates -----------------------------------------------------------------------------------

    def test_GH171_i_the_parameter_group_and_the_instance(self):
        group = re.search(r"\n  Parameters:\n    Type: AWS::RDS::DBParameterGroup\n(?:    .*\n)+", DATABASE_YAML).group(0)
        settings = dict(re.findall(r"\n        ([a-z_.]+): '?([^'\n]+)'?", group))
        self.assertEqual(settings.get("shared_preload_libraries"), "pg_stat_statements", "unchanged: a static parameter (a restart)")
        expected = {"pg_stat_statements.track": "all", "pg_stat_statements.track_utility": "0", "track_io_timing": "1",
                    "log_parameter_max_length": "0", "log_parameter_max_length_on_error": "0", "log_error_verbosity": "terse",
                    "log_lock_waits": "1", "log_temp_files": "10240", "log_min_duration_statement": "2000"}
        for key, value in expected.items():
            self.assertEqual(settings.get(key), value, key)
        self.assertFalse([key for key in settings if key.startswith("auto_explain")], "no auto_explain setting")
        instance = re.search(r"\n  Database:\n    Type: AWS::RDS::DBInstance\n(?:    .*\n)+", DATABASE_YAML).group(0)
        self.assertRegex(instance, r"\n      EnablePerformanceInsights: !If \[HasInsights, true, false\]\n")
        self.assertRegex(instance, r"\n      PerformanceInsightsRetentionPeriod: !If \[HasInsights, 7, !Ref AWS::NoValue\]\n")
        self.assertRegex(instance, r"\n      DatabaseInsightsMode: !If \[HasInsights, standard, !Ref AWS::NoValue\]\n")
        self.assertRegex(instance, r"\n      EnableCloudwatchLogsExports: \[postgresql\]\n")
        self.assertRegex(instance, r"\n    DependsOn: PostgresqlLog\n")
        log = re.search(r"\n  PostgresqlLog:\n    Type: AWS::Logs::LogGroup\n(?:    .*\n)+", DATABASE_YAML).group(0)
        self.assertIn("LogGroupName: /aws/rds/instance/vega-football-db-postgres/postgresql", log)
        self.assertIn("RetentionInDays: 14", log)
        self.assertRegex(DATABASE_YAML, r"HasInsights: !Not \[!Or \[!Equals \[!Ref InstanceClass, db\.t4g\.micro\], !Equals \[!Ref InstanceClass, db\.t4g\.small\]\]\]")

    def test_GH171_j_the_cloudformation_role_may_create_the_log_group_only(self):
        logs = re.search(r"- Sid: Logs\n(?:(?!\s+- Sid:).*\n)+", ROLES_YAML).group(0)
        self.assertIn("log-group:/aws/rds/instance/vega-football-db-postgres/postgresql*", logs)
        self.assertNotRegex(logs, r"log-group:/aws/rds/\*")

    def test_GH171_ci_preloads_the_module_as_the_base_does(self):
        self.assertRegex(CI, r"ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'")

    def test_GH171_l_ci_gives_the_server_s_container_to_the_python_suites(self):
        # Under CI=true a missing prerequisite fails (prerequisites.py): GH171-l reads the service container's log.
        step = re.search(r"\n      - name: Python suites\n(?:        .*\n)+", CI)
        self.assertIsNotNone(step, "no step « Python suites »")
        self.assertRegex(step.group(0), r"\n          VEGA_V2_PG_CONTAINER: \$\{\{ job\.services\.postgres\.id \}\}\n")
        self.assertRegex(step.group(0), r"\n        run: python -m unittest discover -s backend/tests -v\n")


if __name__ == "__main__":
    unittest.main()
