"""Run the documented review E2E through the existing Playwright CLI."""
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

OUT = Path(__file__).resolve().parents[1]
ROOT = OUT.parents[2]
target = json.loads((OUT / "target-schema.proposed.json").read_text())
viewer = json.loads((OUT / "viewer-data.json").read_text())
tables = [t for s in target["schemas"] for t in s["tables"]]
expected = {"policy": target["planning"]["version_policy"],
            "modelSha256": hashlib.sha256((OUT / "target-schema.proposed.json").read_bytes()).hexdigest(),
            "counts": {"tables": len(tables), "columns":sum(len(t["columns"]) for t in tables),
                       "foreignKeys":sum(len(t["foreign_keys"]) for t in tables),
                       "jsonb":sum(c["type"] == "jsonb" for t in tables for c in t["columns"].values()),
                       "currentRelations":len(viewer["current_to_target"])}}
code = (OUT / "tools/review-viewer.js").read_text().replace("__EXPECTED_REVIEW__", json.dumps(expected,ensure_ascii=False))
work = ROOT / "output/playwright/orion-plan"
work.mkdir(parents=True, exist_ok=True)
command = ["/Users/lemonnierhugo/.codex/skills/playwright/scripts/playwright_cli.sh", "-s=orion-plan", "run-code", code]
process = subprocess.run(command, cwd=work, capture_output=True, text=True)
log = process.stdout + process.stderr
(OUT / "evidence/viewer-e2e.log").write_text(log)
result = None
if "### Result\n" in process.stdout:
    result_text = process.stdout.split("### Result\n", 1)[1].split("\n### ", 1)[0].strip()
    try:
        result = json.loads(result_text)
    except json.JSONDecodeError:
        pass
if result is not None:
    (OUT / "evidence/viewer-checks.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    for name in result.get("artifacts", []):
        shutil.copy2(work / name, OUT / "evidence" / name)
receipt = {"atUtc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "command":"python3 docs/architecture/orion-plan-20261104/tools/review_viewer.py",
           "setup":"REVIEW_PROTOCOL.md; local HTTP 127.0.0.1:8794; fresh Playwright CLI session orion-plan with local Chromium; desktop 1440x1000, mobile 390x844, light/dark.",
           "modelSha256":expected["modelSha256"], "expected":expected["counts"],
           "exitCode":process.returncode, "passed":process.returncode==0 and bool(result and result.get("passed") and result.get("modelSha256")==expected["modelSha256"]),
           "log":"viewer-e2e.log", "screenshots":result.get("artifacts", []) if result else [],
           "limits":"Generated review-document navigation only. It does not assess SQL/pilot acceptance; separate bounded local pilot receipts exist. Complete source fidelity, public parity, RDS performance and global acceptance remain open."}
(OUT / "evidence/viewer-e2e.json").write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
if not receipt["passed"]:
    print(log.split("### Error\n", 1)[-1].split("\n", 1)[0][:1000])
raise SystemExit(0 if receipt["passed"] else 1)
