#!/usr/bin/env python3
"""Import the pinned dcaribou snapshot through the existing AWS ingest role."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.request import urlopen
from zipfile import is_zipfile, ZipFile

import psycopg

from import_player_market_values import archive_snapshot, identity_links, prepare_snapshot


VERSION = "679"
ASSET_URL = "https://www.kaggle.com/api/v1/datasets/download/davidcariboo/player-scores"
ASSETS = {
    "player_valuations.csv": "9caf4ff707905f71463a04253c5ac640b3ff9575e07912fd7c50365697efa47d",
    "players.csv": "b94216cf2ff8777b5eddd4fd91402c19e757b366fbdeb4f4437580c302ff2d66",
    "clubs.csv": "26dc6113d8206246145add2c7a318a657b3995fccdb0c9004d65ca6ae5e5968b",
    "appearances.csv": "c4ba5327f9005e4a9914c0f78c3b07132ef2cf1a4babda379bbf54ffd207ebec",
}
SCRIPTS = Path(__file__).resolve().parent
MIGRATION = SCRIPTS.parent / "backend/migrations/038_player_market_value_history.sql"


def fetch_assets(directory, download):
    for name, expected in ASSETS.items():
        target = directory / name
        if download:
            with (directory / (name + ".zip")).open("w+b") as body:
                with urlopen(f"{ASSET_URL}/{name}?dataset_version_number={VERSION}", timeout=120) as source:
                    shutil.copyfileobj(source, body)
                with target.open("wb") as out:
                    if is_zipfile(body):
                        with ZipFile(body) as archive, archive.open(name) as source:
                            shutil.copyfileobj(source, out)
                    else:
                        body.seek(0)
                        shutil.copyfileobj(body, out)
        with target.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest != expected:
            raise ValueError(f"Unexpected checksum for {name}")


def export_evidence(db, path):
    with db.transaction():
        db.execute("SET TRANSACTION READ ONLY")
        with db.cursor().copy("""
            COPY (
                SELECT a.player_id AS vega_player_id, p.name AS player_name,
                       a.team_id AS vega_team_id, a.team AS team_name, a.date AS match_date
                  FROM statarena_app.appearances AS a
                  JOIN statarena_app.players AS p ON p.id=a.player_ref
                 WHERE a.player_id = p.player_id AND a.team_id IS NOT NULL
                   AND a.team IS NOT NULL AND a.date IS NOT NULL
                   AND p.name IS NOT NULL
            ) TO STDOUT (FORMAT CSV, HEADER TRUE)
        """) as copy, path.open("wb") as out:
            for chunk in copy:
                out.write(chunk)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, help="Use the verified local CSV files")
    parser.add_argument("--verified-crosswalk", type=Path, help="Optional separately verified identity links")
    args = parser.parse_args()
    with TemporaryDirectory(prefix="vega-market-values-") as tmp:
        scratch = Path(tmp)
        source = args.data_dir or scratch
        fetch_assets(source, download=args.data_dir is None)
        evidence, links = scratch / "vega-evidence.csv", scratch / "identity-links.csv"
        with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True, connect_timeout=8,
                             options="-c statement_timeout=120000 -c lock_timeout=3000") as db:
            export_evidence(db, evidence)
            matcher = [
                sys.executable, str(SCRIPTS / "match_player_market_value_ids.py"),
                "--data-dir", str(source), "--vega-evidence", str(evidence), "--output", str(links),
            ]
            if args.verified_crosswalk:
                matcher += ["--verified-crosswalk", str(args.verified_crosswalk)]
            subprocess.run(matcher, check=True)
            payload, report, players = prepare_snapshot(
                source / "player_valuations.csv", identity_links(links), VERSION,
            )
            with db.transaction():
                db.execute(MIGRATION.read_text())
        report["archive_changed"] = archive_snapshot(payload, report, players, publish=bool(players))
        report["published"] = bool(players)
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, psycopg.Error, subprocess.CalledProcessError) as error:
        sys.exit(f"Market value import failed ({type(error).__name__}, {getattr(error, 'sqlstate', None)})")
