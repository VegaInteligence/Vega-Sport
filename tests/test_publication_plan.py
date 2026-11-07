"""Execute scheduled/manual publication planning without AWS or a database."""

import os
import shlex
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / ".github/workflows/rematerialize.yml").read_text()
PLAN = textwrap.dedent(WORKFLOW.split("        run: |\n", 1)[1].split("      - uses: actions/checkout", 1)[0])
PUBLISH = textwrap.dedent(WORKFLOW.split("      - name: Publish relational models in AWS RDS\n", 1)[1]
                         .split("        run: |\n", 1)[1].split("      - name:", 1)[0])


class PublicationPlanTests(unittest.TestCase):
    def plan(self, **options):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output"
            env = dict(os.environ, EVENT_NAME="workflow_dispatch", MINUTES_INPUT="", BATCH_INPUT="",
                       QUEUE_ALL_INPUT="", SCHEMA_ONLY_INPUT="", HOME_ONLY_INPUT="", LINEUP_READER_INPUT="",
                       GITHUB_OUTPUT=str(output))
            env.update(options)
            result = subprocess.run(["bash", "-c", PLAN], env=env, capture_output=True, text=True)
            values = dict(line.split("=", 1) for line in output.read_text().splitlines()) if output.exists() else {}
        return result, values

    def command(self, plan, receipt='{"schema_installed":true}'):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            capture = path / "arguments"
            shim = path / "python"
            shim.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE_ARGS"\nprintf "%s\\n" ' + shlex.quote(receipt) + '\n')
            shim.chmod(0o700)
            env = dict(os.environ, PATH=directory + os.pathsep + os.environ["PATH"],
                       CAPTURE_ARGS=str(capture), MATERIALIZE_MINUTES=plan["minutes"],
                       MATERIALIZE_BATCH=plan["batch"], QUEUE_ALL=plan["queue_all"],
                       SCHEMA_ONLY=plan["schema_only"], HOME_ONLY=plan["home_only"])
            result = subprocess.run(["bash", "-c", PUBLISH], cwd=path, env=env, capture_output=True, text=True)
            return result, capture.read_text().splitlines() if capture.exists() else []

    def test_hourly_schedule_has_explicit_safe_defaults(self):
        result, plan = self.plan(EVENT_NAME="schedule")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(plan, dict(minutes="30", batch="10", home_only="false", queue_all="false", schema_only="false", lineup_reader="unchanged"))
        result, args = self.command(plan)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(args, ["dashboard/scripts/relational_materialize.py", "--minutes", "30", "--batch", "10"])

    def test_schedule_cannot_inherit_manual_requeue_or_reader_switch(self):
        result, plan = self.plan(EVENT_NAME="schedule", MINUTES_INPUT="100", BATCH_INPUT="100",
                                 QUEUE_ALL_INPUT="true", SCHEMA_ONLY_INPUT="true", HOME_ONLY_INPUT="true", LINEUP_READER_INPUT="legacy")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(plan, dict(minutes="30", batch="10", home_only="false", queue_all="false", schema_only="false", lineup_reader="unchanged"))

    def test_manual_defaults_and_controls_are_preserved(self):
        result, plan = self.plan()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(plan, dict(minutes="100", batch="10", home_only="false", queue_all="false", schema_only="false", lineup_reader="unchanged"))
        for reader in ("unchanged", "verify", "unified", "legacy"):
            with self.subTest(reader=reader):
                result, plan = self.plan(MINUTES_INPUT="1", BATCH_INPUT="100", QUEUE_ALL_INPUT="true",
                                         SCHEMA_ONLY_INPUT="true", LINEUP_READER_INPUT=reader)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(plan["lineup_reader"], reader)
                result, args = self.command(plan)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(args, ["dashboard/scripts/relational_materialize.py", "--minutes", "1",
                                        "--batch", "100", "--all", "--install-only"])

    def test_home_only_installs_without_publishing_business_data(self):
        result, plan = self.plan(HOME_ONLY_INPUT="true")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(plan["home_only"], "true")
        result, args = self.command(plan)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(args, ["dashboard/scripts/relational_materialize.py", "--minutes", "100", "--batch", "10", "--install-only"])
        locked, _ = self.command(plan, '{"locked":true}')
        self.assertNotEqual(locked.returncode, 0)
        for options in ({"QUEUE_ALL_INPUT": "true"}, {"SCHEMA_ONLY_INPUT": "true"}, {"LINEUP_READER_INPUT": "verify"}):
            result, plan = self.plan(HOME_ONLY_INPUT="true", **options)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(plan, {})

    def test_invalid_manual_budgets_flags_and_trigger_fail_before_publication(self):
        for options in ({"MINUTES_INPUT": "101"}, {"MINUTES_INPUT": "0"}, {"BATCH_INPUT": "101"},
                        {"MINUTES_INPUT": "$(false)"}, {"BATCH_INPUT": "1; false"},
                        {"QUEUE_ALL_INPUT": "TRUE"}, {"SCHEMA_ONLY_INPUT": "yes"}, {"HOME_ONLY_INPUT": "yes"},
                        {"LINEUP_READER_INPUT": "other"}, {"EVENT_NAME": "push"}):
            with self.subTest(options=options):
                result, plan = self.plan(**options)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(plan, {})

    def test_schedule_keeps_serial_writer_and_manual_only_reader_switch(self):
        self.assertIn("cron: \"17 * * * *\"", WORKFLOW)
        self.assertIn("group: statarena-aws-ingestion\n  cancel-in-progress: false\n  queue: max", WORKFLOW)
        self.assertIn("timeout-minutes: ${{ github.event_name == 'schedule' && 50 || 120 }}", WORKFLOW)
        self.assertIn("if: steps.plan.outputs.lineup_reader != 'unchanged'", WORKFLOW)
        for name in ("minutes", "batch", "home_only", "queue_all", "schema_only", "lineup_reader"):
            self.assertIn("${{ steps.plan.outputs." + name + " }}", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
