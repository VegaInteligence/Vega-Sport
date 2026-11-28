"""S3: Opta's detailed actions stored once in core.match_actions (backend/panna/FAILURE_MODES.md section 10,
GH278.A-a to q, written before these tests and the code).

End to end on a disposable local PostgreSQL 18 (VEGA_V2_PANNA_S3_TEST_DSN, database vega_v2_panna_s3_test), cloned for
each case from the migrated template (template_base.fresh), then migrated by the real migrate task with
V2_PANNA_PASSWORD. The fixtures index is loaded by H1's real CLI (`python -m panna run`), the actions by the real CLI
(`python -m panna actions`), connected as the login vega_v2_panna. Every stored row is rebuilt here from the base by
this file's own reader and compared with the source bit for bit; the content digest by this file's own encoder.
Synthetic keys and values only.

  VEGA_V2_PANNA_S3_TEST_DSN=postgresql://postgres@127.0.0.1:55483/vega_v2_panna_s3_test \\
    PYTHONPATH=..:. python3 -m unittest -v test_panna_s3      # from backend/tests
"""

import hashlib
import json
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
    import pyarrow as pa
    import panna_harness as h
    from template_base import fresh
except ImportError:
    h = None

DSN = os.environ.get("VEGA_V2_PANNA_S3_TEST_DSN")
PASSWORD = "panna-s3-test-only-1"
AS_OF = "2026-11-20"
RELEASE = "opta-latest"
T1, T2, T3 = "2026-11-18T10:00:00Z", "2026-11-19T10:00:00Z", "2026-11-20T09:00:00Z"
CODES = ("event_id", "type_id", "minute", "second", "outcome", "period_id")
COORDS = ("x", "y", "end_x", "end_y")
# The 17 source columns and their place in core.match_actions (or the set: match_id, labels).
DEST = {"event_id": "source_event_id", "type_id": "type_code", "period_id": "period_code", "minute": "minute",
        "second": "second", "outcome": "outcome_code", "x": "x", "y": "y", "end_x": "end_x", "end_y": "end_y",
        "team_id": "source_team_key", "player_id": "source_player_key", "player_name": "source_player_name",
        "qualifier_json": "qualifiers"}
STAGED = ("source_event_id", "type_code", "period_code", "minute", "second", "outcome_code", "x", "y", "end_x", "end_y",
          "source_team_key", "source_player_key", "source_player_name", "qualifiers")


def bits(value):
    return struct.pack(">d", value)


def nan(payload):
    return struct.unpack(">d", bytes.fromhex(payload))[0]


def local(dsn):
    return dsn and urlparse(dsn).hostname in ("127.0.0.1", "localhost", "::1")


# --- this file's own encoder and reader --------------------------------------------------------------------------
def encode_value(value, kind):
    if value is None:
        return b"N"
    if kind in ("string", "large_string"):
        data = value.encode()
        return b"T%d:" % len(data) + data
    if kind == "int64":
        return b"I%d" % value
    if kind == "double":
        return b"D%d" % struct.unpack(">q", bits(value))[0]
    raise AssertionError(kind)


def set_digest(rows, schema):
    """SHA-256 of the canonical encoding (FAILURE_MODES.md 10.1): each value then `|`, a newline per row."""
    out = hashlib.sha256()
    for r in rows:
        out.update(b"".join(encode_value(r[f.name], str(f.type)) + b"|" for f in schema) + b"\n")
    return out.digest()


def same(a, b):
    """Equal values, doubles compared by their bits."""
    if isinstance(a, float) or isinstance(b, float):
        return isinstance(a, float) and isinstance(b, float) and bits(a) == bits(b)
    return a == b


def double_schema():
    """events_EPL.parquet of 28 Nov 2026: the six codes as double."""
    return pa.schema([pa.field(f.name, pa.float64() if f.name in CODES else f.type) for f in h.EVENT_SCHEMA])


def floated(rows):
    return [dict(r, **{c: None if r[c] is None else float(r[c]) for c in CODES}) for r in rows]


def fixtures():
    f = h.fixture
    return [f("a1", "2026-10-01", "Ligue_1", "2026-2027"), f("a2", "2025-09-10", "Ligue_1", "2025-2026"),
            f("a3", "2021-08-15", "Ligue_1", "2021-2022"), f("a-old", "2020-09-10", "Ligue_1", "2020-2021"),
            f("a-def", "2026-11-25", "Ligue_1", "2026-2027", status="Fixture", home_score=None, away_score=None,
              ht=(None, None)),
            f("e1", "2021-08-13", "EPL", "2021-2022"), f("e2", "2026-01-10", "EPL", "2025-2026")]


def ligue1(changed=False, contiguous=False):
    """a1 x6, a2 x3, a3 x4, a2 x2 (a2 in two runs), then the rows never stored, then a NULL key."""
    e = h.events_for
    a1 = e("a1", "Ligue_1", "2026-2027", 6, start=1)
    if changed:
        a1[2] = dict(a1[2], x=77.125)
    a2 = e("a2", "Ligue_1", "2025-2026", 5, start=20)
    a3 = e("a3", "Ligue_1", "2021-2022", 4, start=40)
    rows = a1 + (a2 + a3 if contiguous else a2[:3] + a3 + a2[3:])
    rows += e("a-old", "Ligue_1", "2020-2021", 2, start=60) + e("a-def", "Ligue_1", "2026-2027", 2, start=70)
    rows += e("o-old", "Ligue_1", "2013", 2, start=80) + e("o-new", "Ligue_1", "2022-2023", 3, start=90)
    rows += [dict(e("x", "Ligue_1", "2026-2027", 1, start=99)[0], match_id=None)]
    return rows


STORED_L1 = {"a1": 6, "a2": 5, "a3": 4, "o-new": 3}


def epl_edges():
    """e1: every edge value of a double object; e2: plain integral codes."""
    e1 = floated(h.events_for("e1", "EPL", "2021-2022", 8, start=1))
    edges = [
        dict(type_id=3.0, event_id=2.0 ** 62, minute=-0.0, x=nan("7ff8000000000abc"), y=-0.0, end_x=float("inf"),
             end_y=float("-inf"), player_name=None, qualifier_json='{"44":"1, 2","44":"dup","q":null}'),
        dict(second=nan("7ff8000000000123"), outcome=float("inf"), player_name="", qualifier_json="line1\nline2"),
        dict(period_id=0.5, event_id=2.0 ** 63, player_name="Kylian Mbappé", qualifier_json="", competition=None),
        dict(type_id=float("-inf"), minute=None, player_name="O'Neil \"Q\"", qualifier_json=None,
             competition="EPL-other"),
        dict(player_name="tab\tname\\slash", team_id="", x=None),
    ]
    for i, values in enumerate(edges):
        e1[i] = dict(e1[i], **values)
    e2 = floated(h.events_for("e2", "EPL", "2025-2026", 4, start=30))
    return e1 + e2


@required(psycopg is not None and h is not None and local(DSN) and urlparse(DSN).path == "/vega_v2_panna_s3_test",
          "psycopg, pyarrow and VEGA_V2_PANNA_S3_TEST_DSN (local vega_v2_panna_s3_test) are required")
class PannaS3Test(unittest.TestCase):
    db = None

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.outputs = []

    @classmethod
    def tearDownClass(cls):
        if cls.db is not None:
            # S3's rows first (the rollback refuses while they exist, GH278.A-q), then the documented rollback.
            cls.db.execute("TRUNCATE panna.action_field_exceptions, panna.source_set_memberships, core.match_actions, "
                           "core.match_action_sets, core.observation_set_revisions, core.observation_sets CASCADE")
            cls.db.execute((ROOT / "panna" / "ROLLBACK.sql").read_text())
            cls.db.close()
        cls.tmp.cleanup()

    def setUp(self):
        type(self).db = fresh(DSN, self.db)
        self.x = self.db.execute
        self.migrate()
        self.work = Path(tempfile.mkdtemp(dir=self.tmp.name))
        self.fixtures = self.asset("opta_fixtures.parquet", fixtures(), h.FIXTURE_SCHEMA, T1)
        self.cli("run", "--plan", str(self.plan_file({"as_of": AS_OF, "assets": [self.fixtures]})),
                 "--scratch", str(self.work / "scratch"))

    def migrate(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith("V2_")}
        env.update(V2_MIGRATION_DATABASE_URL=DSN, PYTHONPATH=str(ROOT), PYTHONDONTWRITEBYTECODE="1",
                   V2_PANNA_PASSWORD=PASSWORD)
        done = subprocess.run([sys.executable, "-m", "vega.migrate"], cwd=ROOT, env=env, capture_output=True, text=True,
                              timeout=600)
        if done.returncode:
            raise AssertionError(f"migrate exit {done.returncode}\n{done.stdout}\n{done.stderr}")

    def login_dsn(self, port=None):
        url = urlparse(DSN)
        netloc = f"vega_v2_panna:{PASSWORD}@{url.hostname if port is None else '127.0.0.1'}:{port or url.port or 5432}"
        return urlunparse(url._replace(netloc=netloc))

    # --- objects, plans and the CLI ---------------------------------------------------------------------------------
    def asset(self, name, rows, schema, updated_at, row_group_size=4, **fields):
        data = h.parquet_bytes(rows, schema, row_group_size=row_group_size)
        path = self.work / f"{name}-{h.sha256(data)[:12]}"
        path.write_bytes(data)
        entry = {"origin": "github", "container": RELEASE, "name": name, "sha256": h.sha256(data), "bytes": len(data),
                 "path": str(path), "asset_id": 9000 + len(name), "updated_at": updated_at,
                 "url": f"https://example.invalid/{RELEASE}/{name}",
                 "dataset": "opta_fixtures" if name == "opta_fixtures.parquet" else "opta_events"}
        entry.update(fields)
        self.rows_of = getattr(self, "rows_of", {})
        self.rows_of[(name, entry["sha256"])] = (rows, schema)
        return entry

    def plan_file(self, body):
        path = self.work / f"plan-{h.sha256(json.dumps(body, sort_keys=True).encode())[:12]}.json"
        path.write_text(json.dumps(body))
        return path

    def plan(self, *assets, select=None, fixtures=None):
        body = {"as_of": AS_OF, "fixtures": "sha256:" + (fixtures or self.fixtures["sha256"]), "assets": list(assets)}
        if select is not None:
            body["select"] = select
        return self.plan_file(body)

    def cli(self, *args, expect=0, dsn=None, timeout=300, wait=True):
        env = {k: v for k, v in os.environ.items() if not k.startswith("V2_")}
        env.update(PYTHONPATH=str(ROOT), PYTHONDONTWRITEBYTECODE="1", V2_PANNA_DATABASE_URL=dsn or self.login_dsn())
        command = [sys.executable, "-m", "panna", *args]
        if not wait:
            return subprocess.Popen(command, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        done = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=timeout)
        self.outputs.append(done.stdout + done.stderr)
        if expect is not None and done.returncode != expect:
            raise AssertionError(f"exit {done.returncode}, expected {expect}\n{done.stdout}\n{done.stderr}")
        return done

    def actions(self, *assets, select=None, extra=(), expect=0, dsn=None, fixtures=None):
        plan = self.plan(*assets, select=select, fixtures=fixtures)
        return self.cli("actions", "run", "--plan", str(plan), "--scratch", str(self.work / "scratch"), *extra,
                        expect=expect, dsn=dsn)

    @staticmethod
    def lines(done):
        return [json.loads(line) for line in done.stdout.splitlines() if line.strip().startswith("{")]

    def loads(self, done):
        return {line["name"]: line for line in self.lines(done) if line.get("event") == "load"}

    def errors(self, done):
        return [line for line in self.lines(done) if line.get("event") == "error"]

    def count(self, sql, *params):
        return self.x(sql, params or None).fetchone()[0]

    # --- the base read back by this file's own reader ---------------------------------------------------------------
    def totals(self):
        return {name: self.count(f"SELECT count(*) FROM {name}") for name in (
            "core.observation_sets", "core.match_action_sets", "core.match_actions", "panna.action_field_exceptions",
            "panna.source_set_memberships", "core.observation_set_revisions", "core.observation_batches")}

    def set_of(self, key):
        """The current set of a native key."""
        return self.count("""SELECT r.set_id FROM core.observation_set_revisions r WHERE r.origin = 'opta'
                             AND r.product = 'match_actions' AND r.subject_key = %s AND r.is_current""", f"match:{len(key.encode())}:{key}")

    def rebuild(self, set_id):
        """The source rows of a set rebuilt from core.observation_sets, core.match_action_sets, core.match_actions and
        panna.action_field_exceptions only, in the schema's order and types."""
        subject, schema_key, rows_n = self.x("SELECT subject_key, schema_key, row_count FROM core.observation_sets WHERE id = %s",
                                             (set_id,)).fetchone()
        prefix, length, native = subject.split(":", 2)
        self.assertEqual((prefix, int(length)), ("match", len(native.encode())))
        self.assertTrue(schema_key.startswith("arrow:"))
        fields = [part.rsplit(":", 1) for part in schema_key[len("arrow:"):].split(",")]
        kinds = {name: kind.rstrip("!") for name, kind in fields}
        competition, season = self.x("SELECT source_competition_label, source_season_label FROM core.match_action_sets "
                                     "WHERE set_id = %s", (set_id,)).fetchone()
        exceptions = {}
        for ordinal, column, kind, integer, float_bits, text in self.x(
                """SELECT ordinal, source_column, source_type, integer_value, float_bits, text_value
                   FROM panna.action_field_exceptions WHERE set_id = %s""", (set_id,)).fetchall():
            self.assertEqual(kind, kinds[column])
            self.assertEqual(sum(v is not None for v in (integer, float_bits, text)), 1)
            exceptions[(ordinal, column)] = (integer, bytes(float_bits) if float_bits is not None else None, text)
        stored = self.x(f"SELECT ordinal, {', '.join(DEST.values())} FROM core.match_actions WHERE set_id = %s ORDER BY ordinal",
                        (set_id,)).fetchall()
        self.assertEqual([r[0] for r in stored], list(range(rows_n)))
        out = []
        for row in stored:
            ordinal, values = row[0], dict(zip(DEST, row[1:]))
            got = {"match_id": native}
            for name in DEST:
                value, exc = values[name], exceptions.get((ordinal, name))
                if exc is not None:
                    self.assertIsNone(value, (set_id, ordinal, name))
                    value = struct.unpack(">d", exc[1])[0] if exc[1] is not None else exc[0]
                elif value is not None and kinds[name] == "double":
                    value = float(value)
                got[name] = value
            for name, header in (("competition", competition), ("season", season)):
                exc = exceptions.get((ordinal, name))
                got[name] = exc[2] if exc is not None else header
            out.append(got)
        return out, kinds, [name for name, _ in fields]

    def assert_set_exact(self, key, rows, schema):
        """The key's current set holds exactly the source rows of that key, and its digest is this file's."""
        mine = [r for r in rows if r["match_id"] == key]
        set_id = self.set_of(key)
        self.assertIsNotNone(set_id, key)
        got, kinds, order = self.rebuild(set_id)
        self.assertEqual(order, [f.name for f in schema])
        self.assertEqual(kinds, {f.name: str(f.type) for f in schema})
        self.assertEqual(len(got), len(mine))
        for g, w in zip(got, mine):
            for name in order:
                self.assertTrue(same(g[name], w[name]), (key, name, g[name], w[name]))
        digest = bytes(self.count("SELECT content_sha256 FROM core.observation_sets WHERE id = %s", set_id))
        self.assertEqual(digest, set_digest(mine, schema))
        return set_id

    def runs_of(self, rows, key):
        """The key's physical rows as half-open ranges, PostgreSQL's text of an int8multirange."""
        idx = [i for i, r in enumerate(rows) if r["match_id"] == key]
        ranges, start = [], idx[0]
        for a, b in zip(idx, idx[1:] + [None]):
            if b != a + 1:
                ranges.append(f"[{start},{a + 1})")
                start = b
        return "{" + ",".join(ranges) + "}"

    # --- GH278.A-a ----------------------------------------------------------------------------------------------------
    def test_GH278_A_a_first_load_one_copy_every_value(self):
        from panna import encode, registry

        rows = ligue1()
        l1 = self.asset("events_Ligue_1.parquet", rows, h.EVENT_SCHEMA, T1)
        done = self.actions(l1)
        load = self.loads(done)["events_Ligue_1.parquet"]
        self.assertEqual(load["sets_written"], 4)
        self.assertEqual(load["actions_written"], sum(STORED_L1.values()))
        self.assertEqual(load["outcomes"], {"eligible": 15, "eligible_orphan": 3, "historical": 4, "deferred": 2,
                                            "unresolved": 1})
        totals = self.totals()
        self.assertEqual(totals, {"core.observation_sets": 4, "core.match_action_sets": 4, "core.match_actions": 18,
                                  "panna.action_field_exceptions": 0, "panna.source_set_memberships": 4,
                                  "core.observation_set_revisions": 4, "core.observation_batches": 1})
        table = pa.Table.from_pylist(rows, schema=h.EVENT_SCHEMA)
        for key in STORED_L1:
            set_id = self.assert_set_exact(key, rows, h.EVENT_SCHEMA)
            mine = table.filter(pa.compute.equal(table.column("match_id"), key))
            h1 = encode.digest(encode.encode_rows(mine, registry.EVENTS.columns))
            self.assertEqual(bytes(self.count("SELECT content_sha256 FROM core.observation_sets WHERE id = %s", set_id)), h1)
            self.assertEqual(self.x("SELECT source_competition_label, source_season_label FROM core.match_action_sets "
                                    "WHERE set_id = %s", (set_id,)).fetchone(), ("Ligue_1", rows[[r["match_id"] for r in rows].index(key)]["season"]))
            runs, n = self.x("""SELECT m.source_runs::text, m.row_count FROM panna.source_set_memberships m
                                WHERE m.set_id = %s AND m.ordinal_map IS NULL""", (set_id,)).fetchone()
            self.assertEqual((runs, n), (self.runs_of(rows, key), STORED_L1[key]))
            self.assertEqual(self.x("SELECT revision_no, is_current FROM core.observation_set_revisions WHERE set_id = %s",
                                    (set_id,)).fetchall(), [(1, True)])
        self.assertEqual(self.runs_of(rows, "a2"), "{[6,9),[13,15)}")
        batch = self.x("""SELECT distributor, object_name, member_path, encode(content_sha256, 'hex'), publisher_version,
                                 issued_at = %s::timestamptz, source_url, schema_sha256 IS NOT NULL FROM core.observation_batches""",
                       (T1,)).fetchone()
        self.assertEqual(batch, ("pannadata", "events_Ligue_1.parquet", None, l1["sha256"], f"{RELEASE}#{l1['asset_id']}",
                                 True, l1["url"], True))
        events_segments = self.count("SELECT count(*) FROM panna.segments WHERE dataset = 'opta_events'")
        self.assertEqual((self.count("SELECT count(*) FROM panna_data.opta_events"), events_segments), (0, 0))
        stored = {r[0] for r in self.x("SELECT subject_key FROM core.observation_sets").fetchall()}
        self.assertEqual(stored, {f"match:{len(k)}:{k}" for k in STORED_L1})

    # --- GH278.A-b ----------------------------------------------------------------------------------------------------
    def test_GH278_A_b_double_codes_and_edge_values_restored_bit_for_bit(self):
        rows = epl_edges()
        epl = self.asset("events_EPL.parquet", rows, double_schema(), T1)
        self.actions(epl)
        e1 = self.assert_set_exact("e1", rows, double_schema())
        self.assert_set_exact("e2", rows, double_schema())
        self.assertEqual(self.count("SELECT count(*) FROM panna.action_field_exceptions WHERE set_id = %s", self.set_of("e2")), 0)
        exceptions = {(o, c): (k, bytes(b).hex() if b is not None else None, t) for o, c, k, b, t in self.x(
            "SELECT ordinal, source_column, source_type, float_bits, text_value FROM panna.action_field_exceptions "
            "WHERE set_id = %s", (e1,)).fetchall()}
        want = {(0, "minute"): ("double", bits(-0.0).hex(), None), (0, "x"): ("double", "7ff8000000000abc", None),
                (1, "second"): ("double", "7ff8000000000123", None), (1, "outcome"): ("double", bits(float("inf")).hex(), None),
                (2, "period_id"): ("double", bits(0.5).hex(), None), (2, "event_id"): ("double", bits(2.0 ** 63).hex(), None),
                (3, "type_id"): ("double", bits(float("-inf")).hex(), None)}
        # The competition varies (a NULL among the values): header NULL, one text exception per row holding a value.
        want.update({(o, "competition"): ("large_string", None, "EPL-other" if o == 3 else "EPL")
                     for o in range(8) if o != 2})
        self.assertEqual(exceptions, want)
        self.assertEqual(self.x("SELECT source_competition_label, source_season_label FROM core.match_action_sets "
                                "WHERE set_id = %s", (e1,)).fetchone(), (None, "2021-2022"))
        cells = self.x("""SELECT source_event_id, type_code, minute, y::text, end_x::text, end_y::text FROM core.match_actions
                          WHERE set_id = %s AND ordinal = 0""", (e1,)).fetchone()
        self.assertEqual(cells, (2 ** 62, 3, None, "-0", "Infinity", "-Infinity"))
        self.assertEqual(self.x("""SELECT qualifier_ordinal, qualifier_code, value_type, value_text FROM core.match_action_qualifiers
                                   WHERE set_id = %s AND ordinal = 0 ORDER BY qualifier_ordinal""", (e1,)).fetchall(),
                         [(0, "44", "string", "1, 2"), (1, "44", "string", "dup"), (2, "q", "null", None)])
        self.assertEqual(self.count("SELECT count(*) FROM core.match_action_qualifiers WHERE set_id = %s AND ordinal = 1", e1), 0)

    # --- GH278.A-c ----------------------------------------------------------------------------------------------------
    def test_GH278_A_c_schema_drift_and_unstorable_text_refused(self):
        rows = ligue1()
        cases = [("events_Missing.parquet", rows, pa.schema([f for f in h.EVENT_SCHEMA if f.name != "outcome"]), "outcome"),
                 ("events_Extra.parquet", [dict(r, extra=1) for r in rows],
                  pa.schema(list(h.EVENT_SCHEMA) + [pa.field("extra", pa.int64())]), "extra"),
                 ("events_Xtext.parquet", [dict(r, x=None if r["x"] is None else str(r["x"])) for r in rows],
                  pa.schema([pa.field("x", pa.string()) if f.name == "x" else f for f in h.EVENT_SCHEMA]), "x"),
                 ("events_Int32.parquet", rows,
                  pa.schema([pa.field("type_id", pa.int32()) if f.name == "type_id" else f for f in h.EVENT_SCHEMA]), "type_id")]
        for name, data, schema, column in cases:
            done = self.actions(self.asset(name, data, schema, T1), expect=1)
            (error,) = self.errors(done)
            self.assertEqual(error["code"], "SCHEMA_DRIFT", name)
            self.assertIn(column, json.dumps(error), name)
        nul = [dict(r, player_name="bad\x00name") if r["match_id"] == "a3" else r for r in rows]
        (error,) = self.errors(self.actions(self.asset("events_Nul.parquet", nul, h.EVENT_SCHEMA, T1), expect=1))
        self.assertEqual(error["code"], "UNSTORABLE_TEXT")
        totals = self.totals()
        self.assertEqual(sum(v for k, v in totals.items() if k != "core.observation_batches"), 0)

    # --- GH278.A-d ----------------------------------------------------------------------------------------------------
    def test_GH278_A_d_replay_writes_nothing(self):
        l1 = self.asset("events_Ligue_1.parquet", ligue1(), h.EVENT_SCHEMA, T1)
        self.actions(l1)
        before = self.totals()
        load = self.loads(self.actions(l1))["events_Ligue_1.parquet"]
        self.assertEqual(self.totals(), before)
        self.assertEqual((load["status"], load["sets_written"], load["actions_written"], load["memberships_written"],
                          load["revisions_written"]), ("complete", 0, 0, 0, 0))

    # --- GH278.A-e ----------------------------------------------------------------------------------------------------
    def test_GH278_A_e_change_move_and_a_b_a(self):
        g1 = ligue1()
        a = self.asset("events_Ligue_1.parquet", g1, h.EVENT_SCHEMA, T1)
        self.actions(a)
        set_a = self.set_of("a1")
        g2 = ligue1(changed=True, contiguous=True)
        b = self.asset("events_Ligue_1.parquet", g2, h.EVENT_SCHEMA, T2)
        load = self.loads(self.actions(b))["events_Ligue_1.parquet"]
        self.assertEqual((load["sets_written"], load["revisions_written"], load["memberships_written"]), (1, 1, 3))
        for key in STORED_L1:
            self.assert_set_exact(key, g2, h.EVENT_SCHEMA)
        set_b = self.set_of("a1")
        self.assertNotEqual(set_a, set_b)
        moved = self.x("""SELECT o.subject_key, m.source_runs::text FROM panna.source_set_memberships m
                          JOIN core.observation_sets o ON o.id = m.set_id JOIN core.observation_batches b ON b.id = m.batch_id
                          WHERE encode(b.content_sha256, 'hex') = %s ORDER BY 1""", (b["sha256"],)).fetchall()
        self.assertEqual(moved, [("match:2:a1", self.runs_of(g2, "a1")), ("match:2:a2", self.runs_of(g2, "a2")),
                                 ("match:2:a3", self.runs_of(g2, "a3"))])
        again = dict(a, updated_at=T3)
        load = self.loads(self.actions(again))["events_Ligue_1.parquet"]
        self.assertEqual((load["sets_written"], load["actions_written"], load["revisions_written"]), (0, 0, 1))
        revisions = self.x("""SELECT revision_no, set_id, is_current, effective_at = %s::timestamptz FROM core.observation_set_revisions
                              WHERE subject_key = 'match:2:a1' ORDER BY revision_no""", (T3,)).fetchall()
        self.assertEqual(revisions, [(1, set_a, False, False), (2, set_b, False, False), (3, set_a, True, True)])
        self.assertEqual(self.count("SELECT count(*) FROM core.observation_sets WHERE subject_key = 'match:2:a1'"), 2)
        for key in STORED_L1:
            self.assert_set_exact(key, g1, h.EVENT_SCHEMA)

    # --- GH278.A-f ----------------------------------------------------------------------------------------------------
    def test_GH278_A_f_same_set_in_two_objects_then_a_conflict(self):
        g1 = ligue1()
        self.actions(self.asset("events_Ligue_1.parquet", g1, h.EVENT_SCHEMA, T1))
        set_a = self.set_of("a1")
        copy = [r for r in g1 if r["match_id"] == "a1"]
        load = self.loads(self.actions(self.asset("events_Copy.parquet", copy, h.EVENT_SCHEMA, T2)))["events_Copy.parquet"]
        self.assertEqual((load["sets_written"], load["sets_reused"], load["memberships_written"], load["revisions_written"]),
                         (0, 1, 1, 0))
        self.assertEqual(self.count("SELECT count(*) FROM panna.source_set_memberships WHERE set_id = %s", set_a), 2)
        other = [dict(r, x=12.5) for r in copy]
        load = self.loads(self.actions(self.asset("events_Other.parquet", other, h.EVENT_SCHEMA, T1)))["events_Other.parquet"]
        self.assertEqual((load["sets_written"], load["conflicts"], load["revisions_written"]), (1, 1, 0))
        self.assertEqual(self.set_of("a1"), set_a)
        self.assertEqual(self.count("SELECT count(*) FROM core.observation_sets WHERE subject_key = 'match:2:a1'"), 2)
        self.assertEqual(self.count("SELECT count(*) FROM core.observation_set_revisions WHERE subject_key = 'match:2:a1'"), 1)

    # --- GH278.A-g ----------------------------------------------------------------------------------------------------
    def assert_l1_exact(self, rows):
        for key in STORED_L1:
            self.assert_set_exact(key, rows, h.EVENT_SCHEMA)
        totals = self.totals()
        self.assertEqual((totals["core.observation_sets"], totals["core.match_actions"], totals["panna.source_set_memberships"],
                          totals["core.observation_set_revisions"]), (4, 18, 4, 4))
        self.assertEqual(self.count("SELECT count(*) FROM core.observation_set_revisions WHERE is_current"), 4)

    def test_GH278_A_g_stopped_killed_and_lost_commit_runs_resume_exactly(self):
        rows = ligue1()
        l1 = self.asset("events_Ligue_1.parquet", rows, h.EVENT_SCHEMA, T1)
        done = self.actions(l1, extra=("--max-seconds", "0"), expect=3)
        self.assertEqual(self.lines(done)[-1]["status"], "partial")
        done = self.cli("actions", "retry")
        self.assertEqual(self.lines(done)[-1]["status"], "complete")
        self.assert_l1_exact(rows)

        type(self).db = fresh(DSN, self.db)
        self.x = self.db.execute
        self.migrate()
        self.cli("run", "--plan", str(self.plan_file({"as_of": AS_OF, "assets": [self.fixtures]})), "--scratch", str(self.work / "s2"))
        url = urlparse(DSN)
        relay = h.Relay(url.hostname, url.port or 5432)
        self.addCleanup(relay.close)
        relay.rate = 4_000
        proc = self.cli("actions", "run", "--plan", str(self.plan(l1)), "--chunk-rows", "3", "--scratch", str(self.work / "s3"),
                        dsn=self.login_dsn(relay.port), wait=False)
        chunks = "SELECT count(*) FROM panna.chunks c JOIN panna.loads l USING (load_id) JOIN panna.streams s USING (stream_id) WHERE s.dataset = 'opta_events'"
        deadline = time.monotonic() + 120
        while self.count(chunks) < 1 and time.monotonic() < deadline:
            time.sleep(0.02)
        proc.send_signal(signal.SIGKILL)
        proc.wait()
        self.assertGreaterEqual(self.count(chunks), 1)
        self.assertLess(self.count("SELECT count(*) FROM core.observation_sets"), 4)
        relay.rate = 0
        done = self.cli("actions", "retry")
        self.assertEqual(self.lines(done)[-1]["status"], "complete")
        self.assert_l1_exact(rows)

        type(self).db = fresh(DSN, self.db)
        self.x = self.db.execute
        self.migrate()
        self.cli("run", "--plan", str(self.plan_file({"as_of": AS_OF, "assets": [self.fixtures]})), "--scratch", str(self.work / "s4"))
        relay.cut_commit = True
        done = self.cli("actions", "run", "--plan", str(self.plan(l1)), "--chunk-rows", "3", "--scratch", str(self.work / "s5"),
                        dsn=self.login_dsn(relay.port))
        self.assertEqual(relay.drops, 1)
        self.assertEqual(self.lines(done)[-1]["status"], "complete")
        self.assert_l1_exact(rows)

    # --- GH278.A-h ----------------------------------------------------------------------------------------------------
    def test_GH278_A_h_older_generation_refused(self):
        self.actions(self.asset("events_Ligue_1.parquet", ligue1(changed=True), h.EVENT_SCHEMA, T2))
        before = self.totals()
        done = self.actions(self.asset("events_Ligue_1.parquet", ligue1(), h.EVENT_SCHEMA, T1), expect=1)
        self.assertEqual(self.errors(done)[0]["code"], "OLDER_GENERATION")
        self.assertEqual(self.totals(), before)

    # --- GH278.A-i ----------------------------------------------------------------------------------------------------
    def stage_one(self, conn, stage, digest=None, value=5):
        row = {"match_id": "race", "event_id": value, "type_id": 1, "player_id": "p", "player_name": "n", "team_id": "t",
               "minute": 1, "second": 2, "x": 1.5, "y": 2.5, "end_x": None, "end_y": None, "outcome": 1, "period_id": 1,
               "qualifier_json": "{}", "competition": "Ligue_1", "season": "2026-2027"}
        schema_key = "arrow:" + ",".join(f"{f.name}:{f.type}" for f in h.EVENT_SCHEMA)
        conn.execute("INSERT INTO panna.action_stage_sets (stage_id, set_no, subject_key, schema_key, content_sha256, row_count) "
                     "VALUES (%s, 0, 'match:4:race', %s, %s, 1)", (stage, schema_key, digest or set_digest([row], h.EVENT_SCHEMA)))
        conn.execute(f"INSERT INTO panna.action_stage (stage_id, set_no, ordinal, {', '.join(STAGED)}, competition, season) "
                     f"VALUES (%s, 0, 0, {', '.join(['%s'] * len(STAGED))}, %s, %s)",
                     (stage, *[row[c] for c in DEST], row["competition"], row["season"]))
        return conn.execute("SELECT set_no, created FROM panna.put_action_sets(%s)", (stage,)).fetchall()

    def test_GH278_A_i_one_runner_and_one_set_under_a_race(self):
        holder = psycopg.connect(self.login_dsn(), autocommit=True)
        self.addCleanup(holder.close)
        self.assertTrue(holder.execute("SELECT pg_try_advisory_lock(hashtext('vega-panna-loader'))").fetchone()[0])
        self.actions(self.asset("events_Ligue_1.parquet", ligue1(), h.EVENT_SCHEMA, T1), expect=4)
        holder.close()
        one, two = psycopg.connect(self.login_dsn()), psycopg.connect(self.login_dsn())
        self.addCleanup(one.close)
        self.addCleanup(two.close)
        self.assertEqual(self.stage_one(one, 1), [(0, True)])
        result = {}
        second = threading.Thread(target=lambda: result.setdefault("two", self.stage_one(two, 2)))
        second.start()
        time.sleep(0.5)
        self.assertTrue(second.is_alive())  # waiting on the first's set
        one.commit()
        second.join(30)
        two.commit()
        self.assertEqual(result["two"], [(0, False)])
        self.assertEqual((self.count("SELECT count(*) FROM core.observation_sets"), self.count("SELECT count(*) FROM core.match_actions"),
                          self.count("SELECT count(*) FROM panna.action_stage")), (1, 1, 0))

    # --- GH278.A-j, k -------------------------------------------------------------------------------------------------
    def test_GH278_A_j_unreachable_asset_fails_alone(self):
        g1 = ligue1()
        self.actions(self.asset("events_Ligue_1.parquet", g1, h.EVENT_SCHEMA, T1))
        revisions = self.x("SELECT * FROM core.observation_set_revisions ORDER BY id").fetchall()
        gone = self.asset("events_Ligue_1.parquet", ligue1(changed=True), h.EVENT_SCHEMA, T2)
        Path(gone["path"]).unlink()
        gone.update(path=str(self.work / "absent.parquet"), url="http://127.0.0.1:9/absent")
        epl = self.asset("events_EPL.parquet", epl_edges(), double_schema(), T2)
        done = self.actions(gone, epl, expect=1)
        self.assertEqual([e["code"] for e in self.errors(done)], ["DOWNLOAD_FAILED"])
        self.assertEqual(self.lines(done)[-1]["status"], "failed")
        self.assertIn("events_EPL.parquet", self.loads(done))
        self.assertEqual(self.x("SELECT * FROM core.observation_set_revisions WHERE subject_key LIKE 'match:2:a%%' OR "
                                "subject_key = 'match:5:o-new' ORDER BY id").fetchall(), revisions)
        self.assertEqual(self.count("SELECT count(*) FROM core.observation_batches"), 2)
        self.assert_set_exact("a1", g1, h.EVENT_SCHEMA)

    def test_GH278_A_k_digest_mismatch_refused(self):
        l1 = self.asset("events_Ligue_1.parquet", ligue1(), h.EVENT_SCHEMA, T1)
        l1["sha256"] = h.sha256(b"other bytes")
        done = self.actions(l1, expect=1)
        self.assertEqual(self.errors(done)[0]["code"], "DIGEST_MISMATCH")
        self.assertEqual(self.totals()["core.observation_sets"], 0)

    # --- GH278.A-l ----------------------------------------------------------------------------------------------------
    def test_GH278_A_l_selections_compose(self):
        rows = ligue1()
        l1 = self.asset("events_Ligue_1.parquet", rows, h.EVENT_SCHEMA, T1)
        steps = [({"keys": ["a1"]}, {"a1"}, 12), ({"vega_seasons": [2021]}, {"a3"}, 14),
                 ({"key_range": ["a2", "a3"]}, {"a2"}, 13), (None, {"o-new"}, 0)]
        seen = set()
        for select, written, out in steps:
            load = self.loads(self.actions(l1, select=select))["events_Ligue_1.parquet"]
            now = {r[0].split(":", 2)[2] for r in self.x("SELECT subject_key FROM core.observation_sets").fetchall()}
            self.assertEqual(now - seen, written, select)
            self.assertEqual(load["sets_written"], len(written))
            self.assertEqual(load["outcomes"].get("out_of_selection", 0), out, select)
            seen = now
        self.assert_l1_exact(rows)

    # --- GH278.A-m ----------------------------------------------------------------------------------------------------
    def test_GH278_A_m_fixtures_pin_and_schema_version(self):
        l1 = self.asset("events_Ligue_1.parquet", ligue1(), h.EVENT_SCHEMA, T1)
        done = self.actions(l1, fixtures=h.sha256(b"another fixtures generation"), expect=1)
        self.assertEqual(self.errors(done)[0]["code"], "FIXTURES_VERSION_MISMATCH")
        self.x("ALTER FUNCTION panna.put_action_sets(bigint) RENAME TO put_action_sets_gone")
        done = self.actions(l1, expect=1)
        self.assertEqual((self.errors(done)[0]["code"], self.errors(done)[0]["needs"]),
                         ("SCHEMA_VERSION", "backend/panna/sql/006_panna_actions.sql"))
        self.x("ALTER FUNCTION panna.put_action_sets_gone(bigint) RENAME TO put_action_sets")
        self.x("ALTER TABLE core.match_actions RENAME TO match_actions_gone")
        done = self.actions(l1, expect=1)
        self.assertEqual((self.errors(done)[0]["code"], self.errors(done)[0]["needs"]),
                         ("SCHEMA_VERSION", "backend/sql/187_match_action_sets.sql"))
        self.x("ALTER TABLE core.match_actions_gone RENAME TO match_actions")
        self.assertEqual(self.totals()["core.observation_sets"], 0)

    # --- GH278.A-n ----------------------------------------------------------------------------------------------------
    def test_GH278_A_n_privileges_and_server_digest(self):
        for role in ("vega_panna", "vega_collect"):
            for relation in ("core.observation_sets", "core.observation_set_revisions", "core.match_action_sets",
                             "core.match_actions", "panna.action_field_exceptions", "panna.source_set_memberships"):
                for privilege in ("INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                    self.assertFalse(self.count("SELECT has_table_privilege(%s, %s, %s)", role, relation, privilege),
                                     (role, relation, privilege))
        for signature in ("panna.action_batch(bigint, text)", "panna.put_action_sets(bigint)",
                          "panna.place_action_sets(bigint, bigint, timestamptz, text[], bigint[], text[], integer[])",
                          "panna.action_set_encoding(bigint)"):
            self.assertFalse(self.count("SELECT has_function_privilege('public', %s, 'EXECUTE')", signature), signature)
            self.assertTrue(self.count("SELECT has_function_privilege('vega_panna', %s, 'EXECUTE')", signature), signature)
        login = psycopg.connect(self.login_dsn())
        self.addCleanup(login.close)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            login.execute("INSERT INTO core.observation_sets (origin, product, subject_key, schema_key, content_sha256, row_count, "
                          "first_seen_at) VALUES ('opta', 'match_actions', 'match:1:z', 'arrow:', %s, 0, now())", (b"\0" * 32,))
        login.rollback()
        with self.assertRaises(psycopg.errors.RaiseException) as raised:
            self.stage_one(login, 7, digest=b"\1" * 32)
        self.assertIn("VERIFY_MISMATCH", str(raised.exception))
        login.rollback()
        self.assertEqual(self.totals()["core.observation_sets"], 0)

    # --- GH278.A-o ----------------------------------------------------------------------------------------------------
    def test_GH278_A_o_identity_resolved_through_provider_ids_only(self):
        collect = psycopg.connect(DSN, autocommit=True)
        self.addCleanup(collect.close)
        collect.execute("SET ROLE vega_collect")
        from vega.normalize import normalize_family
        from vega.store import Store

        store = Store(collect)
        store.save_references(normalize_family("league", {"id": "l_s3lg01", "name": "Ligue 1", "country_code": "FRA",
                                                          "season": "2026/2027"}))
        edition = self.count("SELECT id FROM core.competition_seasons ORDER BY id LIMIT 1")
        payload = {"id": "m_s3a1aa", "home_team": {"id": "t_s3home", "name": "Home"}, "away_team": {"id": "t_s3away", "name": "Away"},
                   "status": "finished", "date": "2026-10-01", "time_utc": "2026-10-01T19:00:00Z", "score_home": 1, "score_away": 0}
        (mid,) = store.save_matches(normalize_family("summary", payload, match_id="m_s3a1aa"), edition)
        self.x("INSERT INTO core.provider_ids (entity_type, provider, provider_key, entity_id) VALUES ('match', 'opta', 'a1', %s)", (mid,))
        before = (self.count("SELECT count(*) FROM core.matches"), self.count("SELECT count(*) FROM core.provider_ids"))
        self.actions(self.asset("events_Ligue_1.parquet", ligue1(), h.EVENT_SCHEMA, T1))
        self.assertEqual((self.count("SELECT count(*) FROM core.matches"), self.count("SELECT count(*) FROM core.provider_ids")), before)
        resolved = dict(self.x("SELECT source_match_key, match_id FROM core.current_match_action_sets").fetchall())
        self.assertEqual(resolved, {"a1": mid, "a2": None, "a3": None, "o-new": None})
        status = self.lines(self.cli("actions", "status"))[-1]
        self.assertEqual((status["subjects"], status["resolved"], status["pending_identity"]), (4, 1, 3))

    # --- GH278.A-p ----------------------------------------------------------------------------------------------------
    def test_GH278_A_p_verify_names_a_tampered_set(self):
        self.actions(self.asset("events_EPL.parquet", epl_edges(), double_schema(), T1))
        done = self.cli("actions", "verify")
        self.assertEqual((self.lines(done)[-1]["sets"], self.lines(done)[-1]["mismatches"]), (2, 0))
        e1 = self.set_of("e1")
        self.x("UPDATE core.match_actions SET qualifiers = 'tampered' WHERE set_id = %s AND ordinal = 4", (e1,))
        done = self.cli("actions", "verify", expect=1)
        mismatches = [line for line in self.lines(done) if line.get("event") == "mismatch"]
        self.assertEqual([(m["set_id"], m["subject_key"]) for m in mismatches], [(e1, "match:2:e1")])

    # --- GH278.A-q ----------------------------------------------------------------------------------------------------
    def test_GH278_A_q_rollback_refused_once_s3_rows_exist(self):
        self.actions(self.asset("events_EPL.parquet", epl_edges(), double_schema(), T1))
        before = self.totals()
        with self.assertRaises(psycopg.errors.RaiseException) as raised:
            self.x((ROOT / "panna" / "ROLLBACK.sql").read_text())
        self.assertIn("S3", str(raised.exception))
        self.assertEqual(self.totals(), before)
        self.assertIsNotNone(self.count("SELECT to_regnamespace('panna')"))


if __name__ == "__main__":
    unittest.main()
