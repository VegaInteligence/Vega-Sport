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

OUT = Path(__file__).resolve().parents[1]
failures = []
counts = {"json": 0, "gzipJson": 0, "python": 0, "localLinks": 0}

def link(source, target):
    parsed = urlsplit(target)
    if parsed.scheme or not parsed.path or "<!--" in target:
        return
    counts["localLinks"] += 1
    path = source.parent / unquote(parsed.path)
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
browser = json.loads((OUT / "evidence/viewer-checks.json").read_text())
if not browser["passed"] or not all(c["passed"] for c in browser["checks"]):
    failures.append({"browserWorkflowFailed": True})
for image in browser["artifacts"]:
    if not (OUT / "evidence" / image).is_file():
        failures.append({"missingScreenshot": image})
s3 = json.loads((OUT / "evidence/s3.json").read_text())
if not s3["complete"] or sum(g["bytes"] for g in s3["classes"].values()) != s3["bytes"]:
    failures.append({"s3InventoryIncompleteOrInconsistent": True})
receipt = {"atUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "command": "python3 docs/architecture/orion-plan-20261104/tools/verify_artifacts.py",
           "scope": "Syntax, local document links, unchanged input copies, completed browser receipt/screenshots and S3 metadata totals. No application or database acceptance.",
           "counts": counts, "failures": failures, "passed": not failures}
(OUT / "evidence/artifact-validation.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt))
raise SystemExit(bool(failures))
