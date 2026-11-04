"""Run the registered review-document browser workflow through the existing CLI."""
import datetime
import json
from pathlib import Path
import subprocess

OUT = Path(__file__).resolve().parents[1]
ROOT = OUT.parents[2]
target = json.loads((OUT / "target-schema.proposed.json").read_text())
expected = [{"name":t["qualified_name"],"columns":[{"name":n,"type":c["type"],"nullable":c["nullable"]} for n,c in t["columns"].items()]} for s in target["schemas"] for t in s["tables"]]
code = (OUT / "tools/review-viewer.js").read_text().replace("__EXPECTED_TABLES__",json.dumps(expected,ensure_ascii=False))
work = ROOT / "output/playwright/orion-plan"
command = ["/Users/lemonnierhugo/.codex/skills/playwright/scripts/playwright_cli.sh","-s=orion-plan","run-code",code]
process = subprocess.run(command,cwd=work,capture_output=True,text=True)
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
receipt = {"atUtc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "command":"python3 docs/architecture/orion-plan-20261104/tools/review_viewer.py",
           "setup":"REVIEW_PROTOCOL.md; local HTTP127.0.0.1:8794; existing Playwright CLI session orion-plan with cached Chromium configured; desktop1440x1000 and mobile390x844.",
           "exitCode":process.returncode,"passed":process.returncode==0 and bool(result and result.get("passed")),"log":"viewer-e2e.log",
           "limits":"Browser navigation through the generated review document only. Does not prove migration, constraints in PostgreSQL or final application behavior."}
(OUT / "evidence/viewer-e2e.json").write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
if not receipt["passed"]:
    print(log.split("### Error\n", 1)[-1].split("\n", 1)[0][:1000])
raise SystemExit(0 if receipt["passed"] else 1)
