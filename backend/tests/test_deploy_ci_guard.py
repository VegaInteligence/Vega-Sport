"""Exercise the Deploy CI check in a disposable Git checkout with a simulated GitHub CLI.

The expected outcomes are documented in FAILURE_MODES_OPTIMISATIONS.md, GH196.
"""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / "infra/aws/ci/check_deploy_ci.py"
# "workflows/deploy.yml" alone: a name that changed_suites.py can read (no leading dot), so that a change of the
# workflow runs this module's zone too.
WORKFLOW = ROOT / ".github" / "workflows/deploy.yml"
REPO, REPO_ID = "VegaInteligence/Vega-Sport", 1441213700
OTHER_SHA = "1" * 40
# The fake gh and aws: each call logged as [name, *argv]; gh answers what the test wrote, aws always fails.
FAKE = """
import json, os, sys
name = os.path.basename(sys.argv[0])
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps([name, *sys.argv[1:]]) + "\\n")
if name != "gh":
    sys.exit(1)
with open(os.environ["FAKE_GH_ANSWER"]) as answer:
    answer = json.load(answer)
sys.stdout.write(answer["stdout"])
sys.stderr.write(answer["stderr"])
sys.exit(answer["code"])
"""


def page(*runs):
    return {"total_count": len(runs), "workflow_runs": list(runs)}


class GateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.TemporaryDirectory()
        cls.checkout, cls.bin = Path(cls.work.name, "checkout"), Path(cls.work.name, "bin")
        cls.checkout.mkdir()
        cls.bin.mkdir()
        git = ["git", "-c", "init.defaultBranch=main", "-c", "user.name=Gate test", "-c", "user.email=gate@example.invalid",
               "-c", "commit.gpgsign=false"]
        subprocess.run([*git, "init", "-q"], cwd=cls.checkout, check=True)
        subprocess.run([*git, "commit", "-q", "--allow-empty", "-m", "the commit to deploy"], cwd=cls.checkout, check=True)
        cls.sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=cls.checkout, check=True, capture_output=True,
                                 text=True).stdout.strip()
        cls.query = ["gh", "api", "--method", "GET", "--paginate", "--slurp",
                     f"repos/{REPO}/actions/workflows/ci.yml/runs", "-f", "branch=main", "-f", f"head_sha={cls.sha}",
                     "-F", "per_page=100"]
        for name in ("gh", "aws"):
            fake = cls.bin / name
            fake.write_text(f"#!{sys.executable}\n{FAKE}")
            fake.chmod(0o755)

    @classmethod
    def tearDownClass(cls):
        cls.work.cleanup()

    def ci_run(self, number, **changes):
        """A run of ci.yml with the fields of 0c8a27a8's run #574 as the API answered them, on the test's commit."""
        found = {"id": 46147100000 + number, "run_number": number, "run_attempt": 1, "event": "push",
                 "status": "completed", "conclusion": "success", "head_sha": self.sha, "head_branch": "main",
                 "path": ".github/workflows/ci.yml", "repository": {"id": REPO_ID, "full_name": REPO},
                 "head_repository": {"id": REPO_ID, "full_name": REPO}}
        return {**found, **changes}

    def gate(self, stdout="", code=0, stderr="", **env):
        """The real gate in the temporary checkout, gh answering stdout, stderr and code; a variable None is unset."""
        with tempfile.TemporaryDirectory() as scratch:
            log, answer = Path(scratch, "calls"), Path(scratch, "answer.json")
            log.touch()
            answer.write_text(json.dumps({"stdout": stdout, "stderr": stderr, "code": code}))
            variables = {**os.environ, "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}", "FAKE_LOG": str(log),
                         "FAKE_GH_ANSWER": str(answer), "GITHUB_REPOSITORY": REPO, "GITHUB_REPOSITORY_ID": str(REPO_ID),
                         "GITHUB_SHA": self.sha, "GITHUB_REF": "refs/heads/main", "GITHUB_SERVER_URL": "https://github.com"}
            for name, value in env.items():
                if value is None:
                    variables.pop(name, None)
                else:
                    variables[name] = value
            done = subprocess.run([sys.executable, str(GATE)], cwd=self.checkout, env=variables, capture_output=True,
                                  text=True, timeout=120)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
        self.assertNotIn("Traceback", done.stderr, "a decision, not a crash")
        return done, calls

    def assert_refused(self, done, calls, *named, queried=True):
        self.assertNotEqual(done.returncode, 0, done.stdout)
        for text in named:
            self.assertIn(text, done.stderr)
        self.assertEqual(calls, [self.query] if queried else [], "GH196-g: one query or none before it; never aws")

    def test_GH196_a_the_newest_eligible_run_green_lets_the_deploy_go_on(self):
        run = self.ci_run
        for name, pages, number in (
            ("a push", [page(run(5))], 5),
            ("a manual run", [page(run(5, event="workflow_dispatch"))], 5),
            ("a green re-run", [page(run(5, run_attempt=2))], 5),
            ("a manual run after a failed push", [page(run(6, event="workflow_dispatch"), run(5, conclusion="failure"))], 6),
            ("its path with a ref", [page(run(5, path=".github/workflows/ci.yml@refs/heads/main"))], 5),
            ("beside a newer failed pull-request run", [page(run(7, event="pull_request", conclusion="failure"), run(5))], 5),
            ("on the first of two pages", [page(run(6)), page(run(5, conclusion="failure"))], 6),
        ):
            with self.subTest(name):
                done, calls = self.gate(json.dumps(pages))
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertIn(self.sha, done.stdout)
                self.assertIn(f"https://github.com/{REPO}/actions/runs/{46147100000 + number}", done.stdout)
                self.assertEqual(calls, [self.query])

    def test_GH196_b_the_newest_eligible_run_not_green_refuses_naming_it(self):
        for status, conclusion in (("completed", "failure"), ("completed", "cancelled"), ("completed", "timed_out"),
                                   ("completed", None), ("queued", None), ("in_progress", None), ("waiting", None)):
            with self.subTest(status=status, conclusion=conclusion):
                done, calls = self.gate(json.dumps([page(self.ci_run(5, status=status, conclusion=conclusion))]))
                self.assert_refused(done, calls, self.sha, "46147100005", "attempt 1", status, conclusion or "none")
        observed = self.ci_run(574, id=46147167497, conclusion="failure")
        done, calls = self.gate(json.dumps([page(observed)]))
        self.assert_refused(done, calls, self.sha, "46147167497", "#574", "attempt 1", "push", "failure")

    def test_GH196_c_an_older_green_run_never_hides_a_newer_one(self):
        run = self.ci_run
        for name, pages, number, attempt in (
            ("a newer failed run", [page(run(6, conclusion="failure"), run(5))], 6, 1),
            ("a newer cancelled manual run", [page(run(6, event="workflow_dispatch", conclusion="cancelled"), run(5))], 6, 1),
            ("a newer queued manual run",
             [page(run(6, event="workflow_dispatch", status="queued", conclusion=None), run(5))], 6, 1),
            ("a green run re-run, in progress", [page(run(5, run_attempt=2, status="in_progress", conclusion=None))], 5, 2),
            ("the newer failed run on the second page", [page(run(5)), page(run(6, conclusion="failure"))], 6, 1),
        ):
            with self.subTest(name):
                done, calls = self.gate(json.dumps(pages))
                self.assert_refused(done, calls, self.sha, str(46147100000 + number), f"attempt {attempt}")

    def test_GH196_d_without_an_eligible_run_the_deploy_is_refused(self):
        other = {"id": 1, "full_name": "someone/Vega-Sport"}
        for name, runs in (
            ("another commit", [self.ci_run(5, head_sha=OTHER_SHA)]),
            ("another branch", [self.ci_run(5, head_branch="claude/v2-gate")]),
            ("a pull request", [self.ci_run(5, event="pull_request")]),
            ("a fork", [self.ci_run(5, head_repository=other)]),
            ("a deleted fork", [self.ci_run(5, head_repository=None)]),
            ("another repository", [self.ci_run(5, repository=other)]),
            ("another workflow", [self.ci_run(5, path=".github/workflows/pilot.yml")]),
            ("no run", []),
        ):
            with self.subTest(name):
                done, calls = self.gate(json.dumps([page(*runs)]))
                self.assert_refused(done, calls, self.sha, "no eligible")

    def test_GH196_e_another_ref_or_commit_is_refused_before_any_query(self):
        for name, env, named in (
            ("another branch", {"GITHUB_REF": "refs/heads/claude/v2-gate"}, ["GITHUB_REF"]),
            ("a tag", {"GITHUB_REF": "refs/tags/v2"}, ["GITHUB_REF"]),
            ("a checkout of another commit", {"GITHUB_SHA": OTHER_SHA}, [OTHER_SHA, self.sha]),
            ("not a SHA", {"GITHUB_SHA": "main"}, ["GITHUB_SHA"]),
            ("GITHUB_SHA unset", {"GITHUB_SHA": None}, ["GITHUB_SHA"]),
            ("GITHUB_REPOSITORY unset", {"GITHUB_REPOSITORY": None}, ["GITHUB_REPOSITORY"]),
            ("GITHUB_REPOSITORY_ID unset", {"GITHUB_REPOSITORY_ID": None}, ["GITHUB_REPOSITORY_ID"]),
        ):
            with self.subTest(name):
                done, calls = self.gate(json.dumps([page(self.ci_run(5))]), **env)
                self.assert_refused(done, calls, *named, queried=False)

    def test_GH196_f_a_gh_failure_or_an_unreadable_answer_is_refused(self):
        no_number = self.ci_run(5)
        del no_number["run_number"]
        no_conclusion = self.ci_run(5)
        del no_conclusion["conclusion"]
        for name, stdout, code, stderr, named in (
            ("gh failing", "", 1, "gh: Not Found (HTTP 404)\n", ["HTTP 404"]),
            ("not JSON", "<html>", 0, "", []),
            ("an object, not an array of pages", json.dumps(page(self.ci_run(5))), 0, "", []),
            ("an empty array", "[]", 0, "", []),
            ("a page without workflow_runs", json.dumps([{"total_count": 1}]), 0, "", []),
            ("an eligible run without run_number", json.dumps([page(no_number)]), 0, "", []),
            ("an eligible run without conclusion", json.dumps([page(no_conclusion)]), 0, "", ["no valid"]),
        ):
            with self.subTest(name):
                done, calls = self.gate(stdout, code, stderr)
                self.assert_refused(done, calls, self.sha, *named)

    def test_GH196_g_one_query_for_every_run_of_the_commit_and_never_aws(self):
        for pages in ([page(self.ci_run(5))], [page(self.ci_run(5, conclusion="failure"))]):
            done, calls = self.gate(json.dumps(pages))
            self.assertEqual(calls, [self.query], "all pages, branch and commit filters, no status or conclusion filter")


class WorkflowTest(unittest.TestCase):
    def test_GH196_h_the_deploy_checks_out_its_commit_and_gates_it_before_any_aws_session(self):
        text = WORKFLOW.read_text()
        body = text.split("\n  deploy:\n", 1)[1].split("\n    steps:\n", 1)[1]
        steps = []
        for part in re.split(r"\n(?=      - )", "\n" + body):
            lines = [line for line in part.splitlines() if line.strip() and not line.lstrip().startswith("#")]
            if lines and lines[0].startswith("      - "):
                steps.append(lines)
        checkout, gate = steps[0], steps[1]
        self.assertTrue(checkout[0].startswith("      - uses: actions/checkout@"), checkout)
        self.assertIn("          ref: ${{ github.sha }}", checkout)
        self.assertIn("        run: python3 infra/aws/ci/check_deploy_ci.py", gate)
        self.assertIn("          GH_TOKEN: ${{ github.token }}", gate)
        self.assertEqual([line for line in gate if re.match(r"\s+(- )?(if|continue-on-error):", line)], [],
                         "a refusal stops the job")
        sessions = [i for i, step in enumerate(steps) if any("aws-actions/configure-aws-credentials@" in line for line in step)]
        self.assertTrue(sessions and min(sessions) > 1, "every AWS session after the gate")
        deploy = [step for step in steps if any("bash infra/aws/deploy.sh" in line for line in step)]
        self.assertEqual(len(deploy), 1)
        self.assertIn("          IMAGE_TAG: ${{ github.sha }}", deploy[0], "the image of the commit the gate checked")
        triggers = re.search(r"^on:\n((?:[ \t].*\n|\n)*)", text, re.M)[1]
        self.assertEqual(re.findall(r"^  ([\w-]+):", triggers, re.M), ["workflow_dispatch"])
        self.assertRegex(text, r"\npermissions:\n(?:  .*\n)*  actions: read\n")


if __name__ == "__main__":
    unittest.main()
