"""Build the standalone review document; no remote calls or schema operations."""
import json
from pathlib import Path

from markdown_it import MarkdownIt

OUT = Path(__file__).resolve().parents[1]
template = (OUT / "tools/viewer.template.html").read_text()
data = (OUT / "viewer-data.json").read_text().replace("<", "\\u003c")
plan = MarkdownIt("commonmark", {"html": False}).enable("table").render((OUT / "PLAN.md").read_text())
html = template.replace("<!--PLAN-->", plan).replace("<!--DATA-->", data)
(OUT / "index.html").write_text(html)
print(json.dumps({"file": str(OUT / "index.html"), "bytes": len(html.encode()), "remote_dependencies": 0}))
