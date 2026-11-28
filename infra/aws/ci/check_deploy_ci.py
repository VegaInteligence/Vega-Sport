"""Verify full GitHub CI for the exact SHA of a manual Deploy (GH196).

The Deploy workflow calls this after checkout and before assuming its AWS role.
Use the runner's GitHub context and gh authentication.
"""

import json
import os
import re
import subprocess
import sys

WORKFLOW = ".github/workflows/ci.yml"
# On main both run every suite (ci.yml); a pull request's run runs its zones only and never counts.
EVENTS = ("push", "workflow_dispatch")
MAIN = "refs/heads/main"
SHA = re.compile(r"[0-9a-f]{40}")
REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
GH_SECONDS = 60


class Refused(Exception):
    pass


def positive(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def command(argv):
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=GH_SECONDS)
    except (OSError, subprocess.SubprocessError) as error:
        raise Refused(f"{argv[0]} failed: {error}") from None


def runs_of(answer):
    """The runs of gh's --paginate --slurp answer: an array of pages, each {"workflow_runs": [run, ...], ...}."""
    try:
        pages = json.loads(answer)
    except ValueError:
        raise Refused("gh's answer is not JSON") from None
    if not isinstance(pages, list) or not pages:
        raise Refused("gh's answer is not an array of pages")
    runs = []
    for page in pages:
        if not isinstance(page, dict) or not isinstance(page.get("workflow_runs"), list):
            raise Refused("a page of gh's answer has no workflow_runs list")
        runs += page["workflow_runs"]
    if not all(isinstance(run, dict) for run in runs):
        raise Refused("a run of gh's answer is not an object")
    return runs


def eligible(run, sha, repository_id):
    path = run.get("path")
    return (run.get("head_sha") == sha and run.get("head_branch") == "main" and run.get("event") in EVENTS
            and isinstance(path, str) and path.split("@", 1)[0] == WORKFLOW
            and all(isinstance(run.get(side), dict) and run[side].get("id") == repository_id
                    for side in ("repository", "head_repository")))


def describe(run, server, repository):
    link = f"{server}/{repository}/actions/runs/{run['id']}/attempts/{run['run_attempt']}"
    return (f"run {run['id']} (#{run['run_number']}, attempt {run['run_attempt']}, {run['event']}) "
            f"status {run['status']}, conclusion {run['conclusion'] or 'none'}: {link}")


def check(env):
    """The newest eligible run, green; else Refused."""
    missing = [name for name in ("GITHUB_REPOSITORY", "GITHUB_REPOSITORY_ID", "GITHUB_SHA", "GITHUB_REF")
               if not env.get(name)]
    if missing:
        raise Refused(f"{', '.join(missing)} not set")
    repository, sha, ref = env["GITHUB_REPOSITORY"], env["GITHUB_SHA"], env["GITHUB_REF"]
    if ref != MAIN:
        raise Refused(f"GITHUB_REF is {ref!r}, not {MAIN}: a Deploy ships main only")
    if not SHA.fullmatch(sha):
        raise Refused(f"GITHUB_SHA {sha!r} is not a commit SHA")
    if not REPOSITORY.fullmatch(repository) or not re.fullmatch(r"[1-9][0-9]*", env["GITHUB_REPOSITORY_ID"]):
        raise Refused("GITHUB_REPOSITORY or GITHUB_REPOSITORY_ID is malformed")
    head = command(["git", "rev-parse", "HEAD"])
    if head.returncode != 0 or head.stdout.strip() != sha:
        raise Refused(f"the checkout's HEAD is {head.stdout.strip() or 'unknown'}, not GITHUB_SHA")
    query = command(["gh", "api", "--method", "GET", "--paginate", "--slurp",
                     f"repos/{repository}/actions/workflows/ci.yml/runs",
                     "-f", "branch=main", "-f", f"head_sha={sha}", "-F", "per_page=100"])
    if query.returncode != 0:
        raise Refused(f"gh api failed (exit {query.returncode}): {' '.join(query.stderr.split())[:300]}")
    runs = runs_of(query.stdout)
    candidates = [run for run in runs if eligible(run, sha, int(env["GITHUB_REPOSITORY_ID"]))]
    if not candidates:
        raise Refused(f"no eligible CI run (ci.yml on main, from a push or a manual run) among the {len(runs)} returned")
    for run in candidates:
        if not (all(positive(run.get(key)) for key in ("id", "run_number", "run_attempt"))
                and isinstance(run.get("status"), str) and "conclusion" in run
                and isinstance(run["conclusion"], (str, type(None)))):
            raise Refused("an eligible run has no valid id, run_number, run_attempt, status or conclusion")
    newest = max(candidates, key=lambda run: (run["run_number"], run["run_attempt"]))
    if (newest["status"], newest["conclusion"]) != ("completed", "success"):
        server = env.get("GITHUB_SERVER_URL") or "https://github.com"
        raise Refused(f"the newest eligible CI run is not green: {describe(newest, server, repository)}")
    return newest


def main():
    sha = os.environ.get("GITHUB_SHA", "")
    commit = f" for {sha}" if SHA.fullmatch(sha) else ""
    try:
        run = check(os.environ)
    except Refused as refusal:
        print(f"Deploy refused{commit}: {refusal}", file=sys.stderr)
        return 1
    server = os.environ.get("GITHUB_SERVER_URL") or "https://github.com"
    print(f"CI green{commit} on main: {describe(run, server, os.environ['GITHUB_REPOSITORY'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
