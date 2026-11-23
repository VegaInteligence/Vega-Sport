"""Collection wake-ups and shared reads, written before the code: FAILURE_MODES.md §37 (37a–37m).

On a disposable local PostgreSQL (VEGA_V2_COLLECTION_TEST_DSN, database vega_v2_collection_test), under the real roles
(vega_collect for the collection, vega_calc for the daily pass):

- 37a–37d: the real Worker.daily and Open Matchday writer with the National League North files of the audit capsule
  (fixtures/open_matchday/nln-2026, provenance.json): four new results alone make the Elo due, a pass that changes
  nothing runs none (E04k).
- 37e–37f: a complementary score corrected by its source, a complementary match withdrawn then restored (E04k).
- 37g–37j: the International Results editions (nine since main's internationals of 2026/27, §48, 48i) through the real
  bridge and projection, each fetch counted in node (fake_results_fetch.mjs): one read per pass, each edition its own
  state (E02b).
- 48f–48h: the season's internationals, outside the Elo, do not wake it; the Nations League still does (§48).
- 49h–49k: the internationals of 2021/22 to 2025/26 (§49): one season list, finished seasons read weekly, fourteen
  editions in one read with no tournament row in an internationals edition, none waking the Elo.
- 37k–37m: an empty player statistics answer after an accepted one, through the real worker and store (E02d).
"""

import contextlib
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from prerequisites import required  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_COLLECTION_TEST_DSN")
NODE = shutil.which("node")
NLN = ROOT / "tests/fixtures/open_matchday/nln-2026"
FOLDER = "ENG_6_national-league-north"
RESULTS_PRELOAD = ROOT / "tests/fake_results_fetch.mjs"
RESULTS_URL = "https://raw.githubusercontent.com/martj42/international_results/master/results.csv"
# One result of each International Results edition the base reads (cups.EDITIONS), in the dataset's columns; since §49
# (49j), one row of the World Cup, the Euro and each tournament inside the older internationals seasons too, which
# stay out of them (each internationals season keeps exactly its one row held nowhere else).
RESULTS_CSV = """date,home_team,away_team,home_score,away_score,tournament,city,country,neutral
2022-01-10,Senegal,Zimbabwe,1,0,African Cup of Nations,Bafoussam,Cameroon,TRUE
2023-06-25,United States,Jamaica,1,1,Gold Cup,Chicago,United States,FALSE
2024-01-13,Qatar,Lebanon,3,0,AFC Asian Cup,Lusail,Qatar,FALSE
2024-01-15,Nigeria,Equatorial Guinea,1,1,African Cup of Nations,Abidjan,Ivory Coast,TRUE
2024-06-21,Argentina,Canada,2,0,Copa América,Atlanta,United States,TRUE
2025-06-15,Mexico,Dominican Republic,3,2,Gold Cup,Los Angeles,United States,TRUE
2025-12-21,Morocco,Comoros,2,0,African Cup of Nations,Rabat,Morocco,FALSE
2026-10-01,Scotland,Switzerland,1,0,UEFA Nations League,Glasgow,Scotland,FALSE
2026-10-10,Brazil,Japan,2,1,Friendly,Rio de Janeiro,Brazil,FALSE
2021-07-10,Argentina,Brazil,1,0,Copa América,Rio de Janeiro,Brazil,TRUE
2021-07-11,Italy,England,1,1,UEFA Euro,London,England,TRUE
2022-12-18,Argentina,France,3,3,FIFA World Cup,Lusail,Qatar,TRUE
2023-03-23,France,Netherlands,4,0,UEFA Euro qualification,Saint-Denis,France,FALSE
2024-03-26,England,Belgium,2,2,Friendly,London,England,FALSE
2024-06-14,Germany,Scotland,5,1,UEFA Euro,Munich,Germany,FALSE
2024-07-14,Spain,England,2,1,UEFA Euro,Berlin,Germany,TRUE
2024-09-07,Italy,France,3,1,UEFA Nations League,Paris,France,TRUE
2025-11-13,Ivory Coast,Kenya,1,0,African Cup of Nations qualification,Abidjan,Ivory Coast,FALSE
2026-06-15,Spain,Cape Verde,0,0,FIFA World Cup,Atlanta,United States,TRUE
"""
# The seasons of the season's other internationals (§49): 2021/22, the base's first, to 2026/27.
SEASONS = ("2021/2022", "2022/2023", "2023/2024", "2024/2025", "2025/2026", "2026/2027")
NATIONS_SCOPES = {"nations-results:nations-league:2026/2027", "nations-results:afcon:2021", "nations-results:afcon:2023",
                  "nations-results:afcon:2025", "nations-results:copa-america:2024", "nations-results:asian-cup:2023",
                  "nations-results:gold-cup:2023", "nations-results:gold-cup:2025",
                  *(f"nations-results:internationals:{season}" for season in SEASONS)}
INTERNATIONALS, NATIONS_LEAGUE = "nations-results:internationals:2026/2027", "nations-results:nations-league:2026/2027"


def encode(rows):
    return sha256(json.dumps(rows, default=str).encode()).hexdigest()


@required(DSN and psycopg, "requires a disposable local collection DB (VEGA_V2_COLLECTION_TEST_DSN) and psycopg")
class CollectionBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_collection_test":
            raise RuntimeError("dedicated local collection DB required")
        cls.db = connect_local(DSN)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        from vega.store import connect_local, migrate

        self.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(self.db)
        self.x = self.db.execute
        self.collect, self.calc = connect_local(DSN), connect_local(DSN)
        for conn, role in ((self.collect, "vega_collect"), (self.calc, "vega_calc")):
            self.addCleanup(conn.close)
            conn.execute(f"SET ROLE {role}")
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)


class EloWakeTest(CollectionBase):
    """37a–37f: the Elo after a change of its complementary population, and only then."""

    def setUp(self):
        super().setUp()
        from vega.sources import open_matchday_history
        from vega.store import Store
        from vega.worker import Worker

        # The capsule's live files alone: the results the source published then dropped are created by any read of
        # their edition (FAILURE_MODES.md §41, its Elo wake tested by 41o); these cases count the live ones.
        ledger = {k: r for k, r in open_matchday_history.RESULTS.items() if r.get("id_at_incident")}
        patcher = patch.object(open_matchday_history, "RESULTS", ledger)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.clock = datetime(2026, 11, 17, 18, tzinfo=timezone.utc)
        self.stage, self.fetches = "old", []
        self.worker = Worker(Store(self.collect), SimpleNamespace(), clock=lambda: self.clock, calc_conn=self.calc, source_get=self.get)

    def get(self, url, *, as_text=False):
        from vega.sources import open_matchday

        files = {open_matchday.RAW + "build_summary.json": "build_summary.json",
                 **{open_matchday.RAW + f"data/{FOLDER}/{f}": f for f in ("fixtures_2627.csv", "results_2627.csv")}}
        raw = (NLN / self.stage / files[url]).read_text()
        self.fetches.append(url)
        return raw if as_text else json.loads(raw)

    def native(self, year):
        """One finished PitchAPI match of the season `year`: its season becomes due once."""
        from vega.store import Store

        with self.db.transaction():
            season = Store(self.db).season(f"{year}/{year + 1}")
            comp = self.x("INSERT INTO core.competitions(name) VALUES (%s) RETURNING id", (f"Native {year}",)).fetchone()[0]
            edition = self.x("INSERT INTO core.competition_seasons(competition_id,season_id,native_label) VALUES (%s,%s,%s) RETURNING id",
                             (comp, season, f"{year}/{year + 1}")).fetchone()[0]
            a, b = (self.x("INSERT INTO core.teams(name) VALUES (%s) RETURNING id", (f"Native {year} {s}",)).fetchone()[0] for s in "AB")
            when = datetime(year, 10, 1, 12, tzinfo=timezone.utc)
            self.x("""INSERT INTO core.matches(competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,
                      match_date,kickoff_at) VALUES (%s,%s,'pitchapi','finished',%s,%s,1,0,%s,%s)""", (edition, season, a, b, when.date(), when))
        return season

    def daily(self, adapters):
        from vega import sources

        out = io.StringIO()
        with contextlib.redirect_stdout(out), patch.object(sources, "adapters", lambda: adapters):
            seasons = self.worker.daily()
        self.assertNotIn("error=", out.getvalue())
        return seasons

    def state(self):
        """(admitted sides, published sides, Elo runs, digest of agg.team_elo)."""
        from vega import power
        from vega.sources import identity

        merge = {team: keep for team, keep, *_ in identity.pairs(self.db)[0]}
        admitted = power.elo_matches(power.merged_rows(self.x(power.ELO_MATCHES).fetchall(), merge))
        pairs = {(r[0], side) for r in admitted for side in r[3:5]}
        runs = self.x("SELECT id, status, matches FROM agg.power_runs WHERE kind='elo' ORDER BY id").fetchall()
        published = {r[0] for r in runs if r[1] == "published"}
        stored = self.x("SELECT match_id, team_id, run_id, elo_before, elo_after FROM agg.team_elo ORDER BY 1, 2").fetchall()
        return pairs, {(m, t) for m, t, run, *_ in stored if run in published}, runs, encode(stored)

    def test_37a_to_37d_four_new_complementary_results_wake_the_elo_once(self):
        from vega.sources import open_matchday

        om = {"open_matchday": open_matchday}
        first = self.native(2019)
        # 37a: the previous files and a native season due.
        self.assertEqual(self.daily(om), [first])
        pairs, published, runs, _ = self.state()
        self.assertEqual((len(pairs), len(published), len(runs)), (250, 250, 1))
        # 37b: the source's next files alone, four new results: the same pass publishes the Elo.
        self.stage, self.clock = "current", self.clock + timedelta(hours=14)
        self.assertEqual(self.daily(om), [])
        self.assertEqual(len(self.fetches), 6)
        pairs, published, runs, stored = self.state()
        self.assertEqual(len(pairs), 258)
        self.assertEqual(published, pairs)  # red before §37: 250 of 258
        self.assertEqual([r[1] for r in runs], ["superseded", "published"])
        # 37c: an hour later, nothing read: no run.
        self.clock += timedelta(hours=1)
        self.daily(om)
        self.assertEqual(len(self.fetches), 6)
        self.assertEqual(self.state()[2:], (runs, stored))
        # 37d: the same files read again seven hours later: no run.
        self.clock += timedelta(hours=6)
        self.daily(om)
        self.assertEqual(len(self.fetches), 9)
        self.assertEqual(self.state()[2:], (runs, stored))

    def euro(self, matches):
        from vega.sources import cups

        body = {"name": "Euro 2024", "season": "2024", "source": {"name": "OpenFootball"}, "matches": matches}
        return patch.multiple(cups, bridge=lambda command, kind, query: {"status": 200, "body": body},
                              scopes=lambda now: {"open-cups:euro:2024": timedelta(seconds=1)})

    def test_37e_37f_a_corrected_withdrawn_or_restored_complementary_match_wakes_the_elo_once(self):
        from vega.sources import cups

        cup = {"openfootball": cups.For("open-cups")}
        first = self.native(2019)
        self.assertEqual(self.daily({}), [first])
        played = [{"team1": "Alpha United", "team2": "Bravo City", "round": "Finals", "date": "2024-06-03", "score": {"ft": [1, 0]}},
                  {"team1": "Cedar United", "team2": "Delta City", "round": "Finals", "date": "2024-06-04", "score": {"ft": [2, 2]}}]
        self.clock += timedelta(hours=1)
        with self.euro(played):
            self.daily(cup)
        pairs, published, runs, _ = self.state()
        self.assertEqual((len(pairs), published == pairs, len(runs)), (6, True, 2))  # red before §37: no run
        # 37e: the source corrects a score, 1–0 becomes 0–1: one run, then none.
        corrected = [dict(played[0], score={"ft": [0, 1]}), played[1]]
        self.clock += timedelta(hours=1)
        with self.euro(corrected):
            self.daily(cup)
        pairs, published, runs, stored = self.state()
        self.assertEqual((published == pairs, len(runs)), (True, 3))
        alpha = self.x("SELECT id FROM core.matches WHERE home_team_name = 'Alpha United'").fetchone()[0]
        self.assertEqual(sorted(self.x("SELECT t.name, e.result FROM agg.team_elo e JOIN core.teams t ON t.id = e.team_id WHERE e.match_id = %s",
                                       (alpha,)).fetchall()), [("Alpha United", 0.0), ("Bravo City", 1.0)])
        self.clock += timedelta(hours=1)
        with self.euro(corrected):
            self.daily(cup)
        self.assertEqual(self.state()[2:], (runs, stored))
        # 37f: the match withdrawn (an operator's deletion), then restored: each wakes the Elo once.
        row = self.x("SELECT * FROM core.matches WHERE id = %s", (alpha,)).fetchone()
        names = [d.name for d in self.x("SELECT * FROM core.matches LIMIT 0").description]
        keys = self.x("SELECT entity_type, provider, provider_key, entity_id, is_current FROM core.provider_ids WHERE entity_type='match' AND entity_id=%s",
                      (alpha,)).fetchall()
        with self.db.transaction():
            self.x("DELETE FROM core.provider_ids WHERE entity_type='match' AND entity_id=%s", (alpha,))
            self.x("DELETE FROM core.matches WHERE id=%s", (alpha,))
        self.clock += timedelta(hours=1)
        self.daily({})
        pairs, published, runs, stored = self.state()
        self.assertEqual((len(pairs), published == pairs, len(runs)), (4, True, 4))
        self.clock += timedelta(hours=1)
        self.daily({})
        self.assertEqual(self.state()[2:], (runs, stored))
        values = dict(zip(names, row))
        values["updated_at"] = datetime.now(timezone.utc)  # a restoration is a new write
        columns = [c for c in names if values[c] is not None]
        with self.db.transaction():
            self.x(f"INSERT INTO core.matches({', '.join(columns)}) OVERRIDING SYSTEM VALUE VALUES ({', '.join(['%s'] * len(columns))})",
                   [values[c] for c in columns])
            for key in keys:
                self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id, is_current) VALUES (%s,%s,%s,%s,%s)", key)
        self.clock += timedelta(hours=1)
        self.daily({})
        pairs, published, runs, stored = self.state()
        self.assertEqual((len(pairs), published == pairs, len(runs)), (6, True, 5))
        self.clock += timedelta(hours=1)
        self.daily({})
        self.assertEqual(self.state()[2:], (runs, stored))


@required(DSN and psycopg and NODE, "requires a disposable local collection DB (VEGA_V2_COLLECTION_TEST_DSN), psycopg and node")
class SharedReadTest(CollectionBase):
    """37g–37j (48i, 49j): the International Results editions due together read results.csv once."""

    NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)

    def run_due(self, at, *, fail=False):
        from vega import sources

        log = self.tmp / "fetch.log"
        before = len(log.read_text().splitlines()) if log.exists() else 0
        csv = self.tmp / "results.csv"
        csv.write_text(RESULTS_CSV)
        env = {"NODE_OPTIONS": f"--import={RESULTS_PRELOAD.as_uri()}", "VEGA_TEST_RESULTS_CSV": str(csv), "VEGA_TEST_FETCH_LOG": str(log)}
        with patch.dict(os.environ, env):
            if fail:
                os.environ["VEGA_TEST_RESULTS_FAIL"] = "1"
            else:
                os.environ.pop("VEGA_TEST_RESULTS_FAIL", None)
            with contextlib.redirect_stdout(io.StringIO()):
                done = sources.run_due(self.collect, None, at, names={"international_results"})
        lines = log.read_text().splitlines() if log.exists() else []
        return {scope: outcome for (_, scope), outcome in done.items()}, lines[before:]

    def editions(self):
        return {key: rest for key, *rest in self.x(
            """SELECT cs.cup_key, cs.cup_digest, cs.cup_checked_at, r.status, r.error_code, r.last_success_at, r.last_attempt_at,
                      (SELECT count(*) FROM core.matches m WHERE m.competition_season_id = cs.id)
               FROM core.competition_seasons cs JOIN ops.source_runs r ON r.source = 'international_results' AND r.scope = cs.cup_key
               WHERE cs.cup_key LIKE 'nations-results:%' ORDER BY 1""").fetchall()}

    def test_37g_to_37j_one_read_per_pass_and_each_edition_its_state(self):
        # 37g (49j): the fourteen editions due together: one request.
        done, asked = self.run_due(self.NOW)
        self.assertEqual(set(done), NATIONS_SCOPES)
        self.assertEqual(set(done.values()), {"ok"})
        self.assertEqual(asked, [RESULTS_URL])  # red before §37: eight requests
        first = self.editions()
        self.assertEqual(set(first), NATIONS_SCOPES)
        self.assertEqual(len({e[0] for e in first.values()}), len(NATIONS_SCOPES))  # each edition its own digest
        self.assertTrue(all(e[1] == self.NOW and tuple(e[2:5]) == ("ok", None, self.NOW) and e[6] == 1 for e in first.values()), first)
        # 37h: the next pass at once: nothing due, nothing read.
        done, asked = self.run_due(self.NOW + timedelta(minutes=1))
        self.assertEqual((done, asked), ({}, []))
        # 37i: all due again, the source failing: one request, every edition failed, nothing lost.
        later = self.NOW + timedelta(days=8)
        done, asked = self.run_due(later, fail=True)
        self.assertEqual((set(done), set(done.values()), asked), (NATIONS_SCOPES, {"HTTP_502"}, [RESULTS_URL]))
        failed = self.editions()
        for key, e in failed.items():
            self.assertEqual((e[0], e[1], e[2], e[3], e[4], e[5], e[6]), (first[key][0], first[key][1], "error", "HTTP_502", self.NOW, later, 1))
        # 37j: after the retry delay, the source back: one request, every edition ok again, nothing rewritten.
        again = later + timedelta(hours=1, minutes=5)
        done, asked = self.run_due(again)
        self.assertEqual((set(done.values()), asked), ({"ok"}, [RESULTS_URL]))
        for key, e in self.editions().items():
            self.assertEqual((e[0], e[1], e[2], e[4], e[6]), (first[key][0], again, "ok", again, 1))
        self.assertEqual({r[0] for r in self.x("SELECT rows_written FROM ops.source_runs WHERE source='international_results'").fetchall()}, {0})



@required(DSN and psycopg and NODE, "requires a disposable local collection DB (VEGA_V2_COLLECTION_TEST_DSN), psycopg and node")
class InternationalsEloTest(CollectionBase):
    """48f–48h: the season's internationals (main's edition for the home, outside ELO_MATCHES) through the real worker,
    bridge and projection: they never make the Elo due; the Nations League of the same file still does."""

    native, state, daily = EloWakeTest.native, EloWakeTest.state, EloWakeTest.daily

    def setUp(self):
        super().setUp()
        from vega.sources import cups
        from vega.store import Store
        from vega.worker import Worker

        csv, log = self.tmp / "results.csv", self.tmp / "fetch.log"
        csv.write_text(RESULTS_CSV)
        env = patch.dict(os.environ, {"NODE_OPTIONS": f"--import={RESULTS_PRELOAD.as_uri()}", "VEGA_TEST_RESULTS_CSV": str(csv),
                                      "VEGA_TEST_FETCH_LOG": str(log)})
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("VEGA_TEST_RESULTS_FAIL", None)
        self.nations = {"international_results": cups.For("nations-results")}
        self.due_scopes = {}
        scopes = patch.object(cups, "scopes", lambda now: dict(self.due_scopes))
        scopes.start()
        self.addCleanup(scopes.stop)
        self.clock = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)
        self.worker = Worker(Store(self.collect), SimpleNamespace(), clock=lambda: self.clock, calc_conn=self.calc, source_get=lambda *a, **k: None)

    def read(self, scope):
        """A pass reading `scope` alone; the edition's matches after it."""
        self.due_scopes = {scope: timedelta(hours=2)}
        self.clock += timedelta(hours=3)
        self.daily(self.nations)
        status = self.x("SELECT status FROM ops.source_runs WHERE source='international_results' AND scope=%s", (scope,)).fetchone()
        self.assertEqual(status, ("ok",), scope)
        return [r[0] for r in self.x("""SELECT m.id FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
                                        WHERE cs.cup_key = %s ORDER BY 1""", (scope,)).fetchall()]

    def test_48f_48g_the_internationals_never_wake_the_elo_the_nations_league_does(self):
        from vega.worker import elo_due

        first = self.native(2019)
        self.assertEqual(self.daily({}), [first])
        runs = self.state()[2]
        self.assertEqual([r[1] for r in runs], ["published"])
        # 48f: Brazil–Japan, a friendly of 2026/27, written by the real path: no Elo run, no side of it.
        friendly = self.read(INTERNATIONALS)
        self.assertEqual(len(friendly), 1)
        self.assertFalse(elo_due(self.calc))
        pairs, published, after, stored = self.state()
        self.assertEqual(after, runs)  # red on M0: a second run
        self.assertFalse({m for m, _ in published} & set(friendly))
        self.assertFalse({m for m, _ in pairs} & set(friendly))
        # 48g: Scotland–Switzerland, the Nations League: due once, one run, its sides published.
        league = self.read(NATIONS_LEAGUE)
        self.assertEqual(len(league), 1)
        pairs, published, runs, stored = self.state()
        self.assertEqual([r[1] for r in runs], ["superseded", "published"])
        self.assertEqual(published, pairs)
        self.assertEqual({m for m, _ in published} & set(league), set(league))
        self.assertFalse(elo_due(self.calc))
        self.clock += timedelta(hours=1)
        self.daily(self.nations)
        self.assertEqual(self.state()[2:], (runs, stored))

    def test_48h_without_an_elo_run_internationals_alone_are_not_due(self):
        from vega.worker import elo_due

        self.assertEqual(len(self.read(INTERNATIONALS)), 1)
        self.assertFalse(elo_due(self.calc))
        self.assertEqual(self.x("SELECT count(*) FROM agg.power_runs WHERE kind='elo'").fetchone()[0], 0)  # red on M0: the pass ran one
        self.assertEqual(self.x("SELECT count(*) FROM agg.team_elo").fetchone()[0], 0)

    def test_49k_an_older_season_s_internationals_never_wake_the_elo(self):
        from vega.worker import elo_due

        first = self.native(2019)
        self.assertEqual(self.daily({}), [first])
        runs = self.state()[2]
        # Italy–France of 7 Sep 2024, the Nations League of 2024/25 that no edition holds, written by the real path.
        older = self.read("nations-results:internationals:2024/2025")  # red before §49: no such edition
        self.assertEqual(len(older), 1)
        self.assertFalse(elo_due(self.calc))
        pairs, published, after, stored = self.state()
        self.assertEqual(after, runs)
        self.assertFalse({m for m, _ in pairs} & set(older))


class InternationalSeasonsTest(unittest.TestCase):
    """49h–49i: one season list in the projection and in cups.EDITIONS; a finished season is read weekly."""

    def test_49h_one_season_list(self):
        from vega.sources import cups

        self.assertEqual(tuple(cups.INTERNATIONAL_SEASONS), SEASONS)
        self.assertEqual([s for k, c, s in cups.EDITIONS if (k, c) == ("nations-results", "internationals")], list(SEASONS))

    @required(NODE, "requires node")
    def test_49h_the_projection_reads_the_same_list(self):
        import subprocess

        from vega.sources import cups

        script = (f"const m = await import({json.dumps((ROOT.parent / 'dashboard/frontend/src/services/nations-results.js').as_uri())});"
                  "console.log(JSON.stringify(m.INTERNATIONAL_SEASONS))")
        out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, check=True).stdout
        self.assertEqual(json.loads(out), list(cups.INTERNATIONAL_SEASONS))

    def test_49i_finished_seasons_weekly_the_others_as_before(self):
        from vega.sources import cups

        now = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)
        periods = cups.scopes(now)
        for season in SEASONS[:-1]:
            self.assertEqual(periods[f"nations-results:internationals:{season}"], timedelta(days=7), season)
        self.assertEqual(periods["nations-results:internationals:2026/2027"], timedelta(hours=2))
        # Every other edition: main's rule (its first year from the year before now's: every two hours, else weekly).
        for scope, period in periods.items():
            if ":internationals:" not in scope:
                season = scope.split(":", 2)[2]
                self.assertEqual(period, timedelta(hours=2) if int(season[:4]) >= now.year - 1 else timedelta(days=7), scope)
        # 2026/27 finished on 1 July 2027: weekly from then.
        self.assertEqual(cups.scopes(datetime(2027, 6, 30, 23, tzinfo=timezone.utc))["nations-results:internationals:2026/2027"], timedelta(hours=2))
        self.assertEqual(cups.scopes(datetime(2027, 7, 1, 0, tzinfo=timezone.utc))["nations-results:internationals:2026/2027"], timedelta(days=7))

class EmptyStatisticsTest(CollectionBase):
    """37k–37m: an empty player statistics answer after an accepted one, through the worker and the store."""

    def setUp(self):
        super().setUp()
        from test_worker import AWAY, HOME, LIGUE1, PLAYER, FakeApi
        from vega.pitchapi import PitchClient
        from vega.store import Store
        from vega.worker import Worker

        self.now = datetime.now(timezone.utc).replace(second=0, microsecond=0) + timedelta(minutes=1)
        self.api = FakeApi()
        self.api.routes.update({"/leagues": {"leagues": [dict(LIGUE1, seasons=["2025/2026"])]},
                                "/leagues/" + LIGUE1["id"]: dict(LIGUE1, season="2025/2026"),
                                "/teams/" + HOME["id"]: HOME, "/teams/" + AWAY["id"]: AWAY, "/players/" + PLAYER["id"]: PLAYER})
        client = PitchClient("pk_test_synthetic", interval=0, retries=0, transport=self.api, sleep=lambda _: None)
        self.worker = Worker(Store(self.db), client, clock=lambda: self.now, cohort_delay=0)

    def drain(self):
        count = 0
        while self.worker.step():
            count += 1
            self.assertLess(count, 500)

    def mid(self, key):
        return self.x("SELECT entity_id FROM core.provider_ids WHERE entity_type='match' AND provider='pitchapi' AND provider_key=%s", (key,)).fetchone()[0]

    def played(self, key, minutes):
        from test_worker import details

        routes = details(key)
        routes[f"/matches/{key}/players"][0]["stats"][0]["stats"]["m"]["stat"]["value"] = minutes
        if minutes is None:
            routes[f"/matches/{key}/players"] = []
        return routes

    def stats(self, mid):
        return self.x("SELECT player_id, minutes_played FROM core.player_match_stats WHERE match_id=%s ORDER BY 1", (mid,)).fetchall()

    def test_37k_to_37m_an_empty_answer_keeps_the_observation_and_is_asked_again(self):
        from test_worker import match
        from vega import planner
        from vega.jobs import enqueue_or_revive

        kick = self.now - timedelta(hours=3)
        self.api.routes["/date/" + self.now.date().isoformat()] = {"date": self.now.date().isoformat(), "matches": [
            match("m_aaaaaa", kick, "finished", (2, 0)), match("m_bbbbbb", kick - timedelta(hours=1), "finished", (0, 0))]}
        planner.plan(self.db, self.now)
        self.drain()
        for key, minutes in (("m_aaaaaa", 75), ("m_bbbbbb", None)):
            self.api.routes[f"/matches/{key}"] = match(key, kick, "finished", (2, 0) if key == "m_aaaaaa" else (0, 0))
            self.api.routes.update(self.played(key, minutes))
        planner.plan(self.db, self.now)
        self.drain()
        a, b = self.mid("m_aaaaaa"), self.mid("m_bbbbbb")
        observed = self.stats(a)
        self.assertEqual([m for _, m in observed], [75])
        # 37m: a first empty answer is written as before.
        self.assertEqual(self.stats(b), [])
        state = lambda mid: self.x("SELECT status::text, fingerprint FROM ops.family_state WHERE match_id=%s AND family='player_stats'",
                                   (mid,)).fetchone()
        self.assertEqual(state(b)[0], "ok")
        # 37k: the provider answers 200 with no player for the match already observed.
        revision = self.x("SELECT revision, updated_at FROM core.matches WHERE id=%s", (a,)).fetchone()
        accepted = state(a)
        self.api.routes["/matches/m_aaaaaa/players"] = []
        with self.db.transaction():
            enqueue_or_revive(self.db, "details", "player_stats", entity_type="match", entity_id=a, run_after=self.now)
        self.drain()
        self.assertEqual(self.stats(a), observed)  # red before §37: deleted
        self.assertEqual(self.x("SELECT revision, updated_at FROM core.matches WHERE id=%s", (a,)).fetchone(), revision)
        self.assertEqual(state(a), ("error", accepted[1]))
        self.assertEqual(self.x("SELECT player_stats FROM core.match_coverage WHERE match_id=%s", (a,)).fetchone()[0], "ok")
        self.assertIn(("EMPTY_AFTER_OBSERVATION",), self.x(
            "SELECT error_code FROM ops.parse_failures WHERE entity_id=%s AND family='player_stats'", (a,)).fetchall())
        # The backfill asks again for a family that is not ok once nothing else is queued for it.
        self.x("DELETE FROM ops.fetch_jobs WHERE entity_id=%s AND family='player_stats'", (a,))
        asked = planner.plan_backfill(self.db, self.now, first_season=2000, last_season=2100)
        self.assertEqual(asked.get("player_stats"), 1)
        self.assertEqual(self.x("SELECT entity_id FROM ops.fetch_jobs WHERE family='player_stats' AND state='pending'").fetchall(), [(a,)])
        # 37l: the same rows again: ok, nothing rewritten.
        self.api.routes.update({k: v for k, v in self.played("m_aaaaaa", 75).items() if k.endswith("/players")})
        self.worker.lanes = ("backfill",)
        self.drain()
        self.assertEqual(self.stats(a), observed)
        self.assertEqual(state(a), ("ok", accepted[1]))
        self.assertEqual(self.x("SELECT revision, updated_at FROM core.matches WHERE id=%s", (a,)).fetchone(), revision)


if __name__ == "__main__":
    unittest.main()
