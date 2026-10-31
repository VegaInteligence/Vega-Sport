"""Build static preview assets and a self-contained Sites Worker."""

import json
from pathlib import Path
import re
import shutil
import subprocess
import sys


FRONTEND_ASSETS = {
    "index.html": "text/html; charset=utf-8",
    "styles.css": "text/css; charset=utf-8",
    "style.css": "text/css; charset=utf-8",
    "app.js": "text/javascript; charset=utf-8",
    "explorer.js": "text/javascript; charset=utf-8",
    "charts.js": "text/javascript; charset=utf-8",
    "model.js": "text/javascript; charset=utf-8",
    "favicon.svg": "image/svg+xml",
    "data/football.json": "application/json; charset=utf-8",
}


def main():
    root = Path(__file__).resolve().parents[1]
    subprocess.run([sys.executable, str(root / "scripts/build_dashboard_data.py")], check=True)
    destination = root / "dist"
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(exist_ok=True)
    # Copy only the explicitly reviewed frontend; never copy raw project files,
    # credentials, repository metadata or local configuration into the site.
    asset_names = dict(FRONTEND_ASSETS)
    snapshot = json.loads((root / "dashboard/data/football.json").read_text(encoding="utf-8"))
    for match in snapshot.get("matches", []):
        match_id = match.get("id", "")
        if not re.fullmatch(r"m_[A-Za-z0-9]{6}", match_id):
            raise ValueError("Invalid match ID in dashboard snapshot")
        name = f"data/matches/{match_id}.json"
        if (root / "dashboard" / name).is_file():
            asset_names[name] = "application/json; charset=utf-8"
    assets = {}
    for name, content_type in asset_names.items():
        source = root / "dashboard" / name
        # During the migration the explorer can be authored independently.
        if name == "explorer.js" and not source.exists():
            continue
        if source.is_symlink() or not source.resolve().is_relative_to((root / "dashboard").resolve()):
            raise ValueError(f"Refusing symlinked public asset: {name}")
        (destination / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination / name)
        assets[f"/{name}"] = {"type": content_type, "body": source.read_text(encoding="utf-8")}

    # The Worker ESM contract requires one module. Both sources are dependency-free.
    gateway = (root / "worker/pitchapi.js").read_text(encoding="utf-8")
    gateway = re.sub(r"^export ", "", gateway, flags=re.MULTILINE)
    worker = (root / "worker/index.js").read_text(encoding="utf-8")
    worker = worker.replace("import { handlePitchApi } from './pitchapi.js';\n", "", 1)
    marker = "/* ORION_PUBLIC_ASSETS */ {}"
    if worker.count(marker) != 1:
        raise ValueError("Worker public asset marker is missing or ambiguous")
    worker = worker.replace(marker, json.dumps(assets, ensure_ascii=True, separators=(",", ":")), 1)
    (destination / "server").mkdir()
    (destination / "server/index.js").write_text(gateway + "\n" + worker, encoding="utf-8")
    (destination / ".openai").mkdir()
    shutil.copy2(root / ".openai/hosting.json", destination / ".openai/hosting.json")
    print(f"Dashboard built: {destination} ({len(assets)} embedded public assets)")


if __name__ == "__main__":
    main()
