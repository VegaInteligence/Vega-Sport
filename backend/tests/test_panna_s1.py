"""S1: the half-time pair of one existing Vega match published from PannaData's Opta fixture (backend/panna/FAILURE_MODES.md
section 8, GH278.S1-a to t, and the amended GH278-ai and GH278-al, written before these tests and the code).

End to end on a disposable local PostgreSQL 18 (VEGA_V2_PANNA_S1_TEST_DSN, database vega_v2_panna_s1_test), cloned for
each case from the migrated template (template_base.fresh), then migrated by the real migrate task with
V2_PANNA_PASSWORD. The parent is written by the real Pitch writer (vega.normalize, vega.store.Store, as vega_collect),
the Opta row read from a Parquet file by the real CLI (`python -m panna pilot`), connected as the login vega_v2_panna.
Synthetic keys and values only: no PannaData row, no real identifier.

  VEGA_V2_PANNA_S1_TEST_DSN=postgresql://postgres@127.0.0.1:55483/vega_v2_panna_s1_test \\
    PYTHONPATH=..:. python3 -m unittest -v test_panna_s1      # from backend/tests
"""

import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlparse, urlunparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from prerequisites import required  # noqa: E402

try:
    import psycopg
    from psycopg.types.json import Jsonb
except ImportError:
    psycopg = None
try:
    import pyarrow  # noqa: F401
    import panna_harness as h
    from template_base import fresh
except ImportError:
    h = None

DSN = os.environ.get("VEGA_V2_PANNA_S1_TEST_DSN")
PASSWORD = "panna-s1-test-only-1"
AS_OF = "2026-11-28"
RELEASE = "opta-latest"
ASSET = "opta_fixtures.parquet"
KEY = "opta0s1test0psg0roma00001"  # a synthetic Opta key
LEAGUE, MATCH, HOME, AWAY = "l_s1ucl0", "m_s1psgr", "t_s1psg0", "t_s1rom0"
RULE = "opta-half-time-s1"
ISSUED = ("2026-11-20T10:00:00Z", "2026-11-22T10:00:00Z", "2026-11-24T10:00:00Z", "2026-11-26T10:00:00Z")
SNAPSHOT_SOURCES = ("open_matchday", "openfootball", "openligadb", "international_results")


def local(dsn):
    return dsn and urlparse(dsn).hostname in ("127.0.0.1", "localhost", "::1")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def opta_row(key=KEY, ht=("1", "1"), final=("2", "2"), day="2026-11-25", home="Paris Saint-Germain FC",
             away="AS Roma", competition="UCL", season="2026-2027", status="Played"):
    """One row of opta_fixtures.parquet (the release's 13 string columns), synthetic."""
    return {"match_id": key, "match_date": f"{day}Z", "match_status": status, "home_team": home, "away_team": away,
            "home_team_id": "opta-team-home", "away_team_id": "opta-team-away", "home_score": final[0],
            "away_score": final[1], "home_score_ht": ht[0], "away_score_ht": ht[1], "competition": competition,
            "season": season}


def others(n=4, tag="x"):
    """Rows of other fixtures in the same object: two in the window, one before it, one deferred."""
    rows = [opta_row(key=f"opta-other-{tag}-{i}", day=day, season=season, home=f"Home {i}", away=f"Away {i}")
            for i, (day, season) in enumerate((("2026-11-24", "2026-2027"), ("2026-10-01", "2026-2027"),
                                               ("2020-09-10", "2020-2021"), ("2026-12-12", "2026-2027")))]
    return rows[:n]


def packet(rows):
    """The scope manifest's packet: each row's 13 fields as one JSON line (the coordinator's s1 format)."""
    return b"".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")).encode() + b"\n" for r in rows)


def first_half_goals(home=1, away=1):
    goals = [{"event_type": "Goal", "team_id": AWAY, "minute": 5 + i, "period": "FirstHalf", "is_own_goal": False}
             for i in range(away)]
    goals += [{"event_type": "Goal", "team_id": HOME, "minute": 31 + i, "period": "FirstHalf", "is_own_goal": False}
              for i in range(home)]
    return goals


def second_half_goals():
    return [{"event_type": "Goal", "team_id": HOME, "minute": 62, "period": "SecondHalf", "is_own_goal": False},
            {"event_type": "Goal", "team_id": AWAY, "minute": 78, "period": "SecondHalf", "is_own_goal": False},
            {"event_type": "Substitution", "team_id": HOME, "minute": 70, "period": "SecondHalf"}]


ELSEWHERE = """SELECT count(*) FROM pg_shdepend s JOIN pg_database d ON d.oid = s.dbid
               WHERE s.refclassid = 'pg_authid'::regclass AND d.datname <> current_database()
                 AND s.refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'vega_panna')"""


@required(psycopg is not None and h is not None and local(DSN) and urlparse(DSN).path == "/vega_v2_panna_s1_test",
          "psycopg, pyarrow and VEGA_V2_PANNA_S1_TEST_DSN (local vega_v2_panna_s1_test) are required")
class PannaS1Test(unittest.TestCase):
    db = None

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.outputs = []

    @classmethod
    def tearDownClass(cls):
        if cls.db is not None:
            # The documented rollback: the group's rights on core revoked first (GH278-al amended), else this base
            # would keep S1's grants and hold the server's login; the roles go unless another base grants to them.
            cls.db.execute((ROOT / "panna" / "ROLLBACK.sql").read_text())
            cls.db.close()
        cls.tmp.cleanup()

    def setUp(self):
        type(self).db = fresh(DSN, self.db)
        self.x = self.db.execute
        self.migrate(PASSWORD)
        self.work = Path(tempfile.mkdtemp(dir=self.tmp.name))
        self.collect = psycopg.connect(DSN, autocommit=True)
        self.addCleanup(self.collect.close)
        self.collect.execute("SET ROLE vega_collect")
        from vega.store import Store

        self.store = Store(self.collect)

    # --- the real writers -------------------------------------------------------------------------------------------
    def migrate(self, password=None, backend=ROOT, expect=0, online=False):
        env = {k: v for k, v in os.environ.items() if not k.startswith("V2_")}
        env.update(V2_MIGRATION_DATABASE_URL=DSN, PYTHONPATH=str(backend), PYTHONDONTWRITEBYTECODE="1")
        if password:
            env["V2_PANNA_PASSWORD"] = password
        done = subprocess.run([sys.executable, "-m", "vega.migrate", *(["--online"] if online else [])], cwd=backend,
                              env=env, capture_output=True, text=True, timeout=600)
        if expect is not None and done.returncode != expect:
            raise AssertionError(f"migrate exit {done.returncode}\n{done.stdout}\n{done.stderr}")
        return done

    def pitch_parent(self, *, events=True, home_goals_first_half=1, away_goals_first_half=1, date="2026-11-25",
                     home_name="Paris Saint-Germain", away_name="Roma", score=(2, 2), match=MATCH, ht_cells=None):
        """The parent as the worker writes it: the league, the match summary, then its events (the goal chronology)."""
        from vega.normalize import normalize_family

        self.store.save_references(normalize_family("league", {"id": LEAGUE, "name": "UEFA Champions League",
                                                               "country_code": "FRA", "season": "2026/2027"}))
        edition = self.x("SELECT id FROM core.competition_seasons ORDER BY id LIMIT 1").fetchone()[0]
        payload = {"id": match, "home_team": {"id": HOME, "name": home_name}, "away_team": {"id": AWAY, "name": away_name},
                   "status": "finished", "date": date, "time_utc": f"{date}T20:00:00Z", "score_home": score[0],
                   "score_away": score[1]}
        batch = normalize_family("summary", payload, match_id=match)
        if ht_cells is not None:
            batch.rows["core.matches"][0].update(home_score_ht=ht_cells[0], away_score_ht=ht_cells[1])
        (mid,) = self.store.save_matches(batch, edition)
        if events:
            goals = first_half_goals(home_goals_first_half, away_goals_first_half) + second_half_goals()
            self.store.save_family(mid, "events", normalize_family("events", {"match_id": match, "events": goals},
                                                                   match_id=match))
        return mid, edition

    def parent(self, mid):
        row = self.x("""SELECT home_score_ht, away_score_ht, revision, updated_at, source::text, status::text, home_score,
                               away_score, kickoff_at FROM core.matches WHERE id = %s""", (mid,)).fetchone()
        return dict(zip(("ht_home", "ht_away", "revision", "updated_at", "source", "status", "home", "away", "kickoff"), row))

    def versions(self, mid, edition):
        return dict(self.x("""SELECT resource_kind::text, version FROM ops.resource_versions
                              WHERE (resource_kind::text, resource_id) IN (('match', %s), ('competition_season', %s))""",
                           (mid, edition)).fetchall())

    def marks(self):
        return self.x("SELECT count(*) FROM ops.data_changes WHERE relation = 'core.matches'").fetchone()[0]

    # --- the Opta object, its frozen manifest and the scope manifest --------------------------------------------------
    def opta_file(self, rows, name="g1"):
        data = h.parquet_bytes(rows, h.FIXTURE_SCHEMA, row_group_size=3)
        path = self.work / f"{name}-{sha256(data)[:12]}.parquet"
        path.write_bytes(data)
        return path, data

    def frozen(self, path, data, issued=ISSUED[0], name="frozen"):
        entry = {"origin": "github", "container": RELEASE, "name": ASSET, "sha256": sha256(data), "bytes": len(data),
                 "path": str(path), "asset_id": 4242, "url": f"https://example.invalid/{RELEASE}/{ASSET}"}
        if issued:
            entry["updated_at"] = issued
        manifest = self.work / f"{name}-{sha256(data)[:12]}.json"
        manifest.write_text(json.dumps({"assets": [entry]}))
        return manifest

    def frozen_events(self, rows, name="events_UCL.parquet"):
        data = h.parquet_bytes(rows, h.EVENT_SCHEMA)
        path = self.work / f"{name}-{sha256(data)[:12]}"
        path.write_bytes(data)
        manifest = self.work / f"frozen-{name}-{sha256(data)[:12]}.json"
        manifest.write_text(json.dumps({"assets": [{"origin": "github", "container": RELEASE, "name": name, "sha256": sha256(data),
                                                    "bytes": len(data), "path": str(path)}]}))
        return manifest

    def before_186(self):
        """The base as before 186: the panna component rolled back, 186's tables and functions dropped, its record removed."""
        self.x((ROOT / "panna" / "ROLLBACK.sql").read_text())
        self.x("DROP TABLE core.match_score_selections, core.match_score_observations, core.observation_batches CASCADE")
        for (signature,) in self.x("""SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace = 'core'::regnamespace
                                       AND (p.proname LIKE 'score\\_%' OR p.proname IN ('publish_score_pair', 'revert_score_selection'))""").fetchall():
            self.x(f"DROP FUNCTION {signature}")
        self.x("DELETE FROM ops.schema_migrations WHERE version = '186_match_score_observations.sql'")

    def target(self, mid, edition, **changes):
        teams = dict(self.x("SELECT provider_key, entity_id FROM core.provider_ids WHERE entity_type = 'team' "
                            "AND provider = 'pitchapi'").fetchall())
        found = self.x("SELECT season_id, match_date::text, status::text, source::text FROM core.matches WHERE id = %s",
                       (mid,)).fetchone() if mid else (2026, "2026-11-25", "finished", "pitchapi")
        public = self.x("SELECT provider_key FROM core.provider_ids WHERE entity_type = 'match' AND provider = 'pitchapi' "
                        "AND entity_id = %s AND is_current", (mid,)).fetchone()
        body = {"match_id": mid, "public_id": public[0] if public else None, "season_id": found[0],
                "competition_season_id": edition, "home_team_id": teams.get(HOME), "away_team_id": teams.get(AWAY),
                "match_date": found[1], "status": found[2], "parent_source": found[3],
                "publish_columns": ["core.matches.home_score_ht", "core.matches.away_score_ht"]}
        body.update(changes)
        return body

    def scope(self, rows, data, mid, edition, key=KEY, issued=ISSUED[0], max_rows=1, ordinals=None, keys=None,
              match_ids=None, packet_rows=None, digest=None, target=None):
        ords = [i for i, r in enumerate(rows) if r["match_id"] == key] if ordinals is None else ordinals
        body = {
            "as_of_utc": AS_OF,
            "scope": {"asset": ASSET, "published_asset_sha256": "sha256:" + (digest or sha256(data)),
                      "source_ordinals_zero_based": ords, "source_match_keys": keys or [key],
                      "match_ids": match_ids or [mid], "maximum_fixture_rows": max_rows,
                      "packet_sha256": "sha256:" + sha256(packet(packet_rows if packet_rows is not None
                                                                  else [rows[i] for i in ords if i < len(rows)]))},
            "file": "fixture.ndjson",
            "source": {"fact_origin": "opta", "distributor": "pannadata", "release": RELEASE, "asset": ASSET,
                       "sha256": "sha256:" + sha256(data), "release_asset_updated_at": issued, "bytes": len(data)},
            "target": target if target is not None else self.target(mid, edition),
        }
        path = self.work / f"scope-{len(list(self.work.glob('scope-*')))}.json"
        path.write_text(json.dumps(body))
        return path

    # --- the CLI ------------------------------------------------------------------------------------------------------
    def login_dsn(self, port=None):
        url = urlparse(DSN)
        netloc = f"vega_v2_panna:{PASSWORD}@{url.hostname if port is None else '127.0.0.1'}:{port or url.port or 5432}"
        return urlunparse(url._replace(netloc=netloc))

    def cli(self, *args, expect=0, dsn=None, timeout=300):
        env = {k: v for k, v in os.environ.items() if not k.startswith("V2_")}
        env.update(PYTHONPATH=str(ROOT), PYTHONDONTWRITEBYTECODE="1", V2_PANNA_DATABASE_URL=dsn or self.login_dsn())
        done = subprocess.run([sys.executable, "-m", "panna", *args], cwd=ROOT, env=env, capture_output=True, text=True,
                              timeout=timeout)
        self.outputs.append(done.stdout + done.stderr)
        if expect is not None and done.returncode != expect:
            raise AssertionError(f"exit {done.returncode}, expected {expect}\n{done.stdout}\n{done.stderr}")
        return done

    def apply(self, scope, manifest, expect=0, dsn=None, as_of=AS_OF):
        return self.cli("pilot", "apply", "--scope", str(scope), "--manifest", str(manifest), "--as-of", as_of,
                        "--reviewer", "test:s1", "--scratch", str(self.work / "scratch"), expect=expect, dsn=dsn)

    def lines(self, done):
        return [json.loads(line) for line in done.stdout.splitlines() if line.strip().startswith("{")]

    def event(self, done, name):
        found = [line for line in self.lines(done) if line.get("event") == name]
        self.assertTrue(found, f"no {name} line in\n{done.stdout}\n{done.stderr}")
        return found[-1]

    # --- reads -------------------------------------------------------------------------------------------------------
    def observations(self):
        return self.x("""SELECT origin::text, source_match_key, score_phase, revision_no, home_goals, away_goals, home_lexeme,
                                away_lexeme, source_dataset, batch_id IS NOT NULL, effective_at
                         FROM core.match_score_observations ORDER BY id""").fetchall()

    def selection(self, mid):
        return self.x("""SELECT o.origin::text, o.home_goals, o.away_goals, s.rule_version, o.effective_at
                         FROM core.match_score_selections s JOIN core.match_score_observations o ON o.id = s.observation_id
                         WHERE s.match_id = %s AND s.score_phase = 'half_time'""", (mid,)).fetchone()

    def application(self):
        rows = self.x("""SELECT status, reason_code, target_match_id, source_rows, target_rows, rule_version, target_relation,
                                published_at IS NOT NULL FROM panna.canonical_applications ORDER BY id""").fetchall()
        return rows

    def review(self):
        return self.x("""SELECT decision, chosen_id, candidate_ids, evidence_code, is_current
                         FROM panna.identity_reviews ORDER BY id""").fetchall()

    def opta_link(self, mid=None):
        rows = self.x("SELECT provider_key, entity_id FROM core.provider_ids WHERE entity_type = 'match' AND provider = 'opta'"
                      ).fetchall()
        return rows

    def count(self, sql, *params):
        return self.x(sql, params or None).fetchone()[0]

    def nothing_written(self):
        for table in ("core.observation_batches", "core.match_score_observations", "core.match_score_selections",
                      "panna.canonical_applications", "panna.identity_reviews", "panna.segments", "panna.receipts"):
            self.assertEqual(self.count(f"SELECT count(*) FROM {table}"), 0, table)
        self.assertEqual(self.opta_link(), [])

    def normal(self, ht=("1", "1"), final=("2", "2"), **parent):
        mid, edition = self.pitch_parent(**parent)
        rows = others(2) + [opta_row(ht=ht, final=final)] + others(4, "y")[2:]
        path, data = self.opta_file(rows)
        return mid, edition, rows, data, self.frozen(path, data), path

    # --- GH278.S1-a, b, t: the normal path, its scope, a replay, the output --------------------------------------------
    def test_GH278_S1_a_b_t_publishes_the_pair_once_on_the_pitch_parent(self):
        mid, edition, rows, data, manifest, _ = self.normal()
        before, versions, marks = self.parent(mid), self.versions(mid, edition), self.marks()
        self.assertEqual((before["ht_home"], before["ht_away"], before["source"]), (None, None, "pitchapi"))
        done = self.apply(self.scope(rows, data, mid, edition), manifest)
        line = self.event(done, "application")
        self.assertEqual((line["status"], line["reason"]), ("published", None))
        self.assertEqual(line["half_time"], [1, 1])
        after = self.parent(mid)
        self.assertEqual((after["ht_home"], after["ht_away"]), (1, 1))
        self.assertEqual(after["revision"], before["revision"] + 1)
        self.assertEqual((after["home"], after["away"], after["source"], after["status"]), (2, 2, "pitchapi", "finished"))
        now = self.versions(mid, edition)
        for kind in ("competition_season", "match"):
            self.assertEqual(now[kind], versions.get(kind, 0) + 1, kind)
        self.assertGreater(self.marks(), marks)
        # The three observations: Opta's two pairs and the parent's former cells under other.
        obs = self.observations()
        self.assertIn(("opta", KEY, "half_time", 1, 1, 1, "1", "1", "opta_fixtures", True), [o[:10] for o in obs])
        self.assertIn(("opta", KEY, "final_reported", 1, 2, 2, "2", "2", "opta_fixtures", True), [o[:10] for o in obs])
        self.assertIn(("other", str(mid), "half_time", 1, None, None, None, None, "core.matches", False), [o[:10] for o in obs])
        self.assertEqual(len(obs), 3)
        issued = [o[10] for o in obs if o[0] == "opta"]
        self.assertTrue(all(i is not None and i.isoformat().startswith("2026-11-20T10:00:00") for i in issued), issued)
        self.assertEqual(self.selection(mid)[:4], ("opta", 1, 1, RULE))
        self.assertEqual(self.opta_link(), [(KEY, mid)])
        self.assertEqual(self.application(), [("published", None, mid, 1, 1, RULE,
                                               "core.matches(home_score_ht,away_score_ht)", True)])
        decision, chosen, candidates, code, current = self.review()[0]
        self.assertEqual((decision, chosen, candidates, current), ("linked", mid, [mid], True))
        batch = self.x("SELECT distributor, object_name, member_path, encode(content_sha256, 'hex'), issued_at IS NOT NULL "
                       "FROM core.observation_batches").fetchall()
        self.assertEqual(batch, [("pannadata", ASSET, None, sha256(data), True)])
        # The read API's view, under the read role.
        reader = psycopg.connect(DSN, autocommit=True)
        self.addCleanup(reader.close)
        reader.execute("SET ROLE vega_read")
        self.assertEqual(reader.execute("SELECT home_score_ht, away_score_ht FROM api.match_list WHERE match_id = %s",
                                        (mid,)).fetchone(), (1, 1))
        # GH278.S1-b: the scoped load wrote the key only.
        self.assertEqual(self.count("SELECT count(*) FROM panna.segments"), 1)
        self.assertEqual(self.count("SELECT count(*) FROM panna_data.opta_fixtures"), 1)
        self.assertEqual(self.x("SELECT key, first_row, row_count FROM panna.manifest").fetchall(),
                         [(KEY, rows.index(next(r for r in rows if r["match_id"] == KEY)), 1)])
        self.assertEqual(self.x("SELECT key, outcome FROM panna.scope").fetchall(), [(KEY, "eligible")])
        receipt = self.x("SELECT encode(sha256, 'hex'), source_rows FROM panna.receipts").fetchone()
        self.assertEqual(receipt, (sha256(data), len(rows)))
        outcomes = self.x("SELECT outcomes FROM panna.loads").fetchone()[0]
        self.assertEqual(outcomes, {"eligible": 1, "out_of_scope": len(rows) - 1})
        plan = self.x("SELECT plan FROM panna.runs").fetchone()[0]
        self.assertEqual(plan["scope"]["keys"], [KEY])
        self.assertEqual(plan["scope"]["match_ids"], [mid])
        # A replay: nothing more of the business, the same receipt.
        settled, marks = self.parent(mid), self.marks()
        again = self.apply(self.scope(rows, data, mid, edition), manifest)
        self.assertEqual(self.event(again, "application")["status"], "published")
        self.assertFalse(self.event(again, "application")["changed"])
        self.assertEqual(self.parent(mid), settled)
        self.assertEqual(self.versions(mid, edition), now)
        self.assertEqual(self.marks(), marks)
        self.assertEqual(len(self.observations()), 3)
        self.assertEqual(len(self.review()), 1)
        self.assertEqual(len(self.application()), 1)
        # GH278.S1-t: no password, no credential URL, in anything printed.
        for output in self.outputs:
            self.assertNotIn(PASSWORD, output)
            self.assertNotIn("postgresql://", output)

    # --- GH278.S1-c: a scope manifest that does not fit the object -------------------------------------------------------
    def test_GH278_S1_c_a_scope_that_does_not_fit_is_refused_before_any_write(self):
        mid, edition, rows, data, manifest, _ = self.normal()
        ordinal = next(i for i, r in enumerate(rows) if r["match_id"] == KEY)
        cases = {
            "SCOPE_ASSET_DIGEST": dict(digest="0" * 64),
            "SCOPE_KEY_ABSENT": dict(key="opta-key-not-in-file", ordinals=[ordinal]),
            "SCOPE_ORDINALS": dict(ordinals=[ordinal + 1]),
            "SCOPE_PACKET_DIGEST": dict(packet_rows=[dict(rows[ordinal], home_score_ht="9")]),
            "SCOPE_CARDINALITY": dict(keys=[KEY, "opta-other-x-0"]),
            "SCOPE_MATCHES": dict(match_ids=[mid, mid + 1]),
            # A target without a field the approval saw: no stale check could hold it (added before its code).
            "SCOPE_TARGET": dict(target={k: v for k, v in self.target(mid, edition).items() if k != "status"}),
        }
        for code, change in cases.items():
            with self.subTest(code):
                done = self.apply(self.scope(rows, data, mid, edition, **change), manifest, expect=2)
                self.assertIn(code, done.stdout)
                self.nothing_written()
        # Two rows of the key where the scope allows one.
        twice = rows + [dict(rows[ordinal])]
        path, data2 = self.opta_file(twice, "twice")
        done = self.apply(self.scope(twice, data2, mid, edition), self.frozen(path, data2), expect=2)
        self.assertIn("SCOPE_MAX_ROWS", done.stdout)
        self.nothing_written()
        self.assertEqual((self.parent(mid)["ht_home"], self.parent(mid)["ht_away"]), (None, None))

    # --- GH278.S1-d: the Pitch writer keeps the selected pair ---------------------------------------------------------
    def test_GH278_S1_d_pitch_after_opta_keeps_the_pair_and_opta_after_pitch_changes_nothing(self):
        from vega.normalize import normalize_family

        # Without a selection, a Pitch row carrying the cells writes them (the writer as before).
        mid, edition = self.pitch_parent(ht_cells=(0, 0))
        self.assertEqual((self.parent(mid)["ht_home"], self.parent(mid)["ht_away"]), (0, 0))
        rows = [opta_row()] + others(3)
        path, data = self.opta_file(rows)
        manifest = self.frozen(path, data)
        self.apply(self.scope(rows, data, mid, edition), manifest)
        self.assertEqual((self.parent(mid)["ht_home"], self.parent(mid)["ht_away"]), (1, 1))
        revision = self.parent(mid)["revision"]
        # Pitch → (Opta) → Pitch: its row carries other cells and a new kick-off.
        payload = {"id": MATCH, "home_team": {"id": HOME, "name": "Paris Saint-Germain"},
                   "away_team": {"id": AWAY, "name": "Roma"}, "status": "finished", "date": "2026-11-25",
                   "time_utc": "2026-11-25T20:45:00Z", "score_home": 2, "score_away": 2}
        batch = normalize_family("summary", payload, match_id=MATCH)
        batch.rows["core.matches"][0].update(home_score_ht=0, away_score_ht=3)
        self.store.save_matches(batch, edition)
        after = self.parent(mid)
        self.assertEqual((after["ht_home"], after["ht_away"]), (1, 1))
        self.assertEqual(after["kickoff"].isoformat(), "2026-11-25T20:45:00+00:00")
        self.assertEqual(after["revision"], revision + 1)  # the kick-off, not the governed cells
        # The same Pitch row again: nothing changes (the governed cells are not compared).
        self.store.save_matches(batch, edition)
        self.assertEqual(self.parent(mid)["revision"], revision + 1)
        # Opta again after Pitch: the same receipt, no business change.
        settled = self.parent(mid)
        done = self.apply(self.scope(rows, data, mid, edition), manifest)
        self.assertFalse(self.event(done, "application")["changed"])
        self.assertEqual(self.parent(mid), settled)

    # --- GH278.S1-e: the pair already there ---------------------------------------------------------------------------
    def test_GH278_S1_e_an_identical_pair_gets_its_provenance_without_a_revision(self):
        mid, edition, rows, data, manifest, _ = self.normal(ht_cells=(1, 1))
        before, versions, marks = self.parent(mid), self.versions(mid, edition), self.marks()
        done = self.apply(self.scope(rows, data, mid, edition), manifest)
        self.assertEqual(self.event(done, "application")["status"], "unchanged")
        self.assertEqual(self.parent(mid), before)
        self.assertEqual(self.versions(mid, edition), versions)
        self.assertEqual(self.marks(), marks)
        self.assertEqual(self.selection(mid)[:3], ("opta", 1, 1))
        self.assertEqual([o[0] for o in self.observations()].count("other"), 0)
        self.assertEqual(self.application()[0][:2], ("unchanged", None))

    # --- GH278.S1-f: another valid pair replaced, captured -------------------------------------------------------------
    def test_GH278_S1_f_opta_replaces_another_valid_pair_and_keeps_it_readable(self):
        mid, edition, rows, data, manifest, _ = self.normal(ht_cells=(0, 2))
        revision = self.parent(mid)["revision"]
        self.apply(self.scope(rows, data, mid, edition), manifest)
        after = self.parent(mid)
        self.assertEqual((after["ht_home"], after["ht_away"], after["revision"]), (1, 1, revision + 1))
        captured = [o for o in self.observations() if o[0] == "other"]
        self.assertEqual([o[:9] for o in captured], [("other", str(mid), "half_time", 1, 0, 2, "0", "2", "core.matches")])
        self.assertEqual(self.selection(mid)[0], "opta")

    # --- GH278.S1-g: invalid or incomplete lexemes ---------------------------------------------------------------------
    def test_GH278_S1_g_an_invalid_pair_is_kept_and_never_published(self):
        mid, edition = self.pitch_parent()
        for i, ht in enumerate((("1", ""), ("x", "1"), ("1000", "1"), (None, "1"))):
            with self.subTest(ht=ht):
                rows = [opta_row(ht=ht)] + others(2, f"g{i}")
                path, data = self.opta_file(rows, f"g{i}")
                done = self.apply(self.scope(rows, data, mid, edition, issued=ISSUED[0]),
                                  self.frozen(path, data, issued=ISSUED[0]), expect=1)
                line = self.event(done, "application")
                self.assertEqual((line["status"], line["reason"]), ("observed", "INVALID_PAIR"))
                self.assertIsNone(self.selection(mid))
                self.assertEqual((self.parent(mid)["ht_home"], self.parent(mid)["ht_away"]), (None, None))
        kept = [o for o in self.observations() if o[0] == "opta" and o[2] == "half_time"]
        self.assertIn(("1", ""), [(o[6], o[7]) for o in kept])
        self.assertTrue(all(o[4] is None or o[5] is None for o in kept))
        # A later valid generation publishes.
        rows = [opta_row()] + others(2, "valid")
        path, data = self.opta_file(rows, "valid")
        done = self.apply(self.scope(rows, data, mid, edition, issued=ISSUED[1]), self.frozen(path, data, issued=ISSUED[1]))
        self.assertEqual(self.event(done, "application")["status"], "published")
        self.assertEqual((self.parent(mid)["ht_home"], self.parent(mid)["ht_away"]), (1, 1))

    # --- GH278.S1-h: rows of the key that disagree, or repeat ----------------------------------------------------------
    def test_GH278_S1_h_contradictory_rows_publish_nothing_identical_rows_publish_once(self):
        mid, edition = self.pitch_parent()
        rows = [opta_row(), opta_row(ht=("2", "1"))] + others(2)
        path, data = self.opta_file(rows, "dup")
        done = self.apply(self.scope(rows, data, mid, edition, max_rows=2), self.frozen(path, data), expect=1)
        line = self.event(done, "application")
        self.assertEqual((line["status"], line["reason"]), ("conflict", "DUPLICATE_SOURCE_ROWS"))
        self.assertEqual(self.count("SELECT count(*) FROM core.match_score_observations"), 0)
        self.assertIsNone(self.selection(mid))
        self.assertEqual(self.count("SELECT count(*) FROM panna_data.opta_fixtures"), 2)  # both rows, their ordinals
        rows = [opta_row(), opta_row()] + others(2, "same")
        path, data = self.opta_file(rows, "same")
        done = self.apply(self.scope(rows, data, mid, edition, max_rows=2, issued=ISSUED[1]),
                          self.frozen(path, data, issued=ISSUED[1]))
        self.assertEqual(self.event(done, "application")["status"], "published")
        self.assertEqual(self.count("SELECT count(*) FROM core.match_score_observations WHERE origin = 'opta' "
                                    "AND score_phase = 'half_time'"), 1)
        self.assertEqual(self.x("SELECT row_count FROM panna.manifest m JOIN panna.loads l USING (load_id) "
                                "ORDER BY l.load_id DESC LIMIT 1").fetchone()[0], 2)

    # --- GH278.S1-i: the protections -----------------------------------------------------------------------------------
    def test_GH278_S1_i_a_pair_above_the_final_or_against_the_chronology_is_not_published(self):
        cases = (
            ("conflict", "HALF_TIME_ABOVE_FINAL", dict(ht=("3", "1")), {}),
            ("conflict", "CHRONOLOGY_CONTRADICTS", {}, dict(home_goals_first_half=2, away_goals_first_half=0)),
            ("observed", "CHRONOLOGY_ABSENT", {}, dict(events=False)),
        )
        for status, reason, source, parent in cases:
            with self.subTest(reason):
                type(self).db = fresh(DSN, self.db)
                self.x = self.db.execute
                self.migrate(PASSWORD)
                self.collect.close()
                self.collect = psycopg.connect(DSN, autocommit=True)
                self.collect.execute("SET ROLE vega_collect")
                from vega.store import Store

                self.store = Store(self.collect)
                mid, edition, rows, data, manifest, _ = self.normal(**source, **parent)
                revision = self.parent(mid)["revision"]
                done = self.apply(self.scope(rows, data, mid, edition), manifest, expect=1)
                line = self.event(done, "application")
                self.assertEqual((line["status"], line["reason"]), (status, reason))
                self.assertIsNone(self.selection(mid))
                self.assertEqual(self.parent(mid)["revision"], revision)
                self.assertEqual((self.parent(mid)["ht_home"], self.parent(mid)["ht_away"]), (None, None))

    # --- GH278.S1-j: identity --------------------------------------------------------------------------------------------
    def test_GH278_S1_j_identity_is_proven_without_the_arbitrated_pair(self):
        from vega.normalize import normalize_family

        rows = [opta_row()] + others(2)
        path, data = self.opta_file(rows)
        manifest = self.frozen(path, data)
        # No anchor yet: the fact is kept on its key.
        self.store.save_references(normalize_family("league", {"id": LEAGUE, "name": "UEFA Champions League",
                                                               "country_code": "FRA", "season": "2026/2027"}))
        edition = self.x("SELECT id FROM core.competition_seasons ORDER BY id LIMIT 1").fetchone()[0]
        missing = 987654
        absent = dict(match_id=missing, public_id=None, season_id=2026, competition_season_id=edition, home_team_id=None,
                      away_team_id=None, match_date="2026-11-25", status="finished", parent_source="pitchapi")
        done = self.apply(self.scope(rows, data, missing, edition, target=absent), manifest, expect=1)
        line = self.event(done, "application")
        self.assertEqual((line["status"], line["identity"]["decision"]), ("pending_identity", "no_candidate"))
        self.assertEqual(len([o for o in self.observations() if o[0] == "opta"]), 2)
        self.assertEqual(self.opta_link(), [])
        # Pitch creates the parent; the same fact is adopted on its id.
        mid, edition = self.pitch_parent()
        done = self.apply(self.scope(rows, data, mid, edition), manifest)
        self.assertEqual(self.event(done, "application")["status"], "published")
        self.assertEqual(len([o for o in self.observations() if o[0] == "opta"]), 2)
        self.assertEqual(self.application()[0][:3], ("published", None, mid))
        self.assertEqual(len(self.application()), 1)
        self.assertEqual([r[0] for r in self.review()], ["no_candidate", "linked"])
        self.assertEqual([r[4] for r in self.review()], [False, True])

    def test_GH278_S1_j_an_unproven_or_ambiguous_identity_links_nothing(self):
        from vega.normalize import normalize_family

        cases = (
            ("rejected", "DATE_DIFFERS", dict(date="2026-11-26")),
            ("rejected", "TEAMS_DIFFER", dict(away_name="Lazio")),
            ("rejected", "FINAL_DIFFERS", dict(score=(3, 2))),
        )
        for decision, code, parent in cases:
            with self.subTest(code):
                type(self).db = fresh(DSN, self.db)
                self.x = self.db.execute
                self.migrate(PASSWORD)
                self.collect.close()
                self.collect = psycopg.connect(DSN, autocommit=True)
                self.collect.execute("SET ROLE vega_collect")
                from vega.store import Store

                self.store = Store(self.collect)
                mid, edition = self.pitch_parent(**parent)
                rows = [opta_row()] + others(2)
                path, data = self.opta_file(rows)
                done = self.apply(self.scope(rows, data, mid, edition), self.frozen(path, data), expect=1)
                line = self.event(done, "application")
                self.assertEqual((line["status"], line["identity"]["decision"], line["identity"]["evidence_code"]),
                                 ("pending_identity" if decision != "rejected" else "quarantined", decision, code))
                self.assertEqual(self.opta_link(), [])
                self.assertIsNone(self.selection(mid))
        # Another match of the same two teams that day: ambiguous.
        type(self).db = fresh(DSN, self.db)
        self.x = self.db.execute
        self.migrate(PASSWORD)
        self.collect.close()
        self.collect = psycopg.connect(DSN, autocommit=True)
        self.collect.execute("SET ROLE vega_collect")
        from vega.store import Store

        self.store = Store(self.collect)
        mid, edition = self.pitch_parent()
        twin, _ = self.pitch_parent(match="m_s1twin", events=False)
        rows = [opta_row()] + others(2)
        path, data = self.opta_file(rows)
        done = self.apply(self.scope(rows, data, mid, edition), self.frozen(path, data), expect=1)
        identity = self.event(done, "application")["identity"]
        self.assertEqual(identity["decision"], "ambiguous")
        self.assertEqual(sorted(identity["candidate_ids"]), sorted([mid, twin]))
        self.assertEqual(self.opta_link(), [])
        # The key already linked to another match: that link decides first, whatever else matches.
        other, _ = self.pitch_parent(match="m_s1oth0", date="2026-11-01", events=False)
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match', 'opta', %s, %s)",
               (KEY, other))
        done = self.apply(self.scope(rows, data, mid, edition), self.frozen(path, data), expect=1)
        self.assertEqual(self.event(done, "application")["identity"]["evidence_code"], "KEY_LINKED_ELSEWHERE")
        self.assertIsNone(self.selection(mid))

    # --- GH278.S1-k: a parent of a snapshot source ----------------------------------------------------------------------
    def test_GH278_S1_k_a_snapshot_parent_is_never_linked_and_its_next_snapshot_runs(self):
        from vega.sources import snapshot

        # A Pitch match of another day gives the edition and the two teams.
        mid, edition = self.pitch_parent(match="m_s1unus", date="2026-10-01", events=False)
        teams = dict(self.x("SELECT provider_key, entity_id FROM core.provider_ids WHERE entity_type='team' AND provider='pitchapi'"))
        values = {"competition_season_id": edition, "season_id": 2026, "source": "open_matchday", "status": "finished",
                  "match_date": "2026-11-25", "home_team_id": teams[HOME], "away_team_id": teams[AWAY],
                  "home_team_name": "Paris Saint-Germain", "away_team_name": "Roma", "home_score": 2, "away_score": 2,
                  "archive_position": 0}
        with self.collect.transaction():
            owned, _ = snapshot.write(self.collect, "open_matchday", "om-key-1", values, None)
        rows = [opta_row()] + others(2)
        path, data = self.opta_file(rows)
        target = self.target(owned, edition, parent_source="open_matchday", public_id=None)
        done = self.apply(self.scope(rows, data, owned, edition, target=target), self.frozen(path, data), expect=1)
        line = self.event(done, "application")
        self.assertEqual((line["status"], line["reason"]), ("quarantined", "PARENT_OWNED_BY_SNAPSHOT"))
        self.assertEqual(self.review()[0][:2], ("rejected", None))
        self.assertEqual(self.review()[0][3], "PARENT_OWNED_BY_SNAPSHOT")
        self.assertEqual(self.opta_link(), [])
        self.assertEqual(len([o for o in self.observations() if o[0] == "opta"]), 2)
        # The next Open Matchday snapshot writes its parent as before (no foreign key on it).
        found = snapshot.stored(self.collect, "open_matchday", edition)["om-key-1"]
        with self.collect.transaction():
            _, outcome = snapshot.write(self.collect, "open_matchday", "om-key-1", dict(values, home_score=3), found)
        self.assertEqual(outcome, "updated")

    # --- GH278.S1-l: an approval older than the parent -------------------------------------------------------------------
    def test_GH278_S1_l_a_stale_approval_changes_nothing_of_the_match(self):
        mid, edition, rows, data, manifest, _ = self.normal()
        # (review, m5) an expected NULL holds only against NULL: the parent has a public id.
        for change in (dict(status="postponed"), dict(competition_season_id=edition + 1000), dict(public_id=None)):
            with self.subTest(change=change):
                before = self.parent(mid)
                done = self.apply(self.scope(rows, data, mid, edition, target=self.target(mid, edition, **change)),
                                  manifest, expect=1)
                line = self.event(done, "application")
                self.assertEqual((line["status"], line["reason"]), ("quarantined", "STALE_APPROVAL"))
                self.assertEqual(self.parent(mid), before)
                self.assertEqual(self.opta_link(), [])
                self.assertIsNone(self.selection(mid))
        # (review, M1.2) outside the CLI, the login gives panna.apply_score_segment an approval lacking a field, or naming
        # another match: refused by the database, nothing written.
        load = self.count("SELECT max(load_id) FROM panna.loads WHERE status = 'complete'")
        login = psycopg.connect(self.login_dsn(), autocommit=True)
        self.addCleanup(login.close)
        before, batches = self.parent(mid), self.count("SELECT count(*) FROM core.observation_batches")
        for approval in ({}, {k: v for k, v in self.target(mid, edition).items() if k != "season_id"},
                         dict(self.target(mid, edition), match_id=mid + 1)):
            with self.subTest(approval=sorted(approval)):
                with self.assertRaises(psycopg.errors.InvalidParameterValue):
                    login.execute("SELECT panna.apply_score_segment(%s, %s, %s, %s, %s, %s, %s)",
                                  (load, KEY, mid, Jsonb(approval), RULE, "test:s1", None))
                self.assertEqual(self.parent(mid), before)
                self.assertIsNone(self.selection(mid))
                self.assertEqual(self.opta_link(), [])
        # (review) `pilot check` with the database: the same verdicts, read only; the approved parent's verdict publishes.
        for change, code, status in ((dict(public_id=None), 1, "quarantined"), (dict(status="postponed"), 1, "quarantined"),
                                     ({}, 0, "published")):
            with self.subTest(check=change):
                done = self.cli("pilot", "check", "--scope", str(self.scope(rows, data, mid, edition,
                                                                             target=self.target(mid, edition, **change))),
                                "--manifest", str(manifest), "--as-of", AS_OF, "--scratch", str(self.work / "scratch"), expect=code)
                preview = self.event(done, "preview")
                self.assertEqual(preview["status"], status)
                self.assertEqual(preview["reason"], "STALE_APPROVAL" if code else None)
        self.assertEqual(self.parent(mid), before)
        self.assertEqual(self.count("SELECT count(*) FROM core.observation_batches"), batches)
        self.assertIsNone(self.selection(mid))

    # --- GH278.S1-m: generations -----------------------------------------------------------------------------------------
    def test_GH278_S1_m_a_later_correction_wins_a_late_older_one_does_not(self):
        mid, edition = self.pitch_parent(home_goals_first_half=1, away_goals_first_half=1)
        revision = self.parent(mid)["revision"]
        seen = []

        def generation(ht, issued, tag, expect=0, same=None):
            rows, path, data = same or ([opta_row(ht=ht)] + others(2, tag), None, None)
            if path is None:
                path, data = self.opta_file(rows, tag)
            done = self.apply(self.scope(rows, data, mid, edition, issued=issued),
                              self.frozen(path, data, issued=issued, name=f"frozen-{tag}"), expect=expect)
            seen.append(self.event(done, "application"))
            return rows, path, data

        # A (t1), B (t2) a correction, then A's very bytes published again (t3), the correction reverted: three
        # activations of two contents (review, M2), three observations, the selection follows A, B, A.
        # The parent's chronology says 1–1; B (2–0) contradicts it, so B's chronology is changed to 2–0 for that step.
        first = generation(("1", "1"), ISSUED[1], "a1")
        self.assertEqual(self.selection(mid)[1:3], (1, 1))
        self.x("UPDATE core.match_events SET team_id = (SELECT home_team_id FROM core.matches WHERE id = %s) "
               "WHERE match_id = %s AND period = 'first_half'", (mid, mid))
        generation(("2", "0"), ISSUED[2], "b2")
        self.assertEqual(self.selection(mid)[1:3], (2, 0))
        self.x("UPDATE core.match_events SET team_id = CASE WHEN minute < 20 THEN (SELECT away_team_id FROM core.matches "
               "WHERE id = %s) ELSE team_id END WHERE match_id = %s AND period = 'first_half'", (mid, mid))
        generation(None, ISSUED[3], "a3", same=first)
        self.assertEqual(self.selection(mid)[1:3], (1, 1))
        halves = [o for o in self.observations() if o[0] == "opta" and o[2] == "half_time"]
        self.assertEqual([(o[3], o[6], o[7]) for o in halves], [(1, "1", "1"), (2, "2", "0"), (3, "1", "1")])
        self.assertEqual(self.parent(mid)["revision"], revision + 3)
        self.assertEqual([a[0] for a in self.application()].count("superseded"), 1)
        # An older generation received late (t0) does not win.
        generation(("0", "0"), ISSUED[0], "old", expect=1)
        self.assertEqual((seen[-1]["status"], seen[-1]["reason"]), ("superseded", "OLDER_GENERATION"))
        self.assertEqual(self.selection(mid)[1:3], (1, 1))
        # (review) A generation dated after the database's clock would outrank every later real one: not ordered.
        generation(("0", "1"), "2099-01-01T00:00:00Z", "future", expect=1)
        self.assertEqual((seen[-1]["status"], seen[-1]["reason"]), ("quarantined", "GENERATION_NOT_ORDERABLE"))
        self.assertEqual(len([o for o in self.observations() if o[0] == "opta" and o[2] == "half_time"]), 4)
        self.assertEqual(self.selection(mid)[1:3], (1, 1))
        # A generation without an issue instant once the key has observations cannot be ordered.
        rows = [opta_row(ht=("0", "1"))] + others(2, "undated")
        path, data = self.opta_file(rows, "undated")
        done = self.apply(self.scope(rows, data, mid, edition, issued=None), self.frozen(path, data, issued=None), expect=1)
        line = self.event(done, "application")
        self.assertEqual((line["status"], line["reason"]), ("quarantined", "GENERATION_NOT_ORDERABLE"))
        self.assertEqual(len([o for o in self.observations() if o[0] == "opta" and o[2] == "half_time"]), 4)

    def test_GH278_S1_m_a_later_activation_of_the_same_pair_outranks_a_late_older_one(self):
        # (review, M2) A (t1), A' with the same pair and other bytes (t3), then B dated t2 received late: B is older.
        mid, edition = self.pitch_parent()
        seen = []
        for ht, issued, tag, expect in ((("1", "1"), ISSUED[1], "a1", 0), (("1", "1"), ISSUED[3], "a3", 0)):
            rows = [opta_row(ht=ht)] + others(2, tag)
            path, data = self.opta_file(rows, tag)
            seen.append(self.event(self.apply(self.scope(rows, data, mid, edition, issued=issued),
                                              self.frozen(path, data, issued=issued, name=f"frozen-{tag}"), expect=expect),
                                   "application"))
        self.assertEqual([(a["status"], a["changed"]) for a in seen], [("published", True), ("published", False)])
        # B's chronology made to agree, so that only its date can keep it out.
        self.x("UPDATE core.match_events SET team_id = (SELECT home_team_id FROM core.matches WHERE id = %s) "
               "WHERE match_id = %s AND period = 'first_half'", (mid, mid))
        rows = [opta_row(ht=("2", "0"))] + others(2, "b2")
        path, data = self.opta_file(rows, "b2")
        late = self.event(self.apply(self.scope(rows, data, mid, edition, issued=ISSUED[2]),
                                     self.frozen(path, data, issued=ISSUED[2], name="frozen-b2"), expect=1), "application")
        self.assertEqual((late["status"], late["reason"]), ("superseded", "OLDER_GENERATION"))
        self.assertEqual(self.selection(mid)[1:3], (1, 1))
        self.assertEqual((self.parent(mid)["ht_home"], self.parent(mid)["ht_away"]), (1, 1))
        halves = [o for o in self.observations() if o[0] == "opta" and o[2] == "half_time"]
        self.assertEqual([(o[3], o[6], o[7], o[10].isoformat()[:19]) for o in halves],
                         [(1, "1", "1", ISSUED[1][:19]), (2, "1", "1", ISSUED[3][:19]), (3, "2", "0", ISSUED[2][:19])])

    # --- GH278.S1-n: the targeted revert ---------------------------------------------------------------------------------
    def test_GH278_S1_n_revert_restores_the_captured_cells_while_owner(self):
        mid, edition, rows, data, manifest, _ = self.normal(ht_cells=(0, 2))
        done = self.apply(self.scope(rows, data, mid, edition), manifest)
        application = self.event(done, "application")["id"]
        revision = self.parent(mid)["revision"]
        reverted = self.cli("pilot", "revert", "--application", str(application), "--reviewer", "test:s1")
        line = self.event(reverted, "revert")
        self.assertEqual((line["status"], line["restored"]), ("reverted", [0, 2]))
        self.assertEqual(line["reviewer"], "test:s1")  # (review, m7) the request's reviewer is in its receipt
        after = self.parent(mid)
        self.assertEqual((after["ht_home"], after["ht_away"], after["revision"]), (0, 2, revision + 1))
        self.assertIsNone(self.selection(mid))
        self.assertEqual(self.application()[0][0], "reverted")
        # Applied again: published again.
        done = self.apply(self.scope(rows, data, mid, edition), manifest)
        self.assertEqual(self.event(done, "application")["status"], "published")
        self.assertEqual((self.parent(mid)["ht_home"], self.parent(mid)["ht_away"]), (1, 1))
        # A later correction (2–0, the chronology corrected with it) supersedes the first application; reverting that
        # one changes nothing of the match.
        self.x("UPDATE core.match_events SET team_id = (SELECT home_team_id FROM core.matches WHERE id = %s) "
               "WHERE match_id = %s AND period = 'first_half'", (mid, mid))
        newer = [opta_row(ht=("2", "0"))] + others(3, "newer")
        path, data2 = self.opta_file(newer, "newer")
        self.apply(self.scope(newer, data2, mid, edition, issued=ISSUED[2]), self.frozen(path, data2, issued=ISSUED[2]))
        self.assertEqual(self.selection(mid)[1:3], (2, 0))
        settled = self.parent(mid)
        statuses = dict(self.x("SELECT id, status FROM panna.canonical_applications").fetchall())
        self.assertEqual(statuses[application], "superseded")
        line = self.event(self.cli("pilot", "revert", "--application", str(application), "--reviewer", "test:s1"), "revert")
        self.assertEqual((line["status"], line["restored"]), ("reverted", None))
        self.assertEqual(self.parent(mid), settled)
        self.assertEqual(self.selection(mid)[1:3], (2, 0))

    def test_GH278_S1_n_a_revert_restores_its_own_cycle_never_an_earlier_capture(self):
        # (review, m7) Cycle 1 captures 0–2 and is reverted; Pitch then writes 1–1 (no selection); cycle 2 begins on
        # cells already holding the pair; its revert leaves them as cycle 2 found them.
        from vega.normalize import normalize_family

        mid, edition, rows, data, manifest, _ = self.normal(ht_cells=(0, 2))
        first = self.event(self.apply(self.scope(rows, data, mid, edition), manifest), "application")["id"]
        self.cli("pilot", "revert", "--application", str(first), "--reviewer", "test:s1")
        self.assertEqual((self.parent(mid)["ht_home"], self.parent(mid)["ht_away"]), (0, 2))
        payload = {"id": MATCH, "home_team": {"id": HOME, "name": "Paris Saint-Germain"},
                   "away_team": {"id": AWAY, "name": "Roma"}, "status": "finished", "date": "2026-11-25",
                   "time_utc": "2026-11-25T20:00:00Z", "score_home": 2, "score_away": 2}
        batch = normalize_family("summary", payload, match_id=MATCH)
        batch.rows["core.matches"][0].update(home_score_ht=1, away_score_ht=1)
        self.store.save_matches(batch, edition)
        self.assertEqual((self.parent(mid)["ht_home"], self.parent(mid)["ht_away"]), (1, 1))
        again = self.event(self.apply(self.scope(rows, data, mid, edition), manifest), "application")
        self.assertEqual(again["status"], "unchanged")
        revision = self.parent(mid)["revision"]
        line = self.event(self.cli("pilot", "revert", "--application", str(again["id"]), "--reviewer", "test:s1"), "revert")
        self.assertEqual((line["status"], line["restored"], line["changed"]), ("reverted", None, False))
        self.assertEqual((self.parent(mid)["ht_home"], self.parent(mid)["ht_away"], self.parent(mid)["revision"]), (1, 1, revision))
        self.assertIsNone(self.selection(mid))

    # --- GH278.S1-o: concurrency, and a COMMIT whose answer is lost --------------------------------------------------------
    def test_GH278_S1_o_a_concurrent_pitch_write_and_a_lost_commit_answer(self):
        from vega.normalize import normalize_family

        mid, edition, rows, data, manifest, _ = self.normal()
        payload = {"id": MATCH, "home_team": {"id": HOME, "name": "Paris Saint-Germain"},
                   "away_team": {"id": AWAY, "name": "Roma"}, "status": "finished", "date": "2026-11-25",
                   "time_utc": "2026-11-25T21:00:00Z", "score_home": 2, "score_away": 2}
        batch = normalize_family("summary", payload, match_id=MATCH)
        held = threading.Event()
        failures = []

        def pitch():
            try:
                with self.collect.transaction():
                    self.store.save_matches(batch, edition)
                    held.set()
                    self.collect.execute("SELECT pg_sleep(2)")
            except Exception as error:  # noqa: BLE001 - reported below
                failures.append(error)
                held.set()

        revision = self.parent(mid)["revision"]
        writer = threading.Thread(target=pitch)
        writer.start()
        self.assertTrue(held.wait(30))
        started = time.monotonic()
        done = self.apply(self.scope(rows, data, mid, edition), manifest)
        writer.join(30)
        self.assertEqual(failures, [])
        self.assertGreaterEqual(time.monotonic() - started, 1.0)  # it waited for the Pitch writer's locks
        self.assertEqual(self.event(done, "application")["status"], "published")
        after = self.parent(mid)
        self.assertEqual((after["ht_home"], after["ht_away"], after["revision"]), (1, 1, revision + 2))
        self.assertEqual(after["kickoff"].isoformat(), "2026-11-25T21:00:00+00:00")
        # The COMMIT of an application loses its answer: the retry finds it done, nothing twice.
        self.x("DELETE FROM core.match_score_selections")
        self.x("UPDATE core.matches SET home_score_ht = NULL, away_score_ht = NULL WHERE id = %s", (mid,))
        self.x("UPDATE panna.canonical_applications SET status = 'reverted', published_at = NULL")
        revision = self.parent(mid)["revision"]
        url = urlparse(DSN)
        relay = h.Relay(url.hostname, url.port or 5432)
        self.addCleanup(relay.close)
        relay.cut_commit_after = b"apply_score_segment"
        done = self.apply(self.scope(rows, data, mid, edition), manifest, dsn=self.login_dsn(relay.port))
        self.assertGreaterEqual(relay.drops, 1)
        self.assertEqual(self.event(done, "application")["status"], "published")
        self.assertEqual((self.parent(mid)["ht_home"], self.parent(mid)["revision"]), (1, revision + 1))
        self.assertEqual(self.count("SELECT count(*) FROM core.match_score_selections"), 1)

    # --- GH278.S1-p: privileges (GH278-ai amended) ------------------------------------------------------------------------
    def test_GH278_S1_p_the_roles_hold_only_what_the_dictionary_grants(self):
        mid, edition, rows, data, manifest, _ = self.normal()
        self.apply(self.scope(rows, data, mid, edition), manifest)
        login = psycopg.connect(self.login_dsn(), autocommit=True)
        self.addCleanup(login.close)
        for statement in ("SELECT 1 FROM core.matches LIMIT 1", "SELECT 1 FROM core.match_score_observations LIMIT 1",
                          "UPDATE core.matches SET revision = revision WHERE false",
                          "INSERT INTO panna.canonical_applications (segment_id) VALUES (1)",
                          "UPDATE panna.identity_reviews SET is_current = is_current WHERE false",
                          "DELETE FROM panna.canonical_applications WHERE false"):
            with self.subTest(statement):
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    login.execute(statement)
        self.assertGreater(login.execute("SELECT count(*) FROM panna.canonical_applications").fetchone()[0], 0)
        self.assertGreater(login.execute("SELECT count(*) FROM panna.identity_reviews").fetchone()[0], 0)
        functions = {"core.score_pair_verdict": "EXECUTE", "core.publish_score_pair": "EXECUTE",
                     "core.revert_score_selection": "EXECUTE", "panna.apply_score_segment": "EXECUTE",
                     "panna.revert_score_application": "EXECUTE"}
        signatures = dict(self.x("""SELECT n.nspname || '.' || p.proname, p.oid::regprocedure::text FROM pg_proc p
                                    JOIN pg_namespace n ON n.oid = p.pronamespace
                                    WHERE (n.nspname, p.proname) IN (('core', 'score_pair_verdict'), ('core', 'publish_score_pair'),
                                      ('core', 'revert_score_selection'), ('panna', 'apply_score_segment'),
                                      ('panna', 'revert_score_application'))""").fetchall())
        self.assertEqual(set(signatures), set(functions))
        self.x("DROP ROLE IF EXISTS s1_probe")
        self.x("CREATE ROLE s1_probe NOLOGIN")
        self.addCleanup(self.x, "DROP ROLE IF EXISTS s1_probe")
        # (review, M1) the login executes the read and the two panna entry points; core's two writing functions are
        # reached only through those, never called with its own lexemes, key, match, batch or instant.
        granted = {"core.score_pair_verdict", "panna.apply_score_segment", "panna.revert_score_application"}
        for name, signature in signatures.items():
            with self.subTest(name):
                self.assertEqual(self.x("SELECT has_function_privilege('vega_v2_panna', %s, 'EXECUTE')", (signature,)).fetchone()[0],
                                 name in granted)
                self.assertFalse(self.x("SELECT has_function_privilege('s1_probe', %s, 'EXECUTE')", (signature,)).fetchone()[0])
                self.assertFalse(self.x("SELECT has_function_privilege('vega_collect', %s, 'EXECUTE')", (signature,)).fetchone()[0])
                secure, config = self.x("SELECT prosecdef, proconfig FROM pg_proc WHERE oid = %s::regprocedure", (signature,)).fetchone()
                self.assertTrue(secure)
                self.assertIn("search_path=pg_catalog, pg_temp", config)
        for table in ("core.match_score_observations", "core.match_score_selections", "core.observation_batches"):
            for right in ("INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                with self.subTest(table=table, right=right):
                    self.assertFalse(self.x("SELECT has_table_privilege('vega_collect', %s, %s)", (table, right)).fetchone()[0])
            self.assertTrue(self.x("SELECT has_table_privilege('vega_collect', %s, 'SELECT')", (table,)).fetchone()[0])
            self.assertFalse(self.x("SELECT has_table_privilege('vega_v2_panna', %s, 'SELECT')", (table,)).fetchone()[0])
        for sequence in ("core.match_score_observations_id_seq", "core.observation_batches_id_seq"):
            self.assertFalse(self.x("SELECT has_sequence_privilege('vega_collect', %s, 'USAGE')", (sequence,)).fetchone()[0])
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.collect.execute("INSERT INTO core.match_score_selections VALUES (1, 'half_time', 1, now(), 'x')")
        for statement in ("SELECT core.publish_score_pair(" + ", ".join(["NULL"] * 23) + ")",
                          "SELECT core.revert_score_selection(NULL, NULL, NULL, NULL, NULL)"):
            with self.subTest(statement=statement[:30]):
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    login.execute(statement)
        self.assertTrue(self.x("SELECT has_schema_privilege('vega_v2_panna', 'core', 'USAGE')").fetchone()[0])

    # --- GH278.S1-q: purge and restore ------------------------------------------------------------------------------------
    def test_GH278_S1_q_a_purge_takes_the_selection_and_keeps_the_observations(self):
        from vega import open_matchday_restore, scope

        mid, edition, rows, data, manifest, _ = self.normal()
        self.apply(self.scope(rows, data, mid, edition), manifest)
        inventory = open_matchday_restore.dependencies(self.db)
        self.assertIn("core.match_score_selections", inventory)
        self.assertIn("core.match_score_selections", open_matchday_restore.ADDED_DEPENDENCIES)
        self.assertNotIn("core.match_score_observations", inventory)
        for name in ("185_core_provider_opta.sql", "186_match_score_observations.sql"):
            self.assertIn(name, open_matchday_restore.REVIEWED_SCHEMAS)
        calc = psycopg.connect(DSN, autocommit=True)
        self.addCleanup(calc.close)
        calc.execute("SET ROLE vega_calc")
        out = io.StringIO()
        with contextlib.redirect_stdout(out), patch.object(scope, "REMOVED", {LEAGUE: "test"}):
            counts = scope.purge(self.collect, calc)
        self.assertEqual(counts.get("matches"), 1, out.getvalue())
        self.assertEqual(self.count("SELECT count(*) FROM core.matches WHERE id = %s", mid), 0)
        self.assertEqual(self.count("SELECT count(*) FROM core.match_score_selections"), 0)
        self.assertEqual(self.opta_link(), [])
        self.assertEqual(len([o for o in self.observations() if o[0] == "opta"]), 2)
        self.assertEqual(self.count("SELECT count(*) FROM core.observation_batches"), 1)
        self.assertEqual(self.count("SELECT count(*) FROM panna.segments"), 1)

    # --- GH278.S1-r: the rollback (GH278-al amended) ------------------------------------------------------------------------
    def test_GH278_S1_r_the_rollback_revokes_then_drops_and_keeps_the_business_data(self):
        mid, edition, rows, data, manifest, _ = self.normal()
        self.apply(self.scope(rows, data, mid, edition), manifest)
        # (review, m7) On a base of this server without the schema core, while the roles exist: no error.
        bare = "vega_v2_panna_s1_test_bare"
        self.x(f'DROP DATABASE IF EXISTS "{bare}" WITH (FORCE)')
        self.x(f'CREATE DATABASE "{bare}"')
        try:
            with psycopg.connect(urlunparse(urlparse(DSN)._replace(path="/" + bare)), autocommit=True) as c:
                c.execute((ROOT / "panna" / "ROLLBACK.sql").read_text())
        finally:
            self.x(f'DROP DATABASE IF EXISTS "{bare}" WITH (FORCE)')
        self.assertEqual(self.count("SELECT count(*) FROM pg_roles WHERE rolname IN ('vega_panna', 'vega_v2_panna')"), 2)
        self.x((ROOT / "panna" / "ROLLBACK.sql").read_text())
        self.assertEqual(self.count("SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'panna%'"), 0)
        self.assertEqual(self.count("""SELECT count(*) FROM pg_shdepend s JOIN pg_database d ON d.oid = s.dbid
                                       WHERE d.datname = current_database() AND s.refclassid = 'pg_authid'::regclass
                                         AND s.refobjid IN (SELECT oid FROM pg_roles WHERE rolname IN ('vega_panna', 'vega_v2_panna'))"""), 0)
        self.assertEqual((self.parent(mid)["ht_home"], self.parent(mid)["ht_away"]), (1, 1))
        self.assertEqual(self.opta_link(), [(KEY, mid)])
        self.assertEqual(self.count("SELECT count(*) FROM core.match_score_observations"), 3)
        self.assertEqual(self.count("SELECT count(*) FROM core.match_score_selections"), 1)
        self.assertTrue(self.x("SELECT 'opta' = ANY(enum_range(NULL::core.provider)::text[])").fetchone()[0])
        if not self.x(ELSEWHERE).fetchone()[0]:
            self.assertEqual(self.count("SELECT count(*) FROM pg_roles WHERE rolname IN ('vega_panna', 'vega_v2_panna')"), 0)
        self.migrate(PASSWORD)  # the next cases start from a migrated base again

    # --- GH278.S1-u (review, m3): the pilot's scoped load is no fixtures index ------------------------------------------
    def test_GH278_S1_u_after_the_pilot_alone_an_events_run_is_refused(self):
        mid, edition, rows, data, manifest, _ = self.normal()
        self.apply(self.scope(rows, data, mid, edition), manifest)
        events = self.frozen_events(h.events_for(KEY, "UCL", "2026-2027", 4) + h.events_for("opta-other-x-0", "UCL", "2026-2027", 3))
        done = self.cli("run", "--manifest", str(events), "--asset", "events_UCL.parquet", "--as-of", AS_OF,
                        "--scratch", str(self.work / "scratch"), expect=1)
        self.assertIn("DEPENDENCY_MISSING", done.stdout)
        self.assertEqual(self.count("SELECT count(*) FROM panna_data.opta_events"), 0)
        self.assertEqual(self.count("SELECT count(*) FROM panna.segments"), 1)
        done = self.cli("prep", "--manifest", str(events), "--asset", "events_UCL.parquet", "--as-of", AS_OF,
                        "--scratch", str(self.work / "scratch"), "--plan-out", str(self.work / "plan.json"), expect=1)
        self.assertIn("DEPENDENCY_MISSING", done.stdout)

    # --- GH278.S1-v (review, m4): 186 online beside the collector ----------------------------------------------------------
    def test_GH278_S1_v_186_waits_for_a_writer_of_matches_without_queueing_the_others(self):
        mid, edition = self.pitch_parent()
        other, _ = self.pitch_parent(match="m_s1oth2", date="2026-11-02", events=False)
        self.before_186()
        holder = psycopg.connect(DSN)  # a transaction of the collector, holding a row of core.matches for 5 s
        self.addCleanup(holder.close)
        holder.execute("UPDATE core.matches SET revision = revision WHERE id = %s", (mid,))
        env = {k: v for k, v in os.environ.items() if not k.startswith("V2_")}
        env.update(V2_MIGRATION_DATABASE_URL=DSN, PYTHONPATH=str(ROOT), PYTHONDONTWRITEBYTECODE="1")
        started = time.monotonic()
        task = subprocess.Popen([sys.executable, "-m", "vega.migrate", "--online"], cwd=ROOT, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        time.sleep(1.5)
        second = psycopg.connect(DSN, autocommit=True)  # another writer of core.matches, meanwhile
        self.addCleanup(second.close)
        second.execute("SET lock_timeout = '20s'")
        began = time.monotonic()
        second.execute("UPDATE core.matches SET revision = revision WHERE id = %s", (other,))
        waited = time.monotonic() - began
        time.sleep(max(0.0, 5.0 - (time.monotonic() - started)))
        holder.commit()
        out, err = task.communicate(timeout=180)
        self.assertEqual(task.returncode, 0, out + err)
        self.assertIn("migrations applied=1 ", out)
        self.assertGreaterEqual(time.monotonic() - started, 4.5)
        self.assertLess(waited, 1.0, "the second writer queued behind 186's lock")
        self.assertIsNotNone(self.x("SELECT to_regclass('core.match_score_selections')").fetchone()[0])
        self.migrate(PASSWORD)  # the panna component again, as the class leaves it

    # --- GH278.S1-s: the migrations ---------------------------------------------------------------------------------------
    def test_GH278_S1_s_the_migrations_core_without_the_switch_panna_with_it_h1_untouched(self):
        sql = ROOT / "sql"
        for name in ("185_core_provider_opta.sql", "186_match_score_observations.sql"):
            text = (sql / name).read_text()
            self.assertRegex(text, r"(?m)^-- vega:online[ \t]*$", name)
        statements = [s for s in (sql / "185_core_provider_opta.sql").read_text().split(";")
                      if s.strip() and not all(line.strip().startswith("--") or not line.strip() for line in s.splitlines())]
        self.assertEqual(len(statements), 1)
        self.assertIn("ADD VALUE IF NOT EXISTS 'opta'", statements[0])
        # Without the switch: core's files only.
        self.x("DROP SCHEMA IF EXISTS panna_data, panna, panna_admin CASCADE")
        done = self.migrate()
        self.assertNotIn("panna", done.stdout)
        self.assertEqual(self.count("SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'panna%'"), 0)
        for table in ("core.match_score_observations", "core.match_score_selections", "core.observation_batches"):
            self.assertIsNotNone(self.x("SELECT to_regclass(%s)", (table,)).fetchone()[0], table)
        # The panna files up to 003 (H1) and 005 (the loader needs it, FAILURE_MODES.md section 9; it does not need 004),
        # H1 rows loaded, then 004: H1's rows unchanged.
        copy = Path(tempfile.mkdtemp(dir=self.tmp.name)) / "backend"
        shutil.copytree(ROOT / "vega", copy / "vega", ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copytree(ROOT / "sql", copy / "sql")
        shutil.copytree(ROOT / "account" / "sql", copy / "account" / "sql")
        (copy / "panna" / "sql").mkdir(parents=True)
        for name in ("001_panna.sql", "002_panna_variants.sql", "003_panna_segment_index.sql", "005_panna_fixture_extension.sql"):
            shutil.copy(ROOT / "panna" / "sql" / name, copy / "panna" / "sql" / name)
        self.migrate(PASSWORD, backend=copy)
        self.assertEqual(self.count("SELECT count(*) FROM panna_admin.applied"), 4)
        # The pilot on that base (the login, H1's tables, no 004): refused before anything is written.
        early = [opta_row()] + others(2, "no004")
        path, data = self.opta_file(early, "no004")
        absent = dict(match_id=987654, public_id=None, season_id=2026, competition_season_id=1, home_team_id=None,
                      away_team_id=None, match_date="2026-11-25", status="finished", parent_source="pitchapi")
        done = self.apply(self.scope(early, data, 987654, 1, target=absent), self.frozen(path, data, name="no004"), expect=1)
        self.assertIn("SCHEMA_VERSION", done.stdout)
        self.assertIn("004_panna_canonical.sql", done.stdout)
        self.assertEqual(self.count("SELECT count(*) FROM panna.receipts"), 0)
        self.assertEqual(self.count("SELECT count(*) FROM panna.runs"), 0)
        rows = [opta_row()] + others(4)
        path, data = self.opta_file(rows, "h1")
        self.cli("run", "--manifest", str(self.frozen(path, data)), "--asset", ASSET, "--as-of", AS_OF,
                 "--scratch", str(self.work / "scratch"))
        tables = ("panna.segments", "panna.manifest", "panna.scope", "panna.loads", "panna.receipts", "panna_data.opta_fixtures")
        before = {t: self.x(f"SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM {t} t").fetchone()[0] for t in tables}
        self.assertGreater(self.count("SELECT count(*) FROM panna.segments"), 1)
        done = self.migrate(PASSWORD)
        self.assertIn("panna applied=1 total=5", done.stdout)
        after = {t: self.x(f"SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM {t} t").fetchone()[0] for t in tables}
        self.assertEqual(after, before)


if __name__ == "__main__":
    unittest.main()
