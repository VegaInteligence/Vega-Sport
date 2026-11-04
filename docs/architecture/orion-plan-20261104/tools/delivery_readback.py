"""Capture public endpoint status and release metadata without changing production."""
import datetime
import json
from pathlib import Path
import subprocess
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

OUT = Path(__file__).resolve().parents[1] / "evidence"

def command(*args):
    return json.loads(subprocess.check_output(args, text=True, stderr=subprocess.PIPE))

report = {"atUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "command": "python3 docs/architecture/orion-plan-20261104/tools/delivery_readback.py",
          "scope": "Read-only public probes, existing AWS/Vercel/GitHub credentials. No deployment, SQL write or workflow mutation.",
          "endpoints": {}}
for name, url in [("vercelHealth", "https://statarena-analytics.vercel.app/api/health"),
                  ("vercelHome", "https://statarena-analytics.vercel.app/"),
                  ("awsHealth", "https://d317dq37z1tacb.cloudfront.net/api/health")]:
    request = urllib.request.Request(url, headers={"User-Agent": "StatArena-architecture-audit/1.0"})
    try:
        response = urllib.request.urlopen(request, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    except Exception as error:
        report["endpoints"][name] = {"url": url, "error": type(error).__name__}
        continue
    with response:
        body = response.read(6000).decode(errors="replace")
        item = {"url": url, "status": response.status,
                "headers": {k: v for k, v in response.headers.items() if k.lower() in
                            {"content-type", "cache-control", "x-vercel-cache", "x-vercel-error", "x-cache", "age"}}}
        if name.endswith("Health"):
            try:
                item["body"] = json.loads(body)
            except json.JSONDecodeError:
                item["bodyExcerpt"] = body[:1200]
        report["endpoints"][name] = item
report["lambda"] = command("aws", "--profile", "statarena", "--region", "us-east-2", "lambda", "get-function-configuration",
                            "--function-name", "statarena-backend", "--query",
                            "{CodeSha256:CodeSha256,MemorySize:MemorySize,State:State,LastUpdateStatus:LastUpdateStatus}", "--output", "json")
baseline = json.loads((OUT / "runtime-current.json").read_text())["lambda"]
report["lambdaUnchanged"] = all(report["lambda"][k] == baseline[k] for k in report["lambda"])
project = command("npx", "--yes", "vercel@65.11.0", "api",
                  "/v9/projects/prj_DhaqrVkH3Gi4uysT7IRsm9fB2bjR?teamId=team_IYt7KqupdSTtMuQuMvNa9wiJ")
target = project["targets"]["production"]
report["vercelProduction"] = {k: target.get(k) for k in ["id", "url", "readyState", "createdAt"]}
report["vercelProduction"]["commit"] = target.get("meta", {}).get("githubCommitSha")
report["vercelProduction"]["createdParis"] = datetime.datetime.fromtimestamp(target["createdAt"] / 1000, datetime.timezone.utc).astimezone(ZoneInfo("Europe/Paris")).isoformat()
initial = json.loads((OUT / "vercel-current-initial.json").read_text())["production"]
report["vercelChangedSinceInitialInventory"] = target["id"] != initial["id"]
workflows = command("gh", "api", "repos/OrionQuantPlatform/STATARENA/actions/workflows")["workflows"]
report["workflows"] = [{k: w[k] for k in ["name", "path", "state"]} for w in workflows if w["path"] in
                       [".github/workflows/collect-football.yml", ".github/workflows/rematerialize.yml", ".github/workflows/uefa-standings.yml"]]
report["interpretation"] = "The unchanged-Vercel assumption failed. The deployment changed at15:44Paris before the documentation commits; homepage200, public health503 at delivery. Existing source explicitly returns503 when VERCEL is set and NEXT_PUBLIC_API_ORIGIN is absent; current env metadata scopes that origin to preview only. AWS health200 does not validate the public site's data flows. No rollback or cutover performed."
(OUT / "delivery-readback.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
print(json.dumps(report, ensure_ascii=False))
