"""Replay the five .github/workflows/ci.yml jobs on the integrated checkout and its dedicated loopback database.

Completed on 19 Nov 2026 from delivery/verification-integree/run-ci.py (Fable's review of 5a16b1aa, M1, M2 and m5;
FAILURE_MODES.md §36):
- GitHub Actions' runner environment: CI=true, under which a missing prerequisite fails this lot's end-to-end tests;
- the corrected tests job's order: the read API's dependencies (npm ci) before the Python suites;
- the receipts count what ran: the Python log's `Ran N` and result lines, every skipped test with its reason, the status
  of each class of this lot's end-to-end tests, and the node summaries (tests, pass, fail, skipped) of the API and site
  suites. A skipped test anywhere, or an end-to-end class absent or not all `ok`, fails the replay;
- the image job's checks are read from the checkout's ci.yml (step "The image runs its tools", archives.TWINS included)
  and run, line by line, against the image built.
With --rehearsal <tree-ish> everything runs on `git archive <tree-ish>` extracted into a new directory instead of a
clean worktree HEAD: a rehearsal of this script, not the CI of a commit, and the receipt says so.
Usage: python run-ci.py <label> <worktree> [--rehearsal <tree-ish>]

Copied on 20 Nov 2026 into revue-opus-fable-20nov-e82992/validation-opus/run-ci (PR 58 finalisation, FAILURE_MODES §48),
the original left untouched. Three local changes only: the disposable PG18 of this validation (container
vega-opus-finalisation-20nov-pg18, 127.0.0.1:55561); the receipts written next to this copy; the end-to-end classes
checked extended with those of §47 and §48 (job_tests.E2E_CLASSES + E2E_48).
"""

import argparse
import concurrent.futures
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile


here = Path(__file__).resolve().parent
root = Path("/Users/lemonnierhugo/.codex/visualizations/2026/11/17/01a1e6f1-9c43-7b81-a52e-3ee15c953578/production-architecture-review")
sys.path.insert(0, '/Users/lemonnierhugo/.codex/visualizations/2026/11/17/01a1e6f1-9c43-7b81-a52e-3ee15c953578/production-architecture-review/delivery/reprise-claude-19nov/preuves-opus-retours-fable/temoin-ci')
import job_tests  # noqa: E402
E2E_48 = ("test_player_grade_reasons.PlayerGradeReasonsTest", "test_award_year_2020_order.AwardYear2020ProductionOrderTest",
          "test_collection_wakeups.EloWakeTest", "test_collection_wakeups.SharedReadTest", "test_collection_wakeups.InternationalsEloTest",
          "test_deploy_migrations.DeploymentMigrationsTest")
job_tests.E2E_CLASSES = E2E_CLASSES = job_tests.E2E_CLASSES + E2E_48
from job_tests import YAML_PYTHON, node_report, unittest_report  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument("label")
parser.add_argument("worktree", type=Path)
parser.add_argument("--rehearsal", metavar="TREE-ISH")
args = parser.parse_args()
repo = args.worktree.resolve()
runtime = {"container": "vega-opus-finalisation-20nov-pg18", "pg18": "postgresql://postgres@127.0.0.1:55561", "python": str(root / "ci-clean/bin/python")}
out = here / args.label
out.mkdir()
python = Path(runtime["python"])
node24 = Path("/Users/lemonnierhugo/.local/share/nodejs/node-v24.15.0-darwin-arm64/bin/node")
node26 = Path("/Users/lemonnierhugo/.local/share/nodejs/node-v26.4.0-darwin-arm64/bin/node")
npm = "/Users/lemonnierhugo/.local/bin/npm"
docker = ["docker", "--context", "colima"]


def output(*argv, cwd=repo):
    return subprocess.check_output(argv, cwd=cwd, text=True).strip()


if args.rehearsal:
    tree = output("git", "rev-parse", args.rehearsal + "^{tree}")
    worktree = Path(tempfile.mkdtemp(prefix="vega-run-ci-rehearsal-")) / "checkout"
    worktree.mkdir()
    with tarfile.open(fileobj=io.BytesIO(subprocess.check_output(["git", "archive", tree], cwd=repo))) as stream:
        stream.extractall(worktree, filter="data")
else:
    worktree = repo

env = {**os.environ, "PYTHONPATH": str(worktree / "backend"), "PYTHONDONTWRITEBYTECODE": "1", "CI": "true"}
env["PATH"] = str(python.parent) + ":" + env["PATH"]
env.pop("NEXT_PUBLIC_API_ORIGIN", None)
api_env = {**env, "PATH": str(node24.parent) + ":" + env["PATH"], "BUILD_NODE": str(node24)}
site_env = {**env, "PATH": str(node26.parent) + ":" + env["PATH"]}
build_env = {**site_env, "NEXT_PUBLIC_API_ORIGIN": "https://dngp6kh9jx2bl.cloudfront.net"}


def at():
    return datetime.now(timezone.utc).isoformat()


def pin():
    if args.rehearsal:
        return {"rehearsal": True, "tree": tree, "checkout": str(worktree), "repo_head": output("git", "rev-parse", "HEAD")}
    return {
        "commit": output("git", "rev-parse", "HEAD"),
        "tree": output("git", "rev-parse", "HEAD^{tree}"),
        "status": output("git", "status", "--porcelain"),
        "diff_sha256": hashlib.sha256(subprocess.check_output(["git", "diff", "HEAD", "--binary"], cwd=repo)).hexdigest(),
    }


source = pin()
assert args.rehearsal or source["status"] == "", source
assert output(*docker, "port", runtime["container"], "5432/tcp") == "127.0.0.1:55561"
assert runtime["pg18"] == "postgresql://postgres@127.0.0.1:55561"
image = "vega-worker:" + ("rehearsal-" + source["tree"][:12] if args.rehearsal else "audit-integre-" + source["commit"][:12])
counts = {}


def run(name, argv, *, cwd=None, env=env, report=None):
    argv = list(map(str, argv))
    stamp = at()
    log = out / (name + ".log")
    with log.open("wb") as stream:
        result = subprocess.run(argv, cwd=cwd or worktree, env=env, stdout=stream, stderr=subprocess.STDOUT)
    receipt = {
        "command": argv, "cwd": str(cwd or worktree), "started": stamp, "finished": at(), "exit": result.returncode,
        "sha256": hashlib.sha256(log.read_bytes()).hexdigest(),
    }
    if report:
        receipt["counts"] = counts[name] = report(log.read_text(errors="replace"))
    (out / (name + ".json")).write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n")
    print(name, result.returncode, flush=True)
    return result.returncode


def backend_and_package():
    make_db = "database-setup"
    if run(make_db, [python, "backend/ci/test_databases.py", runtime["pg18"]]):
        return {"setup": "failed"}
    db = dict(line.split("=", 1) for line in (out / (make_db + ".log")).read_text().splitlines() if line.startswith("VEGA_"))
    results = {"npm ci": run("api-deps", [node24, npm, "ci", "--prefix", "backend/api"], env=api_env)}
    if results["npm ci"]:
        return results
    results["python"] = run("python", [python, "-m", "unittest", "discover", "-s", "backend/tests", "-v"], env={**env, **db}, report=unittest_report)
    results["api"] = run("api", [node24, npm, "test", "--prefix", "backend/api"], env={**api_env, **db}, report=node_report)
    results["api ZIP"] = run("api-package", [python, "infra/aws/package_api.py", out / "packages" / "api"], env=api_env)
    results["live ZIP"] = run("live-package", [python, "infra/aws/package_api.py", out / "packages" / "live", "live"], env=api_env)
    return results


def site():
    dashboard = worktree / "dashboard"
    results = {"bun install": run("site-deps", ["bun", "install", "--frozen-lockfile"], cwd=dashboard, env=site_env)}
    if results["bun install"]:
        return results
    test_files = [str(path.relative_to(worktree)) for path in sorted((worktree / "tests").glob("*.test.mjs"))]
    results["site"] = run("site", [node26, "--test", *test_files], env=site_env, report=node_report)
    results["site build"] = run("site-build", ["bun", "run", "build"], cwd=dashboard, env=build_env)
    return results


def infra():
    lint = root / "tracks/1-linear/sol-reprise-1219/infra-venv" / "bin" / "cfn-lint"
    templates = [str(path.relative_to(worktree)) for path in sorted((worktree / "infra" / "aws").glob("*.yaml"))]
    return {
        "lint": run("infra-lint", [lint, "--regions", "us-east-2", "--", *templates]),
        "deploy shell": run("infra-deploy-shell", ["bash", "-n", "infra/aws/deploy.sh"]),
        "secrets shell": run("infra-secrets-shell", ["bash", "-n", "infra/aws/ci/secrets.sh"]),
    }


def image_checks():
    """The lines of the image job's step "The image runs its tools", as the checkout's ci.yml writes them."""
    workflow = json.loads(subprocess.check_output(
        [str(YAML_PYTHON), "-c", "import json, sys, yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))",
         str(worktree / ".github/workflows/ci.yml")], text=True))
    step = next(s for s in workflow["jobs"]["image"]["steps"] if s.get("name") == "The image runs its tools")
    return [line.strip() for line in step["run"].splitlines() if line.strip() and not line.strip().startswith("#")]


def worker():
    results = {"build": run("worker-build", [*docker, "build", "--platform", "linux/arm64", "-f", "backend/Dockerfile", "-t", image, "."])}
    if results["build"]:
        return results
    for n, line in enumerate(image_checks(), 1):
        command = line.replace("vega-worker:${{ github.sha }}", image)
        assert command.startswith("docker "), command
        command = " ".join(docker) + " " + command[len("docker "):]
        results[f"check {n}"] = run(f"worker-check-{n}", ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", command])
    return results


began = at()
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    names = [backend_and_package, site, infra, worker]
    futures = {step.__name__: pool.submit(step) for step in names}
    jobs = {name: future.result() for name, future in futures.items()}
after = pin()
py = counts.get("python") or {}
skips = {"python": py.get("skipped"), "api": (counts.get("api") or {}).get("skipped"), "site": (counts.get("site") or {}).get("skipped")}
e2e = {cls: py.get("e2e_classes", {}).get(cls, {}) for cls in E2E_CLASSES}
verdicts = {
    "no_skip_anywhere": py.get("skipped") == {} and skips["api"] == 0 and skips["site"] == 0,
    "e2e_classes_all_ok": all(v and set(v) == {"ok"} for v in e2e.values()),
    "python_result_ok": py.get("result") == "OK",
}
result = {
    "started": began, "finished": at(), "rehearsal": bool(args.rehearsal), "source_before": source, "source_after": after,
    "source_unchanged": source == after, "results": jobs, "counts": counts, "skips": skips, "e2e_classes": e2e, "verdicts": verdicts,
    "env": {"CI": env["CI"]},
    "rerun": [str(python), str(here / "run-ci.py"), args.label + "-again", str(repo)] + (["--rehearsal", args.rehearsal] if args.rehearsal else []),
    "pg": output(*docker, "exec", runtime["container"], "postgres", "--version"),
    "node_api": output(str(node24), "--version"), "node_site": output(str(node26), "--version"),
    "python": output(str(python), "--version"), "bun": output("bun", "--version"),
}
(out / "source-and-results.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
failed = source != after or any(status != 0 for job in jobs.values() for status in job.values()) or not all(verdicts.values())
print(json.dumps({"verdicts": verdicts, "skips": skips, "ran": py.get("ran"), "result": py.get("result"), "failed": failed}))
sys.exit(int(failed))
