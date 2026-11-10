#!/usr/bin/env python3
"""Import the pinned dcaribou snapshot through the existing AWS ingest role."""

import argparse
import csv
import hashlib
import io
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

from import_player_market_values import SNAPSHOT_STATE, archive_snapshot, identity_links, prepare_snapshot


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


def prepare_active_replay(scratch):
    """Rebuild only from the active immutable source and its published links."""
    from aws_store import Store

    store = Store()
    try:
        active = store.db.execute(
            "SELECT value->>'path' FROM statarena.state WHERE name=%s", (SNAPSHOT_STATE,)
        ).fetchone()
        if not active or not active[0]:
            raise ValueError("No active valuation snapshot")
        base = active[0]
        payload = store.bytes(base)
    finally:
        store.db.close()
    with ZipFile(io.BytesIO(payload)) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate archive members")
        manifest = json.loads(archive.read("manifest.json"))
        original = archive.read("source/valuation-export.original")
        if hashlib.sha256(original).hexdigest() != manifest["source_sha256"]:
            raise ValueError("Original valuation source checksum mismatch")
        source = scratch / ("original.csv.gz" if original.startswith(b'\x1f\x8b') else "original.csv")
        source.write_bytes(original)
        identities = {name for name in names if name.startswith("vega/") and name.endswith(".json")}
        links = {}
        for name in identities:
            doc = json.loads(archive.read(name))
            source_id = doc.get("source_player_id")
            vega_id = doc.get("vega_player_id")
            if doc.get("kind") != "vega_market_value_identity" or name != f"vega/{vega_id}.json" or source_id in links:
                raise ValueError("Invalid published identity document")
            links[source_id] = (vega_id, doc.get("identity_evidence"))
        # Validate identities using the same canonical rules as normal import.
        link_file = scratch / "published-links.csv"
        with link_file.open("w", encoding="utf-8", newline="") as out:
            writer = csv.writer(out)
            writer.writerow(("source_player_id", "vega_player_id", "evidence"))
            writer.writerows((sid, *link) for sid, link in links.items())
        validated = identity_links(link_file)
        rebuilt, report, players = prepare_snapshot(source, validated, manifest["source_version"])
        with ZipFile(io.BytesIO(rebuilt)) as candidate:
            candidate_names = candidate.namelist()
            source_names = {n for n in names if n.startswith("source/") and n.endswith(".json")}
            if source_names != {n for n in candidate_names if n.startswith("source/") and n.endswith(".json")}:
                raise ValueError("Replayed source player set changed")
            for name in source_names:
                old = json.loads(archive.read(name))
                new = json.loads(candidate.read(name))
                old_points = [(p["date"], p["valueEur"]) for p in old["history"]]
                new_points = [(p["date"], p["valueEur"]) for p in new["history"]]
                if old_points != new_points:
                    raise ValueError("Replayed valuation history changed")
            if identities != {n for n in candidate_names if n.startswith("vega/") and n.endswith(".json")}:
                raise ValueError("Replayed identity set changed")
            for name in identities:
                if json.loads(archive.read(name)) != json.loads(candidate.read(name)):
                    raise ValueError("Replayed identity evidence changed")
    return base, rebuilt, report, players


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, help="Use the verified local CSV files")
    parser.add_argument("--verified-crosswalk", type=Path, help="Optional separately verified identity links")
    parser.add_argument("--replay-active-clubs", action="store_true", help="Enrich the active snapshot using its original source and identity links")
    args = parser.parse_args()
    if args.replay_active_clubs and (args.data_dir or args.verified_crosswalk):
        parser.error("--replay-active-clubs cannot be combined with source or crosswalk options")
    with TemporaryDirectory(prefix="vega-market-values-") as tmp:
        scratch = Path(tmp)
        if args.replay_active_clubs:
            base, payload, report, players = prepare_active_replay(scratch)
            report["archive_changed"] = archive_snapshot(payload, report, players, publish=True, expected_base=base)
            report["published"] = True
            report["replayed_from"] = base
            print(json.dumps(report, indent=2))
            return
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
