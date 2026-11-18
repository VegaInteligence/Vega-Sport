"""Replay the five .github/workflows/ci.yml jobs on the integrated checkout and its dedicated loopback database."""

import concurrent.futures
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


here = Path(__file__).resolve().parent
root = here.parents[1]
worktree = Path(sys.argv[2]).resolve()
runtime = {"container":"vega-vi27-audit-ci-pg18", "pg18":"postgresql://postgres@127.0.0.1:55439", "python":str(root/"ci-clean/bin/python")}
out = here / sys.argv[1]
out.mkdir()
python = Path(runtime["python"])
node24 = Path("/Users/lemonnierhugo/.local/share/nodejs/node-v24.15.0-darwin-arm64/bin/node")
node26 = Path("/Users/lemonnierhugo/.local/share/nodejs/node-v26.4.0-darwin-arm64/bin/node")
docker = ["docker", "--context", "colima"]
env = {**os.environ, "PYTHONPATH": str(worktree / "backend"), "PYTHONDONTWRITEBYTECODE": "1"}
env["PATH"] = str(python.parent) + ":" + env["PATH"]
env.pop("NEXT_PUBLIC_API_ORIGIN", None)
api_env = {**env, "PATH": str(node24.parent) + ":" + env["PATH"], "BUILD_NODE": str(node24)}
site_env = {**env, "PATH": str(node26.parent) + ":" + env["PATH"]}
build_env = {**site_env, "NEXT_PUBLIC_API_ORIGIN": "https://dngp6kh9jx2bl.cloudfront.net"}


def at():
    return datetime.now(timezone.utc).isoformat()


def output(*args):
    return subprocess.check_output(args, cwd=worktree, text=True).strip()


def pin():
    return {
        "commit": output("git", "rev-parse", "HEAD"),
        "status": output("git", "status", "--porcelain"),
        "diff_sha256": hashlib.sha256(subprocess.check_output(["git", "diff", "HEAD", "--binary"], cwd=worktree)).hexdigest(),
    }


source = pin()
assert source["status"] == "", source
assert output(*docker, "port", runtime["container"], "5432/tcp") == "127.0.0.1:55439"
assert runtime["pg18"] == "postgresql://postgres@127.0.0.1:55439"
image = "vega-worker:audit-integre-" + source["commit"][:12]


def run(name, argv, *, cwd=worktree, env=env):
    argv = list(map(str, argv))
    stamp = at()
    log = out / (name + ".log")
    with log.open("wb") as stream:
        result = subprocess.run(argv, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT)
    receipt = {
        "command": argv, "cwd": str(cwd), "started": stamp, "finished": at(), "exit": result.returncode,
        "sha256": hashlib.sha256(log.read_bytes()).hexdigest(),
    }
    (out / (name + ".json")).write_text(json.dumps(receipt, indent=2) + "\n")
    print(name, result.returncode, flush=True)
    return result.returncode


def backend_and_package():
    make_db = "database-setup"
    if run(make_db, [python, "backend/ci/test_databases.py", runtime["pg18"]]):
        return {"setup": "failed"}
    db = dict(line.split("=", 1) for line in (out / (make_db + ".log")).read_text().splitlines() if line.startswith("VEGA_"))
    results = {"python": run("python", [python, "-m", "unittest", "discover", "-s", "backend/tests", "-v"], env={**env, **db})}
    results["npm ci"] = run("api-deps", [node24, "/Users/lemonnierhugo/.local/bin/npm", "ci", "--prefix", "backend/api"], env=api_env)
    if results["npm ci"]:
        return results
    results["api"] = run("api", [node24, "/Users/lemonnierhugo/.local/bin/npm", "test", "--prefix", "backend/api"], env={**api_env, **db})
    results["api ZIP"] = run("api-package", [python, "infra/aws/package_api.py", out / "packages" / "api"], env=api_env)
    results["live ZIP"] = run("live-package", [python, "infra/aws/package_api.py", out / "packages" / "live", "live"], env=api_env)
    return results


def site():
    dashboard = worktree / "dashboard"
    results = {"bun install": run("site-deps", ["bun", "install", "--frozen-lockfile"], cwd=dashboard, env=site_env)}
    if results["bun install"]:
        return results
    test_files = [str(path.relative_to(worktree)) for path in sorted((worktree / "tests").glob("*.test.mjs"))]
    results["site"] = run("site", [node26, "--test", *test_files], env=site_env)
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


def worker():
    results = {"build": run("worker-build", [*docker, "build", "--platform", "linux/arm64", "-f", "backend/Dockerfile", "-t", image, "."])}
    if results["build"]:
        return results
    verify = {
        "imports": ["python", "-c", "import vega.worker, vega.archives, vega.migrate, vega.live.ingestor, boto3, botocore.auth"],
        "bridge": ["node", "/app/backend/sources/bridge.mjs", "plans"],
        "archive": ["node", "/app/backend/archives/edition.mjs", "-", "-"],
        "paths": ["python", "-c", "from vega.sources import curated, honours, wikidata; from vega import archives; import sys; missing = [str(p) for p in (curated.SHARED / 'league-rules.json', curated.SHARED / 'cup-logos.json', honours.SCRIPTS / 'player_honours.py', wikidata.BRIDGE, archives.EDITION) if not p.exists()]; sys.exit('missing: ' + ', '.join(missing) if missing else 0)"],
    }
    for key, (exe, *args) in verify.items():
        results[key] = run(f"worker-{key}", [*docker, "run", "--rm", "--entrypoint", exe, image, *args])
    return results


began = at()
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    names = [backend_and_package, site, infra, worker]
    futures = {step.__name__: pool.submit(step) for step in names}
    jobs = {name: future.result() for name, future in futures.items()}
after = pin()
result = {
    "started": began, "finished": at(), "source_before": source, "source_after": after,
    "source_unchanged": source == after, "results": jobs,
    "rerun": [str(python), str(here / "run-ci.py"), sys.argv[1] + "-again", str(worktree)],
    "pg": output(*docker, "exec", runtime["container"], "postgres", "--version"),
    "node_api": output(str(node24), "--version"), "node_site": output(str(node26), "--version"),
    "python": output(str(python), "--version"), "bun": output("bun", "--version"),
}
(out / "source-and-results.json").write_text(json.dumps(result, indent=2) + "\n")
sys.exit(int(source != after or any(status != 0 for job in jobs.values() for status in job.values())))
