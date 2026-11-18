"""Frozen OpenLigaDB -> Node bridge -> scheduled collect -> PG18 -> actual cup handler."""
from contextlib import contextmanager
from copy import deepcopy
import csv
from datetime import timedelta
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import test_source_snapshots as snapshots
from vega import sources
from vega.sources import cups

DSN = os.environ.get("VEGA_V2_DFB_PERIODS_TEST_DSN")
FIXTURES = snapshots.ROOT / "tests/fixtures/openligadb"
RAW = {year: json.loads((FIXTURES / f"dfb-{year}.json").read_text()) for year in (2025, 2026)}
with (FIXTURES / "dfb-oracle.csv").open() as handle:
    ORACLE = {r["provider_key"]: r for r in csv.DictReader(handle)}
RDS = json.loads((FIXTURES / "rds-preimage.json").read_text())
PREIMAGE = {r["provider_key"]: r for values in RDS["rows"] if (r := dict(zip(RDS["columns"], values)))}
NOW = snapshots.NOW
SCORES = snapshots.SCORES
URL = "https://api.openligadb.de/getmatchdata/"


def edition(year):
    return f"{year}/{year + 1}"


def pair(value):
    return tuple(map(int, value.split("/"))) if value else (None, None)


def row_for(rows, key):
    return next(m for m in rows if str(m["matchID"]) == str(key))


def period(kind, pair_value):
    kinds = {1: ("HalfTime", "Halbzeit"), 2: ("After90Minutes", "Endergebnis"),
             3: ("Unknown", "Nachspielzeit"), 5: ("AfterPenalties", "Elfmeterschießen")}
    return dict(resultID=90000 + kind, resultTypeID=kind, resultTypeKind=kinds[kind][0], resultName=kinds[kind][1],
                resultOrderID=kind, pointsTeam1=pair_value[0], pointsTeam2=pair_value[1])


@unittest.skipUnless(DSN and snapshots.psycopg and snapshots.NODE, "requires PG18 DFB periods test DB, psycopg and Node")
class DfbPeriodsReplay(snapshots.SnapshotDatabase):
    __unittest_skip__ = False
    __unittest_skip_why__ = ""

    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate
        from urllib.parse import urlparse

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_dfb_periods_test":
            raise RuntimeError("dedicated local DFB periods test database required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)

    def setUp(self):
        super().setUp()
        self.x("TRUNCATE ops.dfb_period_observations") if self.x("SELECT to_regclass('ops.dfb_period_observations')").fetchone()[0] else None

    @contextmanager
    def serving_raw(self, year, rows, series="dfb"):
        path = self.tmp / "openliga.json"
        path.write_text(json.dumps(rows, ensure_ascii=False))
        preload = snapshots.ROOT / "tests/fake_openligadb_fetch.mjs"
        with patch.dict(os.environ, {"NODE_OPTIONS": f"--import={preload.as_uri()}",
                                    "VEGA_TEST_OPENLIGA_URL": f"{URL}{series}/{year}", "VEGA_TEST_OPENLIGA": str(path)}):
            yield

    def refresh(self, year, rows, day=0, *, series="dfb"):
        label = "germany-cup" if series == "dfb" else "nations-league"
        scope = f"openligadb:{label}:{edition(year)}"
        with self.serving_raw(year, rows, series), patch.object(cups, "scopes", lambda now: {scope: timedelta(seconds=1)}):
            self.x("SET ROLE vega_collect")
            try:
                return sources.run_due(self.db, None, NOW + timedelta(days=day), names={"openligadb"})[("openligadb", scope)]
            finally:
                self.x("RESET ROLE")

    def stamps(self, year):
        return self.x("SELECT cup_digest, cup_checked_at, cup_updated_at FROM core.competition_seasons WHERE cup_key=%s",
                      (f"openligadb:germany-cup:{edition(year)}",)).fetchone()

    def state(self, year):
        return {str(r[0]): r[1:] for r in self.x(
            f"""SELECT p.provider_key, m.id, m.archive_position, {', '.join('m.' + c + ('::text' if c == 'status' else '') for c in SCORES)},
                       m.revision, m.updated_at, m.xmin::text, m.home_team_id, m.away_team_id, m.match_date::text
                FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
                JOIN core.provider_ids p ON p.entity_type = 'match' AND p.provider = 'openligadb' AND p.entity_id = m.id
                WHERE cs.cup_key = %s ORDER BY m.archive_position""", (f"openligadb:germany-cup:{edition(year)}",)).fetchall()}

    def api(self, year):
        [competition] = self.x("SELECT competition_id FROM api.cup_editions WHERE competition='germany-cup' AND season=%s", (edition(year),)).fetchone()
        js = """import {createReader} from './src/db.mjs'; import {createHandler} from './src/handler.mjs';
const [dsn,id,season]=process.argv.slice(1);const r=createReader(dsn,{role:'vega_read'});const h=createHandler({read:r.read});
const res=await h(new Request('https://local/api/cups/edition?'+new URLSearchParams({competition:id,season})));
console.log(JSON.stringify({status:res.status, etag:res.headers.get('etag'), body:await res.json()}));await r.end();"""
        call = subprocess.run([snapshots.NODE, "--input-type=module", "-e", js, DSN, str(competition), edition(year)],
                              cwd=snapshots.ROOT / "api", check=True, capture_output=True, text=True, timeout=120)
        result = json.loads(call.stdout.strip().splitlines()[-1])
        self.assertEqual(result["status"], 200)
        return result

    def stage_rds_facts(self, year):
        # Materialize identities/rounds by the normal writer, then restore the sealed RDS score
        # pre-image onto these local keys. IDs and positions below are owned by the disposable DB.
        self.assertEqual(self.refresh(year, RAW[year]), "ok")
        for key, r in PREIMAGE.items():
            if r["edition"].endswith(edition(year)):
                self.x(f"""UPDATE core.matches SET {', '.join(c+'=%s' for c in SCORES)}, revision=9
                           WHERE id = (SELECT entity_id FROM core.provider_ids
                                       WHERE entity_type='match' AND provider='openligadb' AND provider_key=%s)""",
                       tuple(r[c] for c in SCORES) + (key,))
        self.x("UPDATE core.competition_seasons SET cup_digest=%s WHERE cup_key=%s",
               ("staged-rds-preimage", f"openligadb:germany-cup:{edition(year)}"))

    def test_every_key_from_clean_and_rds_preimage_through_repeat_and_read_api(self):
        evidence = {}
        for year, finished in ((2025, 63), (2026, 48)):
            evidence[year] = {"source_sha256": sha256((FIXTURES / f"dfb-{year}.json").read_bytes()).hexdigest(), "rows": {}}
            self.stage_rds_facts(year)
            before, before_api = self.state(year), self.api(year)
            self.assertEqual(self.refresh(year, RAW[year], 1), "ok")
            after, after_api = self.state(year), self.api(year)
            self.assertEqual(list(after), list(before))
            self.assertEqual(len(after), len(RAW[year]))
            count = [0, 0, 0, 0, 0]
            for key, stored in after.items():
                oracle, published = ORACLE[key], PREIMAGE[key]
                self.assertEqual((stored[:2], stored[16:]), (before[key][:2], before[key][16:]), key)
                self.assertEqual(stored[2:5], tuple(published[c] for c in SCORES[:3]), key)
                extra = oracle["phase"] in ("ET", "PEN")
                expected = (*pair(oracle["dfb_90"] if extra else ""), *pair(oracle["dfb_half"]),
                            *pair(oracle["dfb_before_kicks"] if extra else ""), *pair(oracle["dfb_kicks"])) if stored[2] == "finished" else (None,) * 8
                self.assertEqual(stored[5:13], expected, key)
                self.assertEqual(stored[13] - before[key][13], int(stored[2] == "finished"), key)
                if stored[2] != "finished":
                    self.assertEqual(stored, before[key], key)
                count = [a + int(b) for a, b in zip(count, (stored[7] is not None, extra, bool(oracle["dfb_kicks"]),
                         stored[11:13] != before[key][11:13], stored[2] == "not_started"))]
                evidence[year]["rows"][key] = {"rds": published, "local_before": before[key], "actual": stored, "expected_phases": expected}
            self.assertEqual(count, [63, 14, 8, 6, 0] if year == 2025 else [48, 7, 5, 5, 8])
            self.assertEqual(self.run_record("openligadb", f"openligadb:germany-cup:{edition(year)}"), ("ok", None, finished, 0))
            self.assertEqual([m for m in after_api["body"]["matches"] if m["status"] == "scheduled"],
                             [m for m in before_api["body"]["matches"] if m["status"] == "scheduled"])
            stamps = self.stamps(year)
            for day in (2, 3):
                self.assertEqual(self.refresh(year, RAW[year], day), "ok")
                self.assertEqual(self.state(year), after)
                self.assertEqual(self.run_record("openligadb", f"openligadb:germany-cup:{edition(year)}"), ("ok", None, 0, 0))
                self.assertEqual(self.stamps(year)[::2], stamps[::2])
                self.assertGreater(self.stamps(year)[1], stamps[1])
            self.assertEqual(self.api(year), after_api)
            evidence[year].update(before_api=before_api, after_api=after_api, counts=count)
        by_key = {m["key"]: m for m in evidence[2025]["after_api"]["body"]["matches"]}
        self.assertEqual(by_key["openliga:80173"]["periods"], {"ht": [0, 0], "ft": [0, 0], "et": [1, 1], "p": [4, 5]})
        self.assertEqual(by_key["openliga:79584"]["periods"], {"ht": [1, 1], "ft": [1, 1], "et": [2, 1]})
        self.assertIn("après prolongation", by_key["openliga:79584"]["notes"])
        if path := os.environ.get("VEGA_E2E_EVIDENCE"):
            (Path(path) / "dfb-replay.json").write_text(json.dumps(evidence, ensure_ascii=False, default=str, indent=2) + "\n")

    def test_attested_partial_convergence_and_third_state_use_separate_receipts(self):
        rows = deepcopy(RAW[2025])
        self.assertEqual(self.refresh(2025, rows), "ok")
        old = self.state(2025)
        match = row_for(rows, 79584)
        match["matchResults"][1]["pointsTeam1"] = 1
        a = row_for(rows, 80173)
        a["matchResults"].append(period(1, (0, 0)))
        a["matchResults"][2].update(pointsTeam1=4, pointsTeam2=5)
        self.assertEqual(self.refresh(2025, rows, 1), "ok")
        self.assertEqual(self.state(2025), old)
        stable = self.stamps(2025)
        for i, change in enumerate(("points", "date", "swap", "duplicate"), 2):
            fresh = deepcopy(rows)
            m = row_for(fresh, 79584)
            if change == "points":
                m["matchResults"][1]["pointsTeam1"] = 3
            elif change == "date":
                m["matchDateTime"] = "2025-10-28T20:45:00"
            elif change == "swap":
                m["team1"], m["team2"] = m["team2"], m["team1"]
            else:
                m["matchResults"].append(period(2, (4, 0)))
            code = "INVALID_PERIODS" if change == "duplicate" else "PERIODS_CONFLICT"
            self.assertEqual(self.refresh(2025, fresh, i), code)
            self.assertEqual(self.stamps(2025), stable)
            self.assertEqual(self.state(2025), old)
            self.assertIn("79584", self.x("SELECT message FROM ops.parse_failures ORDER BY at DESC LIMIT 1").fetchone()[0])
        seen = self.x("SELECT status, count(*) FROM ops.dfb_period_observations GROUP BY status ORDER BY status").fetchall()
        self.assertEqual(seen, [("accepted", 2), ("refused", 4)])

    def test_unattested_extra_time_and_incomplete_updates(self):
        played = {**deepcopy(RAW[2025][0]), "matchID": 999999,
                  "matchResults": [period(1, (0, 0)), period(2, (0, 0)), period(3, (1, 1)), period(5, (5, 6))]}
        fixture = {**deepcopy(played), "matchID": 999998, "matchIsFinished": False}
        self.assertEqual(self.refresh(2025, [played, fixture]), "ok")
        [game, future] = self.api(2025)["body"]["matches"]
        self.assertEqual(game["periods"], {"ht": [0, 0], "et": [1, 1], "p": [4, 5]})
        self.assertEqual((future["status"], future["score"], future["notes"]), ("scheduled", None, []))
        self.assertNotIn("periods", future)
        before, stamps = self.state(2025), self.stamps(2025)
        cases = [
            ("ht gone", lambda m: m["matchResults"].pop(0), "PERIODS_CONFLICT"),
            ("et gone", lambda m: (m["matchResults"].pop(), m["matchResults"].pop()), "PERIODS_CONFLICT"),
            ("down", lambda m: m.update(matchIsFinished=False), "RESULT_DOWNGRADED"),
            ("direct unknown", lambda m: m["matchResults"][-1].update(pointsTeam1=4, pointsTeam2=5), "PERIODS_CONFLICT"),
            ("no projection", lambda m: m.pop("matchResults"), "INVALID_PERIODS"),
            ("p without ET", lambda m: m["matchResults"].pop(2), "PERIODS_UNREVIEWED"),
            ("p below ET", lambda m: m["matchResults"][-1].update(pointsTeam1=0), "PERIODS_UNREVIEWED"),
            ("p tied", lambda m: m["matchResults"][-1].update(pointsTeam1=6), "PERIODS_UNREVIEWED"),
            ("et not level", lambda m: m["matchResults"][2].update(pointsTeam1=2), "PERIODS_UNREVIEWED"),
            ("unknown kind", lambda m: m["matchResults"][0].update(resultTypeKind="What"), "INVALID_PERIODS"),
            ("bad points", lambda m: m["matchResults"][0].update(pointsTeam1=-1), "INVALID_PERIODS"),
        ]
        for day, (label, mutate, code) in enumerate(cases, 1):
            with self.subTest(label):
                changed = deepcopy(played)
                mutate(changed)
                self.assertEqual(self.refresh(2025, [changed, fixture], day), code)
                self.assertEqual(self.state(2025), before)
                self.assertEqual(self.stamps(2025), stamps)
