"""Calculation audit of 16 Nov 2026 (VI-23), batch B9: the xG evaluation workflow on a dated,
versioned, immutable input (FAILURE_MODES.md §10.1, written before the tool; Astra/xhigh
pre-code amendment §4).

backend/tools/evaluate_xg.py is run as the operator runs it, in a subprocess:
- `--synthetic --seed N --write-input FILE` writes a synthetic input in the schema;
- `--input FILE --cutoff YYYY-MM-DD --output FILE` evaluates the unconstrained and the
  constrained fits on a strict temporal split of that input.
No real data is read: real predictive performance stays unavailable until a snapshot exists.
"""

import hashlib
import json
import math
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "evaluate_xg.py"
SCHEMA = "vega-xg-evaluation-input/1"


def tool(*args):
    return subprocess.run([sys.executable, str(TOOL), *map(str, args)], capture_output=True, text=True, timeout=900,
                          env={"PYTHONPATH": str(ROOT)})


class XgEvaluationInputTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.folder.cleanup)
        cls.input = Path(cls.folder.name) / "synthetic.json"
        cls.written = tool("--synthetic", "--seed", 7, "--write-input", cls.input) if TOOL.exists() else None

    def setUp(self):
        self.assertTrue(TOOL.exists(), f"{TOOL} does not exist")
        self.assertEqual(self.written.returncode, 0, self.written.stderr[-2000:])

    def evaluate(self, data=None, cutoff="2025-01-01", name="report.json"):
        source = self.input
        if data is not None:
            source = Path(self.folder.name) / f"input-{name}"
            source.write_text(json.dumps(data))
        out = Path(self.folder.name) / name
        out.unlink(missing_ok=True)
        return tool("--input", source, "--cutoff", cutoff, "--output", out), out

    def test_1_the_synthetic_input_follows_the_schema(self):
        data = json.loads(self.input.read_text())
        self.assertEqual(data["schema"], SCHEMA)
        self.assertEqual(data["provenance"]["kind"], "synthetic")
        self.assertIs(data["provenance"]["observation_times"], False)
        shot = data["shots"][0]
        self.assertEqual(set(shot), {"match", "shot", "date", "x", "y", "body", "situation", "outcome", "own_goal"})
        dates = sorted({s["date"] for s in data["shots"]})
        self.assertTrue(dates[0] < "2025-01-01" <= dates[-1], (dates[0], dates[-1]))

    def test_2_the_report_names_its_input_split_samples_and_exclusions(self):
        run, out = self.evaluate()
        self.assertEqual(run.returncode, 0, run.stderr[-2000:])
        report = json.loads(out.read_text())
        data = json.loads(self.input.read_text())
        self.assertEqual(report["input"]["sha256"], hashlib.sha256(self.input.read_bytes()).hexdigest())
        self.assertEqual((report["input"]["schema"], report["input"]["shots"]), (SCHEMA, len(data["shots"])))
        # Without observation times this is a retrospective reading by event time, not a replay of
        # what was known at the time; and the input is synthetic.
        self.assertEqual(report["evaluation"], "event-time retrospective evaluation")
        self.assertEqual(report["real_data"], "unavailable")
        split = report["split"]
        self.assertEqual(split["cutoff"], "2025-01-01")
        self.assertLess(split["train"]["last_date"], "2025-01-01")
        self.assertGreaterEqual(split["test"]["first_date"], "2025-01-01")
        excluded = sum(report["excluded"].values())
        self.assertEqual(split["train"]["shots"] + split["test"]["shots"] + excluded, len(data["shots"]))
        self.assertEqual(set(report["models"]), {"unconstrained", "constrained"})
        for name, model in report["models"].items():
            self.assertTrue(math.isfinite(model["log_loss"]) and math.isfinite(model["brier"]), name)
            self.assertTrue(model["calibration"]["distance"] and model["calibration"]["situation"], name)
        self.assertEqual(report["models"]["constrained"]["violations"], [])
        self.assertRegex(report["sha256"], r"^[0-9a-f]{64}$")

    def test_3_the_same_input_gives_the_same_report(self):
        first, a = self.evaluate(name="a.json")
        second, b = self.evaluate(name="b.json")
        self.assertEqual((first.returncode, second.returncode), (0, 0))
        self.assertEqual(a.read_bytes(), b.read_bytes())

    def test_4_a_malformed_input_is_rejected(self):
        data = json.loads(self.input.read_text())
        base = data["shots"][:3]
        cases = {
            "date": [dict(base[0], date="2025-13-01")] + base[1:],
            "duplicate": base + [dict(base[0])],
            "conflict": base + [dict(base[0], shot=base[0]["shot"] + "-b", date="2020-01-01" if base[0]["date"] != "2020-01-01" else "2021-01-01")],
            "coordinate": [dict(base[0], x=140)] + base[1:],
            "body": [dict(base[0], body="knee")] + base[1:],
            "schema": None,
        }
        for reason, shots in cases.items():
            bad = {"schema": "other/0", "provenance": data["provenance"], "shots": base} if shots is None else dict(data, shots=shots)
            run, out = self.evaluate(bad, name=f"bad-{reason}.json")
            self.assertEqual(run.returncode, 2, f"{reason}: {run.stderr[-500:]}")
            self.assertIn(reason, run.stderr.lower(), reason)
            self.assertFalse(out.exists(), reason)

    def test_5_a_cutoff_that_empties_a_partition_is_rejected(self):
        run, out = self.evaluate(cutoff="1990-01-01", name="empty.json")
        self.assertEqual(run.returncode, 2, run.stderr[-500:])
        self.assertIn("partition", run.stderr.lower())
        self.assertFalse(out.exists())

    def test_6_a_fit_that_does_not_converge_leaves_the_comparison_incomplete(self):
        # FAILURE_MODES §10.2 (stage 3): the report is kept as a diagnostic, but says it is not a
        # comparison of fitted optima, and the tool signals it (exit 3; 2 is a rejected input).
        run, out = self.evaluate(name="complete.json")
        self.assertEqual(run.returncode, 0, run.stderr[-500:])
        report = json.loads(out.read_text())
        self.assertEqual((report["complete"], report["status"], report["failed_fits"]), (True, "ok", []))
        out = Path(self.folder.name) / "nonconverged.json"
        out.unlink(missing_ok=True)
        run = tool("--input", self.input, "--cutoff", "2025-01-01", "--output", out, "--iterations", 0)
        self.assertEqual(run.returncode, 3, run.stderr[-500:])
        self.assertTrue(out.exists(), "the diagnostic report was not written")
        self.assertIn("converge", run.stderr.lower())
        report = json.loads(out.read_text())
        self.assertEqual((report["complete"], report["status"]), (False, "nonconverged"))
        self.assertEqual(sorted(report["failed_fits"]), ["constrained", "unconstrained"])
        for name, model in report["models"].items():
            self.assertIs(model["fit"]["converged"], False, name)
            self.assertEqual(model["fit"]["iterations"], 0, name)
            self.assertTrue(math.isfinite(model["log_loss"]), name)  # a terminal-iterate diagnostic, kept
        self.assertRegex(report["sha256"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
