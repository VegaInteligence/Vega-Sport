"""The forecast evaluator (backend/tools/evaluate_forecast.py; FAILURE_MODES.md §89.2 and §89.1-f, written before
the tool). The commands are run as the operator runs them, in a subprocess; the readers that need a network or a
base are called with stand-ins. No real data is read here: the real run is the evidence of §89.3."""

import hashlib
import json
import random
import subprocess
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "evaluate_forecast.py"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
SCHEMA = "vega-forecast-evaluation-input/1"


def tool(*args, **env):
    return subprocess.run([sys.executable, str(TOOL), *map(str, args)], capture_output=True, text=True, timeout=900,
                          env={"PYTHONPATH": str(ROOT), **env})


def league(division="E0", teams=6, start=date(2026, 8, 1)):
    """A double round robin with scores that tell the matches apart: [(id, day, home, away, home goals, away goals)]."""
    names = [f"Club {chr(65 + k)}" for k in range(teams)]
    out, day = [], start
    for i, home in enumerate(names):
        for j, away in enumerate(names):
            if i != j:
                out.append((f"{division}-{i}{j}", day, home, away, (i + 2 * j) % 4, (3 * i + j) % 3))
                day += timedelta(days=3)
    return out


def as_input(games, division="E0", **forecast):
    chances = {"home": 0.5, "draw": 0.25, "away": 0.25, **forecast}
    return {"schema": SCHEMA, "provenance": {"kind": "kickoff-point", "description": "made up for a test"},
            "matches": [{"match": m, "date": d.isoformat(), "competition": "Test League", "division": division, "home": h, "away": a,
                         "home_goals": hg, "away_goals": ag, "forecast": dict(chances)} for m, d, h, a, hg, ag in games]}


class ForecastEvaluationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.folder.cleanup)
        cls.dir = Path(cls.folder.name)
        cls.input = cls.dir / "synthetic.json"
        cls.written = tool("synthetic", "--seed", 7, "--write-input", cls.input) if TOOL.exists() else None

    def setUp(self):
        self.assertTrue(TOOL.exists(), f"{TOOL} does not exist")
        self.assertEqual(self.written.returncode, 0, self.written.stderr[-2000:])

    def report(self, data=None, name="report.json"):
        source = self.input
        if data is not None:
            source = self.dir / f"input-{name}"
            source.write_text(json.dumps(data))
        out = self.dir / name
        out.unlink(missing_ok=True)
        return tool("report", "--input", source, "--output", out), out

    def test_e1_the_same_input_gives_the_same_report_with_its_hash(self):
        data = json.loads(self.input.read_text())
        self.assertEqual(data["schema"], SCHEMA)
        self.assertEqual(data["provenance"]["kind"], "synthetic")
        first, a = self.report(name="a.json")
        second, b = self.report(name="b.json")
        self.assertEqual((first.returncode, second.returncode), (0, 0), first.stderr[-2000:])
        self.assertEqual(a.read_bytes(), b.read_bytes())
        report = json.loads(a.read_text())
        body = {k: v for k, v in report.items() if k != "sha256"}
        self.assertEqual(report["sha256"], hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest())
        self.assertEqual(report["matches"], len(data["matches"]))
        self.assertLess(report["forecast"]["log_loss"], report["base_rate"]["log_loss"])
        self.assertAlmostEqual(sum(report["outcomes"].values()), 1.0, places=5)
        # 89.2-h: a synthetic input says nothing of real performance, and the report repeats it.
        self.assertEqual(report["provenance"]["kind"], "synthetic")
        self.assertIs(report["real_performance"], False)

    def test_e2_the_truth_beats_a_blurred_view_and_the_interval_says_so(self):
        # The synthetic forecast is the law the scores were drawn from; its « market » is that law blurred.
        run, out = self.report(name="truth.json")
        self.assertEqual(run.returncode, 0, run.stderr[-2000:])
        market = json.loads(out.read_text())["market"]
        self.assertLess(market["forecast"]["log_loss"], market["market"]["log_loss"])
        gap = market["difference"]
        self.assertLess(gap["low"], gap["log_loss"])
        self.assertLess(gap["log_loss"], gap["high"])
        self.assertLess(gap["high"], 0)

    def test_e3_an_input_that_breaks_the_schema_is_rejected_without_a_report(self):
        good = as_input(league())
        cases = {"schema": {**good, "schema": "another/1"}, "partition": {**good, "matches": []}}
        for reason, change in (("date", {"date": "2026-13-40"}), ("score", {"home_goals": -1}), ("score", {"away_goals": "two"}),
                               ("probability", {"forecast": {"home": 0.6, "draw": 0.3, "away": 0.3}}),
                               ("probability", {"forecast": {"home": 1.0, "draw": 0.0, "away": 0.0}}),
                               ("probability", {"forecast": {"home": 0.5, "draw": 0.5}})):
            cases[f"{reason}-{len(cases)}"] = {**good, "matches": [{**good["matches"][0], **change}, *good["matches"][1:]]}
        cases["duplicate"] = {**good, "matches": [*good["matches"], good["matches"][0]]}
        for name, data in cases.items():
            run, out = self.report(data, name=f"bad-{name}.json")
            self.assertEqual(run.returncode, 2, (name, run.stderr[-500:]))
            self.assertTrue(run.stderr.strip().startswith(name.split("-")[0]), (name, run.stderr[-500:]))
            self.assertFalse(out.exists(), name)

    def test_e3b_chances_rounded_by_the_api_are_divided_by_their_sum(self):
        run, out = self.report(as_input(league(), home=0.5001, draw=0.2501, away=0.2501), name="rounded.json")
        self.assertEqual(run.returncode, 0, run.stderr[-2000:])

    def test_e4_the_market_is_read_only_where_there_is_one(self):
        data = as_input(league())
        run, out = self.report(data, name="no-market.json")
        self.assertEqual(run.returncode, 0, run.stderr[-2000:])
        report = json.loads(out.read_text())
        self.assertNotIn("market", report)
        self.assertNotIn("over25", report)  # 89.2-e: no expected goals in the forecast either
        for match in data["matches"][:12]:
            match["market"] = {"home": 0.4, "draw": 0.3, "away": 0.3}
        run, out = self.report(data, name="some-market.json")
        report = json.loads(out.read_text())
        self.assertEqual((report["matches"], report["market"]["matches"]), (30, 12))

    def test_e5_a_bookmakers_file_is_linked_by_the_archive_reader_s_rule(self):
        games = league()
        # The sixth pair meets again two days later in the input: its row has two candidates.
        twice = ("E0-twice", games[5][1] + timedelta(days=2), games[5][2], games[5][3], 7, 7)
        source = self.dir / "to-price.json"
        source.write_text(json.dumps(as_input([*games, twice])))
        short = lambda name: "FC " + name[-1]  # the file's own spellings  # noqa: E731
        head = "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,AvgCH,AvgCD,AvgCA,AvgC>2.5,AvgC<2.5"
        lines = [f"E0,{d:%d/%m/%Y},{short(h)},{short(a)},{hg},{ag},2.10,3.40,3.60,1.90,1.95" for _, d, h, a, hg, ag in games]
        lines[0] = lines[0].rsplit(",", 3)[0] + ",,1.90,1.95"  # an incomplete triple: no price (the match is still named)
        lines[1] = lines[1].replace("2.10,3.40,3.60", "1.00,3.40,3.60")  # a price of 1: no price
        lines.append("E0,01/08/2026,FC Y,FC Z,9,9,2.10,3.40,3.60,1.90,1.95")  # a match the input does not hold
        first, second = self.dir / "E0-a.csv", self.dir / "E0-b.csv"
        first.write_text("\n".join([head, *lines]) + "\n")
        second.write_text("\n".join([head, lines[2]]) + "\n")  # the third match named by a second row
        out = self.dir / "priced.json"
        run = tool("add-odds", "--input", source, "--odds", first, second, "--write-input", out)
        self.assertEqual(run.returncode, 0, run.stderr[-2000:])
        data = json.loads(out.read_text())
        self.assertEqual(data["provenance"]["odds"], {"rows": 32, "linked": 28, "unlinked": 4, "priced": 26})
        priced = [m for m in data["matches"] if "market" in m]
        self.assertEqual(len(priced), 26)
        self.assertNotIn("market", data["matches"][0])
        self.assertNotIn("market", data["matches"][1])
        self.assertNotIn("market", data["matches"][2])  # named by two rows: neither
        self.assertNotIn("market", data["matches"][5])  # two matches of the pair within the window: no link
        self.assertNotIn("market", data["matches"][30])
        market = priced[0]["market"]
        self.assertAlmostEqual(market["home"] + market["draw"] + market["away"], 1.0, places=6)
        self.assertAlmostEqual(market["home"], (1 / 2.10) / (1 / 2.10 + 1 / 3.40 + 1 / 3.60), places=6)
        self.assertAlmostEqual(market["over25"], (1 / 1.90) / (1 / 1.90 + 1 / 1.95), places=6)
        # A second run with other files (another league's, in practice) keeps the prices of the first and adds up
        # the rows. Here a file of two rows, one for no match of the input and one for its first match: too few
        # rows for a name to be recognised (the reader's three), so neither is linked.
        third = self.dir / "E0-c.csv"
        third.write_text("\n".join([head, lines[-1], lines[0].replace(",,1.90,1.95", ",3.60,1.90,1.95")]) + "\n")
        again = self.dir / "priced-again.json"
        run = tool("add-odds", "--input", out, "--odds", third, "--write-input", again)
        self.assertEqual(run.returncode, 0, run.stderr[-2000:])
        data = json.loads(again.read_text())
        self.assertEqual(data["provenance"]["odds"], {"rows": 34, "linked": 28, "unlinked": 6, "priced": 26})
        self.assertEqual(sum(1 for m in data["matches"] if "market" in m), 26)
        self.assertEqual(len(data["provenance"]["odds_files"]), 3)

    def test_e6_over_two_and_a_half_goals_only_with_expected_goals(self):
        data = as_input(league())
        for match in data["matches"][:10]:
            match["forecast"].update(home_goals=1.6, away_goals=1.1, rho=-0.03)
        run, out = self.report(data, name="over.json")
        self.assertEqual(run.returncode, 0, run.stderr[-2000:])
        over = json.loads(out.read_text())["over25"]
        self.assertEqual(over["matches"], 10)
        from vega import forecast

        grid = forecast.score_grid(1.6, 1.1, -0.03)
        self.assertAlmostEqual(over["forecast"]["mean"], sum(grid[i][j] for i in range(11) for j in range(11) if i + j >= 3), places=5)
        self.assertNotIn("market", over)

    def test_e7_the_public_api_is_read_page_by_page_and_a_missing_point_is_counted(self):
        import evaluate_forecast as ev

        def fixture(ident, home_score=2, away_score=1):
            return {"id": ident, "date": "2026-10-03", "status": "finished", "home_team": {"name": "A " + ident}, "away_team": {"name": "B " + ident},
                    "league": {"id": "l_test", "name": "Test League"}, "score_home": home_score, "score_away": away_score}

        pages = {None: ([fixture("m_1"), fixture("m_2")], "next"), "next": ([fixture("m_3"), fixture("m_4", None, None), fixture("m_5")], None)}
        asked = []

        def get(path):
            url = urlparse(path)
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            asked.append((url.path, query))
            if url.path == "/api/fixtures":
                matches, cursor = pages[query.get("cursor")]
                return 200, {"data": {"matches": matches}, "pagination": {"nextCursor": cursor}}
            if query["match"] == "m_2":
                return 404, None
            return 200, {"rates": {"home": 1.6, "away": 1.1}, "rho": -0.03, "points": [{"minute": 0, "home": 0.5, "draw": 0.25, "away": 0.25}],
                         **({"lineups": True} if query["match"] == "m_5" else {})}

        data = ev.from_api(get, {"l_test": "E0"}, "2026-08-01", "2026-11-27")
        self.assertEqual(data["schema"], SCHEMA)
        self.assertEqual(data["provenance"]["kind"], "kickoff-point")
        # m_5's point starts from the forecast read again with the line-ups (form and elevens): another forecast,
        # left out and counted.
        self.assertEqual(data["provenance"]["api"], {"played": 4, "missing": 1, "with_lineups": 1})
        self.assertEqual([m["match"] for m in data["matches"]], ["m_1", "m_3"])
        self.assertEqual(data["matches"][0]["forecast"], {"home": 0.5, "draw": 0.25, "away": 0.25, "home_goals": 1.6, "away_goals": 1.1, "rho": -0.03})
        self.assertEqual(data["matches"][0]["division"], "E0")
        first = asked[0][1]
        self.assertEqual((first["league"], first["status"], first["from"], first["to"]), ("l_test", "played", "2026-08-01", "2026-11-27"))
        # Any other failure of a read stops the command: nothing half-read is judged.
        with self.assertRaises(ev.ReadFailed):
            ev.from_api(lambda path: (500, None), {"l_test": "E0"}, "2026-08-01", "2026-11-27")
        for broken in ((500, None), (200, {"points": [{"minute": 0, "home": 0.5}], "rates": {"home": 1.6, "away": 1.1}, "rho": 0}), (200, ["not", "an", "object"])):
            with self.assertRaises(ev.ReadFailed, msg=broken):  # a point that fails is not a point missing
                ev.from_api(lambda path: get(path) if path.startswith("/api/fixtures") else broken, {"l_test": "E0"}, "2026-08-01", "2026-11-27")
        with self.assertRaises(ev.ReadFailed):  # nor is a page of fixtures of another shape
            ev.from_api(lambda path: (200, {"matches": []}), {"l_test": "E0"}, "2026-08-01", "2026-11-27")

    def observed(self, results=None):
        from vega import forecast

        rng = random.Random(3)
        model = {"home": (0.26, 0.93), "away": (0.02, 0.91), "rho": -0.03}
        rows, day = [], date(2025, 8, 1)
        for k in range(1400):
            home, away = rng.sample(range(40), 2)
            eh, ea = 1500 + 12 * home, 1500 + 12 * away
            lh, la = forecast.rates(model, eh, ea)
            goals = (forecast._goals(rng, lh), forecast._goals(rng, la))
            if results and k in results:
                goals = results[k]
            rows.append({"match": f"o{k}", "date": (day + timedelta(days=k // 4)).isoformat(), "competition": "Test League", "division": None,
                         "home": f"T{home}", "away": f"T{away}", "elo_home": eh, "elo_away": ea, "neutral": False,
                         "home_goals": goals[0], "away_goals": goals[1], "home_xg": lh, "away_xg": la})
        return rows

    def test_e8_a_backtest_fits_strictly_before_its_cutoff(self):
        import evaluate_forecast as ev

        rows = self.observed()
        cutoff = rows[1000]["date"]
        before = sum(1 for r in rows if r["date"] < cutoff)
        data = ev.backtest(rows, cutoff)
        self.assertEqual(data["provenance"]["kind"], "backtest")
        self.assertEqual(data["provenance"]["fit"]["matches"], before)
        self.assertEqual(len(data["matches"]), len(rows) - before)
        self.assertTrue(all(m["date"] >= cutoff for m in data["matches"]))
        self.assertTrue(all({"home_goals", "away_goals", "rho"} <= set(m["forecast"]) for m in data["matches"]))
        # What is played from the cutoff changes nothing of what was fitted.
        other = ev.backtest(self.observed({k: (9, 0) for k in range(1100, 1400)}), cutoff)
        self.assertEqual(other["provenance"]["fit"], data["provenance"]["fit"])
        # Nor of what a match played before them was forecast: the hundred judged before the first changed result keep
        # their forecast, form included; later ones read the changed results in their sides' form.
        chances = lambda d, part: [m["forecast"] for m in d["matches"][part]]  # noqa: E731
        self.assertEqual(chances(other, slice(0, 100)), chances(data, slice(0, 100)))
        self.assertNotEqual(chances(other, slice(150, 400)), chances(data, slice(150, 400)))
        # The form's variant and the strengths alone are two forecasts of the same matches.
        alone = ev.backtest(rows, cutoff, form=False)
        self.assertEqual([m["match"] for m in alone["matches"]], [m["match"] for m in data["matches"]])
        self.assertEqual(alone["provenance"]["fit"]["form"], None)
        for reason, moment in (("too few before", rows[100]["date"]), ("none after", "2030-01-01")):
            with self.assertRaises(ev.Rejected, msg=reason) as caught:
                ev.backtest(rows, moment)
            self.assertEqual(caught.exception.reason, "partition")

    def test_e9_the_log_s_export_leaves_out_and_counts_the_stale_rows(self):
        import evaluate_forecast as ev

        kick = datetime(2026, 11, 21, 20, 0, tzinfo=timezone.utc)

        def row(ident, computed):
            return {"match": ident, "kickoff": kick, "computed_at": computed, "competition": "Ligue 1", "country": "FRA", "home": "A", "away": "B",
                    "home_goals": 1, "away_goals": 1, "home_win": 0.5, "draw": 0.25, "away_win": 0.25, "expected_home": 1.6, "expected_away": 1.1,
                    "rho": -0.03, "model_version": "forecast-v2"}

        data = ev.from_log([row("m_fresh", kick - timedelta(hours=3)), row("m_old", kick - timedelta(days=16)), row("m_late", kick + timedelta(minutes=1))])
        self.assertEqual(data["provenance"]["kind"], "log")
        self.assertEqual(data["provenance"]["log"], {"rows": 3, "judged": 1, "stale": 2})
        self.assertEqual([m["match"] for m in data["matches"]], ["m_fresh"])
        self.assertEqual(data["matches"][0]["division"], "F1")
        self.assertEqual(data["matches"][0]["date"], "2026-11-21")


    def test_e10_the_log_is_reviewed_by_the_open_matchday_restore(self):
        # 185 adds a table that names a match (agg.match_forecast_log): the restore's review lists it.
        from vega import open_matchday_restore

        self.assertIn("185_match_forecast_log.sql", open_matchday_restore.REVIEWED_SCHEMAS)
        self.assertIn("agg.match_forecast_log", open_matchday_restore.ADDED_DEPENDENCIES)
        self.assertIn("-- vega:online", (ROOT / "sql" / "185_match_forecast_log.sql").read_text())  # 89.1-i


    def test_e11_a_read_of_the_base_that_fails_is_exit_code_4_and_writes_nothing(self):
        out = self.dir / "never.json"
        for env in ({}, {"VEGA_EVALUATE_DSN": "postgresql://nobody@127.0.0.1:9/none?connect_timeout=2"}):
            for command in (("from-log",), ("backtest", "--cutoff", "2026-07-01")):
                run = tool(*command, "--write-input", out, **env)
                self.assertEqual(run.returncode, 4, (command, env, run.stderr[-500:]))
                self.assertTrue(run.stderr.startswith("read failed"), run.stderr[-500:])
                self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
