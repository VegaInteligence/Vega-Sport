"""Execute the workflow's input planner; never invoke a provider or AWS."""

import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / ".github/workflows/collect-football.yml").read_text()
PLAN = textwrap.dedent(WORKFLOW.split("        run: |\n", 1)[1].split("      - uses: actions/setup-python", 1)[0])


class CollectionPlan(unittest.TestCase):
    def run_plan(self, **options):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output"
            env = dict(os.environ, EVENT_NAME="workflow_dispatch", SCHEDULE="", MODE_INPUT="daily",
                       MINUTES_INPUT="", REQUESTS_INPUT="", PRIORITY_INPUT="", ASSETS_INPUT="true",
                       GITHUB_OUTPUT=str(output))
            env.update(options)
            result = subprocess.run(["bash", "-c", PLAN], env=env, capture_output=True, text=True)
            return result, dict(line.split("=", 1) for line in output.read_text().splitlines()) if output.exists() else {}

    def test_schedules_keep_their_existing_daily_and_pulse_plans(self):
        for schedule, mode, minutes in (("35 22 * * *", "daily", "60"), ("10 6 * * *", "pulse", "25")):
            with self.subTest(schedule=schedule):
                result, plan = self.run_plan(EVENT_NAME="schedule", SCHEDULE=schedule)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((plan["mode"], plan["minutes"]), (mode, minutes))

    def test_historical_budget_reserves_time_for_publication(self):
        result, plan = self.run_plan(MODE_INPUT="historical")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((plan["minutes"], plan["requests"]), ("240", "100000"))

    def test_excess_budget_invalid_request_and_shell_text_are_rejected(self):
        for values in ({"MINUTES_INPUT": "241"}, {"MINUTES_INPUT": "300"},
                       {"MINUTES_INPUT": "0"}, {"MINUTES_INPUT": "$(false)"},
                       {"REQUESTS_INPUT": "100001"}, {"PRIORITY_INPUT": "l_bad; false"}):
            with self.subTest(values=values):
                result, plan = self.run_plan(**values)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(plan, {})

    def test_valid_override_remains_exact_and_assets_can_be_disabled(self):
        result, plan = self.run_plan(MINUTES_INPUT="1", REQUESTS_INPUT="7", PRIORITY_INPUT="l_123ABC", ASSETS_INPUT="false")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((plan["minutes"], plan["requests"], plan["priority_league"], plan["asset_limit"]), ("1", "7", "l_123ABC", "0"))


if __name__ == "__main__":
    unittest.main()
