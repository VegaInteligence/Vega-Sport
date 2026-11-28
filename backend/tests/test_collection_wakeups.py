"""Collection wake-ups and shared reads, written before the code: FAILURE_MODES.md §37 (37a–37m).

On a disposable local PostgreSQL (VEGA_V2_COLLECTION_TEST_DSN, database vega_v2_collection_test), under the real roles
(vega_collect for the collection, vega_calc for the daily pass):

- 37a–37d: the real Worker.daily and Open Matchday writer with the National League North files of the audit capsule
  (fixtures/open_matchday/nln-2026, provenance.json): four new results alone make the Elo due, a pass that changes
  nothing runs none (E04k).
- 37e–37f: a complementary score corrected by its source, a complementary match withdrawn then restored (E04k).
- 57a–57n: the scorers of the held International Results matches (goalscorers.csv), through the same bridge (§57).
- 37g–37j: the International Results editions (nine since main's internationals of 2026/27, §48, 48i) through the real
  bridge and projection, each fetch counted in node (fake_results_fetch.mjs): one read per pass, each edition its own
  state (E02b).
- 48f–48h, 50k turned by §51 (51k, the user's decision of 23 Nov 2026): the season's internationals enter the Elo and wake
  it, as the Nations League does.
- 50h–50j: the internationals of 2021/22 to 2025/26 (§50): one season list, finished seasons read weekly, fourteen
  editions in one read with no tournament row in an internationals edition.
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
from template_base import fresh  # noqa: E402

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
# One result of each International Results edition the base reads (cups.EDITIONS), in the dataset's columns; since §50
# (50j), one row of the World Cup, the Euro and each tournament inside the older internationals seasons too, which
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
# The seasons of the season's other internationals (§50): 2021/22, the base's first, to 2026/27.
SEASONS = ("2021/2022", "2022/2023", "2023/2024", "2024/2025", "2025/2026", "2026/2027")
NATIONS_SCOPES = {"nations-results:nations-league:2026/2027", "nations-results:afcon:2021", "nations-results:afcon:2023",
                  "nations-results:afcon:2025", "nations-results:copa-america:2024", "nations-results:asian-cup:2023",
                  "nations-results:gold-cup:2023", "nations-results:gold-cup:2025",
                  *(f"nations-results:internationals:{season}" for season in SEASONS)}
INTERNATIONALS, NATIONS_LEAGUE = "nations-results:internationals:2026/2027", "nations-results:nations-league:2026/2027"
# §57: the scorers of the held matches (goalscorers.csv), one more scope of the same adapter, read in the same pass.
GOALS_SCOPE = "nations-results:goalscorers"
GOALS_URL = "https://raw.githubusercontent.com/martj42/international_results/master/goalscorers.csv"
GOALS_HEADER = "date,home_team,away_team,team,scorer,minute,own_goal,penalty,assist\n"
# 57b–57c, 57i: goals of RESULTS_CSV's matches, in the file's columns. Mexico–Dominican Republic 3–2 complete (a penalty,
# an own goal scored by a Mexican for the Dominican Republic); Argentina–Canada 2–0 with one goal (partial);
# France–Netherlands 4–0 with five (more than the score); Scotland–Switzerland 1–0, the Nations League edition keyed by
# the English names; Brazil–Japan 2–1 with a minute « NA » and an assist; the 2022 World Cup final, held by no
# International Results edition; a goal of June 2021, before the base's first held day.
GOALS_CSV = GOALS_HEADER + """2021-06-11,Turkey,Italy,Italy,Merih Demiral,53,TRUE,FALSE,NA
2022-12-18,Argentina,France,Argentina,Lionel Messi,23,FALSE,TRUE,NA
2023-03-23,France,Netherlands,France,Antoine Griezmann,2,FALSE,FALSE,NA
2023-03-23,France,Netherlands,France,Dayot Upamecano,8,FALSE,FALSE,NA
2023-03-23,France,Netherlands,France,Kylian Mbappé,21,FALSE,FALSE,NA
2023-03-23,France,Netherlands,France,Kylian Mbappé,88,FALSE,FALSE,NA
2023-03-23,France,Netherlands,France,Kylian Mbappé,89,FALSE,FALSE,NA
2024-06-21,Argentina,Canada,Argentina,Julián Álvarez,49,FALSE,FALSE,NA
2025-06-15,Mexico,Dominican Republic,Mexico,Raúl Jiménez,12,FALSE,TRUE,NA
2025-06-15,Mexico,Dominican Republic,Dominican Republic,Johan Vásquez,30,TRUE,FALSE,NA
2025-06-15,Mexico,Dominican Republic,Mexico,Raúl Jiménez,55,FALSE,FALSE,NA
2025-06-15,Mexico,Dominican Republic,Dominican Republic,Edarlyn Reyes,70,FALSE,FALSE,NA
2025-06-15,Mexico,Dominican Republic,Mexico,Alexis Vega,90,FALSE,FALSE,NA
2026-10-01,Scotland,Switzerland,Scotland,Scott McTominay,61,FALSE,FALSE,NA
2026-10-10,Brazil,Japan,Brazil,Vinícius Júnior,NA,FALSE,FALSE,Raphinha
2026-10-10,Brazil,Japan,Japan,Takefusa Kubo,40,FALSE,FALSE,NA
2026-10-10,Brazil,Japan,Brazil,Rodrygo,77,FALSE,FALSE,NA
"""


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
        from vega.store import connect_local

        type(self).db = fresh(DSN, self.db)
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
    """37g–37j (48i, 50j): the International Results editions due together read results.csv once."""

    NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)

    def run_due(self, at, *, fail=False):
        from vega import sources

        log = self.tmp / "fetch.log"
        before = len(log.read_text().splitlines()) if log.exists() else 0
        csv, goals = self.tmp / "results.csv", self.tmp / "goalscorers.csv"
        csv.write_text(RESULTS_CSV)
        goals.write_text(GOALS_CSV)
        env = {"NODE_OPTIONS": f"--import={RESULTS_PRELOAD.as_uri()}", "VEGA_TEST_RESULTS_CSV": str(csv), "VEGA_TEST_FETCH_LOG": str(log),
               "VEGA_TEST_GOALSCORERS_CSV": str(goals)}
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
        # 37g (50j, 57a): the fourteen editions and the scorers due together: one request of each file.
        done, asked = self.run_due(self.NOW)
        self.assertEqual(set(done), NATIONS_SCOPES | {GOALS_SCOPE})
        self.assertEqual(set(done.values()), {"ok"})
        self.assertEqual(asked, [RESULTS_URL, GOALS_URL])  # red before §37: eight requests; before §57: results.csv alone
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
        self.assertEqual((set(done), set(done.values()), asked), (NATIONS_SCOPES | {GOALS_SCOPE}, {"HTTP_502"}, [RESULTS_URL, GOALS_URL]))
        failed = self.editions()
        for key, e in failed.items():
            self.assertEqual((e[0], e[1], e[2], e[3], e[4], e[5], e[6]), (first[key][0], first[key][1], "error", "HTTP_502", self.NOW, later, 1))
        # 37j: after the retry delay, the source back: one request, every edition ok again, nothing rewritten.
        again = later + timedelta(hours=1, minutes=5)
        done, asked = self.run_due(again)
        self.assertEqual((set(done.values()), asked), ({"ok"}, [RESULTS_URL, GOALS_URL]))
        for key, e in self.editions().items():
            self.assertEqual((e[0], e[1], e[2], e[4], e[6]), (first[key][0], again, "ok", again, 1))
        self.assertEqual({r[0] for r in self.x("SELECT rows_written FROM ops.source_runs WHERE source='international_results'").fetchall()}, {0})



@required(DSN and psycopg and NODE, "requires a disposable local collection DB (VEGA_V2_COLLECTION_TEST_DSN), psycopg and node")
class InternationalGoalsTest(CollectionBase):
    """57a–57n: the scorers of the held International Results matches (goalscorers.csv) through the real adapter, bridge
    and projection, both files served by fake_results_fetch.mjs."""

    NOW = datetime(2026, 11, 24, 12, tzinfo=timezone.utc)
    GOALS = """SELECT m.match_date::text || '|' || m.home_team_name || '|' || m.away_team_name, g.position, g.side::text, g.scorer,
                      g.minute, g.own_goal, g.penalty, g.assist
               FROM core.international_goals g JOIN core.matches m ON m.id = g.match_id ORDER BY 1, 2"""

    def setUp(self):
        super().setUp()
        self.clock = self.NOW
        self.goals_csv = GOALS_CSV

    def run_due(self, *, fail=None):
        """One pass of the International Results adapter, every scope due; {scope: outcome}, the URLs fetched."""
        from vega import sources

        log, csv, goals = self.tmp / "fetch.log", self.tmp / "results.csv", self.tmp / "goalscorers.csv"
        before = len(log.read_text().splitlines()) if log.exists() else 0
        csv.write_text(RESULTS_CSV)
        goals.write_text(self.goals_csv)
        env = {"NODE_OPTIONS": f"--import={RESULTS_PRELOAD.as_uri()}", "VEGA_TEST_RESULTS_CSV": str(csv), "VEGA_TEST_FETCH_LOG": str(log),
               "VEGA_TEST_GOALSCORERS_CSV": str(goals)}
        with patch.dict(os.environ, env):
            for name in ("VEGA_TEST_RESULTS_FAIL", "VEGA_TEST_GOALSCORERS_FAIL"):
                os.environ.pop(name, None)
            if fail:
                os.environ[fail] = "1"
            with contextlib.redirect_stdout(io.StringIO()):
                done = sources.run_due(self.collect, None, self.clock, names={"international_results"})
        self.clock += timedelta(days=8)  # every scope due at the next pass
        lines = log.read_text().splitlines() if log.exists() else []
        return {scope: outcome for (_, scope), outcome in done.items()}, lines[before:]

    def stored(self):
        return self.x(self.GOALS).fetchall()

    def run_row(self):
        return self.x("SELECT status, error_code, rows_written, unmatched FROM ops.source_runs WHERE source='international_results' AND scope=%s",
                      (GOALS_SCOPE,)).fetchone()

    def versions(self):
        """{match key: the xmin of its goal rows}: what a pass rewrote."""
        return dict(self.x("""SELECT m.match_date::text || '|' || m.home_team_name || '|' || m.away_team_name, string_agg(g.xmin::text, ',' ORDER BY g.position)
                              FROM core.international_goals g JOIN core.matches m ON m.id = g.match_id GROUP BY 1""").fetchall())

    def match(self, key):
        return self.x("""SELECT entity_id FROM core.provider_ids WHERE entity_type='match' AND provider='international_results'
                         AND provider_key=%s AND is_current""", (key,)).fetchone()[0]

    def test_57a_to_57d_the_goals_of_the_held_matches_once_per_pass(self):
        done, asked = self.run_due()
        # 57a: one request of each file, every scope ok.
        self.assertEqual(set(done), NATIONS_SCOPES | {GOALS_SCOPE})
        self.assertEqual(set(done.values()), {"ok"})
        self.assertEqual(asked, [RESULTS_URL, GOALS_URL])
        rows = self.stored()
        mexico = [r[1:] for r in rows if r[0] == "2025-06-15|Mexico|Dominican Republic"]
        # 57b: in file order; the own goal counts for the Dominican Republic, the side the file credits.
        self.assertEqual(mexico, [
            (1, "home", "Raúl Jiménez", 12, False, True, None), (2, "away", "Johan Vásquez", 30, True, False, None),
            (3, "home", "Raúl Jiménez", 55, False, False, None), (4, "away", "Edarlyn Reyes", 70, False, False, None),
            (5, "home", "Alexis Vega", 90, False, False, None)])
        self.assertIn(("2026-10-10|Brazil|Japan", 1, "home", "Vinícius Júnior", None, False, False, "Raphinha"), rows)
        # The Nations League's edition names its sides in French: its key is the file's.
        self.assertIn(("2026-10-01|Écosse|Suisse", 1, "home", "Scott McTominay", 61, False, False, None), rows)
        self.assertEqual(len(rows), 15)
        # 57c: the World Cup final is no International Results match; the goal of June 2021 is before the first held day.
        self.assertNotIn("2022-12-18", {r[0][:10] for r in rows})
        self.assertEqual(self.run_row(), ("ok", None, 15, 1))
        # 57d: the same file again: nothing written, no row rewritten.
        versions = self.versions()
        done, asked = self.run_due()
        self.assertEqual(done[GOALS_SCOPE], "ok")
        self.assertEqual(self.run_row(), ("ok", None, 0, 1))
        self.assertEqual(self.versions(), versions)
        self.assertEqual(self.stored(), rows)

    def test_57e_57f_a_goal_added_rewrites_its_match_alone_and_a_vanished_list_stays(self):
        self.run_due()
        rows, versions = self.stored(), self.versions()
        # 57e: Argentina–Canada's second goal; 57f: Brazil–Japan's three goals gone from the file.
        self.goals_csv = "".join(line + "\n" for line in GOALS_CSV.splitlines() if not line.startswith("2026-10-10"))
        self.goals_csv += "2024-06-21,Argentina,Canada,Argentina,Lautaro Martínez,88,FALSE,FALSE,Lionel Messi\n"
        done, _ = self.run_due()
        self.assertEqual(done[GOALS_SCOPE], "ok")
        after = self.versions()
        changed = {key for key in after if after[key] != versions.get(key)}
        self.assertEqual(changed, {"2024-06-21|Argentina|Canada"})
        self.assertEqual(self.run_row()[2], 2)  # the match's two goals written
        self.assertEqual([r for r in self.stored() if r[0].startswith("2026-10-10")], [r for r in rows if r[0].startswith("2026-10-10")])
        self.assertEqual(len([r for r in self.stored() if r[0].startswith("2026-10-10")]), 3)

    def test_57g_an_unreadable_goal_refuses_its_match_alone(self):
        self.run_due()
        rows = self.stored()
        failures = "SELECT count(*) FROM ops.parse_failures WHERE message LIKE %s"
        # Scotland's goal credited to Wales; a minute « 9x » in France–Netherlands; a goal both own goal and penalty in
        # England–Belgium (held, no goal yet); Argentina–Canada's second goal, readable.
        lines = []
        for line in GOALS_CSV.splitlines():
            if line.startswith("2026-10-01"):
                line = line.replace(",Scotland,Scott", ",Wales,Scott")
            if line.startswith("2023-03-23") and ",21," in line:
                line = line.replace(",21,", ",9x,")
            lines.append(line)
        lines += ["2024-03-26,England,Belgium,England,Harry Kane,30,TRUE,TRUE,NA",
                  "2024-06-21,Argentina,Canada,Argentina,Lautaro Martínez,88,FALSE,FALSE,NA"]
        self.goals_csv = "\n".join(lines) + "\n"
        done, _ = self.run_due()
        self.assertEqual(done[GOALS_SCOPE], "ok")
        after = self.stored()
        for day in ("2026-10-01", "2023-03-23"):
            self.assertEqual([r for r in after if r[0].startswith(day)], [r for r in rows if r[0].startswith(day)], day)
        self.assertEqual([r for r in after if r[0].startswith("2024-03-26")], [])
        self.assertEqual(len([r for r in after if r[0].startswith("2024-06-21")]), 2)
        for key in ("2026-10-01|Scotland|Switzerland", "2023-03-23|France|Netherlands", "2024-03-26|England|Belgium"):
            self.assertEqual(self.x(failures, (f"%{key}%",)).fetchone()[0], 1, key)
        # The same refusals again: no second row.
        self.run_due()
        self.assertEqual(self.x(failures, ("%2024-03-26|England|Belgium%",)).fetchone()[0], 1)

    def test_57h_the_file_unavailable_writes_nothing(self):
        self.run_due()
        rows = self.stored()
        done, asked = self.run_due(fail="VEGA_TEST_GOALSCORERS_FAIL")
        self.assertEqual(done[GOALS_SCOPE], "HTTP_502")
        self.assertEqual({o for s, o in done.items() if s != GOALS_SCOPE}, {"ok"})
        self.assertEqual(asked, [RESULTS_URL, GOALS_URL])
        self.assertEqual(self.stored(), rows)

    def test_57i_complete_partial_or_none_at_read_time(self):
        self.run_due()
        complete = dict(self.x("""SELECT match_date::text || '|' || home_name || '|' || away_name, bool_and(complete)
                                  FROM api.international_goals g JOIN (SELECT id, match_date, home_team_name AS home_name,
                                    away_team_name AS away_name FROM core.matches) m ON m.id = g.match_key GROUP BY 1""").fetchall())
        self.assertEqual(complete, {"2025-06-15|Mexico|Dominican Republic": True, "2024-06-21|Argentina|Canada": False,
                                    "2023-03-23|France|Netherlands": False, "2026-10-01|Écosse|Suisse": True,
                                    "2026-10-10|Brazil|Japan": True})
        # A score corrected by a later read changes it.
        self.x("UPDATE core.matches SET home_score = 1 WHERE id = %s", (self.match("2024-06-21|Argentina|Canada"),))
        self.assertTrue(self.x("SELECT bool_and(complete) FROM api.international_goals WHERE match_key = %s",
                               (self.match("2024-06-21|Argentina|Canada"),)).fetchone()[0])

    def test_57j_a_withdrawn_match_takes_its_goals(self):
        from vega.sources import snapshot

        self.run_due()
        match = self.match("2025-06-15|Mexico|Dominican Republic")
        self.assertEqual(snapshot._guard_dependents(self.collect, "international_results", [match], None), {})
        self.x("DELETE FROM core.provider_ids WHERE entity_type='match' AND entity_id=%s", (match,))
        self.x("DELETE FROM core.matches WHERE id=%s", (match,))
        self.assertEqual(self.x("SELECT count(*) FROM core.international_goals WHERE match_id=%s", (match,)).fetchone()[0], 0)

    def lineup(self, team, name, day, *, birth=None):
        """A player of `team`'s line-up on `day` (a collected match of that day); his id."""
        from vega.store import Store

        season = Store(self.db).season(f"{day.year - (day.month < 7)}/{day.year - (day.month < 7) + 1}")
        edition = self.x("SELECT id FROM core.competition_seasons WHERE season_id=%s LIMIT 1", (season,)).fetchone()
        if edition is None:
            comp = self.x("INSERT INTO core.competitions(name) VALUES ('Friendlies') RETURNING id").fetchone()[0]
            edition = self.x("INSERT INTO core.competition_seasons(competition_id, season_id, native_label) VALUES (%s,%s,'x') RETURNING id",
                             (comp, season)).fetchone()
        other = self.x("INSERT INTO core.teams(name) VALUES ('Opponent') RETURNING id").fetchone()[0]
        match = self.x("""INSERT INTO core.matches(competition_season_id, season_id, match_date, status, home_team_id, away_team_id, source)
                          VALUES (%s,%s,%s,'finished',%s,%s,'pitchapi') RETURNING id""", (edition[0], season, day, team, other)).fetchone()[0]
        player = self.x("SELECT id FROM core.players WHERE name=%s AND birth_date IS NOT DISTINCT FROM %s", (name, birth)).fetchone()
        player = player[0] if player else self.x("INSERT INTO core.players(name, birth_date) VALUES (%s,%s) RETURNING id", (name, birth)).fetchone()[0]
        self.x("INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id) VALUES (%s,%s,%s,%s)", (season, match, team, player))
        return player

    def team(self, name):
        return self.x("SELECT entity_id FROM core.provider_ids WHERE entity_type='team' AND provider='international_results' AND provider_key=%s",
                      (name,)).fetchone()[0]

    def links(self):
        return {(r[0], r[1]): r[2] for r in self.x("""SELECT m.match_date::text || '|' || m.home_team_name || '|' || m.away_team_name, g.position, g.player_id
                                                    FROM core.international_goals g JOIN core.matches m ON m.id = g.match_id""").fetchall()}

    def test_57k_to_57m_a_scorer_is_linked_only_when_unambiguous(self):
        from datetime import date

        self.run_due()
        mexico, dominican, france = self.team("Mexico"), self.team("Dominican Republic"), self.team("France")
        argentina, brazil = self.team("Argentina"), self.team("Brazil")
        key = "2025-06-15|Mexico|Dominican Republic"
        # 57k: one Mexican of that name, a line-up a year before the goal (the name written without its accent).
        jimenez = self.lineup(mexico, "Raul Jimenez", date(2024, 6, 1))
        # 57l: two Alexis Vega in Mexico's line-ups; Edarlyn Reyes in another team's only; Kylian Mbappé three years
        # before; Julián Álvarez born ten years before the goal; Johan Vásquez (own goal for the Dominican Republic) in
        # Mexico's line-ups.
        self.lineup(mexico, "Alexis Vega", date(2025, 3, 1), birth=date(1997, 11, 25))
        self.lineup(mexico, "Alexis Vega", date(2025, 3, 2), birth=date(2003, 1, 1))
        self.lineup(brazil, "Edarlyn Reyes", date(2025, 3, 1))
        self.lineup(france, "Kylian Mbappé", date(2020, 3, 1))
        self.lineup(argentina, "Julián Álvarez", date(2024, 3, 1), birth=date(2014, 1, 31))
        vasquez = self.lineup(mexico, "Johan Vásquez", date(2025, 3, 1))
        versions = self.versions()
        self.run_due()
        links = self.links()
        self.assertEqual(links[(key, 1)], jimenez)
        self.assertEqual(links[(key, 3)], jimenez)
        self.assertEqual(links[(key, 2)], vasquez)  # the own goal: the scorer plays for the other side
        self.assertIsNone(links[(key, 4)])
        self.assertIsNone(links[(key, 5)])
        self.assertTrue(all(v is None for (k, _), v in links.items() if not k.startswith("2025-06-15")), links)
        self.assertEqual(self.run_row()[2], 0)  # a link is no goal written
        # 57m: a second Raúl Jiménez appears in Mexico's line-ups: unlinked at the next pass, the other rows untouched.
        self.lineup(mexico, "Raúl Jiménez", date(2025, 9, 1), birth=date(2001, 1, 1))
        self.run_due()
        links = self.links()
        self.assertIsNone(links[(key, 1)])
        self.assertIsNone(links[(key, 3)])
        self.assertEqual(links[(key, 2)], vasquez)
        after = self.versions()
        self.assertEqual({k for k in after if after[k] != versions[k]}, {key})

    def test_57n_display_data_only(self):
        counts = """SELECT (SELECT count(*) FROM core.match_events), (SELECT count(*) FROM core.player_match_stats),
                           (SELECT count(*) FROM agg.team_elo), (SELECT max(updated_at) FROM core.matches)"""
        from vega import sources

        # The editions first, then the goals alone: nothing the rankings or the Elo read changes.
        self.goals_csv = GOALS_HEADER
        self.run_due()
        before = self.x(counts).fetchone()
        self.goals_csv = GOALS_CSV
        self.run_due()
        self.assertEqual(len(self.stored()), 15)
        self.assertEqual(self.x(counts).fetchone(), before)
        for module in ("power", "level"):
            text = (ROOT / "vega" / f"{module}.py").read_text()
            self.assertNotIn("international_goals", text, module)


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

    def national(self, *names):
        """National teams the file names, as an edition of NATIONAL_CUPS would have marked them."""
        for name in names:
            team = self.x("INSERT INTO core.teams(name, is_national) VALUES (%s, true) RETURNING id", (name,)).fetchone()[0]
            self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','international_results',%s,%s)",
                   (name, team))

    def test_51k_the_internationals_wake_the_elo_as_the_nations_league_does(self):
        from vega.worker import elo_due

        first = self.native(2019)
        self.assertEqual(self.daily({}), [first])
        runs = self.state()[2]
        self.assertEqual([r[1] for r in runs], ["published"])
        # Brazil–Japan, a friendly of 2026/27 between two national sides, written by the real path: one run, its sides published.
        self.national("Brazil", "Japan")
        friendly = self.read(INTERNATIONALS)
        self.assertEqual(len(friendly), 1)
        pairs, published, after, stored = self.state()
        self.assertEqual([r[1] for r in after], ["superseded", "published"])  # red before §51: no second run
        self.assertEqual(published, pairs)
        self.assertEqual({m for m, _ in published} & set(friendly), set(friendly))
        self.assertFalse(elo_due(self.calc))
        # Scotland–Switzerland, the Nations League: due once, one run, its sides published, as before.
        league = self.read(NATIONS_LEAGUE)
        self.assertEqual(len(league), 1)
        pairs, published, runs, stored = self.state()
        self.assertEqual([r[1] for r in runs], ["superseded", "superseded", "published"])
        self.assertEqual(published, pairs)
        self.assertFalse(elo_due(self.calc))
        self.clock += timedelta(hours=1)
        self.daily(self.nations)
        self.assertEqual(self.state()[2:], (runs, stored))

    def test_51k_without_an_elo_run_internationals_alone_are_due(self):
        self.assertEqual(len(self.read(INTERNATIONALS)), 1)
        self.assertEqual(self.x("SELECT count(*) FROM agg.power_runs WHERE kind='elo' AND status='published'").fetchone()[0], 1)

    def test_51k_an_older_season_s_internationals_wake_the_elo(self):
        from vega.worker import elo_due

        first = self.native(2019)
        self.assertEqual(self.daily({}), [first])
        # Italy–France of 7 Sep 2024, the Nations League of 2024/25 that no edition holds, written by the real path.
        self.national("Italy", "France")
        older = self.read("nations-results:internationals:2024/2025")
        self.assertEqual(len(older), 1)
        pairs, published, after, stored = self.state()
        self.assertEqual([r[1] for r in after], ["superseded", "published"])
        self.assertEqual({m for m, _ in published} & set(older), set(older))
        self.assertFalse(elo_due(self.calc))

    def test_51k_a_run_of_another_national_method_is_due_once(self):
        from vega.worker import elo_due

        first = self.native(2019)
        self.assertEqual(self.daily({}), [first])
        self.assertFalse(elo_due(self.calc))  # 53c: the run's row holds the present version
        published = "SELECT id FROM agg.power_runs WHERE kind='elo' AND status='published'"
        # 53d: another version in the run's row (agg.nation_elo_runs, §53), then no row (a run from before 168): due.
        self.x(f"UPDATE agg.nation_elo_runs SET version = 'nations-elo-v0' WHERE run_id = ({published})")
        self.assertTrue(elo_due(self.calc))
        self.x(f"DELETE FROM agg.nation_elo_runs WHERE run_id = ({published})")
        self.assertTrue(elo_due(self.calc))
        # One run, then not due.
        self.daily({})
        self.assertEqual([r[1] for r in self.state()[2]], ["superseded", "published"])
        self.assertFalse(elo_due(self.calc))
        self.assertEqual(self.x(f"SELECT version FROM agg.nation_elo_runs WHERE run_id = ({published})").fetchone()[0], "nations-elo-v1")

    def test_50n_an_internationals_edition_renames_no_team(self):
        (self.tmp / "results.csv").write_text(RESULTS_CSV + "2024-10-15,Scotland,Portugal,0,0,UEFA Nations League,Glasgow,Scotland,FALSE\n")
        self.read(NATIONS_LEAGUE)
        name = """SELECT t.id, t.name FROM core.teams t JOIN core.provider_ids p ON p.entity_type='team' AND p.entity_id=t.id
                  AND p.provider='international_results' AND p.provider_key=%s"""
        scotland = self.x(name, ("Scotland",)).fetchone()
        self.assertEqual(scotland[1], "Écosse")
        self.assertEqual(len(self.read("nations-results:internationals:2024/2025")), 2)
        self.assertEqual(self.x(name, ("Scotland",)).fetchone(), scotland)  # red before §50's rule: « Scotland »
        self.assertEqual(self.x(name, ("Portugal",)).fetchone()[1], "Portugal")
        spellings = {r[0] for r in self.x("SELECT name FROM core.entity_names WHERE entity_type='team' AND entity_id=%s AND kind='source_spelling'",
                                          (scotland[0],)).fetchall()}
        self.assertIn("Scotland", spellings)
    def vega(self):
        """The curated adapter with its two scopes of the national teams alone (curated.scopes keeps their order)."""
        from vega.sources import curated

        scopes = patch.object(curated, "scopes", lambda now: {"national_teams": timedelta(days=1), "team_identity": timedelta(days=1)})
        scopes.start()
        self.addCleanup(scopes.stop)
        return {"vega": curated, **self.nations}

    def test_55d_a_league_a_nation_named_in_english_by_the_internationals_stays_national_and_ranked(self):
        # §55 (55d): production's Italy of 24 Nov 2026. « Italie », national, read from OpenLigaDB (Nations League A, against
        # France), no International Results key; a FIFA edition naming Italy; then the internationals of 2024/25 name « Italy ».
        from vega.sources import identity

        x = self.x
        (self.tmp / "results.csv").write_text(RESULTS_CSV + "2024-10-12,Montenegro,Iceland,2,0,Friendly,Podgorica,Montenegro,FALSE\n")
        self.national("France", "Iceland")
        italie = x("INSERT INTO core.teams(name, is_national) VALUES ('Italie', true) RETURNING id").fetchone()[0]
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','openligadb','name:Italien',%s)", (italie,))
        # 55h: « Monténégro », national, with its International Results key (a League C nation of 2026/27's edition).
        montenegro = x("INSERT INTO core.teams(name, is_national) VALUES ('Monténégro', true) RETURNING id").fetchone()[0]
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','international_results','Montenegro',%s)",
          (montenegro,))
        france = x("SELECT entity_id FROM core.provider_ids WHERE provider='international_results' AND provider_key='France'").fetchone()[0]
        with self.db.transaction():
            from vega.store import Store

            season = Store(self.db).season("2026/2027")
            comp = x("INSERT INTO core.competitions(name) VALUES ('UEFA Nations League') RETURNING id").fetchone()[0]
            edition = x("""INSERT INTO core.competition_seasons(competition_id, season_id, native_label, cup_key)
                           VALUES (%s, %s, '2026/2027', 'openligadb:nations-league:2026/2027') RETURNING id""", (comp, season)).fetchone()[0]
            league_a = x("""INSERT INTO core.matches(competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score,
                              away_score, match_date, kickoff_at) VALUES (%s, %s, 'openligadb', 'finished', %s, %s, 1, 1, '2026-09-05',
                              '2026-09-05 18:45+00') RETURNING id""", (edition, season, italie, france)).fetchone()[0]
            fifa = x("INSERT INTO core.ranking_editions(kind, provider, label) VALUES ('fifa_men', 'fifa', '2026-10-01') RETURNING id").fetchone()[0]
            x("INSERT INTO core.countries(code) VALUES ('FRA'), ('ITA'), ('ISL'), ('MNE') ON CONFLICT DO NOTHING")
            x("""INSERT INTO core.ranking_rows(edition_id, row_no, country_code, entity_name, points) VALUES (%s, 1, 'FRA', 'France', 1870),
                 (%s, 2, 'ITA', 'Italy', 1720), (%s, 3, 'ISL', 'Iceland', 1350), (%s, 4, 'MNE', 'Montenegro', 1400)""", (fifa, fifa, fifa, fifa))
        adapters = self.vega()
        self.nations = adapters  # read() passes them all
        first = self.native(2019)
        self.assertEqual(self.daily(adapters), [first])
        # 55j: that pass's Elo, « Italie » not merged yet, is published (daily() fails on any step error; red before §55:
        # DATABASE_23505, « Italy » both a club and a nation in agg.team_power).
        older = self.read("nations-results:internationals:2024/2025")
        self.assertEqual(len(older), 2)
        italy = x("SELECT entity_id FROM core.provider_ids WHERE provider='international_results' AND provider_key='Italy'").fetchone()[0]
        self.assertNotEqual(italy, italie)  # the internationals created « Italy »: the base had no International Results key for Italie
        self.assertEqual(x("SELECT count(*) FROM agg.team_power WHERE team_id = %s AND scope = 'clubs'", (italy,)).fetchone()[0], 0)
        # The next pass, two hours later: the marking, the identity pass, then the Elo.
        self.clock += timedelta(hours=2)
        self.due_scopes = {}
        self.daily(adapters)
        rows = x("SELECT id, name, is_national IS TRUE FROM core.teams WHERE id IN (%s, %s) AND merged_into IS NULL", (italie, italy)).fetchall()
        self.assertEqual(rows, [(italy, "Italy", True)])  # red before §55: « Italy » not national
        self.assertEqual(x("SELECT merged_into FROM core.teams WHERE id = %s", (italie,)).fetchone()[0], italy)
        self.assertEqual(sorted(p for (p,) in x("SELECT provider::text FROM core.provider_ids WHERE entity_type='team' AND entity_id=%s", (italy,)).fetchall()),
                         ["international_results", "openligadb"])
        self.assertEqual(x("SELECT count(*) FROM core.matches WHERE %s IN (home_team_id, away_team_id)", (italy,)).fetchone()[0], 2)
        # In the national pass: the Italy–France match of 2024/25 has its two national sides, Italy is ranked among the nations.
        friendly = next(m for m in older if x("SELECT %s IN (home_team_id, away_team_id) FROM core.matches WHERE id=%s", (italy, m)).fetchone()[0])
        self.assertEqual(x("SELECT count(*) FROM agg.team_elo WHERE match_id = %s", (friendly,)).fetchone()[0], 2)
        self.assertEqual(x("SELECT count(*) FROM agg.team_elo WHERE match_id = %s", (league_a,)).fetchone()[0], 2)
        self.assertIsNotNone(x("SELECT rank FROM agg.team_power WHERE scope='nations' AND season_id=2024 AND team_id=%s", (italy,)).fetchone())
        listed = {key for (key,) in x("SELECT team_key FROM api.nation_list(2026::smallint)").fetchall()}
        self.assertIn(italy, listed)
        self.assertNotIn(italie, listed)
        # 55h: « Monténégro » keeps its row and its name (50n).
        self.assertEqual(x("SELECT name, merged_into FROM core.teams WHERE id=%s", (montenegro,)).fetchone(), ("Monténégro", None))
        self.assertEqual(x("SELECT entity_id FROM core.provider_ids WHERE provider='international_results' AND provider_key='Montenegro'").fetchone()[0],
                         montenegro)
        self.assertFalse(identity.pairs(self.db)[0])

    def test_55e_55f_the_elo_is_due_when_its_national_teams_change(self):
        from vega import power
        from vega.worker import elo_due

        x = self.x
        first = self.native(2019)
        self.assertEqual(self.daily({}), [first])
        self.assertFalse(elo_due(self.calc))
        published = "SELECT id FROM agg.power_runs WHERE kind='elo' AND status='published'"
        present = x(power.NATION_SET).fetchone()
        self.assertEqual(x(f"SELECT national_teams, national_teams_md5 FROM agg.nation_elo_runs WHERE run_id = ({published})").fetchone(), present)
        # 55e: a team marked national, no match changed: due; one run, then not.
        team = x("INSERT INTO core.teams(name) VALUES ('Freedonia') RETURNING id").fetchone()[0]
        self.assertFalse(elo_due(self.calc))
        x("UPDATE core.teams SET is_national = true WHERE id = %s", (team,))
        self.assertTrue(elo_due(self.calc))  # red before §55: the flags are not looked at
        self.clock += timedelta(hours=2)
        self.daily({})
        self.assertEqual([r[1] for r in self.state()[2]], ["superseded", "published"])
        self.assertFalse(elo_due(self.calc))
        # A national row merged into another: the set changes, due once.
        other = x("INSERT INTO core.teams(name, is_national) VALUES ('Freedonie', true) RETURNING id").fetchone()[0]
        self.clock += timedelta(hours=2)
        self.daily({})
        self.assertFalse(elo_due(self.calc))
        x("UPDATE core.teams SET merged_into = %s WHERE id = %s", (team, other))
        self.assertTrue(elo_due(self.calc))
        self.clock += timedelta(hours=2)
        self.daily({})
        self.assertFalse(elo_due(self.calc))
        # 55f: a run's row without the set (a run from before 170): due once.
        x(f"UPDATE agg.nation_elo_runs SET national_teams = NULL, national_teams_md5 = NULL WHERE run_id = ({published})")
        self.assertTrue(elo_due(self.calc))
        self.clock += timedelta(hours=2)
        self.daily({})
        self.assertFalse(elo_due(self.calc))

    def test_56i_the_pass_that_redoes_the_elo_ranks_again_the_years_that_read_the_earlier_one(self):
        from psycopg.types.json import Jsonb
        from vega import level, power
        from vega.store import Store

        x = self.x
        first = self.native(2019)
        self.assertEqual(self.daily({}), [first])
        with self.db.transaction():
            year = Store(self.db).season("2021/2022")
        # A year ranked with players on that Elo, as refresh_players leaves it, its level of the present version.
        x("""INSERT INTO agg.power_runs(kind, season_id, method_version, status, started_at, finished_at, players)
             VALUES ('players', %s, %s, 'published', clock_timestamp(), clock_timestamp(), 3)""", (year, power.METHOD_VERSION))
        x("""INSERT INTO agg.level_runs(season_id, version, status, started_at, finished_at, players, settings)
             VALUES (%s, %s, 'published', clock_timestamp(), clock_timestamp(), 0, %s)""", (year, level.LEVEL_VERSION, Jsonb(level.SETTINGS)))
        self.assertEqual(power.stale_rankings(self.calc), [])
        elo = "SELECT status FROM agg.power_runs WHERE kind = 'elo' ORDER BY id"
        rankings = "SELECT status FROM agg.power_runs WHERE kind = 'players' AND season_id = %s ORDER BY id"
        self.clock += timedelta(hours=2)
        self.daily({})
        self.assertEqual(([s for (s,) in x(elo).fetchall()], [s for (s,) in x(rankings, (year,)).fetchall()]), (["published"], ["published"]))
        # A team marked national: the next pass runs the Elo, then ranks the year again (this base holds no statistics:
        # an empty run of the year).
        x("INSERT INTO core.teams(name, is_national) VALUES ('Freedonia', true)")
        self.assertEqual(power.stale_rankings(self.calc), [])  # the published Elo run is still the one the year read
        self.clock += timedelta(hours=2)
        self.daily({})
        self.assertEqual([s for (s,) in x(elo).fetchall()], ["superseded", "published"])
        self.assertEqual([s for (s,) in x(rankings, (year,)).fetchall()], ["superseded", "published"])  # red before §56: one run
        self.assertEqual(power.stale_rankings(self.calc), [])
        # The pass after: neither.
        self.clock += timedelta(hours=2)
        self.daily({})
        self.assertEqual([s for (s,) in x(elo).fetchall()], ["superseded", "published"])
        self.assertEqual([s for (s,) in x(rankings, (year,)).fetchall()], ["superseded", "published"])


    def test_60p_a_year_whose_race_is_missing_or_of_another_version_or_settings_is_ranked_again_once(self):
        # FAILURE_MODES §60, 60p: power.stale_rankings lists, with the level's years, a year whose published level of the
        # present version has players and whose race (agg.award_runs) is missing, of another version or of other
        # settings, or started before that level; the real worker's pass computes it, the next lists nothing.
        from psycopg.types.json import Jsonb
        from vega import award, level, power
        from vega.store import Store

        x = self.x
        first = self.native(2019)
        self.assertEqual(self.daily({}), [first])
        with self.db.transaction():
            year = Store(self.db).season("2021/2022")
        x("""INSERT INTO agg.power_runs(kind, season_id, method_version, status, started_at, finished_at, players)
             VALUES ('players', %s, %s, 'published', clock_timestamp(), clock_timestamp(), 3)""", (year, power.METHOD_VERSION))
        level_run = x("""INSERT INTO agg.level_runs(season_id, version, status, started_at, finished_at, players, settings)
                         VALUES (%s, %s, 'published', clock_timestamp(), clock_timestamp(), 3, %s) RETURNING id""",
                      (year, level.LEVEL_VERSION, Jsonb(level.SETTINGS))).fetchone()[0]
        race = x("""INSERT INTO agg.award_runs(season_id, version, status, started_at, finished_at, level_run_id, reference_season, players,
                      settings, spreads)
                    VALUES (%s, 'vega-award-v0', 'published', clock_timestamp(), clock_timestamp(), %s, %s, 3, %s, '{}') RETURNING id""",
                 (year, level_run, year, Jsonb(award.SETTINGS))).fetchone()[0]
        self.assertEqual(power.stale_rankings(self.calc), [year])  # another version
        x("UPDATE agg.award_runs SET version = %s WHERE id = %s", (award.AWARD_VERSION, race))
        self.assertEqual(power.stale_rankings(self.calc), [])
        x("UPDATE agg.award_runs SET settings = '{}' WHERE id = %s", (race,))
        self.assertEqual(power.stale_rankings(self.calc), [year])  # other settings
        x("DELETE FROM agg.award_runs WHERE id = %s", (race,))
        self.assertEqual((power.stale_rankings(self.calc), award.stale(self.calc)), ([year], [year]))  # missing
        rankings = "SELECT status FROM agg.power_runs WHERE kind = 'players' AND season_id = %s ORDER BY id"
        races = "SELECT version, status FROM agg.award_runs WHERE season_id = %s ORDER BY id"
        self.clock += timedelta(hours=2)
        self.daily({})
        self.assertEqual([s for (s,) in x(rankings, (year,)).fetchall()], ["superseded", "published"])
        self.assertEqual(x(races, (year,)).fetchall(), [(award.AWARD_VERSION, "published")])  # this base holds no statistics: a run of none
        self.assertEqual(power.stale_rankings(self.calc), [])
        self.clock += timedelta(hours=2)
        self.daily({})
        self.assertEqual([s for (s,) in x(rankings, (year,)).fetchall()], ["superseded", "published"])
        self.assertEqual(x(races, (year,)).fetchall(), [(award.AWARD_VERSION, "published")])


class InternationalSeasonsTest(unittest.TestCase):
    """50h–50i: one season list in the projection and in cups.EDITIONS; a finished season is read weekly."""

    def test_50h_one_season_list(self):
        from vega.sources import cups

        self.assertEqual(tuple(cups.INTERNATIONAL_SEASONS), SEASONS)
        self.assertEqual([s for k, c, s in cups.EDITIONS if (k, c) == ("nations-results", "internationals")], list(SEASONS))

    @required(NODE, "requires node")
    def test_50h_the_projection_reads_the_same_list(self):
        import subprocess

        from vega.sources import cups

        script = (f"const m = await import({json.dumps((ROOT.parent / 'dashboard/frontend/src/services/nations-results.js').as_uri())});"
                  "console.log(JSON.stringify(m.INTERNATIONAL_SEASONS))")
        out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, check=True).stdout
        self.assertEqual(json.loads(out), list(cups.INTERNATIONAL_SEASONS))

    def test_50i_finished_seasons_weekly_the_others_as_before(self):
        from vega.sources import cups

        now = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)
        periods = cups.scopes(now)
        for season in SEASONS[:-1]:
            self.assertEqual(periods[f"nations-results:internationals:{season}"], timedelta(days=7), season)
        self.assertEqual(periods["nations-results:internationals:2026/2027"], timedelta(hours=2))
        # Every other edition: main's rule (its first year from the year before now's: every two hours, else weekly).
        for scope, period in periods.items():
            if scope == GOALS_SCOPE:  # §57: the scorers, no edition, every two hours whatever the season
                self.assertEqual(period, timedelta(hours=2))
            elif ":internationals:" not in scope:
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
