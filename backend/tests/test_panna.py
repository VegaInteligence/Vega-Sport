"""PannaData's Opta fixtures and events into RDS, pass H1 (backend/panna/FAILURE_MODES.md, written before these tests).

End to end: the real CLI (`python -m panna`) against a loopback GitHub release API (panna_harness.Upstream), a
disposable local PostgreSQL 18 migrated by the real migrate task with V2_PANNA_PASSWORD, and, where the case needs it, a
TCP relay between them (panna_harness.Relay). The loader connects as the login vega_v2_panna. The files are synthetic,
with the real schemas; no PannaData row is in this repository.

  VEGA_V2_PANNA_TEST_DSN=postgresql://postgres@127.0.0.1:55483/vega_v2_panna_test \\
    PYTHONPATH=backend python3 -m unittest -v test_panna      # from backend/tests, or -s backend/tests
"""

import datetime
import json
import math
import os
from pathlib import Path
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
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
try:
    import pyarrow  # noqa: F401
    import panna_harness as h
except ImportError:
    h = None

DSN = os.environ.get("VEGA_V2_PANNA_TEST_DSN")
PASSWORD = "panna-test-only-1"
# A past date, so that the later as-of of a case (D+3) is never after the machine's UTC date (GH278-i).
AS_OF = "2026-11-01"
RELEASE = "opta-latest"
SENTINEL = "Sentinelle Évian"  # a value that must never reach the loader's output (GH278-aj)
FIXTURE_COLUMNS = [f.name for f in h.FIXTURE_SCHEMA] if h else []
EXT_COLUMNS = [f.name for f in h.FIXTURE_EXT_SCHEMA] if h else []
EVENT_COLUMNS = [f.name for f in h.EVENT_SCHEMA] if h else []


def day(offset, base=AS_OF):
    return (datetime.date.fromisoformat(base) + datetime.timedelta(days=offset)).isoformat()


def fixtures_g1():
    f = h.fixture
    rows = [
        f("f-epl-2021a", "2021-03-01", "EPL", "2020-2021"),
        f("f-epl-2122", "2021-08-14", "EPL", "2021-2022", home=SENTINEL, away='Quote "FC"\nline'),
        f("f-mls-2021", "2021-04-17", "MLS", "2021"),
        f("f-mls-2020", "2020-07-08", "MLS", "2020"),
        f("f-wcq-2020", "2020-11-15", "UEFA_WC_Qualifiers", "2022 Qatar"),
        f("f-wcq-2021", "2021-03-24", "UEFA_WC_Qualifiers", "2022 Qatar"),
        f("f-euro-2020", "2021-06-11", "UEFA_Euros", "2020"),
        f("f-copa-2021", "2021-06-13", "Copa_America", "2021 Brazil"),
        f("f-gold-2021", "2021-07-11", "CONCACAF_Gold_Cup", "2021"),
        f("f-afcon-2021", "2022-01-09", "AFCON", "2021 Cameroon"),
        f("f-wc-2022", "2022-11-20", "World_Cup", "2022 Qatar"),
        f("f-seriea-x", "2020-12-20", "Serie_A", "2021-2022"),
        f("f-seriea-y", "2021-08-21", "Serie_A", "2021-2022"),
        f("f-myst-2021", "2021-05-01", "Mystery_Cup", "2021"),
        f("f-myst-2022", "2022-05-01", "Mystery_Cup", "2022"),
        f("f-myst-2020", "2020-05-01", "Mystery_Cup", "2020"),
        f("f-l1-today", AS_OF, "Ligue_1", "2026-2027", status="Playing", home_score=None, away_score=None, ht=(None, "")),
        f("f-l1-1", day(-6), "Ligue_1", "2026-2027", home="", away="Ünïcødé ∂ FC"),
        f("f-l1-2", day(-5), "Ligue_1", "2026-2027"),
    ]
    rows += [f(f"f-l1-d{i:02d}", day(1 + i), "Ligue_1", "2026-2027", status="Fixture", home_score=None,
               away_score=None, ht=(None, None)) for i in range(40)]
    return rows


EXPECTED_G1 = {
    "eligible": {"f-epl-2122", "f-mls-2021", "f-wcq-2021", "f-afcon-2021", "f-wc-2022", "f-myst-2022",
                 "f-l1-today", "f-l1-1", "f-l1-2"},
    "historical": {"f-epl-2021a", "f-mls-2020", "f-wcq-2020", "f-euro-2020", "f-copa-2021", "f-gold-2021",
                   "f-myst-2020"},
    "unresolved": {"f-seriea-x", "f-seriea-y", "f-myst-2021"},
    "deferred": {f"f-l1-d{i:02d}" for i in range(40)},
}


def fixtures_ext_g1():
    """fixtures_g1 with the 14 added columns (GH278.F-b): every edge value among six eligible keys; f-l1-1, f-myst-2022
    and f-l1-today all NULL; values on a historical and a deferred key, never stored."""
    nan, inf = float("nan"), float("inf")
    values = {
        "f-epl-2122": dict(venue_id="v-1", venue_name=SENTINEL, venue_latitude=51.5549, venue_longitude=-0.1084,
                           venue_neutral=True, local_date="2021-08-14", local_time="17:30:00", match_week="1",
                           coverage_level="15", var="1", referee_id="r-1", referee_name='Quote "Ref"\nline',
                           attendance=52000.0, match_officials_json='[{"id":"o1","type":"Main","name":"Évian \\"x\\"\\n"}]'),
        "f-mls-2021": dict(venue_id="", venue_name="", venue_latitude=nan, venue_longitude=-0.0, venue_neutral=False,
                           local_date="", local_time="", match_week="", coverage_level="", var="", referee_id="",
                           referee_name="", attendance=inf, match_officials_json=""),
        "f-wcq-2021": dict(venue_latitude=5e-324, venue_longitude=1e308, attendance=-inf,
                           referee_name="tab\tname\\slash", match_officials_json="{}"),
        "f-afcon-2021": dict(venue_name="Stade Ahmadou Ahidjo", venue_neutral=False, attendance=0.0),
        "f-wc-2022": dict(venue_name="Al Bayt ∂", venue_neutral=True, local_time="19:00:00"),
        "f-l1-2": dict(attendance=-0.0),
        "f-epl-2021a": dict(venue_name="historical venue", attendance=1.0),
        "f-l1-d00": dict(venue_name="deferred venue"),
    }
    return [h.extended(r, **values.get(r["match_id"], {})) for r in fixtures_g1()]


EXTENDED_KEYS = {"f-epl-2122", "f-mls-2021", "f-wcq-2021", "f-afcon-2021", "f-wc-2022", "f-l1-2"}


def ligue1_events(changed=False, added=False, shift=0.0):
    e = h.events_for
    nan, inf = float("nan"), float("inf")
    one = e("f-l1-1", "Ligue_1", "2026-2027", 30, start=1, x=[nan, inf, -inf, -0.0, None, 5e-324, 1e308],
            names=[None, "", "Kylian Mbappé", "O'Neil \"Q\"", "tab\tname\\slash", SENTINEL],
            qualifier=['{"a":"\\n"}', "line1\nline2", "", None])
    if changed:
        one[10] = dict(one[10], x=99.125)
    two = e("f-l1-2", "Ligue_1", "2026-2027", 25, start=100)
    today = e("f-l1-today", "Ligue_1", "2026-2027", 10, start=200)
    # f-l1-2 and f-l1-today interleaved: a segment's rows need not be contiguous in the file.
    mixed = []
    for i in range(max(len(two), len(today))):
        if i < len(two):
            mixed.append(two[i])
        if i < len(today):
            mixed.append(today[i])
    rows = one + mixed
    rows += e("o-old", "Ligue_1", "2013", 5, start=300)
    rows += e("o-new", "Ligue_1", "2022-2023", 4, start=400)
    rows += e("o-what", "Ligue_1", "", 3, start=500)
    if added:
        rows += e("f-l1-new", "Ligue_1", "2026-2027", 6, start=600)
    if shift:
        rows = [dict(r, x=None if r["x"] is None else r["x"] + shift) for r in rows]
    return rows


def epl_events():
    return h.events_for("f-epl-2021a", "EPL", "2020-2021", 12, start=1) + h.events_for("f-epl-2122", "EPL", "2021-2022", 15, start=50)


def world_cup_events():
    return h.events_for("f-wc-2022", "World_Cup", "2022 Qatar", 20, start=1)


def copy_events():
    return world_cup_events() + h.events_for("f-afcon-2021", "AFCON", "2021 Cameroon", 8, start=70)


def release_g1():
    return {
        "opta_fixtures.parquet": h.parquet_bytes(fixtures_g1(), h.FIXTURE_SCHEMA, row_group_size=7),
        "events_Ligue_1.parquet": h.parquet_bytes(ligue1_events(), h.EVENT_SCHEMA, row_group_size=16),
        "events_EPL.parquet": h.parquet_bytes(epl_events(), h.EVENT_SCHEMA),
        "events_World_Cup.parquet": h.parquet_bytes(world_cup_events(), h.EVENT_SCHEMA),
        "events_Copy.parquet": h.parquet_bytes(copy_events(), h.EVENT_SCHEMA),
        # Not a family of H1: listed upstream, never fetched.
        "opta_player_stats.parquet": h.parquet_bytes(fixtures_g1()[:3], h.FIXTURE_SCHEMA),
    }


# The six integer columns events_EPL.parquet and events_Scottish_Premiership.parquet store as Arrow double in the
# release of 28 Nov 2026 (the coordinator's h1-schema-drift-real.json), every other events file as int64.
DOUBLE_COLUMNS = ("event_id", "type_id", "minute", "second", "outcome", "period_id")
DOUBLE_SCHEMA = (h.pa.schema([h.pa.field(f.name, h.pa.float64()) if f.name in DOUBLE_COLUMNS else f for f in h.EVENT_SCHEMA])
                 if h else None)


def epl_double_rows():
    rows = epl_events()
    rows[14]["event_id"] = 3_000_831_779  # beyond 32 bits, as the real EPL file's largest
    rows[15]["minute"] = None  # a NULL stays NULL
    rows[16]["period_id"] = 16
    return rows


def same_value(a, b):
    if isinstance(a, float) or isinstance(b, float):
        if a is None or b is None:
            return a is b
        if math.isnan(a) or math.isnan(b):
            return math.isnan(a) and math.isnan(b)
        return struct.pack(">d", a) == struct.pack(">d", b)
    return a == b


def panna_dsn():
    url = urlparse(DSN)
    netloc = f"vega_v2_panna:{PASSWORD}@{url.hostname}:{url.port or 5432}"
    return urlunparse(url._replace(netloc=netloc))


def via_relay(relay):
    url = urlparse(panna_dsn())
    return urlunparse(url._replace(netloc=f"vega_v2_panna:{PASSWORD}@127.0.0.1:{relay.port}"))


def local(dsn):
    return dsn and urlparse(dsn).hostname in ("127.0.0.1", "localhost", "::1")


# Roles belong to the whole server. Another database of a shared local server may hold a PannaData installation of
# its own (its grants to vega_panna): then the suite leaves the login alone instead of dropping it from under it.
ELSEWHERE = """SELECT count(*) FROM pg_shdepend s JOIN pg_database d ON d.oid = s.dbid
               WHERE s.refclassid = 'pg_authid'::regclass AND d.datname <> current_database()
                 AND s.refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'vega_panna')"""


def drop_login(admin):
    """The documented rollback (ROLLBACK.sql): the group's rights on core revoked (S1, GH278-al amended), the panna
    schemas dropped, then the roles unless another database of the server still grants to vega_panna. Without the
    revocation, a base the suite leaves keeps S1's grants on core and holds the login on every other base's server."""
    admin.execute((ROOT / "panna" / "ROLLBACK.sql").read_text())


@required(psycopg is not None and h is not None and local(DSN),
          "psycopg, pyarrow and VEGA_V2_PANNA_TEST_DSN (a local disposable database) are required")
class PannaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.admin = psycopg.connect(DSN, autocommit=True)
        drop_login(cls.admin)
        env = {k: v for k, v in os.environ.items() if not k.startswith("V2_")}
        env.update(V2_MIGRATION_DATABASE_URL=DSN, V2_PANNA_PASSWORD=PASSWORD, PYTHONPATH=str(ROOT))
        done = subprocess.run([sys.executable, "-m", "vega.migrate"], cwd=ROOT, env=env, capture_output=True,
                              text=True, timeout=900)
        if done.returncode:
            raise AssertionError(done.stdout + done.stderr)
        cls.migrate_out = done.stdout + done.stderr
        cls.outputs = []
        cls.upstream = h.Upstream()
        cls.tmp = tempfile.TemporaryDirectory()

    @classmethod
    def tearDownClass(cls):
        cls.upstream.close()
        drop_login(cls.admin)
        cls.admin.close()
        cls.tmp.cleanup()

    def setUp(self):
        # Every case starts from empty panna tables (the schema, its registry rows and the login stay).
        tables = [r[0] for r in self.admin.execute(
            "SELECT format('%I.%I', schemaname, tablename) FROM pg_tables WHERE schemaname IN ('panna', 'panna_data') "
            "AND (schemaname, tablename) NOT IN (('panna', 'datasets'), ('panna', 'columns'))").fetchall()]
        if tables:
            self.admin.execute(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE")
        self.upstream.serve(RELEASE, release_g1())
        self.upstream.corrupt.clear()
        self.upstream.no_digest.clear()
        self.upstream.requests.clear()
        self.scratch = Path(tempfile.mkdtemp(dir=self.tmp.name))

    # --- the CLI ---------------------------------------------------------------------------------------------------
    def cli(self, *args, dsn=None, expect=0, timeout=300, wait=True):
        env = {k: v for k, v in os.environ.items() if not k.startswith("V2_")}
        env.update(PYTHONPATH=str(ROOT), PYTHONDONTWRITEBYTECODE="1")
        command = [sys.executable, "-m", "panna", *args]
        if args and args[0] in ("run", "retry", "status", "verify", "prep", "explain"):
            env["V2_PANNA_DATABASE_URL"] = dsn or panna_dsn()
        if args and args[0] in ("run", "prep", "probe"):
            command += ["--github-api", self.upstream.api, "--scratch", str(self.scratch)]
        if not wait:
            return subprocess.Popen(command, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        done = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=timeout)
        self.outputs.append(done.stdout + done.stderr)
        if expect is not None and done.returncode != expect:
            raise AssertionError(f"exit {done.returncode}, expected {expect}\n{done.stdout}\n{done.stderr}")
        return done

    def lines(self, done):
        return [json.loads(line) for line in done.stdout.splitlines() if line.strip().startswith("{")]

    def last(self, done):
        return self.lines(done)[-1]

    def run_load(self, *assets, as_of=AS_OF, extra=(), dsn=None, expect=0):
        args = ["run", "--as-of", as_of, "--release", RELEASE]
        for name in assets:
            args += ["--asset", name]
        return self.cli(*args, *extra, dsn=dsn, expect=expect)

    # --- reading the base back ------------------------------------------------------------------------------------
    def stored(self, dataset, columns):
        rows = self.admin.execute(
            f"SELECT s.key, d.ordinal, {', '.join('d.' + c for c in columns)} FROM panna_data.{dataset} d "
            "JOIN panna.segments s USING (segment_id) ORDER BY s.key, s.segment_id, d.ordinal").fetchall()
        return rows

    def count(self, sql, *params):
        return self.admin.execute(sql, params or None).fetchone()[0]

    def assert_rows_equal(self, got, want, columns):
        self.assertEqual(len(got), len(want))
        for g, w in zip(got, want):
            for c, a, b in zip(columns, g, w):
                self.assertTrue(same_value(a, b), f"{c}: stored {a!r}, source {b!r}")

    def expected_events(self, rows, keys):
        """Source rows of `keys`, grouped by match in key order, each group in source order."""
        out = []
        for key in sorted(keys):
            group = [r for r in rows if r["match_id"] == key]
            out += [tuple(r[c] for c in EVENT_COLUMNS) for r in group]
        return out

    # --- GH278-a to l: the scope, no database -----------------------------------------------------------------------
    def test_GH278_a_to_k_probe_decides_each_case_and_conserves_counts(self):
        done = self.cli("probe", "--as-of", AS_OF, "--release", RELEASE, "--family", "opta_fixtures",
                        "--family", "opta_events", "--keys")
        lines = self.lines(done)
        decisions = {line["key"]: line["outcome"] for line in lines if line.get("event") == "key" and line["dataset"] == "opta_fixtures"}
        for outcome, keys in EXPECTED_G1.items():
            for key in keys:
                self.assertEqual(decisions.get(key), outcome, key)
        events = {line["key"]: line["outcome"] for line in lines if line.get("event") == "key" and line["dataset"] == "opta_events"}
        self.assertEqual(events["o-old"], "historical")
        self.assertEqual(events["o-new"], "eligible_orphan")
        self.assertEqual(events["o-what"], "pending")
        self.assertEqual(events["f-epl-2021a"], "historical")
        self.assertEqual(events["f-l1-1"], "eligible")
        objects = {line["name"]: line for line in lines if line.get("event") == "object"}
        self.assertEqual(set(objects), {"opta_fixtures.parquet", "events_Ligue_1.parquet", "events_EPL.parquet",
                                        "events_World_Cup.parquet", "events_Copy.parquet"})
        for name, line in objects.items():
            self.assertEqual(sum(line["outcomes"].values()), line["source_rows"], name)  # GH278-k
        self.assertEqual(objects["opta_fixtures.parquet"]["outcomes"],
                         {"eligible": 9, "historical": 7, "unresolved": 3, "deferred": 40})
        self.assertEqual(objects["events_Ligue_1.parquet"]["outcomes"],
                         {"eligible": 65, "historical": 5, "eligible_orphan": 4, "pending": 3})
        self.assertEqual(objects["events_EPL.parquet"]["outcomes"], {"eligible": 15, "historical": 12})
        # Nothing but the named families was fetched (opta_player_stats.parquet is listed, not read).
        self.assertFalse(any("opta_player_stats" in p for p in self.upstream.downloads()))

    def test_GH278_i_an_as_of_after_today_is_refused(self):
        tomorrow = (datetime.datetime.now(datetime.timezone.utc).date() + datetime.timedelta(days=1)).isoformat()
        done = self.cli("probe", "--as-of", tomorrow, "--release", RELEASE, "--family", "opta_fixtures", expect=2)
        self.assertIn("AS_OF_IN_FUTURE", done.stdout + done.stderr)
        self.assertEqual(self.upstream.requests, [])

    # --- GH278-m, n, w: a load, every column, the server's digests ----------------------------------------------------
    def test_GH278_m_n_w_every_eligible_row_and_column_then_a_no_op(self):
        done = self.run_load("opta_fixtures.parquet", "events_Ligue_1.parquet", "events_EPL.parquet")
        end = self.last(done)
        self.assertEqual(end["status"], "complete")
        fixtures = {r["match_id"]: r for r in fixtures_g1()}
        got = self.stored("opta_fixtures", FIXTURE_COLUMNS)
        want = [(k, 0, *[fixtures[k][c] for c in FIXTURE_COLUMNS]) for k in sorted(EXPECTED_G1["eligible"])]
        self.assert_rows_equal(got, want, ["key", "ordinal", *FIXTURE_COLUMNS])
        # Events: the eligible fixtures' and the in-window orphan's, in source order; nothing else.
        source = ligue1_events() + epl_events()
        keys = {"f-l1-1", "f-l1-2", "f-l1-today", "o-new", "f-epl-2122"}
        got = [g[2:] for g in self.stored("opta_events", EVENT_COLUMNS)]
        self.assert_rows_equal(got, self.expected_events(source, keys), EVENT_COLUMNS)
        ordinals = self.admin.execute("SELECT s.key, array_agg(d.ordinal ORDER BY d.ordinal) FROM panna_data.opta_events d "
                                      "JOIN panna.segments s USING (segment_id) GROUP BY s.key").fetchall()
        for key, values in ordinals:
            self.assertEqual(values, list(range(len(values))), key)
        orphan = self.admin.execute("SELECT flag FROM panna.segments WHERE dataset = 'opta_events' AND key = 'o-new'").fetchone()[0]
        self.assertEqual(orphan, "eligible_orphan")
        # The scope index holds every fixture key and its decision, no data column of a deferred fixture.
        scope = dict(self.admin.execute("SELECT key, outcome FROM panna.scope WHERE dataset = 'opta_fixtures'").fetchall())
        for outcome, ids in EXPECTED_G1.items():
            for key in ids:
                self.assertEqual(scope[key], outcome, key)
        self.assertEqual(self.count("SELECT count(*) FROM panna_data.opta_fixtures d JOIN panna.segments s USING (segment_id) "
                                    "WHERE s.key LIKE 'f-l1-d%'"), 0)
        # Receipts: one per asset read, its digest and footer rows.
        receipts = {r[0]: r[1:] for r in self.admin.execute(
            "SELECT name, sha256, source_rows FROM panna.receipts").fetchall()}
        assets = release_g1()
        for name in ("opta_fixtures.parquet", "events_Ligue_1.parquet", "events_EPL.parquet"):
            self.assertEqual(bytes(receipts[name][0]).hex(), h.sha256(assets[name]))
        self.assertEqual(receipts["opta_fixtures.parquet"][1], len(fixtures_g1()))
        # GH278-n: the server recomputes every segment's digest.
        verify = self.cli("verify")
        self.assertEqual(self.last(verify)["mismatched"], 0)
        self.assertEqual(self.last(verify)["segments"], self.count("SELECT count(*) FROM panna.segments"))
        # GH278-w: nothing changed, nothing due.
        before = self.count("SELECT count(*) FROM panna.segments")
        again = self.run_load("opta_fixtures.parquet", "events_Ligue_1.parquet", "events_EPL.parquet")
        self.assertEqual(self.last(again)["status"], "complete")
        self.assertEqual(self.last(again)["rows_written"], 0)
        self.assertEqual(self.count("SELECT count(*) FROM panna.segments"), before)

    # --- GH278-o, p: the as-of moves, fixtures move --------------------------------------------------------------------
    def test_GH278_o_a_later_as_of_writes_what_became_due_with_the_same_digests(self):
        self.run_load("opta_fixtures.parquet")
        first = self.count("SELECT count(*) FROM panna.segments")
        done = self.run_load("opta_fixtures.parquet", as_of=day(3))
        self.assertEqual(self.last(done)["rows_written"], 3)
        written = {r[0] for r in self.admin.execute("SELECT key FROM panna.segments").fetchall()}
        self.assertEqual(len(written), first + 3)
        self.assertTrue({"f-l1-d00", "f-l1-d01", "f-l1-d02"} <= written)
        self.assertNotIn("f-l1-d03", written)
        self.assertEqual(self.count("SELECT count(*) FROM panna.scope WHERE outcome = 'deferred'"), 37)

    def test_GH278_p_a_deferred_fixture_moved_later_stays_deferred_one_moved_earlier_is_written(self):
        self.run_load("opta_fixtures.parquet")
        g2 = fixtures_g1()
        for r in g2:
            if r["match_id"] == "f-l1-d00":
                r["match_date"] = day(30) + "Z"
            if r["match_id"] == "f-l1-d10":
                r["match_date"] = day(-1) + "Z"
        release = release_g1()
        release["opta_fixtures.parquet"] = h.parquet_bytes(g2, h.FIXTURE_SCHEMA)
        self.upstream.serve(RELEASE, release)
        done = self.run_load("opta_fixtures.parquet")
        self.assertEqual(self.last(done)["rows_written"], 1)
        keys = {r[0] for r in self.admin.execute("SELECT key FROM panna.segments").fetchall()}
        self.assertIn("f-l1-d10", keys)
        self.assertNotIn("f-l1-d00", keys)
        moved = self.admin.execute("SELECT next_eligible_on FROM panna.scope WHERE key = 'f-l1-d00'").fetchone()[0]
        self.assertEqual(moved.isoformat(), day(30))

    # --- GH278-q, r, s: generations and shared segments ----------------------------------------------------------------
    def test_GH278_q_a_new_generation_writes_only_its_changed_segments(self):
        self.run_load("opta_fixtures.parquet", "events_Ligue_1.parquet")
        g1_load = self.admin.execute("SELECT max(l.load_id) FROM panna.loads l JOIN panna.streams s USING (stream_id) "
                                     "WHERE s.name = 'events_Ligue_1.parquet'").fetchone()[0]
        g1 = self.admin.execute("SELECT key, segment_id FROM panna.current_segments WHERE name = 'events_Ligue_1.parquet'").fetchall()
        fixtures = fixtures_g1() + [h.fixture("f-l1-new", day(-1), "Ligue_1", "2026-2027")]
        release = release_g1()
        release["opta_fixtures.parquet"] = h.parquet_bytes(fixtures, h.FIXTURE_SCHEMA)
        release["events_Ligue_1.parquet"] = h.parquet_bytes(ligue1_events(changed=True, added=True), h.EVENT_SCHEMA)
        self.upstream.serve(RELEASE, release)
        done = self.run_load("opta_fixtures.parquet", "events_Ligue_1.parquet")
        loads = {line["name"]: line for line in self.lines(done) if line.get("event") == "load"}
        self.assertEqual(loads["events_Ligue_1.parquet"]["segments_written"], 2)
        self.assertEqual(loads["events_Ligue_1.parquet"]["rows_written"], 30 + 6)
        self.assertEqual(loads["opta_fixtures.parquet"]["segments_written"], 1)
        # The first generation stays readable: its manifest as of its own load.
        old = self.admin.execute("SELECT key, segment_id FROM panna.segments_as_of(%s) ORDER BY key", (g1_load,)).fetchall()
        self.assertEqual(sorted(old), sorted(g1))
        # The same rows written again by another encoder: another digest, 0 rows.
        release["events_Ligue_1.parquet"] = h.parquet_bytes(ligue1_events(changed=True, added=True), h.EVENT_SCHEMA,
                                                            row_group_size=3, compression="zstd")
        self.upstream.serve(RELEASE, release)
        again = self.run_load("opta_fixtures.parquet", "events_Ligue_1.parquet")
        self.assertEqual(self.last(again)["rows_written"], 0)
        self.assertEqual(self.count("SELECT count(DISTINCT sha256) FROM panna.receipts WHERE name = 'events_Ligue_1.parquet'"), 3)

    def test_GH278_r_most_segments_changed_stops_with_the_churn_guard(self):
        self.run_load("opta_fixtures.parquet", "events_Ligue_1.parquet")
        before = self.count("SELECT count(*) FROM panna_data.opta_events")
        release = release_g1()
        release["events_Ligue_1.parquet"] = h.parquet_bytes(ligue1_events(shift=0.5), h.EVENT_SCHEMA)
        self.upstream.serve(RELEASE, release)
        done = self.run_load("events_Ligue_1.parquet", extra=("--churn-limit", "0.5", "--churn-min-segments", "2"), expect=3)
        self.assertEqual(self.last(done)["reason"], "CHURN_GUARD")
        self.assertEqual(self.count("SELECT count(*) FROM panna_data.opta_events"), before)

    def test_GH278_s_the_same_events_in_two_objects_are_stored_once(self):
        done = self.run_load("opta_fixtures.parquet", "events_World_Cup.parquet", "events_Copy.parquet")
        self.assertEqual(self.last(done)["status"], "complete")
        self.assertEqual(self.count("SELECT count(*) FROM panna.segments WHERE dataset = 'opta_events' AND key = 'f-wc-2022'"), 1)
        self.assertEqual(self.count("SELECT count(*) FROM panna_data.opta_events d JOIN panna.segments s USING (segment_id) "
                                    "WHERE s.key = 'f-wc-2022'"), 20)
        streams = {r[0] for r in self.admin.execute(
            "SELECT name FROM panna.current_segments WHERE dataset = 'opta_events' AND key = 'f-wc-2022'").fetchall()}
        self.assertEqual(streams, {"events_World_Cup.parquet", "events_Copy.parquet"})

    # --- GH278-t, u, v: refusals before writing ------------------------------------------------------------------------
    def test_GH278_t_events_without_a_complete_fixtures_load_are_refused(self):
        done = self.run_load("events_EPL.parquet", expect=1)
        self.assertIn("DEPENDENCY_MISSING", done.stdout)
        self.assertEqual(self.count("SELECT count(*) FROM panna.segments"), 0)

    def test_GH278_u_a_column_added_upstream_stops_that_object(self):
        self.run_load("opta_fixtures.parquet")
        release = release_g1()
        rows = epl_events()
        release["events_EPL.parquet"] = h.parquet_bytes(rows, h.EVENT_SCHEMA, extra_columns=[("xg", h.pa.float64(), [0.1] * len(rows))])
        self.upstream.serve(RELEASE, release)
        done = self.run_load("events_EPL.parquet", expect=1)
        self.assertIn("SCHEMA_DRIFT", done.stdout)
        self.assertIn("xg", done.stdout)
        self.assertEqual(self.count("SELECT count(*) FROM panna_data.opta_events"), 0)

    # --- GH278-am to ar: the source's integer columns stored as doubles; empty generations; the catalog probe -------
    def epl_stream_loads(self):
        return self.admin.execute(
            "SELECT l.load_id, l.status, l.conversions, r.schema FROM panna.loads l JOIN panna.streams s USING (stream_id) "
            "JOIN panna.receipts r USING (receipt_id) WHERE s.name = 'events_EPL.parquet' ORDER BY l.load_id").fetchall()

    def test_GH278_am_integers_stored_as_doubles_load_exactly_and_keep_their_source_type(self):
        rows = epl_double_rows()
        release = release_g1()
        release["events_EPL.parquet"] = h.parquet_bytes(rows, DOUBLE_SCHEMA, row_group_size=7)
        self.upstream.serve(RELEASE, release)
        probe = self.cli("probe", "--as-of", AS_OF, "--release", RELEASE, "--asset", "opta_fixtures.parquet",
                         "--asset", "events_EPL.parquet")
        reported = {line["name"]: line for line in self.lines(probe) if line.get("event") == "object"}["events_EPL.parquet"]
        self.assertEqual(reported["outcomes"], {"eligible": 15, "historical": 12})
        self.assertEqual(sorted(reported["conversions"]), sorted(DOUBLE_COLUMNS))
        done = self.run_load("opta_fixtures.parquet", "events_EPL.parquet")
        self.assertEqual(self.last(done)["status"], "complete")
        got = [g[2:] for g in self.stored("opta_events", EVENT_COLUMNS)]
        self.assert_rows_equal(got, self.expected_events(rows, {"f-epl-2122"}), EVENT_COLUMNS)
        types = dict(self.admin.execute(
            "SELECT attname, format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'panna_data.opta_events'::regclass "
            "AND attnum > 0").fetchall())
        self.assertTrue(all(types[c] == "bigint" for c in DOUBLE_COLUMNS))
        [(load, status, conversions, schema)] = self.epl_stream_loads()
        self.assertEqual(status, "complete")
        self.assertEqual({c: v["from"] for c, v in conversions.items()}, {c: "double" for c in DOUBLE_COLUMNS})
        self.assertEqual({n: t for n, t in schema if n in DOUBLE_COLUMNS}, {c: "double" for c in DOUBLE_COLUMNS})
        # The source's doubles come back by a cast, bit for bit, NULL included.
        source = h.pq.read_table(h.pa.BufferReader(release["events_EPL.parquet"])).to_pylist()
        want = [tuple(r[c] for c in DOUBLE_COLUMNS) for r in source if r["match_id"] == "f-epl-2122"]
        back = self.admin.execute(
            "SELECT " + ", ".join(f"d.{c}::double precision" for c in DOUBLE_COLUMNS) +
            " FROM panna_data.opta_events d JOIN panna.segments s USING (segment_id) WHERE s.key = 'f-epl-2122' "
            "AND s.dataset = 'opta_events' ORDER BY d.ordinal").fetchall()
        self.assert_rows_equal(back, want, DOUBLE_COLUMNS)
        self.assertEqual(self.last(self.cli("verify"))["mismatched"], 0)

    def test_GH278_an_a_double_that_is_not_an_exact_integer_refuses_the_whole_object(self):
        rows = epl_events()
        for i, (column, value) in enumerate((("event_id", 1.5), ("minute", float("nan")), ("second", float("inf")),
                                             ("outcome", -0.0), ("type_id", 2.0 ** 53 + 2))):
            rows[13 + i][column] = value  # in the eligible fixture's rows
        release = release_g1()
        release["events_EPL.parquet"] = h.parquet_bytes(rows, DOUBLE_SCHEMA)
        self.upstream.serve(RELEASE, release)
        done = self.run_load("opta_fixtures.parquet", "events_EPL.parquet", expect=1)
        error = next(line for line in self.lines(done) if line.get("event") == "error")
        self.assertEqual(error["code"], "LOSSY_CONVERSION")
        self.assertEqual(error["columns"], {"event_id": 1, "minute": 1, "second": 1, "outcome": 1, "type_id": 1})
        self.assertEqual(self.count("SELECT count(*) FROM panna_data.opta_events"), 0)
        self.assertEqual(set(error), {"event", "code", "name", "columns"})  # names and counts only, never a value
        self.assertFalse([line for line in self.lines(done) if line.get("event") != "chunk" and "1.5" in json.dumps(line)])
        probe = self.cli("probe", "--as-of", AS_OF, "--release", RELEASE, "--asset", "opta_fixtures.parquet",
                         "--asset", "events_EPL.parquet", expect=1)
        self.assertIn("LOSSY_CONVERSION", probe.stdout)

    def test_GH278_ao_the_same_rows_as_int64_then_as_double_are_the_same_segments(self):
        self.run_load("opta_fixtures.parquet", "events_EPL.parquet")
        segments = self.admin.execute("SELECT segment_id, digest FROM panna.segments WHERE dataset = 'opta_events' ORDER BY 1").fetchall()
        release = release_g1()
        release["events_EPL.parquet"] = h.parquet_bytes(epl_events(), DOUBLE_SCHEMA)
        self.upstream.serve(RELEASE, release)
        done = self.run_load("opta_fixtures.parquet", "events_EPL.parquet")
        self.assertEqual(self.last(done)["rows_written"], 0)
        self.assertEqual(self.admin.execute("SELECT segment_id, digest FROM panna.segments WHERE dataset = 'opta_events' ORDER BY 1").fetchall(),
                         segments)
        loads = self.epl_stream_loads()
        self.assertEqual([bool(c) for _, _, c, _ in loads], [False, True])
        self.assertEqual([s for _, s, _, _ in loads], ["complete", "complete"])

    def test_GH278_ap_any_other_type_change_is_schema_drift(self):
        self.run_load("opta_fixtures.parquet")
        schema = h.pa.schema([h.pa.field("x", h.pa.string()) if f.name == "x" else f for f in h.EVENT_SCHEMA])
        rows = [dict(r, x=None if r["x"] is None else repr(r["x"])) for r in epl_events()]
        release = release_g1()
        release["events_EPL.parquet"] = h.parquet_bytes(rows, schema)
        self.upstream.serve(RELEASE, release)
        done = self.run_load("events_EPL.parquet", expect=1)
        error = next(line for line in self.lines(done) if line.get("event") == "error")
        self.assertEqual((error["code"], error["retyped"]), ("SCHEMA_DRIFT", ["x"]))
        self.assertEqual(self.count("SELECT count(*) FROM panna_data.opta_events"), 0)

    def generations(self, name):
        return self.admin.execute("SELECT load_id, segments FROM panna.current_generations WHERE name = %s", (name,)).fetchall()

    def test_GH278_aq_a_generation_without_eligible_rows_completes_empty(self):
        # A stream's first generation with nothing eligible: complete and empty.
        release = release_g1()
        release["events_Old.parquet"] = h.parquet_bytes(
            h.events_for("f-epl-2021a", "EPL", "2020-2021", 9) + h.events_for("o-older", "EPL", "2012-2013", 4, start=90), h.EVENT_SCHEMA)
        self.upstream.serve(RELEASE, release)
        done = self.run_load("opta_fixtures.parquet", "events_Old.parquet", "events_EPL.parquet")
        loads = {line["name"]: line for line in self.lines(done) if line.get("event") == "load"}
        self.assertEqual(loads["events_Old.parquet"]["outcomes"], {"historical": 13})
        self.assertEqual(loads["events_Old.parquet"]["segments_written"], 0)
        [(old_load, segments)] = self.generations("events_Old.parquet")
        self.assertEqual(segments, 0)
        first = self.generations("events_EPL.parquet")
        self.assertEqual(first[0][1], 1)
        # A missing asset records no generation: the current state stays.
        release.pop("events_EPL.parquet")
        self.upstream.serve(RELEASE, release)
        self.run_load("events_EPL.parquet", expect=1)
        self.assertEqual(self.generations("events_EPL.parquet"), first)
        # A next generation with nothing eligible: its predecessor's keys tombstoned, the predecessor still readable.
        release["events_EPL.parquet"] = h.parquet_bytes(h.events_for("f-epl-2021a", "EPL", "2020-2021", 12, start=1), h.EVENT_SCHEMA)
        self.upstream.serve(RELEASE, release)
        done = self.run_load("events_EPL.parquet")
        self.assertEqual(self.last(done)["status"], "complete")
        [(load, segments)] = self.generations("events_EPL.parquet")
        self.assertGreater(load, first[0][0])
        self.assertEqual(segments, 0)
        self.assertEqual(self.count("SELECT count(*) FROM panna.current_segments WHERE name = 'events_EPL.parquet'"), 0)
        self.assertEqual([k for k, _ in self.admin.execute("SELECT * FROM panna.segments_as_of(%s)", (first[0][0],)).fetchall()],
                         ["f-epl-2122"])

    def test_GH278_ar_the_catalog_probe_reports_every_object_and_names_the_refused_one(self):
        release = release_g1()
        rows = epl_events()
        release["events_EPL.parquet"] = h.parquet_bytes(rows, h.EVENT_SCHEMA, extra_columns=[("xg", h.pa.float64(), [0.1] * len(rows))])
        self.upstream.serve(RELEASE, release)
        done = self.cli("probe", "--as-of", AS_OF, "--release", RELEASE, "--family", "opta_fixtures", "--family", "opta_events", expect=1)
        objects = {line["name"] for line in self.lines(done) if line.get("event") == "object"}
        self.assertEqual(objects, {"opta_fixtures.parquet", "events_Ligue_1.parquet", "events_World_Cup.parquet", "events_Copy.parquet"})
        end = self.last(done)
        self.assertEqual(end["event"], "probe_end")
        self.assertEqual(end["refused"], {"events_EPL.parquet": "SCHEMA_DRIFT"})

    # --- GH278-as to ax: Fable's review of H1 ---------------------------------------------------------------------------
    EVENTS_CHUNKS = ("SELECT count(*) FROM panna.chunks c JOIN panna.loads l USING (load_id) "
                     "JOIN panna.streams s USING (stream_id) WHERE s.dataset = 'opta_events'")

    def slow_events_run(self, relay, rate=6_000):
        self.run_load("opta_fixtures.parquet")
        relay.rate = rate
        proc = self.cli("run", "--as-of", AS_OF, "--release", RELEASE, "--asset", "events_Ligue_1.parquet",
                        "--chunk-rows", "10", dsn=via_relay(relay), wait=False)
        deadline = time.monotonic() + 60
        while self.count(self.EVENTS_CHUNKS) < 1 and time.monotonic() < deadline:
            time.sleep(0.02)
        return proc

    def test_GH278_as_a_chunk_lost_after_its_commit_is_never_completed(self):
        relay = self.relay()
        proc = self.slow_events_run(relay)
        # What a crash-restart can take back under asynchronous commit: chunks the loader saw committed.
        load = self.admin.execute("SELECT max(load_id) FROM panna.loads l JOIN panna.streams s USING (stream_id) "
                                  "WHERE s.dataset = 'opta_events'").fetchone()[0]
        self.admin.execute("DELETE FROM panna.manifest WHERE load_id = %s", (load,))
        self.admin.execute("DELETE FROM panna.segments s WHERE s.first_load_id = %s AND NOT EXISTS "
                           "(SELECT 1 FROM panna.manifest m WHERE m.segment_id = s.segment_id)", (load,))
        self.admin.execute("DELETE FROM panna_data.opta_events d WHERE NOT EXISTS "
                           "(SELECT 1 FROM panna.segments s WHERE s.segment_id = d.segment_id)")
        self.admin.execute("DELETE FROM panna.chunks WHERE load_id = %s", (load,))
        out, _ = proc.communicate(timeout=120)
        self.outputs.append(out)
        lines = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
        self.assertEqual(proc.returncode, 1, out)
        error = next(line for line in lines if line.get("event") == "error")
        self.assertEqual(error["code"], "CONSERVATION")
        self.assertGreater(error["missing"], 0)
        self.assertEqual(lines[0]["synchronous_commit"], "on")
        self.assertEqual(self.admin.execute("SELECT status FROM panna.loads WHERE load_id = %s", (load,)).fetchone()[0], "loading")
        relay.rate = 0
        done = self.cli("retry", dsn=via_relay(relay))
        self.assertEqual(self.last(done)["status"], "complete")
        self.assert_events_exact()

    def test_GH278_at_the_verification_finds_a_chunk_by_a_b_tree_and_a_base_without_it_is_refused(self):
        indexes = dict(self.admin.execute(
            "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'panna_data'").fetchall())
        for table in ("opta_events", "opta_fixtures"):
            self.assertIn(f"USING btree (segment_id)", indexes.get(f"{table}_segment_id", ""), table)
        self.run_load("opta_fixtures.parquet", "events_Ligue_1.parquet")
        plan = self.last(self.cli("explain", "--dataset", "opta_events", "--last-segments", "3"))
        self.assertEqual(plan["event"], "explain")
        self.assertEqual(plan["segments"], 3)
        self.assertTrue(plan["plan"])
        self.admin.execute("DROP INDEX panna_data.opta_events_segment_id")
        self.addCleanup(self.admin.execute, "CREATE INDEX opta_events_segment_id ON panna_data.opta_events (segment_id)")
        done = self.run_load("events_EPL.parquet", expect=1)
        self.assertIn("SCHEMA_VERSION", done.stdout)
        self.assertIn("003_panna_segment_index.sql", done.stdout)

    def test_GH278_au_a_lock_still_held_by_the_old_session_is_waited_for(self):
        relay = self.relay()
        proc = self.slow_events_run(relay)
        waiter = psycopg.connect(DSN, autocommit=True)
        self.addCleanup(waiter.close)
        held = threading.Event()

        def hold():
            waiter.execute("SELECT pg_advisory_lock(hashtext('vega-panna-loader'))")
            held.set()
            time.sleep(2)
            waiter.execute("SELECT pg_advisory_unlock(hashtext('vega-panna-loader'))")
        thread = threading.Thread(target=hold, daemon=True)
        thread.start()
        time.sleep(0.3)  # the waiter queues behind the loader's session
        relay.drop_after = 0  # the loader's next bytes cut its link: its old session ends, the waiter takes the lock
        self.assertTrue(held.wait(30), "the waiter never got the lock")
        out, _ = proc.communicate(timeout=180)
        thread.join(10)
        self.outputs.append(out)
        lines = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
        self.assertEqual(proc.returncode, 0, out)
        self.assertEqual(lines[-1]["status"], "complete")
        self.assertTrue(any(line.get("event") == "reconnect" for line in lines))
        self.assert_events_exact()

    def test_GH278_av_retry_refuses_a_run_older_than_a_complete_one(self):
        self.run_load("opta_fixtures.parquet")
        self.run_load("events_Ligue_1.parquet", extra=("--chunk-rows", "10", "--max-seconds", "0"), expect=3)
        stale = self.count("SELECT max(run_id) FROM panna.runs")
        self.run_load("events_Ligue_1.parquet")
        later = self.count("SELECT max(run_id) FROM panna.runs")
        loads = self.count("SELECT count(*) FROM panna.loads")
        state = self.admin.execute("SELECT name, key, segment_id FROM panna.current_segments ORDER BY 1, 2").fetchall()
        refused = self.cli("retry", expect=2)
        end = self.last(refused)
        self.assertEqual((end["reason"], end["run_id"], end["later_run"]), ("RETRY_STALE", stale, later))
        self.assertEqual(self.count("SELECT count(*) FROM panna.loads"), loads)
        self.assertEqual(self.admin.execute("SELECT name, key, segment_id FROM panna.current_segments ORDER BY 1, 2").fetchall(), state)
        self.cli("retry", "--force")

    def test_GH278_aw_retry_keeps_the_run_s_bounds(self):
        done = self.run_load("opta_fixtures.parquet", extra=("--database-ceiling-bytes", "1"), expect=3)
        self.assertEqual(self.last(done)["reason"], "DATABASE_CEILING")
        again = self.cli("retry", expect=3)
        self.assertEqual(self.last(again)["reason"], "DATABASE_CEILING")
        self.assertEqual(self.count("SELECT count(*) FROM panna.segments"), 0)
        finished = self.cli("retry", "--database-ceiling-bytes", str(10 ** 12))
        self.assertEqual(self.last(finished)["status"], "complete")

    def test_GH278_ax_an_asset_listed_without_a_digest_is_refused(self):
        self.upstream.no_digest.add("opta_fixtures.parquet")
        done = self.run_load("opta_fixtures.parquet", expect=1)
        self.assertIn("NO_DECLARED_DIGEST", done.stdout)
        self.assertEqual(self.upstream.downloads(), [])
        self.assertEqual(self.count("SELECT count(*) FROM panna.segments"), 0)

    def test_GH278_v_a_projection_over_the_ceiling_is_refused_before_writing(self):
        done = self.run_load("opta_fixtures.parquet", extra=("--database-ceiling-bytes", "1"), expect=3)
        end = self.last(done)
        self.assertEqual(end["reason"], "DATABASE_CEILING")
        self.assertGreater(end["projected_bytes"], 0)
        self.assertEqual(self.count("SELECT count(*) FROM panna.segments"), 0)

    # --- GH278-x to ac: transport and resumption -------------------------------------------------------------------------
    def relay(self):
        url = urlparse(DSN)
        relay = h.Relay(url.hostname, url.port or 5432)
        self.addCleanup(relay.close)
        return relay

    def assert_events_exact(self):
        source = ligue1_events()
        keys = {"f-l1-1", "f-l1-2", "f-l1-today", "o-new"}
        got = [g[2:] for g in self.stored("opta_events", EVENT_COLUMNS)]
        self.assert_rows_equal(got, self.expected_events(source, keys), EVENT_COLUMNS)
        self.assertEqual(self.count("SELECT count(*) FROM (SELECT segment_id, ordinal FROM panna_data.opta_events "
                                    "GROUP BY 1, 2 HAVING count(*) > 1) d"), 0)
        self.assertEqual(self.count("SELECT count(*) FROM (SELECT dataset, key, digest FROM panna.segments GROUP BY 1, 2, 3 "
                                    "HAVING count(*) > 1) d"), 0)

    def test_GH278_x_a_connection_dropped_mid_chunk_resumes_without_duplicates(self):
        relay = self.relay()
        self.run_load("opta_fixtures.parquet", dsn=via_relay(relay))
        relay.drop_after = 6000
        done = self.run_load("events_Ligue_1.parquet", dsn=via_relay(relay), extra=("--chunk-rows", "20"))
        self.assertEqual(relay.drops, 1)
        self.assertEqual(self.last(done)["status"], "complete")
        self.assertTrue(any(line.get("event") == "reconnect" for line in self.lines(done)))
        self.assert_events_exact()

    def test_GH278_y_a_lost_commit_answer_is_found_in_the_ledger(self):
        relay = self.relay()
        self.run_load("opta_fixtures.parquet", dsn=via_relay(relay))
        relay.cut_commit = True
        done = self.run_load("events_Ligue_1.parquet", dsn=via_relay(relay), extra=("--chunk-rows", "20"))
        self.assertEqual(relay.drops, 1)
        self.assertEqual(self.last(done)["status"], "complete")
        self.assert_events_exact()

    def test_GH278_z_a_throttled_link_completes(self):
        relay = self.relay()
        relay.rate = 200_000
        self.run_load("opta_fixtures.parquet", "events_Ligue_1.parquet", dsn=via_relay(relay), extra=("--chunk-rows", "20"))
        self.assert_events_exact()

    def test_GH278_aa_a_killed_run_is_resumed_by_retry(self):
        relay = self.relay()
        self.run_load("opta_fixtures.parquet")
        relay.rate = 20_000
        proc = self.cli("run", "--as-of", AS_OF, "--release", RELEASE, "--asset", "events_Ligue_1.parquet",
                        "--chunk-rows", "10", dsn=via_relay(relay), wait=False)
        events_chunks = ("SELECT count(*) FROM panna.chunks c JOIN panna.loads l USING (load_id) "
                         "JOIN panna.streams s USING (stream_id) WHERE s.dataset = 'opta_events'")
        deadline = time.monotonic() + 60
        while self.count(events_chunks) < 1 and time.monotonic() < deadline:
            time.sleep(0.05)
        proc.send_signal(signal.SIGKILL)
        proc.wait()
        written = self.count("SELECT count(*) FROM panna_data.opta_events")
        self.assertGreaterEqual(self.count(events_chunks), 1)
        self.assertLess(written, 69)
        relay.rate = 0
        done = self.cli("retry", dsn=via_relay(relay))
        self.assertTrue(any(line.get("event") == "retry" for line in self.lines(done)))
        self.assertEqual(self.last(done)["status"], "complete")
        self.assert_events_exact()

    def test_GH278_ab_a_second_runner_exits_already_running(self):
        holder = psycopg.connect(panna_dsn(), autocommit=True)
        self.addCleanup(holder.close)
        self.assertTrue(holder.execute("SELECT pg_try_advisory_lock(hashtext('vega-panna-loader'))").fetchone()[0])
        done = self.run_load("opta_fixtures.parquet", expect=4)
        self.assertEqual(self.last(done)["status"], "already_running")
        self.assertEqual(self.count("SELECT count(*) FROM panna.segments"), 0)

    def test_GH278_ac_a_time_budget_stops_between_chunks_and_retry_finishes(self):
        self.run_load("opta_fixtures.parquet")
        done = self.run_load("events_Ligue_1.parquet", extra=("--chunk-rows", "10", "--max-seconds", "0"), expect=3)
        self.assertEqual(self.last(done)["reason"], "MAX_SECONDS")
        self.assertLess(self.count("SELECT count(*) FROM panna_data.opta_events"), 69)
        finished = self.cli("retry")
        self.assertEqual(self.last(finished)["status"], "complete")
        self.assert_events_exact()

    # --- GH278-ad to ag: selection and receipts ---------------------------------------------------------------------------
    def test_GH278_ad_only_the_named_assets_are_fetched(self):
        self.run_load("opta_fixtures.parquet")
        self.assertEqual(self.upstream.downloads(), [f"/blob/{RELEASE}/opta_fixtures.parquet"])
        receipt = self.admin.execute("SELECT origin, container, name, asset_id, bytes, source_rows FROM panna.receipts").fetchone()
        assets = release_g1()
        self.assertEqual(receipt[:3], ("github", RELEASE, "opta_fixtures.parquet"))
        self.assertIsNotNone(receipt[3])
        self.assertEqual(receipt[4], len(assets["opta_fixtures.parquet"]))
        self.assertEqual(receipt[5], len(fixtures_g1()))

    def test_GH278_ae_a_frozen_manifest_with_local_paths_makes_no_request(self):
        blobs = Path(self.tmp.name) / "blobs"
        blobs.mkdir(exist_ok=True)
        entries = []
        for name in ("opta_fixtures.parquet", "events_EPL.parquet"):
            data = release_g1()[name]
            (blobs / h.sha256(data)).write_bytes(data)
            entries.append({"origin": "github", "container": RELEASE, "name": name, "sha256": h.sha256(data),
                            "bytes": len(data), "path": str(blobs / h.sha256(data))})
        manifest = Path(self.tmp.name) / "frozen.json"
        manifest.write_text(json.dumps({"assets": entries}))
        self.upstream.requests.clear()
        done = self.cli("run", "--as-of", AS_OF, "--manifest", str(manifest))
        self.assertEqual(self.last(done)["status"], "complete")
        self.assertEqual(self.upstream.requests, [])
        self.assertEqual(self.count("SELECT count(*) FROM panna.receipts"), 2)
        self.assertTrue((blobs / h.sha256(release_g1()["opta_fixtures.parquet"])).exists())  # never removed: not the scratch's

    def test_GH278_af_bytes_that_differ_from_the_listed_digest_load_nothing(self):
        self.upstream.corrupt[(RELEASE, "opta_fixtures.parquet")] = release_g1()["events_EPL.parquet"]
        done = self.run_load("opta_fixtures.parquet", expect=1)
        self.assertIn("DIGEST_MISMATCH", done.stdout)
        self.assertEqual(self.count("SELECT count(*) FROM panna.segments"), 0)
        self.assertEqual(list(self.scratch.glob("*")), [])

    def test_GH278_ag_an_asset_absent_from_the_release_is_named(self):
        done = self.run_load("events_Nowhere.parquet", expect=1)
        self.assertIn("ASSET_MISSING", done.stdout)
        self.assertIn("events_Nowhere.parquet", done.stdout)

    def test_prep_writes_a_plan_that_run_follows(self):
        plan = Path(self.tmp.name) / "plan.json"
        self.cli("prep", "--as-of", AS_OF, "--release", RELEASE, "--asset", "opta_fixtures.parquet",
                 "--asset", "events_World_Cup.parquet", "--plan-out", str(plan))
        body = json.loads(plan.read_text())
        self.assertEqual([a["name"] for a in body["assets"]], ["opta_fixtures.parquet", "events_World_Cup.parquet"])
        self.assertTrue(all(len(a["sha256"]) == 64 for a in body["assets"]))
        self.assertGreater(body["projected_bytes"], 0)
        self.upstream.requests.clear()
        done = self.cli("run", "--plan", str(plan))
        self.assertEqual(self.last(done)["status"], "complete")
        self.assertEqual(self.upstream.downloads(), [])  # the plan's verified files in the scratch
        self.assertEqual(self.count("SELECT count(*) FROM panna_data.opta_events"), 20)

    # --- GH278-ai to al: privileges, output, verify, rollback -------------------------------------------------------------
    def test_GH278_ai_the_login_cannot_delete_alter_or_read_the_football_schemas(self):
        self.run_load("opta_fixtures.parquet")
        login = psycopg.connect(panna_dsn(), autocommit=True)
        self.addCleanup(login.close)
        for statement in ("DELETE FROM panna_data.opta_fixtures", "TRUNCATE panna_data.opta_events",
                          "DROP TABLE panna_data.opta_events", "ALTER TABLE panna.segments ADD COLUMN x int",
                          "CREATE TABLE panna_data.x (a int)", "DELETE FROM panna.segments", "UPDATE panna_data.opta_fixtures SET season = 'x'",
                          "SELECT 1 FROM core.matches", "SELECT 1 FROM agg.player_season_stats",
                          "SELECT 1 FROM ops.fetch_jobs", "SELECT 1 FROM api.publication"):
            with self.subTest(statement=statement):
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    login.execute(statement)
        limit = self.count("SELECT rolconnlimit FROM pg_roles WHERE rolname = 'vega_v2_panna'")
        self.assertEqual(limit, 4)
        # Amended for S1 (FAILURE_MODES.md section 8): no S1 table of core read or written, the two panna receipt tables
        # read only; the schema core used for its score functions alone.
        for statement in ("SELECT 1 FROM core.match_score_observations", "SELECT 1 FROM core.observation_batches",
                          "SELECT 1 FROM core.match_score_selections", "SELECT 1 FROM core.provider_ids",
                          "DELETE FROM panna.canonical_applications", "UPDATE panna.identity_reviews SET is_current = false"):
            with self.subTest(statement=statement):
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    login.execute(statement)
        self.assertEqual(login.execute("SELECT count(*) FROM panna.canonical_applications").fetchone()[0], 0)
        self.assertTrue(self.count("SELECT has_schema_privilege('vega_v2_panna', 'core', 'USAGE')::int") == 1)
        # What the login executes beyond what every role does (PUBLIC, seen through a role granted nothing): the S1 read
        # and the two panna entry points, and H1's panna.segments_as_of (001_panna.sql), which S1 leaves as it is.
        self.admin.execute("DROP ROLE IF EXISTS panna_public_probe")
        self.admin.execute("CREATE ROLE panna_public_probe NOLOGIN")
        self.addCleanup(self.admin.execute, "DROP ROLE IF EXISTS panna_public_probe")
        granted = {r[0] for r in self.admin.execute(
            """SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname IN ('core', 'panna') AND has_function_privilege('vega_v2_panna', p.oid, 'EXECUTE')
                 AND NOT has_function_privilege('panna_public_probe', p.oid, 'EXECUTE')""").fetchall()}
        # Amended after Fable's review (M1): core's two writing functions are reached only through the panna ones.
        self.assertEqual({g.split("(")[0] for g in granted}, {"core.score_pair_verdict", "panna.apply_score_segment",
                                                             "panna.revert_score_application", "panna.segments_as_of"})
        for table in ("core.match_score_observations", "core.match_score_selections", "core.observation_batches"):
            for right in ("INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                self.assertEqual(self.count("SELECT has_table_privilege('vega_collect', %s, %s)::int", table, right), 0,
                                 (table, right))

    def test_GH278_ak_verify_names_a_tampered_segment(self):
        self.run_load("opta_fixtures.parquet", "events_EPL.parquet")
        self.admin.execute("UPDATE panna_data.opta_events SET x = x + 1 WHERE ordinal = 3 AND segment_id = "
                           "(SELECT segment_id FROM panna.segments WHERE dataset = 'opta_events' AND key = 'f-epl-2122')")
        done = self.cli("verify", expect=1)
        end = self.last(done)
        self.assertEqual(end["mismatched"], 1)
        self.assertIn("f-epl-2122", done.stdout)

    def test_GH278_aj_status_and_every_output_hold_no_value_or_credential(self):
        self.run_load("opta_fixtures.parquet", "events_Ligue_1.parquet")
        status = self.last(self.cli("status"))
        self.assertEqual(status["datasets"]["opta_events"]["rows"], self.count("SELECT count(*) FROM panna_data.opta_events"))
        self.assertIn("deferred", status["scope"]["opta_fixtures"])
        for text in self.outputs:
            self.assertNotIn(SENTINEL, text)
            self.assertNotIn(PASSWORD, text)
            self.assertNotIn("Mbappé", text)

    # --- GH278.F-a to j: the fixtures' 14 added columns (FAILURE_MODES.md section 9) -------------------------------
    def serve_fixtures(self, rows, schema):
        release = release_g1()
        release["opta_fixtures.parquet"] = h.parquet_bytes(rows, schema, row_group_size=7)
        self.upstream.serve(RELEASE, release)
        return release["opta_fixtures.parquet"]

    def fixtures_load(self):
        return self.count("SELECT max(l.load_id) FROM panna.loads l JOIN panna.streams s USING (stream_id) "
                          "WHERE s.dataset = 'opta_fixtures' AND l.status = 'complete'")

    def fixture_rows(self, load):
        cursor = self.admin.execute("SELECT * FROM panna.fixture_rows(%s) ORDER BY source_ordinal", (load,))
        return [d.name for d in cursor.description], cursor.fetchall()

    def expected_fixture_rows(self, rows):
        return [(i, *(r[c] for c in EXT_COLUMNS)) for i, r in enumerate(rows) if r["match_id"] in EXPECTED_G1["eligible"]]

    def assert_generation(self, load, rows):
        columns, back = self.fixture_rows(load)
        self.assertEqual(columns, ["source_ordinal"] + EXT_COLUMNS)
        self.assert_rows_equal(back, self.expected_fixture_rows(rows), columns)
        for row in back:
            self.assertTrue(all(type(v) in (str, float, bool, int, type(None)) for v in row))

    def segment_ids(self, dataset):
        return dict(self.admin.execute("SELECT key, segment_id FROM panna.segments WHERE dataset = %s", (dataset,)).fetchall())

    def entries(self, load):
        return {k: (s, e) for k, s, e in self.admin.execute(
            "SELECT key, segment_id, extension_segment_id FROM panna.manifest WHERE load_id = %s", (load,)).fetchall()}

    def table_rows(self):
        return (self.count("SELECT count(*) FROM panna_data.opta_fixtures"),
                self.count("SELECT count(*) FROM panna_data.opta_fixtures_ext"))

    def test_GH278_F_a_b_j_an_extended_object_keeps_every_column(self):
        rows = fixtures_ext_g1()
        self.serve_fixtures(rows, h.FIXTURE_EXT_SCHEMA)
        probe = self.cli("probe", "--as-of", AS_OF, "--release", RELEASE, "--asset", "opta_fixtures.parquet")
        (reported,) = [line for line in self.lines(probe) if line.get("event") == "object"]
        self.assertEqual(reported["outcomes"], {"eligible": 9, "historical": 7, "unresolved": 3, "deferred": 40})
        self.assertEqual(reported["extension"], "opta_fixtures_ext")
        done = self.run_load("opta_fixtures.parquet")
        self.assertEqual(self.last(done)["status"], "complete")
        eligible = sorted((r for r in rows if r["match_id"] in EXPECTED_G1["eligible"]), key=lambda r: r["match_id"])
        self.assert_rows_equal([g[2:] for g in self.stored("opta_fixtures", FIXTURE_COLUMNS)],
                               [tuple(r[c] for c in FIXTURE_COLUMNS) for r in eligible], FIXTURE_COLUMNS)
        self.assertEqual(set(self.segment_ids("opta_fixtures_ext")), EXTENDED_KEYS)
        added = EXT_COLUMNS[len(FIXTURE_COLUMNS):]
        self.assert_rows_equal([g[2:] for g in self.stored("opta_fixtures_ext", added)],
                               [tuple(r[c] for c in added) for r in eligible if r["match_id"] in EXTENDED_KEYS], added)
        load = self.fixtures_load()
        self.assertEqual(self.count("SELECT extension FROM panna.loads WHERE load_id = %s", load), "opta_fixtures_ext")
        entries = self.entries(load)
        self.assertEqual({k for k, (_, e) in entries.items() if e is not None}, EXTENDED_KEYS)
        self.assertEqual(set(entries), EXPECTED_G1["eligible"])
        self.assert_generation(load, rows)
        verify = self.cli("verify")
        self.assertEqual((self.last(verify)["segments"], self.last(verify)["mismatched"]), (9 + 6, 0))
        # GH278.F-j: a tampered added value is named by its segment.
        self.admin.execute("UPDATE panna_data.opta_fixtures_ext SET attendance = 52001 WHERE segment_id = "
                           "(SELECT segment_id FROM panna.segments WHERE dataset = 'opta_fixtures_ext' AND key = 'f-epl-2122')")
        tampered = self.cli("verify", expect=1)
        (mismatch,) = [line for line in self.lines(tampered) if line.get("event") == "mismatch"]
        self.assertEqual((mismatch["dataset"], mismatch["key"]), ("opta_fixtures_ext", "f-epl-2122"))
        for out in (probe, done, verify, tampered):
            for value in (SENTINEL, "Ahmadou", "Bayt", "historical venue", "17:30"):
                self.assertNotIn(value, out.stdout + out.stderr)

    def test_GH278_F_c_d_f_both_schemas_share_the_13_column_segments(self):
        rows, plain = fixtures_ext_g1(), fixtures_g1()
        # c: a 13-column generation, then the extended object with the same 13 values.
        self.serve_fixtures(plain, h.FIXTURE_SCHEMA)
        self.run_load("opta_fixtures.parquet")
        first, segments = self.fixtures_load(), self.segment_ids("opta_fixtures")
        self.assertIsNone(self.count("SELECT extension FROM panna.loads WHERE load_id = %s", first))
        self.serve_fixtures(rows, h.FIXTURE_EXT_SCHEMA)
        self.run_load("opta_fixtures.parquet")
        second = self.fixtures_load()
        self.assertEqual(self.segment_ids("opta_fixtures"), segments)
        self.assertEqual(self.table_rows(), (9, 6))
        self.assertEqual({k: s for k, (s, _) in self.entries(second).items()}, {k: segments[k] for k in EXTENDED_KEYS})
        self.assert_generation(second, rows)
        self.assertEqual(dict(self.admin.execute("SELECT key, segment_id FROM panna.segments_as_of(%s)", (first,)).fetchall()), segments)
        with self.assertRaises(psycopg.errors.InvalidParameterValue):
            self.fixture_rows(first)
        # f: the same extended object again.
        replay = self.run_load("opta_fixtures.parquet")
        third = self.fixtures_load()
        self.assertEqual((self.last(replay)["rows_written"], self.entries(third), self.table_rows()), (0, {}, (9, 6)))
        self.assert_generation(third, rows)
        # d: the 13-column object, then the extended one again: nothing written, entries without then with extensions.
        self.serve_fixtures(plain, h.FIXTURE_SCHEMA)
        self.assertEqual(self.last(self.run_load("opta_fixtures.parquet"))["rows_written"], 0)
        fourth = self.fixtures_load()
        self.assertEqual(self.entries(fourth), {k: (segments[k], None) for k in EXTENDED_KEYS})
        with self.assertRaises(psycopg.errors.InvalidParameterValue):
            self.fixture_rows(fourth)
        self.serve_fixtures(rows, h.FIXTURE_EXT_SCHEMA)
        self.assertEqual(self.last(self.run_load("opta_fixtures.parquet"))["rows_written"], 0)
        fifth = self.fixtures_load()
        self.assertEqual(self.entries(fifth), self.entries(second))
        self.assertEqual(self.table_rows(), (9, 6))
        self.assert_generation(fifth, rows)
        self.assert_generation(second, rows)

    def test_GH278_F_e_a_correction_writes_only_its_segments(self):
        rows = fixtures_ext_g1()
        self.serve_fixtures(rows, h.FIXTURE_EXT_SCHEMA)
        self.run_load("opta_fixtures.parquet")
        first = self.fixtures_load()
        before = self.entries(first)
        g2 = [dict(r) for r in rows]
        at = {r["match_id"]: r for r in g2}
        at["f-epl-2122"]["home_score"] = "2"
        at["f-mls-2021"].update(attendance=41000.0, match_officials_json='[{"id":"o2"}]')
        at["f-l1-1"]["venue_name"] = "Stade Pierre-Mauroy"
        at["f-l1-2"]["attendance"] = None
        self.serve_fixtures(g2, h.FIXTURE_EXT_SCHEMA)
        self.run_load("opta_fixtures.parquet")
        second = self.fixtures_load()
        self.assertEqual(self.table_rows(), (9 + 1, 6 + 2))
        changed = self.entries(second)
        self.assertEqual(set(changed), {"f-epl-2122", "f-mls-2021", "f-l1-1", "f-l1-2"})
        self.assertNotEqual(changed["f-epl-2122"][0], before["f-epl-2122"][0])
        self.assertEqual(changed["f-epl-2122"][1], before["f-epl-2122"][1])
        self.assertEqual(changed["f-mls-2021"][0], before["f-mls-2021"][0])
        self.assertNotIn(changed["f-mls-2021"][1], (None, before["f-mls-2021"][1]))
        self.assertIsNotNone(changed["f-l1-1"][1])
        self.assertEqual(changed["f-l1-2"], (before["f-l1-2"][0], None))
        self.assert_generation(first, rows)
        self.assert_generation(second, g2)
        self.assertEqual(self.last(self.cli("verify"))["mismatched"], 0)

    def test_GH278_F_g_any_other_fixtures_schema_is_drift(self):
        rows = fixtures_ext_g1()
        retyped = lambda name, kind: h.pa.schema([h.pa.field(f.name, kind) if f.name == name else f for f in h.FIXTURE_EXT_SCHEMA])
        cases = {
            "match_week": h.parquet_bytes(rows, h.FIXTURE_EXT_SCHEMA, drop=("match_week",)),
            "roof": h.parquet_bytes(rows, h.FIXTURE_EXT_SCHEMA, extra_columns=[("roof", h.pa.string(), [None] * len(rows))]),
            "venue_neutral": h.parquet_bytes([dict(r, venue_neutral=None if r["venue_neutral"] is None else str(r["venue_neutral"]))
                                              for r in rows], retyped("venue_neutral", h.pa.string())),
            "attendance": h.parquet_bytes([dict(r, attendance=None) for r in rows], retyped("attendance", h.pa.int64())),
        }
        for column, data in cases.items():
            release = release_g1()
            release["opta_fixtures.parquet"] = data
            self.upstream.serve(RELEASE, release)
            done = self.run_load("opta_fixtures.parquet", expect=1)
            (error,) = [line for line in self.lines(done) if line.get("event") == "error"]
            self.assertEqual(error["code"], "SCHEMA_DRIFT", column)
            self.assertIn(column, error["added"] + error["removed"] + error["retyped"])
            self.assertEqual(self.table_rows(), (0, 0))

    def test_GH278_F_h_s1s_scoped_segment_is_kept_by_the_extended_generation(self):
        # S1's state in production: one key loaded alone from a 13-column object (a scoped plan, run --plan).
        data = self.serve_fixtures(fixtures_g1(), h.FIXTURE_SCHEMA)
        path = self.scratch / "plain.parquet"
        path.write_bytes(data)
        ordinal = [r["match_id"] for r in fixtures_g1()].index("f-l1-2")
        plan = {"as_of": AS_OF, "release": RELEASE, "fixtures": "current",
                "assets": [{"origin": "github", "container": RELEASE, "name": "opta_fixtures.parquet",
                            "sha256": h.sha256(data), "bytes": len(data), "path": str(path), "dataset": "opta_fixtures"}],
                "scope": {"dataset": "opta_fixtures", "keys": ["f-l1-2"], "ordinals": [ordinal], "max_rows": 1}}
        (self.scratch / "plan.json").write_text(json.dumps(plan))
        scoped = self.cli("run", "--plan", str(self.scratch / "plan.json"))
        self.assertEqual(self.last(scoped)["status"], "complete")
        pilot = self.segment_ids("opta_fixtures")
        self.assertEqual(set(pilot), {"f-l1-2"})
        self.serve_fixtures(fixtures_ext_g1(), h.FIXTURE_EXT_SCHEMA)
        self.run_load("opta_fixtures.parquet")
        load = self.fixtures_load()
        self.assertEqual(self.segment_ids("opta_fixtures")["f-l1-2"], pilot["f-l1-2"])
        self.assertEqual(self.entries(load)["f-l1-2"][0], pilot["f-l1-2"])
        self.assertIsNotNone(self.entries(load)["f-l1-2"][1])
        self.assertEqual(self.table_rows(), (9, 6))
        self.assert_generation(load, fixtures_ext_g1())
        self.assertEqual(self.count("SELECT count(*) FROM panna.canonical_applications"), 0)
        self.assertEqual(self.last(self.cli("verify"))["mismatched"], 0)

    def test_GH278_F_i_a_base_without_005_is_refused(self):
        self.serve_fixtures(fixtures_ext_g1(), h.FIXTURE_EXT_SCHEMA)
        self.admin.execute("ALTER TABLE panna_data.opta_fixtures_ext RENAME TO opta_fixtures_ext_hidden")
        try:
            done = self.run_load("opta_fixtures.parquet", expect=1)
        finally:
            self.admin.execute("ALTER TABLE panna_data.opta_fixtures_ext_hidden RENAME TO opta_fixtures_ext")
        self.assertIn("005_panna_fixture_extension.sql", done.stdout)
        self.assertEqual(self.count("SELECT count(*) FROM panna.receipts"), 0)

    # --- GH278.F-k to q: after Fable's review of the lot (FAILURE_MODES.md section 9, review F) ----------------------
    def reset(self):
        tables = [r[0] for r in self.admin.execute(
            "SELECT format('%I.%I', schemaname, tablename) FROM pg_tables WHERE schemaname IN ('panna', 'panna_data') "
            "AND (schemaname, tablename) NOT IN (('panna', 'datasets'), ('panna', 'columns'))").fetchall()]
        self.admin.execute(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE")

    def assert_exact(self, rows):
        self.assert_generation(self.fixtures_load(), rows)
        for table in ("opta_fixtures", "opta_fixtures_ext"):
            self.assertEqual(self.count(f"SELECT count(*) FROM (SELECT segment_id, ordinal FROM panna_data.{table} "
                                        "GROUP BY 1, 2 HAVING count(*) > 1) d"), 0)
        self.assertEqual(self.count("SELECT count(*) FROM (SELECT dataset, key, digest FROM panna.segments "
                                    "GROUP BY 1, 2, 3 HAVING count(*) > 1) d"), 0)
        self.assertEqual(self.table_rows(), (9, 6))

    def slow_fixtures_run(self, relay, until):
        relay.rate = 4_000
        proc = self.cli("run", "--as-of", AS_OF, "--release", RELEASE, "--asset", "opta_fixtures.parquet",
                        "--chunk-rows", "2", dsn=via_relay(relay), wait=False)
        deadline = time.monotonic() + 60
        while self.count(until) < 1 and time.monotonic() < deadline:
            time.sleep(0.02)
        return proc

    def scoped_plan(self, rows, schema, key):
        data = self.serve_fixtures(rows, schema)
        path = self.scratch / f"{key}.parquet"
        path.write_bytes(data)
        plan = {"as_of": AS_OF, "release": RELEASE, "fixtures": "current",
                "assets": [{"origin": "github", "container": RELEASE, "name": "opta_fixtures.parquet",
                            "sha256": h.sha256(data), "bytes": len(data), "path": str(path), "dataset": "opta_fixtures"}],
                "scope": {"dataset": "opta_fixtures", "keys": [key], "ordinals": [[r["match_id"] for r in rows].index(key)],
                          "max_rows": 1}}
        (self.scratch / "plan.json").write_text(json.dumps(plan))
        return str(self.scratch / "plan.json")

    def test_GH278_F_k_an_extended_load_stopped_or_killed_is_resumed_by_retry(self):
        rows = fixtures_ext_g1()
        self.serve_fixtures(rows, h.FIXTURE_EXT_SCHEMA)
        done = self.run_load("opta_fixtures.parquet", extra=("--chunk-rows", "2", "--max-seconds", "0"), expect=3)
        self.assertEqual(self.last(done)["reason"], "MAX_SECONDS")
        self.assertEqual(self.last(self.cli("retry"))["status"], "complete")
        self.assert_exact(rows)
        self.reset()
        relay = self.relay()
        proc = self.slow_fixtures_run(relay, "SELECT count(*) FROM panna.chunks")
        proc.send_signal(signal.SIGKILL)
        proc.wait()
        self.assertGreaterEqual(self.count("SELECT count(*) FROM panna.chunks"), 1)
        self.assertLess(self.count("SELECT count(*) FROM panna.manifest"), 9)
        relay.rate = 0
        done = self.cli("retry", dsn=via_relay(relay))
        self.assertEqual(self.last(done)["status"], "complete")
        self.assert_exact(rows)

    def test_GH278_F_l_a_cut_link_or_a_lost_commit_answer_during_an_extended_chunk(self):
        rows = fixtures_ext_g1()
        self.serve_fixtures(rows, h.FIXTURE_EXT_SCHEMA)
        for arm in ("drop_on", "cut_commit_after"):
            self.reset()
            relay = self.relay()
            setattr(relay, arm, b"COPY panna_data.opta_fixtures_ext")
            done = self.run_load("opta_fixtures.parquet", dsn=via_relay(relay), extra=("--chunk-rows", "2"))
            self.assertEqual((relay.drops, self.last(done)["status"]), (1, "complete"), arm)
            if arm == "drop_on":
                self.assertTrue(any(line.get("event") == "reconnect" for line in self.lines(done)))
            self.assert_exact(rows)

    def test_GH278_F_m_a_lost_extension_link_is_never_completed(self):
        self.serve_fixtures(fixtures_ext_g1(), h.FIXTURE_EXT_SCHEMA)
        relay = self.relay()
        linked = "SELECT count(*) FROM panna.manifest WHERE extension_segment_id IS NOT NULL"
        proc = self.slow_fixtures_run(relay, linked)
        self.assertGreaterEqual(self.count(linked), 1)
        self.admin.execute("UPDATE panna.manifest SET extension_segment_id = NULL")
        out, _ = proc.communicate(timeout=120)
        self.outputs.append(out)
        self.assertEqual(proc.returncode, 1, out)
        error = next(json.loads(line) for line in out.splitlines() if '"event": "error"' in line)
        self.assertEqual(error["code"], "CONSERVATION")
        self.assertGreater(error["stale"], 0)
        self.assertEqual(self.count("SELECT count(*) FROM panna.loads WHERE status = 'complete'"), 0)
        relay.rate = 0
        again = self.cli("retry", dsn=via_relay(relay), expect=1)
        self.assertIn("CONSERVATION", again.stdout)

    def test_GH278_F_n_the_churn_guard_counts_the_pair(self):
        rows = fixtures_ext_g1()
        self.serve_fixtures(rows, h.FIXTURE_EXT_SCHEMA)
        self.run_load("opta_fixtures.parquet")
        g2 = [dict(r, attendance=1234.0) if r["match_id"] in EXTENDED_KEYS else r for r in rows]
        self.serve_fixtures(g2, h.FIXTURE_EXT_SCHEMA)
        bounds = ("--churn-min-segments", "5")
        done = self.run_load("opta_fixtures.parquet", extra=bounds, expect=3)
        self.assertEqual(self.last(done)["reason"], "CHURN_GUARD")
        self.assertEqual(self.table_rows(), (9, 6))
        self.run_load("opta_fixtures.parquet", extra=bounds + ("--allow-churn",))
        self.assertEqual(self.table_rows(), (9, 12))
        self.assert_generation(self.fixtures_load(), g2)

    def test_GH278_F_o_a_scoped_extended_plan_writes_its_two_segments_only(self):
        rows = fixtures_ext_g1()
        done = self.cli("run", "--plan", self.scoped_plan(rows, h.FIXTURE_EXT_SCHEMA, "f-epl-2122"))
        self.assertEqual(self.last(done)["status"], "complete")
        load = self.fixtures_load()
        self.assertEqual(self.table_rows(), (1, 1))
        ((key, (segment, extension)),) = self.entries(load).items()
        self.assertEqual(key, "f-epl-2122")
        self.assertIsNotNone(segment)
        self.assertIsNotNone(extension)
        self.assertEqual(self.count("SELECT count(*) FROM panna.scope"), 1)
        with self.assertRaises(psycopg.errors.InvalidParameterValue):
            self.fixture_rows(load)
        self.run_load("opta_fixtures.parquet")
        # Its pair and place unchanged, the full load writes no entry for it: the scoped one stays its latest.
        self.assertNotIn("f-epl-2122", self.entries(self.fixtures_load()))
        self.assertEqual(self.admin.execute("SELECT segment_id, extension_segment_id FROM panna.manifest WHERE key = "
                                            "'f-epl-2122' ORDER BY load_id DESC LIMIT 1").fetchone(), (segment, extension))
        self.assert_exact(rows)

    def test_GH278_F_p_an_older_object_never_becomes_current(self):
        rows = fixtures_ext_g1()
        self.addCleanup(setattr, self.upstream, "updated", {})
        self.upstream.updated = {"opta_fixtures.parquet": "2026-11-28T14:18:06Z"}
        self.serve_fixtures(rows, h.FIXTURE_EXT_SCHEMA)
        self.run_load("opta_fixtures.parquet")
        current = self.fixtures_load()
        self.upstream.updated = {"opta_fixtures.parquet": "2026-11-27T15:06:53Z"}
        self.serve_fixtures(fixtures_g1(), h.FIXTURE_SCHEMA)
        done = self.run_load("opta_fixtures.parquet", expect=1)
        (error,) = [line for line in self.lines(done) if line.get("event") == "error"]
        self.assertEqual(error["code"], "OLDER_GENERATION")
        self.assertEqual((self.fixtures_load(), self.table_rows(), self.count("SELECT count(*) FROM panna.receipts")),
                         (current, (9, 6), 1))
        self.upstream.updated = {"opta_fixtures.parquet": "2026-11-28T14:18:06Z"}
        self.serve_fixtures(rows, h.FIXTURE_EXT_SCHEMA)
        self.assertEqual(self.last(self.run_load("opta_fixtures.parquet"))["rows_written"], 0)
        self.assert_generation(self.fixtures_load(), rows)

    def test_GH278_F_q_rows_moved_in_the_object_keep_their_own_ordinals(self):
        rows = fixtures_ext_g1()
        self.serve_fixtures(rows, h.FIXTURE_EXT_SCHEMA)
        self.run_load("opta_fixtures.parquet")
        first = self.fixtures_load()
        g2 = list(rows)
        g2[1], g2[2] = g2[2], g2[1]
        self.serve_fixtures(g2, h.FIXTURE_EXT_SCHEMA)
        self.assertEqual(self.last(self.run_load("opta_fixtures.parquet"))["rows_written"], 0)
        second = self.fixtures_load()
        self.assertEqual(self.entries(second), {k: self.entries(first)[k] for k in ("f-epl-2122", "f-mls-2021")})
        self.assert_generation(first, rows)
        self.assert_generation(second, g2)

    def migrate(self, password=None, backend=ROOT):
        env = {k: v for k, v in os.environ.items() if not k.startswith("V2_")}
        env.update(V2_MIGRATION_DATABASE_URL=DSN, PYTHONPATH=str(backend), PYTHONDONTWRITEBYTECODE="1")
        if password:
            env["V2_PANNA_PASSWORD"] = password
        return subprocess.run([sys.executable, "-m", "vega.migrate"], cwd=backend, env=env, capture_output=True,
                              text=True, timeout=900)

    def test_GH278_ah_al_rollback_then_the_migrate_task_with_and_without_the_password(self):
        # Whatever happens below, the next cases find the schema and the login again.
        self.addCleanup(lambda: self.migrate(PASSWORD))
        self.run_load("opta_fixtures.parquet")
        football = self.count("SELECT count(*) FROM pg_tables WHERE schemaname IN ('core', 'agg', 'ops', 'api')")
        matches = self.count("SELECT count(*) FROM core.matches")
        # GH278-al: the documented rollback. The roles go too, unless another database of this server still uses them.
        shared = self.count(ELSEWHERE)
        self.admin.execute((ROOT / "panna" / "ROLLBACK.sql").read_text())
        self.assertEqual(self.count("SELECT count(*) FROM pg_namespace WHERE nspname IN ('panna', 'panna_data', 'panna_admin')"), 0)
        self.assertEqual(self.count("SELECT count(*) FROM pg_roles WHERE rolname IN ('vega_v2_panna', 'vega_panna')"), 2 if shared else 0)
        self.assertEqual(self.count("SELECT count(*) FROM pg_tables WHERE schemaname IN ('core', 'agg', 'ops', 'api')"), football)
        self.assertEqual(self.count("SELECT count(*) FROM core.matches"), matches)
        # Amended for S1: the roles keep no right in this database (their grants on core revoked before the drop), and
        # the business tables of S1 and the provider value stay.
        self.assertEqual(self.count("""SELECT count(*) FROM pg_shdepend s JOIN pg_database d ON d.oid = s.dbid
                                       WHERE d.datname = current_database() AND s.refclassid = 'pg_authid'::regclass
                                         AND s.refobjid IN (SELECT oid FROM pg_roles WHERE rolname IN ('vega_panna', 'vega_v2_panna'))"""), 0)
        for table in ("core.match_score_observations", "core.match_score_selections", "core.observation_batches"):
            self.assertIsNotNone(self.admin.execute("SELECT to_regclass(%s)", (table,)).fetchone()[0], table)
        self.assertEqual(self.count("SELECT count(*) FROM pg_enum WHERE enumtypid = 'core.provider'::regtype AND enumlabel = 'opta'"), 1)
        # GH278-ah: without V2_PANNA_PASSWORD, nothing of panna.
        done = self.migrate()
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertNotIn("panna", done.stdout)
        self.assertEqual(self.count("SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'panna%'"), 0)
        # With it: applied once, recorded, the login set; a second run applies nothing.
        files = sorted((ROOT / "panna" / "sql").glob("*.sql"))
        done = self.migrate(PASSWORD)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertRegex(done.stdout, rf"panna applied={len(files)} total={len(files)} .*logins=vega_v2_panna")
        recorded = self.admin.execute("SELECT name, sha256 FROM panna_admin.applied ORDER BY name").fetchall()
        self.assertEqual(recorded, [(f.name, h.sha256(f.read_bytes())) for f in files])
        done = self.migrate(PASSWORD)
        self.assertRegex(done.stdout, rf"panna applied=0 total={len(files)} ")
        self.assertEqual(self.count("SELECT rolconnlimit FROM pg_roles WHERE rolname = 'vega_v2_panna'"), 4)
        # A recorded file whose bytes changed stops the run.
        with tempfile.TemporaryDirectory() as tmp:
            backend = Path(tmp) / "backend"
            import shutil
            shutil.copytree(ROOT / "vega", backend / "vega", ignore=shutil.ignore_patterns("__pycache__"))
            shutil.copytree(ROOT / "sql", backend / "sql")
            shutil.copytree(ROOT / "account" / "sql", backend / "account" / "sql")
            shutil.copytree(ROOT / "panna" / "sql", backend / "panna" / "sql")
            first = sorted((backend / "panna" / "sql").glob("*.sql"))[0]
            first.write_text(first.read_text() + "\n-- edited\n")
            done = self.migrate(PASSWORD, backend=backend)
            self.assertEqual(done.returncode, 1)
            self.assertIn("PANNA_SQL_CHANGED", done.stderr)

if __name__ == "__main__":
    unittest.main()
