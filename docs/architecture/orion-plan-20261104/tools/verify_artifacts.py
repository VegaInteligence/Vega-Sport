"""Inspect the review deliverable; no service, database or deployment operations."""
import ast
import datetime
import gzip
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit
from markdown_it import MarkdownIt

OUT = Path(__file__).resolve().parents[1]
failures = []
counts = {"json": 0, "gzipJson": 0, "python": 0, "localLinks": 0}

def link(source, target):
    parsed = urlsplit(target)
    if parsed.scheme or not parsed.path or "<!--" in target:
        return
    counts["localLinks"] += 1
    # The narrative template is rendered as PLAN.md at the review-folder root.
    base = OUT if source == OUT / "tools/PLAN.template.md" else source.parent
    path = base / unquote(parsed.path)
    if not path.exists():
        failures.append({"file": str(source.relative_to(OUT)), "missing": target})

class Links(HTMLParser):
    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in {"href", "src"} and value:
                link(OUT / "index.html", value)

for path in sorted(OUT.rglob("*")):
    if not path.is_file():
        continue
    try:
        if path.suffix == ".json":
            json.loads(path.read_text())
            counts["json"] += 1
        elif path.name.endswith(".json.gz"):
            json.loads(gzip.decompress(path.read_bytes()))
            counts["gzipJson"] += 1
        elif path.suffix == ".py":
            ast.parse(path.read_text(), filename=str(path))
            counts["python"] += 1
        elif path.suffix == ".md":
            for target in re.findall(r"\]\(([^\s)]+)\)", path.read_text()):
                link(path, target)
    except (ValueError, SyntaxError, OSError) as error:
        failures.append({"file": str(path.relative_to(OUT)), "error": str(error)})
Links().feed((OUT / "index.html").read_text())
inputs = json.loads((OUT / "evidence/inputs-and-scope.json").read_text())
for item in inputs["inputs"]:
    body = (OUT / item["copy"]).read_bytes()
    if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
        failures.append({"inputChanged": item["copy"]})
model_sha256 = hashlib.sha256((OUT / "target-schema.proposed.json").read_bytes()).hexdigest()
model = json.loads((OUT / "target-schema.proposed.json").read_text())
tables = [t for s in model["schemas"] for t in s["tables"]]
for file in ("proposal-inspection.json", "plan-coherence.json", "viewer-e2e.json", "viewer-checks.json", "rebuild.json"):
    proof = json.loads((OUT / "evidence" / file).read_text())
    if proof.get("modelSha256") != model_sha256 or not proof.get("passed"):
        failures.append({"staleOrFailedCurrentProof": file})
pro_review = json.loads((OUT / "evidence/pro-review-receipt.json").read_text())
if hashlib.sha256((OUT / pro_review["copy"]).read_bytes()).hexdigest() != pro_review["sha256"]:
    failures.append({"inputChanged": pro_review["copy"]})
protocols = json.loads((OUT / "evidence/pro-transform-protocols.json").read_text())
if not protocols["passed"] or protocols["finalModelSha256"] != model_sha256:
    failures.append({"staleOrFailedTransformProtocols": True})
for result in protocols["results"]:
    code = re.search(r'```python\n(.*?)\n```', (OUT / result["protocol"]).read_text(), re.S).group(1)
    if hashlib.sha256(code.encode()).hexdigest() != result["scriptSha256"]:
        failures.append({"transformProtocolChangedSinceRun": result["protocol"]})
browser = json.loads((OUT / "evidence/viewer-checks.json").read_text())
if not browser["passed"] or not all(c["passed"] for c in browser["checks"]):
    failures.append({"browserWorkflowFailed": True})
for image in browser["artifacts"]:
    if not (OUT / "evidence" / image).is_file():
        failures.append({"missingScreenshot": image})
if browser["counts"]["tables"] != len(tables) or browser["counts"]["columns"] != sum(len(t["columns"]) for t in tables) or browser["counts"]["foreignKeys"] != sum(len(t["foreign_keys"]) for t in tables):
    failures.append({"browserModelCoverageMismatch": browser["counts"]})
embedded = re.search(r'<script id="plan-data" type="application/json">(.*?)</script>', (OUT / "index.html").read_text(), re.S)
if embedded is None or json.loads(embedded.group(1)) != json.loads((OUT / "viewer-data.json").read_text()):
    failures.append({"embeddedModelMismatch": True})
rendered_plan = MarkdownIt("commonmark", {"html": False}).enable("table").render((OUT / "PLAN.md").read_text())
if rendered_plan not in (OUT / "index.html").read_text():
    failures.append({"embeddedPlanMismatch": True})
s3 = json.loads((OUT / "evidence/s3.json").read_text())
if not s3["complete"] or sum(g["bytes"] for g in s3["classes"].values()) != s3["bytes"]:
    failures.append({"s3InventoryIncompleteOrInconsistent": True})
receipt = {"atUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "command": "python3 docs/architecture/orion-plan-20261104/tools/verify_artifacts.py",
           "modelSha256": model_sha256,
           "scope": "Syntax, local document links, unchanged input copies, completed browser receipt/screenshots and S3 metadata totals. No application or database acceptance.",
           "counts": counts, "failures": failures, "passed": not failures,
           "documentSha256": {name: hashlib.sha256((OUT / name).read_bytes()).hexdigest() for name in ("PLAN.md", "index.html", "viewer-data.json", "DICTIONNAIRE.md", "current-to-target.csv", "blueprint-diff.json", "changes.json")},
           "screenshotsSha256": {name: hashlib.sha256((OUT / "evidence" / name).read_bytes()).hexdigest() for name in browser["artifacts"] if (OUT / "evidence" / name).is_file()}}
(OUT / "evidence/artifact-validation.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt))
raise SystemExit(bool(failures))
