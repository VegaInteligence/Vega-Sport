"""Versions kept by the writers (FAILURE_MODES_OPTIMISATIONS.md GH137A, migration 181) on a dedicated local base.

Failure modes, and what is expected:
- a table a read sees changed while no version moves -> each committed transaction that really changes a table of a
  closure adds one mark (one, whatever its rows and statements), visible at its commit; a rollback or a savepoint rolled
  back adds none; TRUNCATE, a row moved across partitions and a partition created later mark (GH137A-m);
- a write that changes nothing moving a version -> an upsert of the same values (json and jsonb columns), a conflicting
  INSERT ... DO NOTHING and a DELETE of nothing leave no mark (GH137A-h, at the tables);
- writers waiting on each other -> two transactions writing one table at once: neither waits (lock_timeout 200 ms);
- a version going back, or missing a commit -> the fold moves the counts in one statement (the version is the same
  before and after it); a mark of a transaction still open is folded once it commits;
- a read validated by versions it cannot have -> every source of ops.data_sources carries the four triggers; a view over
  a materialized view, a function running dynamic SQL and a read of now() have no source row (api.data_version NULL);
  a read of current_date is a day read; the machinery's own tables are no source;
- a table added by a later migration left untracked -> store.migrate's run tracks it;
- the marks written by anyone but the trigger, or read by the read API directly -> vega_collect and vega_calc cannot
  write or read them, may fold; vega_read reads versions through api.data_version only;
- the migration applied while the services write -> 181 is not marked online (it adds triggers to every written table);
- versions never folded -> the worker folds them each planning round (Worker.publish).
Added after the review of 26 Nov 2026 (GH137A-s; the draft of 181 left a version unchanged when a leaf was truncated):
- a leaf partition truncated directly, a leaf created after the migration (plain, or by core.ensure_season_partitions)
  then truncated, a partition detached, attached with rows, detached concurrently -> the version changes each time; a
  detached table truncated does not change it; a TRUNCATE rolled back does not either; a row written into a leaf
  directly marks its root;
- a fold seen from a snapshot taken before it, or from separate transactions -> the same version;
- a privilege granted beyond the machinery's need -> exactly the owner on the tables and the sequence; PUBLIC only on
  the claim; vega_read only on api.data_version; vega_collect and vega_calc only on the fold.
Added after the second review of 26 Nov 2026 (GH137A-s, r):
- a leaf detached, its rows updated while detached (no trigger then, and no new file), attached again: the version
  changes (score 1 -> 8 kept the draft's version); a concurrent detach left pending changes it (its rows are no longer
  read), and the leaf, its detach finished, updated and attached again, gives a version not seen before;
- a reader counting pending marks without bound when the worker stops folding -> past 10 000 marks on a source the
  version is unknown (NULL), and the fold, 100 000 marks at most a call, gives it back unchanged by the fold;
- an existing api view given another table by a migration committed before the tracking that follows it (store.migrate
  commits each file, then tracks), seen from another session in between, or after a tracking that failed -> the
  version is unknown until a tracking commits; then the new table's writes move it (GH137A-z).
"""
import os
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
from vega import migrate as migration
from vega.store import Store, connect_local, migrate
from vega.worker import Worker

DSN = os.environ.get("VEGA_V2_DATA_VERSIONS_TEST_DSN")
TRIGGERS = {"vega_change_insert", "vega_change_update", "vega_change_delete", "vega_change_truncate"}


# Skipped without its base outside CI; under CI=true a missing base fails (prerequisites.py, backend/ci/test_databases.py).
@required(bool(DSN), "VEGA_V2_DATA_VERSIONS_TEST_DSN, the disposable local vega_v2_data_versions_test")
class DataVersionsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_data_versions_test":
            raise RuntimeError("dedicated local vega_v2_data_versions_test required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        # Probes of this test: a plain table, a partitioned one, read by api views; a json and a jsonb column.
        x = cls.db.execute
        x("CREATE TABLE core.gh137a_plain(id int PRIMARY KEY, label text, doc json, docb jsonb)")
        x("CREATE TABLE core.gh137a_parts(season_id int NOT NULL, id int NOT NULL, label text, PRIMARY KEY(season_id, id)) PARTITION BY LIST(season_id)")
        x("CREATE TABLE core.gh137a_parts_a PARTITION OF core.gh137a_parts FOR VALUES IN (2019, 2020)")
        x("CREATE TABLE core.gh137a_parts_b PARTITION OF core.gh137a_parts FOR VALUES IN (2026)")
        x("CREATE VIEW api.gh137a_probe AS SELECT p.id, p.label, q.season_id FROM core.gh137a_plain p LEFT JOIN core.gh137a_parts q ON q.id = p.id")
        x("CREATE MATERIALIZED VIEW core.gh137a_mv AS SELECT 1 AS one")
        x("CREATE VIEW api.gh137a_over_mv AS SELECT one FROM core.gh137a_mv")
        x("CREATE FUNCTION api.gh137a_dynamic() RETURNS bigint LANGUAGE plpgsql AS $$ DECLARE n bigint; BEGIN EXECUTE 'SELECT count(*) FROM core.gh137a_plain' INTO n; RETURN n; END $$")
        x("CREATE VIEW api.gh137a_now AS SELECT now() AS at, label FROM core.gh137a_plain")
        x("CREATE VIEW api.gh137a_today AS SELECT current_date AS day, label FROM core.gh137a_plain")
        x("SELECT ops.track_data_changes()")

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        self.db.execute("TRUNCATE core.gh137a_plain")
        self.db.execute("DELETE FROM core.gh137a_parts")
        self.db.execute("SELECT ops.fold_data_changes()")

    # Helpers -------------------------------------------------------------

    def marks(self, relation):
        return self.db.execute("SELECT count(*) FROM ops.data_changes WHERE relation = %s", (relation,)).fetchone()[0]

    def version(self, *relations):
        return self.db.execute("SELECT api.data_version(%s::text[])", (list(relations),)).fetchone()[0]

    def other(self):
        conn = psycopg.connect(DSN, autocommit=True)
        self.addCleanup(conn.close)
        return conn

    # Marks ----------------------------------------------------------------

    def test_one_mark_per_table_and_committed_transaction(self):
        before = self.version("api.gh137a_probe")
        watcher = self.other()
        with self.db.transaction():
            self.db.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (1, 'a'), (2, 'b'), (3, 'c')")
            self.db.execute("UPDATE core.gh137a_plain SET label = label || '!'")
            self.db.execute("INSERT INTO core.gh137a_parts VALUES (2026, 1, 'x'), (2019, 2, 'y')")
            seen = watcher.execute("SELECT count(*) FROM ops.data_changes WHERE relation LIKE 'core.gh137a%'").fetchone()[0]
            self.assertEqual(seen, 0, "a mark is seen only with its transaction's data")
        self.assertEqual(self.marks("core.gh137a_plain"), 1)
        self.assertEqual(self.marks("core.gh137a_parts"), 1, "one mark for the root, whatever the partitions")
        self.assertNotEqual(self.version("api.gh137a_probe"), before)

    def test_rollbacks_leave_no_mark(self):
        before = self.version("api.gh137a_probe")
        with self.assertRaises(RuntimeError):
            with self.db.transaction():
                self.db.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (1, 'a')")
                raise RuntimeError("rolled back")
        with self.db.transaction():
            with self.assertRaises(RuntimeError):
                with self.db.transaction():  # a savepoint
                    self.db.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (2, 'b')")
                    raise RuntimeError("savepoint rolled back")
        self.assertEqual(self.marks("core.gh137a_plain"), 0)
        self.assertEqual(self.version("api.gh137a_probe"), before)
        # After a savepoint rolled back, a later change of the same transaction still marks the table, once.
        with self.db.transaction():
            with self.assertRaises(RuntimeError):
                with self.db.transaction():
                    self.db.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (3, 'c')")
                    raise RuntimeError("savepoint rolled back")
            self.db.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (4, 'd')")
        self.assertEqual(self.marks("core.gh137a_plain"), 1)

    def test_writes_that_change_nothing_leave_no_mark(self):
        self.db.execute("""INSERT INTO core.gh137a_plain(id, label, doc, docb) VALUES (1, 'a', '{"k": [1, 2]}', '{"k": [1, 2]}')""")
        self.db.execute("SELECT ops.fold_data_changes()")
        before = self.version("api.gh137a_probe")
        self.db.execute("""INSERT INTO core.gh137a_plain(id, label, doc, docb) VALUES (1, 'a', '{"k": [1, 2]}', '{"k": [1, 2]}')
                           ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, doc = EXCLUDED.doc, docb = EXCLUDED.docb""")
        self.db.execute("UPDATE core.gh137a_plain SET label = label, doc = doc, docb = docb::text::jsonb")
        self.db.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (1, 'other') ON CONFLICT DO NOTHING")
        self.db.execute("DELETE FROM core.gh137a_plain WHERE id = 99")
        self.assertEqual(self.marks("core.gh137a_plain"), 0)
        self.assertEqual(self.version("api.gh137a_probe"), before)
        # A json value written differently is another value (its text is what the reads give): a change.
        self.db.execute("""UPDATE core.gh137a_plain SET doc = '{"k":[1,2]}'""")
        self.assertEqual(self.marks("core.gh137a_plain"), 1)

    def test_truncate_row_movement_and_a_later_partition_mark(self):
        self.db.execute("INSERT INTO core.gh137a_parts VALUES (2019, 1, 'x')")
        self.db.execute("SELECT ops.fold_data_changes()")
        self.db.execute("UPDATE core.gh137a_parts SET season_id = 2026 WHERE id = 1")
        self.assertEqual(self.marks("core.gh137a_parts"), 1, "a row moved across partitions")
        self.db.execute("TRUNCATE core.gh137a_plain")
        self.assertEqual(self.marks("core.gh137a_plain"), 1, "TRUNCATE")
        self.db.execute("CREATE TABLE core.gh137a_parts_c PARTITION OF core.gh137a_parts FOR VALUES IN (2030)")
        self.addCleanup(self.db.execute, "DROP TABLE IF EXISTS core.gh137a_parts_c")
        triggers = {r[0] for r in self.db.execute(
            "SELECT tgname FROM pg_trigger WHERE tgrelid = 'core.gh137a_parts_c'::regclass AND NOT tgisinternal")}
        self.assertLessEqual(TRIGGERS - {"vega_change_truncate"}, triggers, "a partition created later inherits the row triggers")
        self.db.execute("SELECT ops.fold_data_changes()")
        self.db.execute("INSERT INTO core.gh137a_parts VALUES (2030, 9, 'z')")
        self.assertEqual(self.marks("core.gh137a_parts"), 1)

    def test_two_writers_of_one_table_never_wait_on_each_other(self):
        first, second = self.other(), self.other()
        before = self.db.execute("SELECT coalesce(version, 0) FROM ops.data_versions WHERE relation = 'core.gh137a_plain'").fetchone()
        first.execute("BEGIN")
        first.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (1, 'first')")
        second.execute("SET lock_timeout = '200ms'")
        second.execute("BEGIN")
        second.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (2, 'second')")  # LockNotAvailable if it waited
        second.execute("UPDATE core.gh137a_plain SET label = 'again' WHERE id = 2")
        second.execute("COMMIT")
        first.execute("COMMIT")
        self.assertEqual(self.marks("core.gh137a_plain"), 2)
        self.db.execute("SELECT ops.fold_data_changes()")
        after = self.db.execute("SELECT version FROM ops.data_versions WHERE relation = 'core.gh137a_plain'").fetchone()[0]
        self.assertEqual(after - (before[0] if before else 0), 2)

    def test_the_fold_moves_counts_and_keeps_what_is_still_open(self):
        self.db.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (1, 'a')")
        self.db.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (2, 'b')")
        before = self.version("api.gh137a_probe")
        writer = self.other()
        writer.execute("BEGIN")
        writer.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (3, 'c')")
        folded = self.db.execute("SELECT ops.fold_data_changes()").fetchone()[0]
        self.assertGreaterEqual(folded, 2)
        self.assertEqual(self.version("api.gh137a_probe"), before, "the fold changes no version")
        self.assertEqual(self.marks("core.gh137a_plain"), 0)
        writer.execute("COMMIT")
        self.assertEqual(self.marks("core.gh137a_plain"), 1, "the open transaction's mark, kept")
        self.assertNotEqual(self.version("api.gh137a_probe"), before)

    # What no row trigger sees: partitions (GH137A-s) ----------------------------

    def test_a_leaf_truncated_directly_changes_the_version(self):
        self.db.execute("INSERT INTO core.gh137a_parts VALUES (2026, 1, 'x'), (2026, 2, 'y'), (2019, 3, 'z')")
        self.db.execute("SELECT ops.fold_data_changes()")
        before = self.version("api.gh137a_probe")
        with self.assertRaises(RuntimeError):
            with self.db.transaction():
                self.db.execute("TRUNCATE core.gh137a_parts_b")
                self.assertNotEqual(self.version("api.gh137a_probe"), before, "seen inside its transaction")
                raise RuntimeError("rolled back")
        self.assertEqual(self.version("api.gh137a_probe"), before, "a TRUNCATE rolled back")
        self.db.execute("TRUNCATE core.gh137a_parts_b")
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.gh137a_parts").fetchone()[0], 1)
        self.assertNotEqual(self.version("api.gh137a_probe"), before, "a leaf truncated directly")

    def test_a_leaf_created_later_then_truncated_changes_the_version(self):
        before = self.version("api.gh137a_probe")
        self.db.execute("CREATE TABLE core.gh137a_parts_c PARTITION OF core.gh137a_parts FOR VALUES IN (2030)")
        self.addCleanup(self.db.execute, "DROP TABLE IF EXISTS core.gh137a_parts_c")
        created = self.version("api.gh137a_probe")
        self.assertNotEqual(created, before, "a member added")
        self.db.execute("INSERT INTO core.gh137a_parts_c VALUES (2030, 7, 'direct')")
        self.assertEqual(self.marks("core.gh137a_parts"), 1, "a row written into a leaf directly marks its root")
        self.db.execute("SELECT ops.fold_data_changes()")
        filled = self.version("api.gh137a_probe")
        self.db.execute("TRUNCATE core.gh137a_parts_c")
        self.assertNotEqual(self.version("api.gh137a_probe"), filled, "a later leaf truncated directly")

    def test_the_season_partitions_of_core_are_covered(self):
        # core's facts are partitioned by season (017): a season's leaves come from core.ensure_season_partitions.
        sources = {r[0] for r in self.db.execute("SELECT source FROM ops.data_sources WHERE relation = 'api.player_appearances'")}
        self.assertIn("core.player_match_stats", sources)
        before = self.version("api.player_appearances")
        self.db.execute("SELECT core.ensure_season_partitions(2031)")
        made = self.version("api.player_appearances")
        self.assertNotEqual(made, before, "a season's partitions created")
        self.db.execute("TRUNCATE core.player_match_stats_s2031")
        self.assertNotEqual(self.version("api.player_appearances"), made, "a season's leaf truncated directly")

    def test_detach_and_attach_change_the_version(self):
        self.db.execute("INSERT INTO core.gh137a_parts VALUES (2019, 1, 'old'), (2026, 2, 'new')")
        self.db.execute("SELECT ops.fold_data_changes()")
        before = self.version("api.gh137a_probe")
        self.db.execute("ALTER TABLE core.gh137a_parts DETACH PARTITION core.gh137a_parts_a")
        self.addCleanup(self._attach_a)
        detached = self.version("api.gh137a_probe")
        self.assertNotEqual(detached, before, "detached: its rows are no longer read")
        self.db.execute("TRUNCATE core.gh137a_parts_a")
        self.db.execute("INSERT INTO core.gh137a_parts_a VALUES (2020, 3, 'while detached')")
        self.assertEqual(self.version("api.gh137a_probe"), detached, "a detached table is no longer a source")
        self.db.execute("ALTER TABLE core.gh137a_parts ATTACH PARTITION core.gh137a_parts_a FOR VALUES IN (2019, 2020)")
        attached = self.version("api.gh137a_probe")
        self.assertNotEqual(attached, detached, "attached with a row")
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.gh137a_parts WHERE season_id = 2020").fetchone()[0], 1)
        self.db.execute("ALTER TABLE core.gh137a_parts DETACH PARTITION core.gh137a_parts_a CONCURRENTLY")
        self.assertNotEqual(self.version("api.gh137a_probe"), attached, "detached concurrently")

    def test_a_leaf_detached_updated_and_attached_again_changes_the_version(self):
        # The second review's sequence (partition-reattach.sql): no TRUNCATE, no new file.
        self.db.execute("INSERT INTO core.gh137a_parts VALUES (2026, 1, 'one')")
        self.db.execute("SELECT ops.fold_data_changes()")
        before = self.version("api.gh137a_probe")
        node = lambda: self.db.execute("SELECT relfilenode FROM pg_class WHERE oid = 'core.gh137a_parts_b'::regclass").fetchone()[0]
        file = node()
        self.db.execute("ALTER TABLE core.gh137a_parts DETACH PARTITION core.gh137a_parts_b")
        try:
            self.db.execute("UPDATE core.gh137a_parts_b SET label = 'eight'")
        finally:
            self.db.execute("ALTER TABLE core.gh137a_parts ATTACH PARTITION core.gh137a_parts_b FOR VALUES IN (2026)")
        self.assertEqual(node(), file, "the same file: what the draft's version named")
        self.assertEqual(self.marks("core.gh137a_parts"), 0, "no trigger saw the update")
        self.assertEqual(self.db.execute("SELECT label FROM core.gh137a_parts WHERE id = 1").fetchone()[0], "eight")
        self.assertNotEqual(self.version("api.gh137a_probe"), before, "attached again: another incarnation")

    def test_a_concurrent_detach_left_pending_then_attached_again_changes_the_version(self):
        self.db.execute("INSERT INTO core.gh137a_parts VALUES (2019, 1, 'old')")
        self.db.execute("SELECT ops.fold_data_changes()")
        before = self.version("api.gh137a_probe")
        self.addCleanup(self._attach_a)  # last: after the two sessions are closed
        holder, detacher = self.other(), self.other()
        holder.execute("BEGIN ISOLATION LEVEL REPEATABLE READ")
        holder.execute("SELECT count(*) FROM core.gh137a_parts")  # a snapshot the detach waits for
        detacher.execute("SET statement_timeout = '1s'")
        with self.assertRaises(psycopg.errors.QueryCanceled):
            detacher.execute("ALTER TABLE core.gh137a_parts DETACH PARTITION core.gh137a_parts_a CONCURRENTLY")
        holder.execute("COMMIT")
        pending = self.db.execute("SELECT inhdetachpending FROM pg_inherits WHERE inhrelid = 'core.gh137a_parts_a'::regclass").fetchone()
        self.assertEqual(pending, (True,), "left pending by the cancelled wait")
        halfway = self.version("api.gh137a_probe")
        self.assertNotEqual(halfway, before, "a detach pending: its rows are no longer read")
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.gh137a_parts WHERE season_id = 2019").fetchone()[0], 0)
        self.db.execute("ALTER TABLE core.gh137a_parts DETACH PARTITION core.gh137a_parts_a FINALIZE")
        finished = self.version("api.gh137a_probe")
        self.assertNotEqual(finished, before)
        # The same leaf, its file kept, updated while detached, attached again: no version seen before.
        self.db.execute("UPDATE core.gh137a_parts_a SET label = 'eight'")
        self.db.execute("ALTER TABLE core.gh137a_parts ATTACH PARTITION core.gh137a_parts_a FOR VALUES IN (2019, 2020)")
        self.assertEqual(self.db.execute("SELECT label FROM core.gh137a_parts WHERE id = 1").fetchone()[0], "eight")
        self.assertNotIn(self.version("api.gh137a_probe"), {before, halfway, finished}, "attached again: another incarnation")

    def test_pending_marks_are_bounded_for_a_reader_and_folded_in_batches(self):
        self.db.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (1, 'a')")
        self.db.execute("SELECT ops.fold_data_changes()")
        self.db.execute("INSERT INTO ops.data_changes(relation) SELECT 'core.gh137a_plain' FROM generate_series(1, 10000)")
        known = self.version("api.gh137a_probe")
        self.assertIsNotNone(known, "10 000 pending marks: still read")
        self.db.execute("INSERT INTO ops.data_changes(relation) SELECT 'core.gh137a_plain' FROM generate_series(1, 140001)")
        self.assertIsNone(self.version("api.gh137a_probe"), "past 10 000: unknown, the read bounded")
        self.assertEqual(self.db.execute("SELECT ops.fold_data_changes()").fetchone()[0], 100000, "one batch")
        self.assertIsNone(self.version("api.gh137a_probe"))
        self.assertEqual(self.db.execute("SELECT ops.fold_data_changes()").fetchone()[0], 50001)
        folded = self.version("api.gh137a_probe")
        self.assertIsNotNone(folded)
        self.assertNotEqual(folded, known, "150 001 more changes")
        self.assertEqual(self.db.execute("SELECT ops.fold_data_changes()").fetchone()[0], 0)
        self.assertEqual(self.version("api.gh137a_probe"), folded, "the fold changes no version")

    def _attach_a(self):
        state = self.db.execute(
            "SELECT inhdetachpending FROM pg_inherits WHERE inhrelid = 'core.gh137a_parts_a'::regclass").fetchone()
        if state and state[0]:
            self.db.execute("ALTER TABLE core.gh137a_parts DETACH PARTITION core.gh137a_parts_a FINALIZE")
            state = None
        if not state:
            self.db.execute("ALTER TABLE core.gh137a_parts ATTACH PARTITION core.gh137a_parts_a FOR VALUES IN (2019, 2020)")

    def test_a_fold_is_seen_the_same_from_one_snapshot_and_from_separate_transactions(self):
        for i in range(3):
            with self.db.transaction():
                self.db.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (%s, 'x')", (i,))
        self.assertEqual(self.marks("core.gh137a_plain"), 3, "three transactions, three marks")
        reader = self.other()
        reader.execute("BEGIN ISOLATION LEVEL REPEATABLE READ")
        seen = reader.execute("SELECT api.data_version(ARRAY['api.gh137a_probe'])").fetchone()[0]
        self.other().execute("SELECT ops.fold_data_changes()")
        self.assertEqual(reader.execute("SELECT api.data_version(ARRAY['api.gh137a_probe'])").fetchone()[0], seen,
                         "the snapshot taken before the fold")
        reader.execute("COMMIT")
        self.assertEqual(self.version("api.gh137a_probe"), seen, "a snapshot taken after it")
        self.assertEqual(self.marks("core.gh137a_plain"), 0)

    def test_no_privilege_beyond_what_the_machinery_needs(self):
        owner = self.db.execute("SELECT current_user").fetchone()[0]
        grantees = lambda kind, name: {r[0] for r in self.db.execute(
            f"""SELECT coalesce(g.rolname, 'PUBLIC') FROM {kind} o CROSS JOIN LATERAL aclexplode(o.{'relacl' if kind == 'pg_class' else 'proacl'}) a
                LEFT JOIN pg_roles g ON g.oid = a.grantee WHERE o.oid = %s::{'regclass' if kind == 'pg_class' else 'regprocedure'}""", (name,))}
        for table in ("ops.data_changes", "ops.data_versions", "ops.data_relations", "ops.data_sources", "ops.data_tracking", "ops.data_changes_id_seq"):
            self.assertEqual(grantees("pg_class", table), {owner}, table)
        self.assertEqual(grantees("pg_proc", "ops.mark_data_change()"), {owner})
        self.assertEqual(grantees("pg_proc", "ops.track_data_changes()"), {owner})
        self.assertEqual(grantees("pg_proc", "ops.fold_data_changes()"), {owner, "vega_collect", "vega_calc"})
        self.assertEqual(grantees("pg_proc", "api.data_version(text[],text)"), {owner, "vega_read"})
        # The claim keeps PostgreSQL's default (no ACL: PUBLIC may run it): every role that writes a table runs it.
        self.assertIsNone(self.db.execute("SELECT proacl FROM pg_proc WHERE oid = 'ops.claim_data_change(text)'::regprocedure").fetchone()[0])

    # The closure ----------------------------------------------------------

    def test_every_source_carries_the_four_triggers(self):
        sources = [r[0] for r in self.db.execute("SELECT DISTINCT source FROM ops.data_sources WHERE source IS NOT NULL")]
        self.assertIn("core.matches", sources)
        self.assertIn("core.gh137a_parts", sources)
        for source in sources:
            found = {r[0] for r in self.db.execute(
                "SELECT tgname FROM pg_trigger WHERE tgrelid = %s::regclass AND NOT tgisinternal", (source,))}
            self.assertLessEqual(TRIGGERS, found, source)
        own = self.db.execute("""SELECT count(*) FROM ops.data_sources WHERE source IN
            ('ops.data_changes', 'ops.data_versions', 'ops.data_relations', 'ops.data_sources', 'ops.data_tracking', 'ops.schema_migrations')""").fetchone()[0]
        self.assertEqual(own, 0, "the machinery's own tables are no source")
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM pg_trigger WHERE tgrelid = 'ops.data_changes'::regclass AND NOT tgisinternal").fetchone()[0], 0)

    def test_what_cannot_be_tracked_is_never_validated_by_versions(self):
        for relation in ("api.gh137a_over_mv", "api.gh137a_dynamic", "api.gh137a_now"):
            self.assertIsNone(self.version(relation), relation)
            self.assertIsNone(self.version("api.gh137a_probe", relation), relation)
        self.assertIsNotNone(self.version("api.gh137a_today"))
        day = lambda zone: self._in_zone(zone, "api.gh137a_today")
        self.assertNotEqual(day("Etc/GMT+12"), day("Etc/GMT-14"), "a read of current_date: the base's day")
        self.assertEqual(self._in_zone("Etc/GMT+12", "api.gh137a_probe"), self._in_zone("Etc/GMT-14", "api.gh137a_probe"))

    def _in_zone(self, zone, relation):
        with self.db.transaction():
            self.db.execute(f"SET LOCAL TimeZone = '{zone}'")
            return self.version(relation)

    def test_a_table_added_later_is_tracked_by_the_next_migrate_run(self):
        self.db.execute("CREATE TABLE core.gh137a_late(id int PRIMARY KEY)")
        self.db.execute("CREATE VIEW api.gh137a_late AS SELECT id FROM core.gh137a_late")
        # Cleanups run last first: the table goes, then the sources are recomputed without it.
        self.addCleanup(self.db.execute, "SELECT ops.track_data_changes()")
        self.addCleanup(self.db.execute, "DROP TABLE IF EXISTS core.gh137a_late CASCADE")
        self.assertIsNone(self.version("api.gh137a_late"), "not tracked yet: unknown")
        migrate(self.db)
        self.assertIsNotNone(self.version("api.gh137a_late"))
        self.db.execute("INSERT INTO core.gh137a_late VALUES (1)")
        self.assertEqual(self.marks("core.gh137a_late"), 1)
        self.assertEqual(self.db.execute("SELECT ops.track_data_changes()").fetchone()[0], 0, "nothing more to install")

    def test_a_view_given_a_table_by_a_migration_is_unknown_until_tracked(self):
        self.db.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (1, 'a')")
        self.assertIsNotNone(self.version("api.gh137a_probe"))
        # Cleanups run last first: the view as it was, the table gone, the row gone, the map made again.
        self.addCleanup(self.db.execute, "SELECT ops.track_data_changes()")
        self.addCleanup(self.db.execute, "DELETE FROM ops.schema_migrations WHERE version = '999_gh137a_extra.sql'")
        self.addCleanup(self.db.execute, "DROP TABLE IF EXISTS core.gh137a_extra")
        self.addCleanup(self._probe_as_it_was)
        # The migration, in its own session and transaction, as store.migrate runs a file: the view reads a new table.
        migration = self.other()
        with migration.transaction():
            migration.execute("CREATE TABLE core.gh137a_extra(id int PRIMARY KEY, note text)")
            migration.execute("""CREATE OR REPLACE VIEW api.gh137a_probe AS SELECT p.id, p.label, q.season_id, x.note
                FROM core.gh137a_plain p LEFT JOIN core.gh137a_parts q ON q.id = p.id LEFT JOIN core.gh137a_extra x ON x.id = p.id""")
            migration.execute("INSERT INTO ops.schema_migrations(version, checksum) VALUES ('999_gh137a_extra.sql', '\\x00')")
        # The window: committed, not tracked yet. The new table has no trigger: its writes would move no version.
        self.assertIsNone(self.version("api.gh137a_probe"), "the map is older than the schema")
        self.assertIsNone(self.version("api.gh137a_today"), "every version: the map is the base's")
        self.db.execute("INSERT INTO core.gh137a_extra VALUES (1, 'unseen')")
        self.assertEqual(self.marks("core.gh137a_extra"), 0)
        # A tracking that fails changes nothing.
        with self.assertRaises(psycopg.errors.RaiseException):
            with self.db.transaction():
                self.db.execute("SELECT ops.track_data_changes()")
                self.db.execute("DO $$ BEGIN RAISE EXCEPTION 'interrupted'; END $$")
        self.assertIsNone(self.version("api.gh137a_probe"), "a tracking rolled back")
        # The next run of store.migrate tracks it.
        migrate(self.db)
        tracked = self.version("api.gh137a_probe")
        self.assertIsNotNone(tracked)
        self.db.execute("UPDATE core.gh137a_extra SET note = 'seen'")
        self.assertEqual(self.marks("core.gh137a_extra"), 1, "the new table, tracked")
        self.assertNotEqual(self.version("api.gh137a_probe"), tracked)

    def _probe_as_it_was(self):
        with self.db.transaction():
            self.db.execute("DROP VIEW api.gh137a_probe")
            self.db.execute("CREATE VIEW api.gh137a_probe AS SELECT p.id, p.label, q.season_id FROM core.gh137a_plain p LEFT JOIN core.gh137a_parts q ON q.id = p.id")

    # Privileges, the deploy, the worker ---------------------------------------

    def test_privileges(self):
        self.db.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (1, 'a')")
        for role in ("vega_collect", "vega_calc"):
            with self.subTest(role=role):
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    with self.db.transaction():
                        self.db.execute(f"SET LOCAL ROLE {role}")
                        self.db.execute("INSERT INTO ops.data_changes(relation) VALUES ('core.gh137a_plain')")
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    with self.db.transaction():
                        self.db.execute(f"SET LOCAL ROLE {role}")
                        self.db.execute("SELECT * FROM ops.data_versions")
                with self.db.transaction():
                    self.db.execute(f"SET LOCAL ROLE {role}")
                    self.db.execute("SELECT ops.fold_data_changes()")
        with self.db.transaction():
            self.db.execute("SET LOCAL ROLE vega_collect")
            self.db.execute("INSERT INTO core.teams(id, name) VALUES (913701, 'Marked by the collector')")
        self.assertEqual(self.marks("core.teams"), 1, "a writer's change marks through the trigger's own rights")
        with self.db.transaction():
            self.db.execute("SET LOCAL ROLE vega_read")
            self.assertIsNotNone(self.db.execute("SELECT api.data_version(ARRAY['api.fixtures'])").fetchone()[0])
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                with self.db.transaction():
                    self.db.execute("SELECT count(*) FROM ops.data_changes")
        self.db.execute("DELETE FROM core.teams WHERE id = 913701")

    def test_the_migration_is_not_online(self):
        self.assertFalse(migration.online(ROOT / "sql" / "181_data_versions.sql"))

    def test_the_worker_folds_each_round(self):
        self.db.execute("INSERT INTO core.gh137a_plain(id, label) VALUES (1, 'a')")
        self.assertEqual(self.marks("core.gh137a_plain"), 1)
        before = self.version("api.gh137a_probe")
        Worker(Store(self.db), SimpleNamespace()).publish()
        self.assertEqual(self.marks("core.gh137a_plain"), 0)
        self.assertEqual(self.version("api.gh137a_probe"), before)


if __name__ == "__main__":
    unittest.main()
