"""Rebuild the source snapshot and package the dependency-free dashboard."""

from pathlib import Path
import shutil
import subprocess
import sys


def main():
    root = Path(__file__).resolve().parents[1]
    subprocess.run([sys.executable, str(root / "scripts/build_dashboard_data.py")], check=True)
    destination = root / "dist"
    destination.mkdir(exist_ok=True)
    # Copy only the explicitly reviewed frontend; never copy raw project files,
    # credentials, repository metadata or local configuration into the site.
    for name in ["index.html", "styles.css", "style.css", "app.js", "charts.js", "model.js", "favicon.svg"]:
        shutil.copy2(root / "dashboard" / name, destination / name)
    (destination / "data").mkdir(exist_ok=True)
    shutil.copy2(root / "dashboard/data/football.json", destination / "data/football.json")
    print(f"Dashboard built: {destination}")


if __name__ == "__main__":
    main()
