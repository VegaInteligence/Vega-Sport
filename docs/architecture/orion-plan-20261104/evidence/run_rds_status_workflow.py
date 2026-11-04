"""Record the bounded, local document-status workflow and protected bytes."""
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

EVIDENCE = Path(__file__).resolve().parent
OUT = EVIDENCE.parent
ROOT = OUT.parents[2]
WORK = ROOT / "output/playwright/orion-plan"
CLI = "/Users/lemonnierhugo/.codex/skills/playwright/scripts/playwright_cli.sh"
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
now = datetime.datetime.now(datetime.timezone.utc)
previous = EVIDENCE / "rds-status-refresh.json"
if previous.exists():
    archive = EVIDENCE / ("rds-status-runs/" + now.strftime("%Y%m%dT%H%M%S%fZ") + "-previous")
    archive.mkdir(parents=True)
    old = json.loads(previous.read_text())
    for name in ["rds-status-refresh.json", "rds-status-workflow.log", *old.get("artifacts", [])]:
        if (EVIDENCE / name).exists():
            shutil.copy2(EVIDENCE / name, archive / name)
command = [CLI, "-s=orion-plan", "run-code", (EVIDENCE / "rds-status-workflow.js").read_text()]
process = subprocess.run(command, cwd=WORK, text=True, capture_output=True)
log = process.stdout + process.stderr
(EVIDENCE / "rds-status-workflow.log").write_text(log)
result = None
if "### Result\n" in process.stdout:
    try:
        result = json.loads(process.stdout.split("### Result\n", 1)[1].split("\n### ", 1)[0].strip())
    except json.JSONDecodeError:
        pass
if result:
    for name in result.get("artifacts", []):
        shutil.copy2(WORK / name, EVIDENCE / name)
protected = json.loads((EVIDENCE / "rds-status-protected-before.json").read_text())["sha256"]
changed = [name for name, before in protected.items() if sha(ROOT / name) != before]
local_hashes = {name: sha(OUT / name) for name in ["PLAN.md", "index.html", "PRO_REVIEW_RESPONSE.md", "PRO_VERSIONING_DESIGN.md", "target-schema.proposed.json"]}
served_match = bool(result and result.get("sourceHashes") == local_hashes)
receipt_paths = ["rds-runs/20261104T193736115395Z-reviewed-schema-bootstrap/result.json", "rds-readbacks/20261104T193830558195Z-rds-schema-bootstrap/result.json"]
pilot = ROOT / "docs/verification/orion-pro-pilot-20261104"
receipt = {
    "atUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "command": "python3 -B docs/architecture/orion-plan-20261104/evidence/run_rds_status_workflow.py",
    "setup": "RDS_STATUS_PROTOCOL.md; existing local HTTP127.0.0.1:8794 and Playwright CLI orion-plan; desktop1440x1000, mobile390x844, light/dark; no external service or SQL operation",
    "expected": "Applied schema/bootstrap only;94tables/1709columns/431FK/10seeds;012/013sealed;no real business data;backend/data/fullacceptance/cutover/purgeopen",
    "exitCode": process.returncode,
    "result": result,
    "artifacts": result.get("artifacts", []) if result else [],
    "log": "rds-status-workflow.log",
    "modelSha256": local_hashes["target-schema.proposed.json"],
    "documentSha256": local_hashes,
    "servedDocumentsMatchLocalBytes": served_match,
    "protectedFiles": len(protected),
    "protectedChangedPaths": changed,
    "sourceReceipts": {"docs/verification/orion-pro-pilot-20261104/" + name: sha(pilot / name) for name in receipt_paths},
    "priorFullWorkflow": {"path": "historical-before-rds-bootstrap-status", "checks": 1208, "atUtc": "2026-11-04T18:37:57.207431+00:00", "scope": "Earlier rendering, same18da43model; does not cover current RDS status text; not rerun"},
    "scope": "Documentary verification only. Separate RDS receipts prove actual schema/bootstrap. No business import, backend/public cutover or full acceptance is inferred.",
    "passed": process.returncode == 0 and bool(result and result.get("passed")) and served_match and not changed,
}
receipt["screenshotsSha256"] = {name: sha(EVIDENCE / name) for name in receipt["artifacts"]}
previous.write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n")
print(json.dumps({"passed": receipt["passed"], "checks": len(result.get("checks", [])) if result else 0, "failures": [c["name"] for c in result.get("checks", []) if not c["passed"]] if result else [log[:700]], "servedDocumentsMatchLocalBytes": served_match, "protectedChangedPaths": changed, "receipt": str(previous)}))
raise SystemExit(0 if receipt["passed"] else 1)
