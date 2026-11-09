"""Database roles (017_roles.sql): each component reaches only its own schemas."""

import os
from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_ROLES_TEST_DSN")


@unittest.skipUnless(DSN and psycopg, "requires disposable local roles DB and psycopg")
class RolesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega_v2.store import Store, connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_roles_test":
            raise RuntimeError("dedicated local roles DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        cls.Store = Store

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("RESET ROLE")
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def as_role(self, role):
        self.db.execute(f"SET ROLE {role}")
        self.addCleanup(self.db.execute, "RESET ROLE")

    def denied(self, sql):
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            with self.db.transaction():
                self.db.execute(sql)

    def test_collect_writes_core_and_ops_and_creates_partitions(self):
        self.as_role("vega_collect")
        store = self.Store(self.db)
        with self.db.transaction():
            self.assertEqual(store.season("2027/2028"), 2027)
            store.season("1999/2000")
        names = {r[0] for r in self.db.execute("SELECT relname FROM pg_class WHERE relname LIKE 'shots_%'")}
        self.assertTrue({"shots_s2027", "shots_archive"} <= names)
        self.assertEqual(
            self.db.execute("SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname='shots_s2027'").fetchone()[0],
            "postgres",
        )
        store.log_attempt(
            "calendar",
            {"fetched_at": datetime(2027, 3, 4, tzinfo=timezone.utc), "status": 200, "error_code": None, "request_id": None, "duration_ms": 5},
            target_date=datetime(2027, 3, 4).date(),
        )
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.fetch_log_202703").fetchone()[0], 1)
        self.denied("SELECT 1 FROM agg.team_season_stats")
        self.denied("CREATE TABLE core.intruder(id integer)")

    def test_calc_reads_core_writes_agg(self):
        self.as_role("vega_calc")
        with self.db.transaction():
            self.db.execute("INSERT INTO agg.calc_runs(kind, model_version) VALUES ('levels', 'test')")
            self.db.execute("SELECT count(*) FROM core.matches").fetchone()
        self.denied("INSERT INTO core.countries(code) VALUES ('ZZZ')")
        self.denied("INSERT INTO ops.fetch_jobs(lane, family, global_key) VALUES ('reference', 'league', 'catalogue')")

    def test_read_sees_api_only(self):
        self.as_role("vega_read")
        self.assertEqual(self.db.execute("SELECT count(*) FROM api.match_list").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT api.public_id('team', 7)").fetchone()[0], "t_v0000007")
        self.db.execute("SELECT * FROM api.publication").fetchone()
        self.denied("SELECT 1 FROM core.matches")
        self.denied("SELECT 1 FROM agg.player_season_stats")
        self.denied("SELECT 1 FROM ops.fetch_jobs")

    def test_migration_task_creates_logins_idempotently(self):
        from vega_v2 import migrate

        env = {"V2_MIGRATION_DATABASE_URL": DSN, "V2_COLLECT_PASSWORD": "pw-collect-1", "V2_READ_PASSWORD": "pw-read-1"}
        for _ in range(2):
            self.assertEqual(migrate.main(env), 0)
        rows = self.db.execute(
            """SELECT r.rolname, r.rolcanlogin, r.rolconnlimit, g.rolname FROM pg_roles r
               JOIN pg_auth_members m ON m.member = r.oid JOIN pg_roles g ON g.oid = m.roleid
               WHERE r.rolname LIKE 'vega_v2_%' ORDER BY 1"""
        ).fetchall()
        self.assertEqual(rows, [("vega_v2_collect", True, 6, "vega_collect"), ("vega_v2_read", True, 12, "vega_read")])
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.schema_migrations").fetchone()[0], len(list((ROOT / "sql").glob("*.sql"))) - 2)

    def test_owner_url_from_the_rds_secret(self):
        from vega_v2.migrate import owner_url

        url = owner_url({"V2_DB_HOST": "h.example", "V2_DB_NAME": "vega_v2", "V2_DB_USER": "vega_owner", "V2_DB_PASSWORD": "p@ss/w:rd"})
        self.assertEqual(url, "postgresql://vega_owner:p%40ss%2Fw%3Ard@h.example:5432/vega_v2?sslmode=verify-full&sslrootcert=/app/rds-ca.pem")
        self.assertIsNone(owner_url({"V2_DB_HOST": "h"}))


if __name__ == "__main__":
    unittest.main()
