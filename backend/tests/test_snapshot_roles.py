"""Cup and Open Matchday snapshots under the production roles, written before the code: FAILURE_MODES.md §35 (35m–35s).

The real writers run through sources.run_due under vega_collect, the forecasts are written under vega_calc, and the
published state is read back through the real read API under vega_read (tests/read_http.mjs), on a disposable local
PostgreSQL (VEGA_V2_SNAPSHOT_ROLES_TEST_DSN, database vega_v2_snapshot_roles_test). The Euro 2024 bodies are the frozen
upstream file (fixtures/openfootball, CC0) through the real bridge and projection.

Failure modes: two imports of one edition interleaving and leaving rows of both under one digest (35m); a period the
source omits erasing an attested one (35n, 35o); a reschedule of a fixture with an ordinary forecast refusing the whole
edition, so that another match's correction is never written (35p); an ambiguous reschedule losing a fact or passing
silently (35q); a withdrawal deleting what another authority holds, or holding the whole edition for it (35r); a match
version written after a withdrawal's check outliving the match (35s).
"""

from contextlib import contextmanager
import copy
from datetime import timedelta
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
from time import monotonic, sleep
import unittest
from unittest.mock import patch
from urllib.parse import quote, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from vega import sources  # noqa: E402
from vega.sources import cups, open_matchday, snapshot  # noqa: E402
from test_source_snapshots import EDITIONS, FIXTURES, FOLDER, NOW, PRELOAD, ROUND_RESULTS, league  # noqa: E402
from prerequisites import required  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_SNAPSHOT_ROLES_TEST_DSN")
NODE = shutil.which("node")
HTTP_READY = bool(NODE) and (ROOT / "api" / "node_modules" / "pg").is_dir()
EURO = "open-cups:euro:2024"
OM_EDITION = f"open-matchday:{FOLDER}:2026/2027"


def blocked(observer, waiter_pid, timeout=5.0):
    """Whether the backend `waiter_pid` waits on a lock within `timeout` seconds."""
    limit = monotonic() + timeout
    while monotonic() < limit:
        if observer.execute("SELECT cardinality(pg_blocking_pids(%s)) > 0", (waiter_pid,)).fetchone()[0]:
            return True
        sleep(0.02)
    return False


@required(DSN and psycopg and NODE and HTTP_READY,
          "requires a disposable local snapshot roles DB (VEGA_V2_SNAPSHOT_ROLES_TEST_DSN), psycopg, node and backend/api/node_modules")
class RolesBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_snapshot_roles_test":
            raise RuntimeError("dedicated local snapshot roles DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        from vega.store import connect_local

        self.x = self.db.execute
        self.x("""TRUNCATE core.matches, core.rounds, core.competition_seasons, core.competitions, core.provider_ids, core.entity_names,
                  core.teams, core.source_revisions, core.assets, ops.source_runs, ops.parse_failures, ops.resource_versions,
                  agg.match_forecasts, agg.forecast_models RESTART IDENTITY CASCADE""")
        self.collect, self.calc, self.other = (connect_local(DSN) for _ in range(3))
        for conn, role in ((self.collect, "vega_collect"), (self.calc, "vega_calc"), (self.other, "vega_collect")):
            self.addCleanup(conn.close)
            conn.execute(f"SET ROLE {role}")
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def read(self, *requests):
        done = subprocess.run([NODE, str(ROOT / "tests" / "read_http.mjs"), DSN, json.dumps(list(requests))],
                              capture_output=True, text=True, timeout=120)
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout.strip().splitlines()[-1])

    def failures(self):
        return self.x("SELECT error_code, message FROM ops.parse_failures ORDER BY id").fetchall()

    def edition_path(self, kind, season):
        competition, label = self.x("SELECT competition_id, season FROM api.cup_editions WHERE kind = %s AND season LIKE %s",
                                    (kind, season + "%")).fetchone()
        return f"/api/cups/edition?competition={quote(str(competition))}&season={quote(label)}"


class CupEditionLockTest(RolesBase):
    """35m: two imports of one edition, each changing another match, then a replay."""

    SEED = {"name": "Euro", "matches": [
        {"team1": "Alpha United", "team2": "Bravo City", "round": "Finals", "date": "2024-06-03", "score": {"ft": [2, 1], "ht": [1, 0]}},
        {"team1": "Cedar United", "team2": "Delta City", "round": "Finals", "date": "2024-06-04", "score": {"ft": [0, 1], "ht": [0, 0]}}]}

    def cup(self, conn, day, body):
        self.answer.body = body
        return sources.run_due(conn, None, NOW + timedelta(days=day), names={"openfootball"})[("openfootball", EURO)]

    def stored(self):
        digest = self.x("SELECT cup_digest FROM core.competition_seasons WHERE cup_key = %s", (EURO,)).fetchone()[0]
        rows = self.x("""SELECT m.id, m.home_score, m.away_score, m.home_score_ht, m.away_score_ht, m.revision, m.xmin::text
                         FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
                         WHERE cs.cup_key = %s ORDER BY m.archive_position""", (EURO,)).fetchall()
        return digest, rows

    def test_35m_the_stored_rows_are_the_body_whose_digest_is_stored(self):
        self.answer = threading.local()
        bridge = lambda *_args: {"status": 200, "body": self.answer.body}
        older = copy.deepcopy(self.SEED)
        older["matches"][0]["score"]["ft"] = [3, 1]
        newer = copy.deepcopy(self.SEED)
        newer["matches"][1]["score"]["ft"] = [1, 1]
        digests = {cups.rows_digest(body["name"], cups.unique_rows(cups.match_rows("open-cups", "euro", "2024", body))): body
                   for body in (older, newer)}
        with patch.object(cups, "scopes", lambda now: {EURO: timedelta(seconds=1)}), patch.object(cups, "bridge", bridge):
            self.assertEqual(self.cup(self.collect, 0, self.SEED), "ok")
            outcomes, waited = [], []
            read = snapshot.stored

            def interleave(conn, *args):
                found = read(conn, *args)
                if conn is self.collect and not outcomes:
                    worker = threading.Thread(target=lambda: outcomes.append(self.cup(self.other, 2, older)))
                    worker.start()
                    waited.append(blocked(self.db, self.other.info.backend_pid, timeout=2))
                    worker.join(0 if waited[-1] else 10)
                    self.worker = worker
                return found

            with patch.object(snapshot, "stored", interleave):
                latest = self.cup(self.collect, 4, newer)
            self.worker.join(20)
            self.assertFalse(self.worker.is_alive())
            self.assertEqual((latest, outcomes), ("ok", ["ok"]))
            self.assertEqual(waited, [True], "the second import of the edition ran inside the first one's read")
            digest, rows = self.stored()
            self.assertIn(digest, digests)
            body = digests[digest]
            self.assertEqual([r[1:5] for r in rows], [(*m["score"]["ft"], *m["score"]["ht"]) for m in body["matches"]])
            path = self.edition_path("open-cups", "2024")
            # The cup's one representation of its matches: /api/matches/{id} and its summary serve PitchAPI's alone (404).
            [edition] = self.read({"path": path})
            self.assertEqual([m["score"]["ft"] for m in edition["body"]["matches"]], [m["score"]["ft"] for m in body["matches"]])
            # The same body again: nothing written, the representations unchanged.
            self.assertEqual(self.cup(self.collect, 6, body), "ok")
            self.assertEqual(self.x("SELECT rows_written FROM ops.source_runs WHERE source = 'openfootball' AND scope = %s", (EURO,)).fetchone()[0], 0)
            self.assertEqual(self.stored(), (digest, rows))
            [again] = self.read({"path": path, "etag": edition["etag"]})
            self.assertEqual((again["status"], again["body"], again["conditional"]), (200, edition["body"], 304))


class CupPeriodsTest(RolesBase):
    """35n, 35o: the frozen Euro 2024 file through the real bridge, a period omitted, then stated."""

    @contextmanager
    def serving(self, body):
        path = self.tmp / f"editions-{len(list(self.tmp.iterdir()))}.json"
        path.write_text(json.dumps({"editions": {"euro:2024": body}}))
        with patch.dict(os.environ, {"NODE_OPTIONS": f"--import={PRELOAD.as_uri()}", "VEGA_TEST_OPENFOOTBALL": str(path)}):
            yield

    def euro(self, body, day):
        with self.serving(body), patch.object(cups, "scopes", lambda now: {EURO: timedelta(seconds=1)}):
            return sources.run_due(self.collect, None, NOW + timedelta(days=day), names={"openfootball"})[("openfootball", EURO)]

    def match(self, body, home, away):
        return next(m for m in body["matches"] if (m["team1"], m["team2"]) == (home, away))

    def public(self, etag=None):
        [edition] = self.read({"path": self.edition_path("open-cups", "2024"), "etag": etag})
        return edition, {(m["team1"], m["team2"]): m["score"] for m in edition["body"]["matches"]}

    def columns(self, home, away):
        return self.x("""SELECT home_score, away_score, home_score_90, away_score_90, home_score_ht, away_score_ht, home_score_et, away_score_et,
                                home_penalty_score, away_penalty_score, revision FROM core.matches WHERE home_team_name = %s AND away_team_name = %s""",
                      (home, away)).fetchone()

    def test_35n_an_omitted_half_time_keeps_the_attested_one(self):
        full = copy.deepcopy(EDITIONS["euro:2024"])
        self.assertEqual(self.euro(full, 0), "ok")
        before, scores = self.public()
        self.assertEqual(scores[("Germany", "Scotland")], {"ft": [5, 1], "ht": [3, 0]})
        self.assertEqual(scores[("Scotland", "Hungary")], {"ft": [0, 1], "ht": [0, 0]})
        stored = (self.columns("Germany", "Scotland"), self.columns("Scotland", "Hungary"))
        without = copy.deepcopy(full)
        del self.match(without, "Germany", "Scotland")["score"]["ht"]
        del self.match(without, "Scotland", "Hungary")["score"]["ht"]  # a 0–0 half time
        self.assertEqual(self.euro(without, 2), "ok")
        after, scores = self.public(before["etag"])
        self.assertEqual(scores[("Germany", "Scotland")], {"ft": [5, 1], "ht": [3, 0]})
        self.assertEqual(scores[("Scotland", "Hungary")], {"ft": [0, 1], "ht": [0, 0]})
        self.assertEqual((self.columns("Germany", "Scotland"), self.columns("Scotland", "Hungary")), stored)
        self.assertEqual((after["status"], after["conditional"]), (200, 304))
        # An explicit half time replaces it.
        stated = copy.deepcopy(full)
        self.match(stated, "Germany", "Scotland")["score"]["ht"] = [2, 0]
        self.assertEqual(self.euro(stated, 4), "ok")
        changed, scores = self.public(before["etag"])
        self.assertEqual(scores[("Germany", "Scotland")], {"ft": [5, 1], "ht": [2, 0]})
        self.assertEqual(changed["conditional"], 200)

    def test_35o_omitted_extra_time_and_shoot_out_are_kept_a_changed_full_time_beside_them_is_refused(self):
        full = copy.deepcopy(EDITIONS["euro:2024"])
        self.assertEqual(self.euro(full, 0), "ok")
        before, scores = self.public()
        self.assertEqual(scores[("Portugal", "Slovenia")], {"ft": [0, 0], "et": [0, 0], "p": [3, 0]})
        stored = self.columns("England", "Switzerland"), self.columns("Portugal", "Slovenia")
        shorter = copy.deepcopy(full)
        self.match(shorter, "England", "Switzerland")["score"] = {"ft": [1, 1], "ht": [0, 0]}
        self.match(shorter, "Portugal", "Slovenia")["score"] = {"ft": [0, 0]}
        self.assertEqual(self.euro(shorter, 2), "ok")
        self.assertEqual((self.columns("England", "Switzerland"), self.columns("Portugal", "Slovenia")), stored)
        self.assertEqual(self.public(before["etag"])[0]["conditional"], 304)
        # The full time changing while the extra time is omitted: another reading of the score; refused, kept.
        other = copy.deepcopy(full)
        self.match(other, "England", "Switzerland")["score"] = {"ft": [2, 1], "ht": [0, 0]}
        self.assertEqual(self.euro(other, 4), "PERIODS_CONFLICT")
        self.assertEqual(self.columns("England", "Switzerland"), stored[0])
        self.assertEqual(self.public(before["etag"])[0]["conditional"], 304)


class OpenMatchdayRolesTest(RolesBase):
    """35p–35s: a fixture moved, ambiguous moves, withdrawals with what holds them, a late match version."""

    CORRECTED = ROUND_RESULTS.replace(",2,1,1,0,", ",3,1,1,0,")

    def om(self, day, *, results=ROUND_RESULTS, fixtures=FIXTURES, conn=None):
        files = {f"{FOLDER}/results_2627.csv": results, f"{FOLDER}/fixtures_2627.csv": fixtures}
        counts = {part: len(text.strip().splitlines()) - 1 for part, text in (("results", results), ("fixtures", fixtures))}

        def get(url, *, as_text=False):
            if url.endswith("build_summary.json"):
                return {"season": "2627", "generated_utc": "2026-11-17T07:19:26Z", "leagues": [league(**counts)]}
            name = url.removeprefix(open_matchday.RAW + "data/")
            if name not in files:
                raise sources.SourceError("HTTP_404")
            return files[name]

        conn = conn or self.collect
        outcome = sources.run_due(conn, get, NOW + timedelta(days=day), names={"open_matchday"})[("open_matchday", "europe")]
        return (outcome, *self.x("SELECT rows_written, unmatched FROM ops.source_runs WHERE source = 'open_matchday'").fetchone())

    def matches(self):
        return {key: rest for key, *rest in self.x(
            """SELECT p.provider_key, m.id, m.match_date::text, m.status::text, m.home_score, m.away_score
               FROM core.matches m JOIN core.provider_ids p ON p.entity_type = 'match' AND p.entity_id = m.id AND p.is_current
               JOIN core.competition_seasons cs ON cs.id = m.competition_season_id WHERE cs.cup_key = %s ORDER BY 1""", (OM_EDITION,)).fetchall()}

    def key(self, day, home="South FC", away="North FC"):
        return f"{FOLDER}:2026/2027:{day}|{home}|{away}"

    def setUp(self):
        super().setUp()
        self.assertEqual(self.om(0), ("ok", 2, 0))
        found = self.matches()
        self.fixture, self.result = found[self.key("2026-11-29")][0], found[self.key("2026-11-01", "North FC", "South FC")][0]

    def forecast(self, match):
        model = self.calc.execute("""INSERT INTO agg.forecast_models(version, matches, home_base, home_slope, away_base, away_slope, rho,
                                                                    strength_spread, simulations)
                                     VALUES ('controlled', 100, 1, .1, 1, .1, 0, 100, 500) RETURNING id""").fetchone()[0]
        self.calc.execute("""INSERT INTO agg.match_forecasts(match_id, season_id, home_win, draw, away_win, home_goals, away_goals, likely_home,
                                                           likely_away, home_elo, away_elo, model_id)
                             SELECT id, season_id, .4, .3, .3, 1.5, 1.3, 1, 1, 1500, 1490, %s FROM core.matches WHERE id = %s""", (model, match))

    def forecasts(self):
        return [r[0] for r in self.calc.execute("SELECT match_id FROM agg.match_forecasts ORDER BY 1").fetchall()]

    def test_35p_a_fixture_moved_keeps_its_match_and_the_other_correction_is_written(self):
        self.forecast(self.fixture)
        path = self.edition_path("open-matchday", "2026")
        [before] = self.read({"path": path})
        self.assertEqual(self.om(2, results=self.CORRECTED, fixtures=FIXTURES.replace("2026-11-29", "2026-11-30")), ("ok", 2, 0))
        self.assertEqual(self.failures(), [])
        found = self.matches()
        self.assertEqual(found[self.key("2026-11-30")][:3], [self.fixture, "2026-11-30", "not_started"])
        self.assertNotIn(self.key("2026-11-29"), found)
        self.assertEqual(found[self.key("2026-11-01", "North FC", "South FC")][3:], [3, 1])
        self.assertEqual(self.forecasts(), [self.fixture])
        [after] = self.read({"path": path, "etag": before["etag"]})
        self.assertEqual((after["status"], after["conditional"]), (200, 200))
        # The edition's body (table-v1): the moved fixture with its forecast, the corrected result.
        moved = next(m for m in after["body"]["fixtures"] if m["date"] == "2026-11-30")
        self.assertIn("forecast", moved)
        self.assertEqual([(m["date"], m["ft_home"], m["ft_away"]) for m in after["body"]["results"]], [("2026-11-01", "3", "1")])

    def test_35q_an_ambiguous_move_is_named_and_loses_nothing(self):
        # One fixture leaves, two of the same pair arrive.
        two = FIXTURES.replace("2026-11-29", "2026-11-30") + "2026-12-06,South FC,North FC,17\n"
        self.assertEqual(self.om(2, fixtures=two)[0], "ok")
        self.assertIn("AMBIGUOUS_RESCHEDULE", {code for code, _ in self.failures()})
        self.assertTrue(any(self.key("2026-11-29") in message for code, message in self.failures() if code == "AMBIGUOUS_RESCHEDULE"))
        found = self.matches()
        self.assertTrue({self.key("2026-11-30"), self.key("2026-12-06")} <= set(found))
        self.assertNotIn(self.fixture, [v[0] for v in found.values()])  # nothing held it: withdrawn
        # Two fixtures of the pair leave, one arrives: one of them holds odds.
        keep = found[self.key("2026-12-06")][0]
        self.x("""INSERT INTO core.match_odds(season_id, match_id, bookmaker, title, home, draw, away, first_home, first_draw, first_away, fetched_at)
                  SELECT season_id, id, 'book', 'Book', 2.5, 3, 3.5, 2.5, 3, 3.5, now() FROM core.matches WHERE id = %s""", (keep,))
        self.assertEqual(self.om(4, fixtures=FIXTURES.replace("2026-11-29", "2026-12-13"))[0], "ok")
        found = self.matches()
        self.assertIn(keep, [v[0] for v in found.values()])
        self.assertEqual(self.x("SELECT count(*) FROM core.match_odds WHERE match_id = %s", (keep,)).fetchone()[0], 1)
        codes = [code for code, _ in self.failures()]
        self.assertGreaterEqual(codes.count("AMBIGUOUS_RESCHEDULE"), 2)
        self.assertIn("MATCH_HAS_DEPENDENTS", codes)

    def withdraw(self, day, dependent):
        """Hold `dependent` on the fixture, then files without it and with the other match corrected."""
        match = self.fixture
        if dependent == "forecast":
            self.forecast(match)
        elif dependent == "odds":
            self.x("""INSERT INTO core.match_odds(season_id, match_id, bookmaker, title, home, draw, away, first_home, first_draw, first_away, fetched_at)
                      SELECT season_id, id, 'book', 'Book', 2.5, 3, 3.5, 2.5, 3, 3.5, now() FROM core.matches WHERE id = %s""", (match,))
        elif dependent == "event":
            self.x("""INSERT INTO core.match_events(season_id, match_id, seq, event_type, team_id)
                      SELECT season_id, id, 1, 'goal', home_team_id FROM core.matches WHERE id = %s""", (match,))
        elif dependent == "lineup_forecast":
            self.x("""INSERT INTO agg.match_lineup_forecasts(match_id, season_id, home_win, draw, away_win, home_goals, away_goals, likely_home,
                                                             likely_away, home_elo, away_elo, home_deviation, away_deviation, elo_per_unit)
                      SELECT id, season_id, .4, .3, .3, 1.5, 1.3, 1, 1, 1500, 1490, 10, 10, 1 FROM core.matches WHERE id = %s""", (match,))
        elif dependent == "kickoff":
            self.x("UPDATE core.matches SET kickoff_at = '2026-11-29 18:45+00' WHERE id = %s", (match,))
        elif dependent == "key":
            self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match', 'pitchapi', 'm_shared', %s)", (match,))
        return self.om(day, results=self.CORRECTED, fixtures="date,home,away,gw\n")

    def test_35r_a_withdrawal_deletes_a_free_fixture_and_holds_what_another_authority_holds(self):
        for day, (dependent, code) in enumerate((("nothing", None), ("forecast", None), ("odds", "MATCH_HAS_DEPENDENTS"),
                                                 ("event", "MATCH_HAS_DEPENDENTS"), ("lineup_forecast", "MATCH_HAS_DEPENDENTS"),
                                                 ("kickoff", "MATCH_HAS_DEPENDENTS"), ("key", "SHARED_MATCH")), 1):
            with self.subTest(dependent=dependent):
                if day > 1:
                    self.setUp()
                outcome = self.withdraw(day, dependent)
                found = self.matches()
                self.assertEqual(found[self.key("2026-11-01", "North FC", "South FC")][3:], [3, 1])  # the rest is written
                if code is None:
                    self.assertEqual(outcome[:3], ("ok", 1, 0))
                    self.assertNotIn(self.key("2026-11-29"), found)
                    self.assertEqual(self.failures(), [])
                    if dependent == "forecast":
                        self.assertEqual(self.forecasts(), [self.fixture])  # the collection never writes agg
                else:
                    self.assertEqual(outcome[0], "ok")
                    self.assertGreaterEqual(outcome[2], 1)
                    self.assertEqual(found[self.key("2026-11-29")][0], self.fixture)
                    self.assertIn(code, {c for c, _ in self.failures()})
                    self.assertTrue(any(self.key("2026-11-29") in m or str(self.fixture) in m for c, m in self.failures() if c == code))

    def test_35s_a_match_version_written_after_the_check_cannot_outlive_the_withdrawal(self):
        guard = snapshot._guard_dependents
        late = []

        def after_check(conn, *args, **kwargs):
            out = guard(conn, *args, **kwargs)
            if conn is self.collect and not late:
                def write():
                    try:
                        with self.other.transaction():
                            self.other.execute("INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('match', %s)", (self.fixture,))
                    except psycopg.errors.ForeignKeyViolation:
                        late.append("refused")
                    else:
                        late.append("written")
                worker = threading.Thread(target=write)
                worker.start()
                late.append(blocked(self.db, self.other.info.backend_pid, timeout=1))
                worker.join(0 if late[-1] else 10)
                self.worker = worker
            return out

        with patch.object(snapshot, "_guard_dependents", after_check):
            outcome = self.om(1, fixtures="date,home,away,gw\n")
        self.worker.join(10)
        self.assertFalse(self.worker.is_alive())
        self.assertEqual(outcome, ("ok", 1, 0))
        self.assertNotIn(self.key("2026-11-29"), self.matches())
        self.assertEqual(late, [True, "refused"])
        self.assertEqual(self.x("""SELECT count(*) FROM ops.resource_versions v WHERE v.resource_kind = 'match'
                                   AND NOT EXISTS (SELECT 1 FROM core.matches m WHERE m.id = v.resource_id)""").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
