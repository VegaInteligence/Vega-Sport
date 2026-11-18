"""Cup and open-matchday snapshots (VI-27), written before the code: FAILURE_MODES.md §19.

The OpenFootball bodies are the frozen upstream files of fixtures/openfootball (CC0). The real
bridge (backend/sources/bridge.mjs) runs the real projection, with fake_openfootball_fetch.mjs in
place of the network; the real writers store them in a disposable local PostgreSQL
(VEGA_V2_SNAPSHOTS_TEST_DSN, database vega_v2_snapshots_test), through sources.run_due's own
transaction and status record. Every step commits, as in production: a write is told from a
re-read by its revision, updated_at and row version.
"""

from contextlib import contextmanager
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))
from vega import sources
from vega.sources import SourceError, cups, curated, open_matchday

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_SNAPSHOTS_TEST_DSN")
NODE = shutil.which("node")
FIXTURE = ROOT / "tests/fixtures/openfootball/editions.json"
PRELOAD = ROOT / "tests/fake_openfootball_fetch.mjs"
EDITIONS = json.loads(FIXTURE.read_text())["editions"]
NOW = datetime(2026, 11, 17, 19, tzinfo=timezone.utc)
SCORES = ("status", "home_score", "away_score", "home_score_90", "away_score_90", "home_score_ht", "away_score_ht",
          "home_score_et", "away_score_et", "home_penalty_score", "away_penalty_score")
# Played matches of each frozen edition (sources/upstream/reconciliation.csv, upstream_finished).
UPSTREAM_FINISHED = {
    "world-cup-history:1930": 18, "world-cup-history:1934": 17, "world-cup-history:1938": 18, "world-cup-history:1950": 22,
    "world-cup-history:1954": 26, "world-cup-history:1958": 35, "world-cup-history:1962": 32, "world-cup-history:1966": 32,
    "world-cup-history:1970": 32, "world-cup-history:1974": 38, "world-cup-history:1978": 38, "world-cup-history:1982": 52,
    "world-cup-history:1986": 52, "world-cup-history:1990": 52, "world-cup-history:1994": 52, "world-cup-history:1998": 64,
    "world-cup-history:2002": 64, "world-cup-history:2006": 64, "world-cup-history:2010": 64, "world-cup-history:2014": 64,
    "world-cup-history:2018": 64, "world-cup-history:2022": 64, "world-cup-history:2026": 104,
    "euro:2020": 51, "euro:2024": 51, "euro:2028": 0,
}

# Every frozen edition through the real projection in one node process, with the display helper's
# final score of each source match (shared/openfootball-history.js historicalScore).
CENSUS = r"""
import { readFileSync } from "node:fs";
const [fixture, projection, history] = process.argv.slice(1);
const { editions } = JSON.parse(readFileSync(fixture, "utf8"));
const { historicalScore } = await import(history);
const { GET } = await import(projection);
const out = {};
for (const [key, body] of Object.entries(editions)) {
  globalThis.fetch = async () => Response.json(body);
  const [competition, season] = key.split(":");
  const r = await GET(new Request(`http://bridge/api/open-cups?competition=${competition}&season=${season}`));
  out[key] = { status: r.status, body: await r.json(), display: body.matches.map((m) => historicalScore(m)) };
}
process.stdout.write(JSON.stringify(out));
"""


def rows_of(*matches, season="1954"):
    return cups.match_rows("open-cups", "world-cup-history", season, {"name": f"World Cup {season}", "matches": list(matches)})


def scores_of(row):
    return tuple(row[k] for k in SCORES)


def expected_row(m):
    """A source match's stored score columns, read from the table of §19.2 (independent of the writer)."""
    score, status = m.get("score"), m.get("status")
    if status in ("canceled", "cancelled"):
        return ("canceled",) + (None,) * 10
    if not score:
        return ("not_started",) + (None,) * 10
    parts = {"ft": score} if isinstance(score, list) else score
    ft, ht, et, p = (tuple(parts[k]) if k in parts else (None, None) for k in ("ft", "ht", "et", "p"))
    final = et if "et" in parts else ft
    return ("finished", *final, *(ft if "et" in parts else (None, None)), *ht, *et, *p)


class ScoreRulesTest(unittest.TestCase):
    """19a–19i: one rule for every OpenFootball score encoding (no database)."""

    def test_19a_to_19f_each_encoding_is_stored_as_the_source_says(self):
        none = (None,) * 10
        cases = {
            # 19a: worldcup.json's full-time array (England–USA 2022, Uruguay–Colombia 1962).
            "array 0-0": ({"score": [0, 0]}, ("finished", 0, 0) + (None,) * 8),
            "array 2-1": ({"score": [2, 1]}, ("finished", 2, 1) + (None,) * 8),
            # 19b: England–Belgium 1954, decided after extra time.
            "after extra time": ({"score": {"ft": [3, 3], "et": [4, 4]}}, ("finished", 4, 4, 3, 3, None, None, 4, 4, None, None)),
            # 19c: extra time without the 90-minute score: never inferred.
            "extra time only": ({"score": {"et": [2, 1]}}, ("finished", 2, 1, None, None, None, None, 2, 1, None, None)),
            # 19d: a shoot-out beside the score after extra time.
            "shoot-out": ({"score": {"ft": [1, 1], "et": [1, 1], "p": [4, 3]}}, ("finished", 1, 1, 1, 1, None, None, 1, 1, 4, 3)),
            "full time and half time": ({"score": {"ft": [3, 1], "ht": [2, 1]}}, ("finished", 3, 1, None, None, 2, 1, None, None, None, None)),
            # 19e: no result yet.
            "no score": ({}, ("not_started",) + none),
            "empty score": ({"score": {}}, ("not_started",) + none),
            "null score": ({"score": None}, ("not_started",) + none),
            # 19f: Sweden–Austria 1938, canceled by the source.
            "canceled": ({"status": "canceled"}, ("canceled",) + none),
            "cancelled": ({"status": "cancelled"}, ("canceled",) + none),
        }
        for name, (extra, expected) in cases.items():
            with self.subTest(name):
                [(_, row)] = rows_of({"round": "Matchday 1", "date": "1954-06-16", "team1": "A", "team2": "B", **extra})
                self.assertEqual(scores_of(row), expected)

    def test_19g_19h_a_malformed_score_or_status_makes_the_edition_invalid(self):
        for score in ([2], [2, -1], [2, 1.5], [True, 0], [2, "1"], "2-1", 3, {"ft": [1, None]}, {"ht": [1, 0]}, {"p": [4, 3]},
                      {"ft": [1, 0], "x": [0, 0]}, {"ft": [1, 0, 0]}):
            with self.subTest(score=score):
                with self.assertRaises(SourceError) as caught:
                    rows_of({"date": "1954-06-16", "team1": "A", "team2": "B", "score": score})
                self.assertEqual(caught.exception.code, "INVALID_SCORE")
        for extra in ({"status": "canceled", "score": [1, 0]}, {"status": "postponed"}, {"status": 3}):
            with self.subTest(extra=extra):
                with self.assertRaises(SourceError) as caught:
                    rows_of({"date": "1954-06-16", "team1": "A", "team2": "B", **extra})
                self.assertEqual(caught.exception.code, "INVALID_STATUS")

    @unittest.skipUnless(NODE, "requires node")
    def test_19i_the_frozen_editions_through_the_projection(self):
        done = subprocess.run(
            [NODE, "--input-type=module", "-e", CENSUS, str(FIXTURE), (REPO / "backend/sources/projections/open-cups.mjs").as_uri(),
             (REPO / "dashboard/shared/openfootball-history.js").as_uri()],
            capture_output=True, text=True, timeout=120,
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        projected = json.loads(done.stdout)
        finished, arrays, array_editions, canceled, unplayed = 0, 0, set(), 0, 0
        for key, body in EDITIONS.items():
            answer = projected[key]
            self.assertEqual(answer["status"], 200, key)
            competition, season = key.split(":")
            rows = cups.match_rows("open-cups", competition, season, answer["body"])
            self.assertEqual(len(rows), len(body["matches"]), key)
            played = 0
            for (_, row), source, display in zip(rows, body["matches"], answer["display"]):
                self.assertEqual(scores_of(row), expected_row(source), (key, source))
                if row["status"] == "finished":
                    played += 1
                    if isinstance(source.get("score"), list):
                        arrays += 1
                        array_editions.add(key)
                elif row["status"] == "canceled":
                    canceled += 1
                else:
                    unplayed += 1
                # The site's display helper and the stored row give the match the same score.
                final = [row["home_score"], row["away_score"]] if row["status"] == "finished" else [None, None]
                self.assertEqual(display, final, (key, source))
            self.assertEqual(played, UPSTREAM_FINISHED[key], key)
            finished += played
        self.assertEqual((finished, arrays, len(array_editions), canceled, unplayed), (1170, 665, 18, 1, 51))


def pair(m, home, away):
    return (m.get("team1"), m.get("team2")) == (home, away)


def baseline_digest(body):
    """The digest the baseline writer stored: its projection's raw body (array scores kept, status dropped)."""
    matches = [{k: m[k] for k in ("round", "group", "num", "date", "team1", "team2", "score") if k in m} for m in body["matches"]]
    return hashlib.sha256(json.dumps([body["name"], matches], sort_keys=True, ensure_ascii=False).encode()).hexdigest()


@unittest.skipUnless(DSN and psycopg and NODE, "requires a disposable local snapshots DB (VEGA_V2_SNAPSHOTS_TEST_DSN), psycopg and node")
class SnapshotDatabase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_snapshots_test":
            raise RuntimeError("dedicated local snapshots DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        self.x = self.db.execute
        self.x("""TRUNCATE core.matches, core.rounds, core.competition_seasons, core.competitions, core.provider_ids,
                  core.entity_names, core.teams, core.source_revisions, core.assets, ops.source_runs, ops.parse_failures
                  RESTART IDENTITY CASCADE""")
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)

    # -- cups: the real bridge and projection, run_due's own transaction and status --
    @contextmanager
    def serving(self, editions):
        path = self.tmp / f"editions-{len(list(self.tmp.iterdir()))}.json"
        path.write_text(json.dumps({"editions": editions}))
        with patch.dict(os.environ, {"NODE_OPTIONS": f"--import={PRELOAD.as_uri()}", "VEGA_TEST_OPENFOOTBALL": str(path)}):
            yield

    def read_cup(self, key, body, at):
        """One due read of the edition `key` ("world-cup-history:1962") answering `body`: its outcome."""
        scope = f"open-cups:{key}"
        with self.serving({key: body}), patch.object(cups, "scopes", lambda now: {scope: timedelta(seconds=1)}):
            return sources.run_due(self.db, None, at, names={"openfootball"})[("openfootball", scope)]

    def edition(self, key):
        return self.x("""SELECT id, cup_digest, cup_checked_at, cup_updated_at, cup_name FROM core.competition_seasons
                         WHERE cup_key = %s""", (f"open-cups:{key}",)).fetchone()

    def matches(self, key):
        """Per provider key: id, position, the score columns, revision, updated_at and row version."""
        return {r[0]: r[1:] for r in self.x(
            f"""SELECT p.provider_key, m.id, m.archive_position, {', '.join('m.' + c + ('::text' if c == 'status' else '') for c in SCORES)},
                       m.revision, m.updated_at, m.xmin::text
                FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
                JOIN core.provider_ids p ON p.entity_type = 'match' AND p.entity_id = m.id
                WHERE cs.cup_key = %s ORDER BY m.archive_position""", (f"open-cups:{key}",)).fetchall()}

    def run_record(self, provider, scope):
        return self.x("SELECT status, error_code, rows_written, unmatched FROM ops.source_runs WHERE source = %s AND scope = %s",
                      (provider, scope)).fetchone()


class CupReplayTest(SnapshotDatabase):
    def store_as_baseline(self, key, body):
        """The edition as the baseline writer left it: array scores and canceled matches not started, its raw digest."""
        edition = self.edition(key)[0]
        for position, m in enumerate(body["matches"]):
            if isinstance(m.get("score"), list) or m.get("status"):
                self.x(f"""UPDATE core.matches SET status = 'not_started', {', '.join(c + ' = NULL' for c in SCORES[1:])}
                           WHERE competition_season_id = %s AND archive_position = %s""", (edition, position))
        self.x("UPDATE core.competition_seasons SET cup_digest = %s WHERE id = %s", (baseline_digest(body), edition))

    def test_19j_a_stored_edition_is_corrected_once_after_the_parser_upgrade(self):
        for key, corrected in (("world-cup-history:1962", 32), ("world-cup-history:2022", 7), ("world-cup-history:1938", 1)):
            with self.subTest(key):
                body = EDITIONS[key]
                self.assertEqual(self.read_cup(key, body, NOW), "ok")
                self.store_as_baseline(key, body)
                before, edition = self.matches(key), self.edition(key)
                # The same upstream body, read by the new code.
                self.assertEqual(self.read_cup(key, body, NOW + timedelta(days=8)), "ok")
                after = self.matches(key)
                self.assertEqual(self.run_record("openfootball", f"open-cups:{key}")[2], corrected)
                self.assertEqual({k: v[0] for k, v in after.items()}, {k: v[0] for k, v in before.items()})  # same match ids
                self.assertEqual([v[2:13] for v in after.values()], [expected_row(m) for m in body["matches"]])
                changed = [k for k in after if before[k][2:13] != after[k][2:13]]
                self.assertEqual(len(changed), corrected)
                for k in after:
                    self.assertEqual(after[k][13], before[k][13] + (1 if k in changed else 0), k)  # revision
                    if k not in changed:
                        self.assertEqual(after[k][14:], before[k][14:], k)  # untouched: updated_at and row version
                now_edition = self.edition(key)
                self.assertNotEqual(now_edition[1], edition[1])
                self.assertGreater(now_edition[3], edition[3])
                # A third read of the same body changes nothing; only the read time moves.
                self.assertEqual(self.read_cup(key, body, NOW + timedelta(days=16)), "ok")
                self.assertEqual(self.matches(key), after)
                self.assertEqual(self.run_record("openfootball", f"open-cups:{key}")[2], 0)
                last = self.edition(key)
                self.assertEqual((last[1], last[3]), (now_edition[1], now_edition[3]))
                self.assertGreater(last[2], now_edition[2])
        canceled = self.x("""SELECT m.status::text, m.home_score, m.away_score FROM core.matches m
                             WHERE m.home_team_name = 'Sweden' AND m.away_team_name = 'Austria'""").fetchone()
        self.assertEqual(canceled, ("canceled", None, None))
        england = self.x("""SELECT m.status::text, m.home_score, m.away_score FROM core.matches m
                            WHERE m.home_team_name = 'England' AND m.away_team_name = 'USA'""").fetchone()
        self.assertEqual(england, ("finished", 0, 0))

    def test_19k_another_order_moves_positions_only(self):
        key, body = "world-cup-history:1962", EDITIONS["world-cup-history:1962"]
        self.assertEqual(self.read_cup(key, body, NOW), "ok")
        before, edition = self.matches(key), self.edition(key)
        reordered = dict(body, matches=list(reversed(body["matches"])))
        self.assertEqual(self.read_cup(key, reordered, NOW + timedelta(days=8)), "ok")
        after = self.matches(key)
        self.assertEqual(list(after), list(reversed(list(before))))  # positions follow the source
        for k in before:
            self.assertEqual(after[k][0], before[k][0])
            self.assertEqual(after[k][2:15], before[k][2:15], k)  # scores, revision and updated_at
        self.assertEqual(self.edition(key)[3], edition[3])  # cup_updated_at
        self.assertEqual(self.run_record("openfootball", f"open-cups:{key}")[2], 0)


class CupGuardTest(SnapshotDatabase):
    KEY = "world-cup-history:1938"

    def setUp(self):
        super().setUp()
        self.body = copy.deepcopy(EDITIONS[self.KEY])
        self.assertEqual(self.read_cup(self.KEY, self.body, NOW), "ok")
        self.before, self.stored = self.matches(self.KEY), self.edition(self.KEY)

    def assertKept(self, outcome, code):
        self.assertEqual(outcome, code)
        self.assertEqual(self.matches(self.KEY), self.before)  # ids, scores, revisions, row versions
        self.assertEqual(self.edition(self.KEY), self.stored)  # digest, cup_checked_at, cup_updated_at
        record = self.run_record("openfootball", f"open-cups:{self.KEY}")
        self.assertEqual(record[:2], ("error", code))

    def test_19l_a_200_without_matches_keeps_the_edition(self):
        self.assertKept(self.read_cup(self.KEY, dict(self.body, matches=[]), NOW + timedelta(days=8)), "SNAPSHOT_DROPS_RESULT")
        detail = self.x("SELECT error_code, message FROM ops.parse_failures").fetchall()
        self.assertEqual([d[0] for d in detail], ["SNAPSHOT_DROPS_RESULT"])
        self.assertIn("open-cups:world-cup-history:1938", detail[0][1])

    def test_19m_a_result_dropped_or_unplayed_keeps_the_edition(self):
        dropped = dict(self.body, matches=[m for m in self.body["matches"] if not pair(m, "France", "Belgium")])
        self.assertKept(self.read_cup(self.KEY, dropped, NOW + timedelta(days=8)), "SNAPSHOT_DROPS_RESULT")
        unplayed = copy.deepcopy(self.body)
        for m in unplayed["matches"]:
            if pair(m, "France", "Belgium"):
                del m["score"]
        self.assertKept(self.read_cup(self.KEY, unplayed, NOW + timedelta(days=16)), "RESULT_DOWNGRADED")

    def test_19g_a_malformed_score_keeps_the_edition(self):
        broken = copy.deepcopy(self.body)
        broken["matches"][1]["score"] = {"ft": [6, None]}
        self.assertKept(self.read_cup(self.KEY, broken, NOW + timedelta(days=8)), "INVALID_SCORE")

    def test_19n_a_complete_correction_is_accepted(self):
        # Synthetic changes of the 1938 body: Hungary–Dutch East Indies corrected from 6–0 to 6–1, a
        # match of two synthetic teams added, the canceled (never played) Sweden–Austria withdrawn.
        corrected = copy.deepcopy(self.body)
        for m in corrected["matches"]:
            if pair(m, "Hungary", "Dutch East Indies"):
                m["score"] = {"ft": [6, 1], "ht": [4, 0]}
        corrected["matches"] = [m for m in corrected["matches"] if m.get("status") != "canceled"]
        corrected["matches"].append({"round": "Synthetic", "date": "1938-06-20", "team1": "Synthetic A", "team2": "Synthetic B", "score": {"ft": [1, 0]}})
        self.assertEqual(self.read_cup(self.KEY, corrected, NOW + timedelta(days=8)), "ok")
        after = self.matches(self.KEY)
        hungary = next(k for k in after if "|Hungary|Dutch East Indies|" in k)
        self.assertEqual((after[hungary][3], after[hungary][4], after[hungary][13]), (6, 1, self.before[hungary][13] + 1))
        self.assertFalse([k for k in after if "|Sweden|Austria|" in k])
        self.assertTrue([k for k in after if "|Synthetic A|Synthetic B|" in k])
        unchanged = [k for k in self.before if k in after and k != hungary]
        self.assertEqual(len(unchanged), len(self.before) - 2)
        for k in unchanged:
            self.assertEqual(after[k][2:15], self.before[k][2:15], k)  # scores, revision, updated_at (positions may move)
        self.assertEqual(self.run_record("openfootball", f"open-cups:{self.KEY}")[:3], ("ok", None, 3))

    def test_19o_a_reviewed_retraction_alone_may_go(self):
        from vega.sources import snapshot

        france = next(k for k in self.before if "|France|Belgium|" in k)
        without = dict(self.body, matches=[m for m in self.body["matches"] if not pair(m, "France", "Belgium") and not pair(m, "Sweden", "Cuba")])
        with patch.dict(snapshot.RETRACTIONS, {("openfootball", france): "test: reviewed retraction"}):
            # The unreviewed Sweden–Cuba keeps the edition whole.
            self.assertKept(self.read_cup(self.KEY, without, NOW + timedelta(days=8)), "SNAPSHOT_DROPS_RESULT")
            alone = dict(self.body, matches=[m for m in self.body["matches"] if not pair(m, "France", "Belgium")])
            self.assertEqual(self.read_cup(self.KEY, alone, NOW + timedelta(days=16)), "ok")
        after = self.matches(self.KEY)
        self.assertNotIn(france, after)
        self.assertEqual(set(after), set(self.before) - {france})


# -- open-matchday --
FOLDER, OTHER = "ENG_5_national-league", "SCO_3_league-one"
RESULTS = ("date,home,away,ft_home,ft_away,ht_home,ht_away,home_shots,away_shots,home_corners,away_corners\n"
           "2026-11-01,North FC,South FC,2,1,1,0,11,7,6,3\n")
FIXTURES = "date,home,away,gw\n2026-11-29,South FC,North FC,16\n"


def league(folder=FOLDER, **over):
    return {"league": "National League", "folder": "data/" + folder, "results": 1, "fixtures": 1, "errors": [], **over}


class OpenMatchdayGuardTest(SnapshotDatabase):
    def read(self, leagues, files, at):
        """One due read of the europe scope: its outcome, rows written and unmatched."""
        def get(url, *, as_text=False):
            if url.endswith("build_summary.json"):
                return {"season": "2627", "generated_utc": "2026-11-17T07:19:26Z", "leagues": leagues}
            name = url.removeprefix(open_matchday.RAW + "data/")
            if name not in files:
                raise SourceError("HTTP_404")
            return files[name]

        outcome = sources.run_due(self.db, get, at, names={"open_matchday"})[("open_matchday", "europe")]
        return (outcome, *self.run_record("open_matchday", "europe")[2:])

    @staticmethod
    def files(folder=FOLDER, results=RESULTS, fixtures=FIXTURES):
        out = {}
        if results is not None:
            out[f"{folder}/results_2627.csv"] = results
        if fixtures is not None:
            out[f"{folder}/fixtures_2627.csv"] = fixtures
        return out

    def state(self, folder=FOLDER):
        return self.x(
            """SELECT p.provider_key, m.id, m.status::text, m.home_score, m.away_score, m.home_score_ht, m.away_score_ht,
                      m.revision, m.updated_at, m.xmin::text,
                      (SELECT json_agg(json_build_array(s.team_id, s.period::text, s.total_shots, s.corners, s.xmin::text)
                                       ORDER BY s.team_id, s.period) FROM core.team_match_stats s
                       WHERE s.season_id = m.season_id AND s.match_id = m.id)
               FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
               JOIN core.provider_ids p ON p.entity_type = 'match' AND p.entity_id = m.id
               WHERE cs.cup_key = %s ORDER BY 1""", (f"open-matchday:{folder}:2026/2027",)).fetchall()

    def stamps(self, folder=FOLDER):
        return self.x("SELECT cup_checked_at, cup_updated_at FROM core.competition_seasons WHERE cup_key = %s",
                      (f"open-matchday:{folder}:2026/2027",)).fetchone()

    def failures(self):
        return self.x("SELECT error_code, message FROM ops.parse_failures ORDER BY id").fetchall()

    def setUp(self):
        super().setUp()
        self.assertEqual(self.read([league()], self.files(), NOW), ("ok", 2, 0))
        self.before = self.state()
        self.assertEqual([r[2:7] for r in self.before], [
            ("finished", 2, 1, 1, 0),  # North FC–South FC, 1 November
            ("not_started", None, None, None, None),  # South FC–North FC, 29 November
        ])
        self.assertEqual(len(self.before[0][10]), 2)  # the result's statistics, one row per side

    def assertKept(self, outcome, code, folder=FOLDER):
        self.assertEqual(outcome[0], "ok")
        self.assertGreaterEqual(outcome[2], 1)  # unmatched
        self.assertEqual(self.state(folder), self.before)
        found = [f for f in self.failures() if f[0] == code]
        self.assertTrue(found, self.failures())
        self.assertIn(f"open-matchday:{folder}:2026/2027", found[-1][1])

    def test_19p_a_fixture_with_the_key_of_a_result_is_that_result(self):
        stale = FIXTURES + "2026-11-01,North FC,South FC,15\n"
        outcome = self.read([league(fixtures=2)], self.files(fixtures=stale), NOW + timedelta(days=1))
        self.assertEqual(outcome, ("ok", 2, 0))
        self.assertEqual(self.state(), self.before)

    def test_19q_an_incomplete_folder_keeps_its_edition(self):
        header = RESULTS.splitlines()[0] + "\n"
        cases = (
            ("other headers", "INVALID_HEADER", [league()],
             self.files(results="kickoff,home_team,away_team,home_score,away_score\n2026-11-01,North FC,South FC,2,1\n")),
            ("a header-only file", "ROW_COUNT_MISMATCH", [league()], self.files(results=header)),
            ("fewer rows than declared", "ROW_COUNT_MISMATCH", [league(results=2)], self.files()),
            ("errors reported", "SOURCE_REPORTED_ERRORS", [league(errors=["football-data: timeout"])], self.files()),
            ("boolean counts", "MANIFEST_INVALID", [league(results=True, fixtures=True)], self.files()),
            # sources/repro/probe.py missing_manifest_parts: a manifest describing neither file.
            ("neither file", "MANIFEST_INVALID", [league(results=False, fixtures=False)], self.files()),
        )
        for days, (name, code, leagues, files) in enumerate(cases, 1):
            with self.subTest(name):
                self.assertKept(self.read(leagues, files, NOW + timedelta(days=days)), code)

    def test_19r_a_result_row_without_its_goals_keeps_the_edition(self):
        for days, goals in enumerate((",", "2,", "2,x", "2,-1"), 1):
            with self.subTest(goals=goals):
                row = f"2026-11-01,North FC,South FC,{goals},1,0,11,7,6,3\n"
                self.assertKept(self.read([league()], self.files(results=RESULTS.splitlines()[0] + "\n" + row), NOW + timedelta(days=days)),
                                "INVALID_RESULT_ROW")

    def test_19s_a_result_dropped_or_listed_as_a_fixture_keeps_the_edition(self):
        other = RESULTS.splitlines()[0] + "\n2026-11-08,North FC,East FC,0,0,0,0,5,5,2,2\n"
        self.assertKept(self.read([league()], self.files(results=other), NOW + timedelta(days=1)), "SNAPSHOT_DROPS_RESULT")
        as_fixture = "date,home,away,gw\n2026-11-01,North FC,South FC,15\n2026-11-29,South FC,North FC,16\n"
        self.assertKept(self.read([league(results=0, fixtures=2)], self.files(results=None, fixtures=as_fixture), NOW + timedelta(days=2)),
                        "RESULT_DOWNGRADED")

    def test_19t_one_rejected_folder_does_not_hold_back_another(self):
        files = {**self.files(results="kickoff,home_team\n2026-11-01,North FC\n"), **self.files(OTHER, results=RESULTS.replace("North FC", "Elgin"))}
        outcome = self.read([league(), league(OTHER, league="Scottish League One", fixtures=0)], files, NOW + timedelta(days=1))
        self.assertEqual(outcome, ("ok", 1, 1))
        self.assertEqual(self.state(), self.before)
        self.assertEqual([r[2:5] for r in self.state(OTHER)], [("finished", 2, 1)])

    def test_19u_the_same_files_read_again_change_nothing(self):
        checked, updated = self.stamps()
        self.assertEqual(self.read([league()], self.files(), NOW + timedelta(days=1)), ("ok", 2, 0))
        self.assertEqual(self.state(), self.before)  # no update: revision, updated_at, row versions, statistics
        self.assertEqual(self.failures(), [])
        stamps = self.stamps()
        self.assertGreater(stamps[0], checked)
        self.assertEqual(stamps[1], updated)

    def test_19v_a_corrected_score_or_statistic_is_a_change_of_its_match(self):
        _, updated = self.stamps()
        corrected = RESULTS.replace(",2,1,1,0,11,", ",2,2,1,0,11,")
        self.assertEqual(self.read([league()], self.files(results=corrected), NOW + timedelta(days=1)), ("ok", 2, 0))
        result, fixture = self.state()
        self.assertEqual((result[2:5], result[7]), (("finished", 2, 2), self.before[0][7] + 1))
        self.assertEqual(fixture, self.before[1])
        self.assertGreater(self.stamps()[1], updated)
        shots = corrected.replace(",11,7,", ",12,7,")
        self.assertEqual(self.read([league()], self.files(results=shots), NOW + timedelta(days=2)), ("ok", 2, 0))
        again = self.state()[0]
        home = again[10][0]  # North FC (the first team written), the whole match
        self.assertEqual((again[7], home[1], home[2]), (result[7] + 1, "all", 12))

    def test_19w_a_fixture_no_longer_listed_is_removed(self):
        self.assertEqual(self.read([league(fixtures=0)], self.files(fixtures=None), NOW + timedelta(days=1)), ("ok", 1, 0))
        self.assertEqual(self.state(), self.before[:1])


    # 22a, 22b (FAILURE_MODES.md §22, written before the code): a later file without a statistic keeps it; a
    # stated value, 0 included, replaces it once.
    def test_22a_missing_statistic_columns_or_cells_keep_the_stored_values(self):
        _, updated = self.stamps()
        without_columns = "date,home,away,ft_home,ft_away,ht_home,ht_away\n2026-11-01,North FC,South FC,2,1,1,0\n"
        empty_cells = RESULTS.splitlines()[0] + "\n2026-11-01,North FC,South FC,2,1,1,0,,,,\n"
        for days, (name, results) in enumerate((("no statistic columns", without_columns), ("empty cells", empty_cells)), 1):
            with self.subTest(name):
                self.assertEqual(self.read([league()], self.files(results=results), NOW + timedelta(days=days)), ("ok", 2, 0))
                self.assertEqual(self.state(), self.before)  # ids, revision, updated_at, statistics and their row versions
                self.assertEqual(self.stamps()[1], updated)
                self.assertEqual(self.failures(), [])

    def test_22b_a_stated_zero_replaces_the_stored_value_once(self):
        zero = RESULTS.replace(",11,7,", ",0,7,")
        self.assertEqual(self.read([league()], self.files(results=zero), NOW + timedelta(days=1)), ("ok", 2, 0))
        result = self.state()[0]
        self.assertEqual((result[7], result[10][0][1], result[10][0][2]), (self.before[0][7] + 1, "all", 0))
        self.assertEqual(result[10][1][2], 7)  # the other side's stated value
        self.assertEqual(self.read([league()], self.files(results=zero), NOW + timedelta(days=2)), ("ok", 2, 0))
        self.assertEqual(self.state()[0], result)


    def test_attested_final_accepts_late_stats_without_moving_the_match(self):
        folder = "ENG_6_national-league-north"
        header = "date,home,away,ft_home,ft_away"
        row = "2026-08-31,AFC Telford,Bedford,0,1"
        plain = f"{header}\n{row}\n"
        enriched = f"{header},ht_home,ht_away,home_corners\n{row},0,1,4\n"
        scope = [league(folder, results=1, fixtures=0)]
        def read_result(day, body):
            self.assertEqual(self.read(scope, self.files(folder, results=body, fixtures=None), NOW + timedelta(days=day)),
                             ("ok", 1, 0))
            state = self.state(folder)[0]
            position = self.x("SELECT archive_position FROM core.matches WHERE id=%s", (state[1],)).fetchone()[0]
            return state, position

        original, before_position = read_result(1, plain)
        state, position = read_result(2, enriched)
        self.assertEqual((state[0:5], position), (original[0:5], before_position))
        self.assertEqual(state[5:8], (0, 1, original[7] + 1))
        self.assertEqual(state[10][0][1:4], ["all", None, 4])
        self.assertEqual(read_result(3, plain), (state, position))

    def test_a_qualified_league_keeps_only_the_proven_rolling_prefix(self):
        folder = "ENG_6_national-league-north"
        first_day = datetime(2026, 9, 5, tzinfo=timezone.utc)
        past = "2026-08-31,First Home,First Away,1,0"
        overlap = [
            f"{(first_day + timedelta(days=i // 10)).date()},Home {i},Away {i},1,0"
            for i in range(60)
        ]
        new = "2026-11-18,New Home,New Away,0,1"

        def read_day(rows, step):
            body = "date,home,away,ft_home,ft_away\n" + "\n".join(rows) + "\n"
            return self.read([league(folder, results=len(rows), fixtures=0)],
                             self.files(folder, results=body, fixtures=None), NOW + timedelta(days=step))

        self.assertEqual(read_day([past, *overlap], 1), ("ok", 61, 0))
        first = self.state(folder)[0]
        self.assertIn("2026-08-31", first[0])
        self.assertEqual(read_day([*overlap, new], 2), ("ok", 62, 0))
        accepted = self.state(folder)
        self.assertEqual(accepted[0], first)
        self.assertEqual(len(accepted), 62)
        self.assertEqual(read_day([*overlap, new], 3), ("ok", 62, 0))
        self.assertEqual(self.state(folder), accepted)
        # Missing the first of several matches on the boundary day is an interior omission.
        for step, invalid in ((4, [*overlap[1:], new]), (5, [*overlap[-3:], new])):
            with self.subTest(step=step):
                self.assertEqual(read_day(invalid, step), ("ok", 0, 1))
                self.assertEqual(self.failures()[-1][0], "SNAPSHOT_DROPS_RESULT")
                self.assertEqual(self.state(folder), accepted)


class CupApiScoreTest(SnapshotDatabase):
    """22c: the 90-minute score is never invented: source -> cups.save -> PostgreSQL -> the real /api/cups/edition."""

    def edition_scores(self, matches):
        with self.db.transaction():
            cups.save(self.db, "open-cups", "euro", "2024", {"name": "Scores", "matches": matches}, NOW)
        competition = self.x("SELECT competition_id FROM api.cup_editions WHERE competition = 'euro' AND season = '2024'").fetchone()[0]
        js = """import {createReader} from './src/db.mjs';import {createHandler} from './src/handler.mjs';
const [dsn,id]=process.argv.slice(1);const r=createReader(dsn,{role:'vega_read'});const h=createHandler({read:r.read});
const res=await h(new Request('https://local/api/cups/edition?competition='+id+'&season=2024'));
console.log(JSON.stringify({status:res.status,body:await res.json()}));await r.end();"""
        done = subprocess.run([NODE, "--input-type=module", "-e", js, DSN, str(competition)], cwd=ROOT / "api", capture_output=True, text=True, timeout=120)
        self.assertEqual(done.returncode, 0, done.stderr)
        out = json.loads(done.stdout.strip().splitlines()[-1])
        self.assertEqual(out["status"], 200)
        return {(m["team1"], m["team2"]): m.get("score") for m in out["body"]["matches"]}

    def test_22c_extra_time_without_regulation_has_no_ft(self):
        scores = self.edition_scores([
            {"date": "2024-07-01", "team1": "One", "team2": "Two", "score": {"et": [2, 1]}},
            {"date": "2024-07-02", "team1": "Three", "team2": "Four", "score": {"ft": [1, 1], "et": [2, 1]}},
            {"date": "2024-07-03", "team1": "Five", "team2": "Six", "score": {"ft": [0, 0], "et": [0, 0], "p": [4, 3]}},
            {"date": "2024-07-04", "team1": "Seven", "team2": "Eight", "score": {"ft": [3, 0]}},
        ])
        self.assertEqual(scores[("One", "Two")], {"et": [2, 1]})
        self.assertEqual(scores[("Three", "Four")], {"ft": [1, 1], "et": [2, 1]})
        self.assertEqual(scores[("Five", "Six")], {"ft": [0, 0], "et": [0, 0], "p": [4, 3]})
        self.assertEqual(scores[("Seven", "Eight")], {"ft": [3, 0]})


class CupCatalogueLogoTest(SnapshotDatabase):
    """C6 (FAILURE_MODES.md §22, written before the code): a cup-only competition's verified logo reaches the catalogue
    by the edition's own competition (its FK), additively: source -> open_matchday.save -> PostgreSQL -> the real API."""

    def api(self, path):
        js = """import {createReader} from './src/db.mjs';import {createHandler} from './src/handler.mjs';
const [dsn,path]=process.argv.slice(1);const r=createReader(dsn,{role:'vega_read'});const h=createHandler({read:r.read});
const res=await h(new Request('https://local'+path));console.log(JSON.stringify({status:res.status,body:await res.json()}));await r.end();"""
        done = subprocess.run([NODE, "--input-type=module", "-e", js, DSN, path], cwd=ROOT / "api", capture_output=True, text=True, timeout=120)
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout.strip().splitlines()[-1])

    def test_the_catalogue_carries_the_competition_logo(self):
        results = open_matchday.rows("date,home,away,ft_home,ft_away\n2026-08-01,Brickfield,Llanuwchllyn,5,1\n")
        with self.db.transaction():
            open_matchday.save(self.db, "WAL_2_cymru-north", "Cymru North", "2026/2027", results, [], NOW)
        reference = "https://media.vega.invalid/sha256/" + "0b2958916b260998034409a86e6ede3879dd706020e0371df9b9e03ddb826022" + ".png"
        logo = self.x("INSERT INTO core.assets(kind, source_url, s3_key) VALUES ('logo', %s, 'sources/v2/images/x.png') RETURNING id", (reference,)).fetchone()[0]
        competition = self.x("SELECT competition_id FROM core.competition_seasons WHERE cup_key LIKE 'open-matchday:WAL_2_cymru-north:%'").fetchone()[0]
        self.x("UPDATE core.competitions SET logo_asset_id = %s WHERE id = %s", (logo, competition))
        index = self.api("/api/cup-index?kind=supplemental")
        self.assertEqual(index["status"], 200)
        [entry] = index["body"]["competitions"]
        self.assertEqual((entry["folder"], entry["image_url"]), ("WAL_2_cymru-north", reference))
        cups = self.api("/api/cups/index")["body"]["cups"]
        self.assertEqual([c.get("imageUrl") for c in cups if c["key"] == "WAL_2_cymru-north"], [reference])
        # No logo: the field is absent, the body otherwise as before.
        self.x("UPDATE core.competitions SET logo_asset_id = NULL WHERE id = %s", (competition,))
        self.assertNotIn("image_url", self.api("/api/cup-index?kind=supplemental")["body"]["competitions"][0])


class CupLogosTest(SnapshotDatabase):
    """19.4 L1–L6: reviewed competition logos through curated.cup_logos."""

    LOGOS = json.loads((REPO / "dashboard/shared/cup-logos.json").read_text())["logos"]

    def competition(self, provider, key, name, logo=None):
        comp = self.x("INSERT INTO core.competitions(name, logo_asset_id) VALUES (%s, %s) RETURNING id", (name, logo)).fetchone()[0]
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition', %s, %s, %s)",
               (provider, key, comp))
        return comp

    def logo(self, comp):
        return self.x("""SELECT a.id, a.kind::text, a.source_url, a.author FROM core.competitions c
                         LEFT JOIN core.assets a ON a.id = c.logo_asset_id WHERE c.id = %s""", (comp,)).fetchone()

    def test_L1_to_L6(self):
        own = self.x("INSERT INTO core.assets(kind, source_url) VALUES ('logo', 'https://cdn.pitchapi.dev/l/world-cup.png') RETURNING id").fetchone()[0]
        ids = {
            "aut": self.competition("vega", "cup:open-matchday:AUT_CUP_ofb-cup", "OFB Cup"),
            "aut_archive": self.competition("vega", "cup:open-cups:austria-cup-archive", "austria-cup-archive"),
            "dfb": self.competition("vega", "cup:open-matchday:GER_CUP_dfb-pokal", "DFB-Pokal"),
            "dfb_archive": self.competition("vega", "cup:open-cups:germany-cup-archive", "germany-cup-archive"),
            "dfb_openligadb": self.competition("vega", "cup:openligadb:germany-cup", "germany-cup"),
            "unl": self.competition("vega", "cup:openligadb:nations-league", "nations-league"),
            "unl_results": self.competition("vega", "cup:nations-results:nations-league", "nations-league"),
            "world_cup": self.competition("pitchapi", "l_1XLtP0", "World Cup"),
        }
        self.x("""INSERT INTO core.family_artwork_qualifications(competition_id,asset_id,certificate,manifest_sha256)
                  VALUES (%s,%s,'{"asset_role":"competition_logo","competition_identity_only":true}',repeat('a',64))""",
               (ids["world_cup"], own))
        self.x("UPDATE core.competitions SET logo_asset_id=%s WHERE id=%s", (own, ids["world_cup"]))
        with self.db.transaction():
            curated.cup_logos(self.db)
        aut = self.logo(ids["aut"])
        self.assertEqual(aut[1:], ("logo", self.LOGOS["open-matchday:AUT_CUP_ofb-cup"]["imageUrl"], "SportScore"))
        self.assertEqual(self.logo(ids["aut_archive"])[0], aut[0])
        self.assertEqual(self.logo(ids["dfb"])[2], self.LOGOS["open-matchday:GER_CUP_dfb-pokal"]["imageUrl"])
        self.assertEqual({self.logo(ids[k])[0] for k in ("dfb", "dfb_archive", "dfb_openligadb")}, {self.logo(ids["dfb"])[0]})
        self.assertEqual(self.logo(ids["unl_results"])[0], self.logo(ids["unl"])[0])
        self.assertEqual(self.logo(ids["unl"])[2], self.LOGOS["openligadb:nations-league"]["imageUrl"])
        self.assertEqual(self.logo(ids["world_cup"])[0], own)  # L4
        # L3: the competitions of the other keys are not in this base: nothing created for them.
        self.assertEqual(self.x("SELECT count(*) FROM core.competitions").fetchone()[0], len(ids))
        # L6: a second pass writes nothing.
        assets = self.x("SELECT count(*) FROM core.assets").fetchone()[0]
        rows = self.x("SELECT id, logo_asset_id, updated_at, xmin::text FROM core.competitions ORDER BY id").fetchall()
        with self.db.transaction():
            curated.cup_logos(self.db)
        self.assertEqual(self.x("SELECT count(*) FROM core.assets").fetchone()[0], assets)
        self.assertEqual(self.x("SELECT id, logo_asset_id, updated_at, xmin::text FROM core.competitions ORDER BY id").fetchall(), rows)


class CupLogoKeysTest(unittest.TestCase):
    def test_L5_every_logo_key_and_alias_is_named_by_a_source_family_or_the_site(self):
        logos = json.loads((REPO / "dashboard/shared/cup-logos.json").read_text())["logos"]
        for key in logos:
            self.assertTrue(key.startswith("l_") or key.split(":", 1)[0] in curated.CUP_FAMILY, key)
        archives = dict(re.findall(r'"([A-Z]{3}_CUP_[a-z0-9-]+)": \{ key: "([a-z-]+)"',
                                   (REPO / "dashboard/frontend/src/services/cup-archives.js").read_text()))
        self.assertEqual(sorted(archives.values()), sorted(cups.NATIONAL_CUP_ARCHIVES))
        site = {(f"open-matchday:{folder}", f"cup:open-cups:{key}") for folder, key in archives.items()}
        site |= {("open-matchday:GER_CUP_dfb-pokal", "cup:openligadb:germany-cup"),
                 ("openligadb:nations-league", "cup:nations-results:nations-league")}
        aliases = {(key, also) for key, targets in curated.CUP_LOGO_ALSO.items() for also in targets}
        self.assertEqual(aliases, site)
        self.assertTrue(all(key in logos for key, _ in aliases))


if __name__ == "__main__":
    unittest.main()


class CupPublishedPhasesTest(CupCatalogueLogoTest):
    def edition_response(self, competition, season):
        [public] = self.x("SELECT competition_id FROM api.cup_editions WHERE competition=%s AND season=%s",
                          (competition, season)).fetchone()
        return self.api(f"/api/cups/edition?competition={public}&season={season}")["body"]

    def test_verified_award_and_source_loss(self):
        text = (ROOT / "tests/fixtures/openfootball/france-2024.txt").read_text()
        key = "france-cup:2024/2025"
        self.assertEqual(self.read_cup(key, text.replace("[awarded]", ""), NOW), "ok")
        match = lambda: next(m for m in self.edition_response("france-cup", "2024/2025")["matches"]
                             if m["team1"] == "Tours FC" and m["team2"] == "FC Lorient")
        self.assertEqual(match()["score"], {"ft": [0, 3]})
        self.assertEqual(self.read_cup(key, text, NOW + timedelta(days=1)), "ok")
        approved = match()
        self.assertEqual((approved["status"], approved["awardScore"]), ("awarded", [0, 3]))
        self.assertIn("fff.fr", approved["awardReason"]["source"])
        self.assertNotIn("score", approved)
        before = self.matches(key)
        self.assertEqual(self.read_cup(key, text.replace("[awarded]", ""), NOW + timedelta(days=2)), "PERIODS_CONFLICT")
        self.assertEqual(self.matches(key), before)
        self.assertEqual(match(), approved)

    def test_club_world_cup_22_halves_and_edition_notification(self):
        from vega.worker import publish

        count = 0
        for year in (2021, 2022, 2023):
            key = f"club-world-cup:{year}"
            text = (ROOT / f"tests/fixtures/openfootball/openfootball-{year}.txt").read_text()
            self.assertEqual(self.read_cup(key, text, NOW), "ok")
            matches = self.edition_response("club-world-cup", str(year))["matches"]
            count += len(matches)
            self.assertTrue(all(m["score"].get("ht") is not None for m in matches))
            if year == 2021:
                self.assertEqual(matches[-1]["score"], {"ft": [1, 1], "ht": [0, 0], "et": [2, 1]})
            generation = publish(self.db, NOW, force=True)
            self.assertIsNotNone(generation)
            old = self.matches(key)
            self.assertEqual(self.read_cup(key, text, NOW + timedelta(days=1)), "ok")
            self.assertIsNone(publish(self.db, NOW + timedelta(days=1), force=True))
            self.assertEqual(self.matches(key), old)
        self.assertEqual(count, 22)
