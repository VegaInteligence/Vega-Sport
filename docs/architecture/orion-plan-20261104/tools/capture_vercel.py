"""Vercel project/env metadata only; never export values of environment variables."""
import datetime
import json
from pathlib import Path
import subprocess

OUT = Path(__file__).resolve().parents[1] / "evidence"
PROJECT = "prj_DhaqrVkH3Gi4uysT7IRsm9fB2bjR"
TEAM = "team_IYt7KqupdSTtMuQuMvNa9wiJ"


def api(path):
    result = subprocess.run(["npx", "--yes", "vercel@65.11.0", "api", path], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


project = api("/v9/projects/" + PROJECT + "?teamId=" + TEAM)
environment = api("/v10/projects/" + PROJECT + "/env?teamId=" + TEAM)
target = project.get("targets", {}).get("production", {})
report = {"atUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "command": "python3 docs/architecture/orion-plan-20261104/tools/capture_vercel.py",
          "setup": "Authenticated existing Vercel CLI65.11.0; read-only GET. Source API response remains private; only deployment fields and env names/targets are saved.",
          "project": project.get("name"), "root": project.get("rootDirectory"),
          "production": {k: target.get(k) for k in ("id", "url", "readyState", "createdAt")},
          "environment": [{"key": e["key"], "targets": e.get("target"), "branch": e.get("gitBranch")} for e in environment.get("envs", [])]}
report["production"]["commit"] = target.get("meta", {}).get("githubCommitSha")
(OUT / "vercel-current.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"project": report["project"], "production": report["production"], "envKeys": len(report["environment"])}))
