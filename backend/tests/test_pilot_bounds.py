"""The isolated pilot (.github/workflows/pilot.yml; docs/calculs/09-audit-2026-11/FAILURE_MODES_OPTIMISATIONS.md, GH194):
by hand from main, its own provider key, a bounded run. Offline: no provider, no AWS, no database (the AWS CLI is a stub
on PATH). Written before the change; revised after the review of 25 Nov 2026 (the base's 1 to 306 matches, the inputs
through the environment, the cap of a full season, its time) before the workflow.

Failure modes and expected outcomes (GH194.2):
- GH194-a a push touching backend/** -> no pilot run (no push, schedule or pull-request trigger);
- GH194-b a run asked by hand from another branch -> the job is skipped (main only);
- GH194-c the steps -> never the worker's /vega/v2/pitchapi-key, no GitHub secret; the key is /vega/v2/pitchapi-pilot-key;
- GH194-d the pilot parameter absent, empty or malformed -> the key step fails, before any provider command;
- GH194-e every --interval of the workflow -> 0.5 or more; the pilot's CLI refuses 0.25;
- GH194-f max_matches any whole number from 1 to 306 (default 1, as the base), the regressions on request, worker jobs
  0/100/300/700 -> accepted; the budgets 20 x n + 20 (pilot.default_budget(n), every n), 100 or 0, 2 x jobs;
- GH194-g max_matches empty, 0, 307, 1.5, abc, +5, -1, 05, " 5", "5 ", "5\n", 1e2, 99999999999999999999, $(echo 5);
  worker jobs 701 or empty; regressions yes -> the bounds step fails naming the input, nothing written;
- GH194-h the commands -> the inputs through their step's environment (the checked outputs), quoted; no expression in
  any script; each provider command with its budget;
- GH194-i a failed pilot command -> not run again by the workflow;
- GH194-j PitchClient(max_requests=...) -> each attempt counted, retries included; spent, the next attempt refused unsent;
- GH194-k the pilot's CLI without a key, or with a malformed one -> exit 1, MISSING_API_KEY, no database, no provider call;
- GH194-l the budgets reach the clients: the pilot's default 20 per match + 20 (6 140 for 306 matches, its cap: 6 141 and
  307 matches refused), the worker's --max-requests (none without it);
- GH194-m the job's time limit -> 120 minutes or more (7 640 attempts at 0.5 s at most: about 64 minutes);
- GH194-n the role vega-v2-pilot -> trust refs/heads/main exactly, the workflow, this repository; the pilot parameter only.
"""

import contextlib
import io
import os
import re
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock

from vega import pilot, worker
from vega.pitchapi import PitchClient, PitchError

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github/workflows/pilot.yml").read_text()
ROLES = (ROOT / "infra/aws/deploy-roles.yaml").read_text()
WORKER_STACK = (ROOT / "infra/aws/worker.yaml").read_text()
PILOT_KEY = "/vega/v2/pitchapi-pilot-key"
PRODUCTION_KEY = "/vega/v2/pitchapi-key"
MAIN = "repo:VegaInteligence@188998341/Vega-Sport@1441213700:ref:refs/heads/main"


def top_level(name):
    found = re.search(rf"^{name}:\n((?:[ \t].*\n|\n)*)", WORKFLOW, re.M)
    return found.group(1) if found else ""


def steps():
    """The pilot job's steps, in order: (name, text)."""
    body = WORKFLOW.split("\n    steps:\n", 1)[1]
    parts = [p for p in re.split(r"\n(?=      - )", "\n" + body) if p.strip().startswith("- ")]
    return [(re.search(r"(?:name|uses|run): (.+)", p).group(1).strip(), p) for p in parts]


def script(step):
    found = re.search(r"\n        run: \|\n((?:          .*\n|\n)+)", step + "\n")
    return textwrap.dedent(found.group(1)) if found else re.search(r"\n        run: (.+)", step).group(1)


def provider_steps():
    return [(name, text) for name, text in steps() if re.search(r"python -m vega\.(pilot|worker)\b", text)]


def run_step(text, env, stub=None):
    """Runs a step's script with bash; `stub`: the AWS CLI's answer (exit code, standard output)."""
    with tempfile.TemporaryDirectory() as directory:
        outputs, environment = Path(directory, "output"), Path(directory, "env")
        outputs.touch()
        environment.touch()
        path = os.environ["PATH"]
        if stub is not None:
            aws = Path(directory, "aws")
            aws.write_text(f"#!/bin/sh\nprintf '%s' '{stub[1]}'\nexit {stub[0]}\n")
            aws.chmod(aws.stat().st_mode | stat.S_IEXEC)
            path = f"{directory}:{path}"
        done = subprocess.run(["bash", "-eo", "pipefail", "-c", script(text)], capture_output=True, text=True,
                              env={**env, "PATH": path, "GITHUB_OUTPUT": str(outputs), "GITHUB_ENV": str(environment)})
        values = dict(line.split("=", 1) for line in outputs.read_text().splitlines() if "=" in line)
        return done, values, environment.read_text()


class WorkflowTest(unittest.TestCase):
    def test_GH194_a_started_by_hand_only(self):
        trigger = top_level("on")
        self.assertIn("workflow_dispatch:", trigger)
        for event in ("push:", "schedule:", "pull_request", "workflow_run", "repository_dispatch"):
            self.assertNotIn(event, trigger, event)

    def test_GH194_b_the_job_runs_for_main_only(self):
        guard = re.search(r"\n  pilot:\n(?:    .*\n)*?    if: (.+)\n", WORKFLOW)
        self.assertIsNotNone(guard, "the pilot job has no condition")
        self.assertIn("github.ref == 'refs/heads/main'", guard.group(1))
        self.assertIn("github.event_name == 'workflow_dispatch'", guard.group(1))

    def test_GH194_c_the_pilot_key_never_the_production_key(self):
        self.assertNotIn(PRODUCTION_KEY, WORKFLOW)
        self.assertNotIn("secrets.", WORKFLOW)
        key = [text for name, text in steps() if PILOT_KEY in text]
        self.assertEqual(len(key), 1, "one step reads the pilot key")

    def test_GH194_d_a_missing_or_malformed_key_stops_before_any_provider_command(self):
        names = [name for name, _ in steps()]
        (key_name, key_step), = [(name, text) for name, text in steps() if PILOT_KEY in text]
        for name, _ in provider_steps():
            self.assertLess(names.index(key_name), names.index(name), name)
        for stub in ((254, ""), (0, ""), (0, "None"), (0, "not-a-key"), (0, "pk_live_ok extra")):
            done, _, env = run_step(key_step, {}, stub)
            self.assertNotEqual(done.returncode, 0, stub)
            self.assertNotIn("PITCHAPI_API_KEY", env, stub)
        done, _, env = run_step(key_step, {}, (0, "pk_live_Pilot-only_1"))
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("::add-mask::pk_live_Pilot-only_1", done.stdout)
        self.assertEqual(env.strip(), "PITCHAPI_API_KEY=pk_live_Pilot-only_1")

    def test_GH194_e_the_pace_is_the_production_s_or_slower(self):
        intervals = re.findall(r"--interval\s+(\S+)", WORKFLOW)
        self.assertTrue(intervals)
        for value in intervals:
            self.assertGreaterEqual(float(value), 0.5, value)
        for name, text in provider_steps():
            self.assertRegex(text, r"--interval\s+\d", name)

    def bounds(self):
        (_, text), = [(name, text) for name, text in steps() if "id: bounds" in text]
        return text

    def test_GH194_f_any_match_count_of_the_base_and_its_budgets(self):
        inputs = top_level("on")
        matches = re.search(r"\n      max_matches:\n((?:        .*\n)+)", inputs)
        self.assertIsNotNone(matches, "max_matches")
        self.assertIn("type: string", matches.group(1))
        self.assertIn("default: '1'", matches.group(1))
        self.assertIn("1 to 306", matches.group(1))
        self.assertNotIn("options:", matches.group(1))
        jobs = re.search(r"worker_jobs:\n(?:\s+.*\n)*?\s+options: \[([^\]]+)\]", inputs)
        self.assertIsNotNone(jobs, "worker_jobs is a choice")
        self.assertEqual([int(v.strip().strip("'\"")) for v in jobs.group(1).split(",")], [0, 100, 300, 700])
        self.assertRegex(inputs, r"regressions:\n(?:\s+.*\n)*?\s+type: boolean")
        bounds = self.bounds()
        for m in (1, 3, 20, 306):
            for j in (0, 100, 300, 700):
                for regressions in ("true", "false"):
                    done, out, _ = run_step(bounds, {"MAX_MATCHES": str(m), "WORKER_JOBS": str(j), "REGRESSIONS": regressions})
                    self.assertEqual(done.returncode, 0, done.stderr)
                    self.assertEqual(out, {"matches": str(m), "pilot": str(pilot.default_budget(m)),
                                           "regressions": "100" if regressions == "true" else "0", "jobs": str(j), "worker": str(2 * j)})
        # The workflow's budget is the CLI's for every count, and within the CLI's cap.
        for m in range(1, 307):
            done, out, _ = run_step(bounds, {"MAX_MATCHES": str(m), "WORKER_JOBS": "0", "REGRESSIONS": "false"})
            self.assertEqual((done.returncode, int(out["pilot"])), (0, pilot.default_budget(m)), m)
            self.assertLessEqual(int(out["pilot"]), pilot.MAX_REQUESTS, m)

    def test_GH194_g_every_other_value_is_refused_before_any_arithmetic(self):
        bounds = self.bounds()
        well = {"MAX_MATCHES": "1", "WORKER_JOBS": "100", "REGRESSIONS": "false"}
        bad_matches = ("", "0", "307", "1.5", "abc", "+5", "-1", "05", " 5", "5 ", "5\n", "1e2", "99999999999999999999",
                       "$(echo 5)", "1000", "3 4")
        for name, values in (("max_matches", bad_matches), ("worker_jobs", ("701", "", "1e2")), ("regressions", ("yes", ""))):
            for value in values:
                done, out, _ = run_step(bounds, {**well, name.upper(): value})
                self.assertNotEqual(done.returncode, 0, (name, value))
                self.assertIn(f"::error::{name} ", done.stdout, (name, value))
                self.assertEqual(out, {}, (name, value))

    def test_GH194_h_inputs_through_the_environment_quoted_and_a_budget_for_each_command(self):
        for name, text in steps():
            if "run:" in text:
                self.assertNotIn("${{", script(text), name)
        def env_of(text):
            """A step's env block, as NAME -> expression."""
            if "\n        env:\n" not in text:
                return {}
            block = "\n" + text.split("\n        env:\n", 1)[1].split("\n        run:", 1)[0]
            return dict(re.findall(r"\n          (\w+): (.+)", block))
        self.assertEqual({k: v for k, v in env_of(self.bounds()).items()},
                         {"MAX_MATCHES": "${{ inputs.max_matches }}", "WORKER_JOBS": "${{ inputs.worker_jobs }}", "REGRESSIONS": "${{ inputs.regressions }}"})
        commands = {}
        for name, text in provider_steps():
            env = env_of(text)
            for command in re.findall(r"python -m vega\.(?:pilot|worker)[^\n]*", script(text)):
                budget = re.search(r'--max-requests "\$(\w+)"', command)
                self.assertIsNotNone(budget, command)
                self.assertRegex(env.get(budget.group(1), ""), r"^\$\{\{ steps\.bounds\.outputs\.(pilot|regressions|worker) \}\}$", name)
                commands[command.split(" --report ")[1]] = (command, env)
        pilot_command, pilot_env = commands["work/vega-v2-pilot.md"]
        self.assertIn('--max-matches "$MATCHES"', pilot_command)
        self.assertEqual(pilot_env["MATCHES"], "${{ steps.bounds.outputs.matches }}")
        worker_command, worker_env = commands["work/vega-v2-worker.md"]
        self.assertIn('--max-jobs "$JOBS"', worker_command)
        self.assertEqual(worker_env["JOBS"], "${{ steps.bounds.outputs.jobs }}")
        self.assertIn("--ordinals 19,20,227,228 --max-matches 4", commands["work/vega-v2-regressions.md"][0])
        # Whether a step runs is read from the checked values too.
        conditions = {name: re.search(r"\n        if: (.+)", text) for name, text in provider_steps()}
        self.assertEqual(sorted(c.group(1) for c in conditions.values() if c),
                         ["steps.bounds.outputs.jobs != '0'", "steps.bounds.outputs.regressions != '0'"])

    def test_GH194_m_time_for_a_full_season(self):
        limit = re.search(r"\n    timeout-minutes: (\d+)\n", WORKFLOW)
        self.assertGreaterEqual(int(limit.group(1)), 120)

    def test_GH194_i_a_failed_pilot_is_not_run_again(self):
        for name, text in provider_steps():
            self.assertLessEqual(len(re.findall(r"python -m vega\.pilot", text)), 1, name)
            self.assertNotRegex(script(text), r"\belse\b|\|\|", name)


class RoleTest(unittest.TestCase):
    def setUp(self):
        found = re.search(r"\n  PilotRole:\n((?:    .*\n|\n)+?)(?=Outputs:|\n  \S)", ROLES)
        self.assertIsNotNone(found, "PilotRole missing")
        self.role = found.group(1)

    def test_GH194_n_trusted_from_main_and_reads_the_pilot_key_only(self):
        self.assertNotIn("StringLike", self.role)
        self.assertNotIn("claude/v2", self.role)
        self.assertIn(f"token.actions.githubusercontent.com:sub: '{MAIN}'", self.role)
        self.assertIn("token.actions.githubusercontent.com:workflow: 'Isolated pilot'", self.role)
        self.assertIn("token.actions.githubusercontent.com:repository_id: '1441213700'", self.role)
        self.assertIn("token.actions.githubusercontent.com:aud: sts.amazonaws.com", self.role)
        self.assertEqual(sorted(set(re.findall(r"Action: '([^']+)'", self.role))), ["kms:Decrypt", "ssm:GetParameter"])
        resources = re.findall(r"Resource: (.+)", self.role)
        self.assertIn(f"!Sub 'arn:${{AWS::Partition}}:ssm:${{AWS::Region}}:${{AWS::AccountId}}:parameter{PILOT_KEY}'", resources)
        self.assertNotIn(PRODUCTION_KEY + "'", self.role)
        # The worker keeps the production key; the pilot's is another parameter.
        self.assertIn(f"PitchApiKeyParameter: {{Type: String, Default: {PRODUCTION_KEY}}}", WORKER_STACK)


def answers(*replies):
    calls = []

    def transport(request, timeout):
        calls.append(request.full_url)
        return replies[min(len(calls), len(replies)) - 1]

    return transport, calls


class ClientBudgetTest(unittest.TestCase):
    def test_GH194_j_every_attempt_counts_retries_included(self):
        transport, calls = answers((429, {}, b'{"error":{"code":"RATE_LIMIT_EXCEEDED"}}'))
        client = PitchClient("pk_test_dummy", interval=0, transport=transport, sleep=lambda s: None, max_requests=3)
        with self.assertRaisesRegex(PitchError, "REQUEST_BUDGET_EXHAUSTED"):
            client.fetch("/leagues")
        self.assertEqual((len(calls), client.requests), (3, 3))

    def test_GH194_j_a_spent_budget_sends_nothing(self):
        transport, calls = answers((200, {}, b'{"data":{"leagues":[]}}'))
        client = PitchClient("pk_test_dummy", interval=0, transport=transport, sleep=lambda s: None, max_requests=2)
        client.fetch("/leagues")
        client.fetch("/leagues")
        with self.assertRaisesRegex(PitchError, "REQUEST_BUDGET_EXHAUSTED"):
            client.fetch("/leagues")
        self.assertEqual(len(calls), 2)
        unbounded = PitchClient("pk_test_dummy", interval=0, transport=answers((200, {}, b'{"data":[]}'))[0], sleep=lambda s: None)
        for _ in range(5):
            unbounded.fetch("/leagues")
        self.assertEqual(unbounded.requests, 5)

    def test_GH194_j_a_budget_is_a_positive_integer(self):
        for bad in (0, -1, True, 1.5, "3"):
            with self.assertRaisesRegex(PitchError, "INVALID_REQUEST_BUDGET"):
                PitchClient("pk_test_dummy", max_requests=bad)


class PilotCliTest(unittest.TestCase):
    def run_pilot(self, argv, key):
        environ = {k: v for k, v in os.environ.items() if k != "PITCHAPI_API_KEY"}
        if key is not None:
            environ["PITCHAPI_API_KEY"] = key
        out = io.StringIO()
        with mock.patch.dict(os.environ, environ, clear=True), contextlib.redirect_stdout(out), \
                mock.patch.object(pilot, "connect_local", side_effect=AssertionError("database opened")) as opened, \
                mock.patch.object(PitchClient, "_request", side_effect=AssertionError("provider called")):
            code = pilot.main(argv)
        return code, out.getvalue(), opened

    def test_GH194_k_no_key_no_database_no_provider(self):
        for key in (None, "", "abc", "pk_live_"):
            code, out, opened = self.run_pilot(["--max-matches", "1"], key)
            self.assertEqual(code, 1, key)
            self.assertIn("pilot_error=MISSING_API_KEY", out)
            opened.assert_not_called()

    def test_GH194_e_l_pace_and_budget_bounds(self):
        self.assertEqual((pilot.default_budget(306), pilot.MAX_REQUESTS), (6140, 6140))
        for argv in (["--interval", "0.25"], ["--max-requests", "0"], ["--max-requests", "6141"], ["--max-matches", "307"],
                     ["--max-matches", "0"]):
            with self.assertRaises(SystemExit, msg=argv), contextlib.redirect_stderr(io.StringIO()):
                pilot.main(argv)
        seen = []

        @contextlib.contextmanager
        def database(dsn):
            yield mock.MagicMock()

        def run(self, **kwargs):
            seen.append((kwargs["max_matches"], self.client.max_requests))
            return True

        with mock.patch.dict(os.environ, {"PITCHAPI_API_KEY": "pk_test_dummy"}), mock.patch.object(pilot, "connect_local", database), \
                mock.patch.object(pilot, "migrate"), mock.patch.object(pilot.Pilot, "run", run), mock.patch.object(pilot.Pilot, "report"):
            self.assertEqual(pilot.main(["--max-matches", "4"]), 0)
            self.assertEqual(pilot.main(["--max-matches", "4", "--max-requests", "30"]), 0)
            self.assertEqual(pilot.main(["--max-matches", "306"]), 0)
            self.assertEqual(pilot.main(["--max-matches", "306", "--max-requests", "6140"]), 0)
        self.assertEqual(seen, [(4, 100), (4, 30), (306, 6140), (306, 6140)])


class WorkerCliTest(unittest.TestCase):
    def test_GH194_l_the_worker_s_budget_reaches_its_client(self):
        made = []

        def client(key, **kwargs):
            made.append(kwargs.get("max_requests"))
            return mock.MagicMock()

        env = {"V2_DATABASE_URL": "postgresql://127.0.0.1/vega_v2_unused", "PITCHAPI_API_KEY": "pk_test_dummy"}
        with mock.patch.dict(os.environ, env), mock.patch.object(worker, "PitchClient", client), \
                mock.patch.object(worker, "keep_running", return_value=True), mock.patch.object(worker.signal, "signal"), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(worker.main(["--max-jobs", "1", "--until-idle", "--max-requests", "5"]), 0)
            self.assertEqual(worker.main(["--max-jobs", "1", "--until-idle"]), 0)
        self.assertEqual(made, [5, None])
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            worker.main(["--max-requests", "0"])


if __name__ == "__main__":
    unittest.main()
