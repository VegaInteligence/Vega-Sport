#!/usr/bin/env python3
"""Archive every source valuation and publish histories for verified Vega identities."""

import argparse
import csv
from datetime import date
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile


PLAYER_ID = re.compile(r"p_[A-Za-z0-9]{6}")
SOURCE_ID = re.compile(r"[1-9][0-9]*")
VALUE_EUR = re.compile(r"0|[1-9][0-9]*")
VALUE_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
SNAPSHOT_STATE = "player_market_value_snapshot_v1"


def csv_rows(path, body, fields):
    raw = io.BytesIO(body)
    stream = gzip.GzipFile(fileobj=raw) if path.suffix.lower() == ".gz" else raw
    with io.TextIOWrapper(stream, encoding="utf-8-sig", newline="") as text:
        reader = csv.DictReader(text, strict=True)
        headers = reader.fieldnames or []
        if len(set(headers)) != len(headers) or not set(fields) <= set(headers):
            raise ValueError(f"{path.name}: expected columns {', '.join(fields)}")
        for row in reader:
            location = f"{path.name}:{reader.line_num}"
            if None in row or any(row[field] is None for field in fields):
                raise ValueError(f"{location}: malformed CSV row")
            yield location, row


def identity_links(path):
    links = {}
    vega_ids = set()
    fields = ("source_player_id", "vega_player_id", "evidence")
    for location, row in csv_rows(path, path.read_bytes(), fields):
        source_id = row["source_player_id"]
        vega_id = row["vega_player_id"]
        evidence = row["evidence"].strip()
        if not SOURCE_ID.fullmatch(source_id) or not PLAYER_ID.fullmatch(vega_id):
            raise ValueError(f"{location}: invalid player identifier")
        if not evidence or "\x00" in evidence:
            raise ValueError(f"{location}: an identity evidence reference is required")
        if source_id in links or vega_id in vega_ids:
            raise ValueError(f"{location}: duplicate or ambiguous identity link")
        links[source_id] = (vega_id, evidence)
        vega_ids.add(vega_id)
    return links


def write_document(archive, path, document):
    archive.writestr(
        zipfile.ZipInfo(path), json.dumps(document, separators=(",", ":")).encode(),
        compress_type=zipfile.ZIP_DEFLATED,
    )


def prepare_snapshot(path, links, source_version):
    body = path.read_bytes()
    source_hash = hashlib.sha256(body).hexdigest()
    histories = {}
    source_max_date = None
    source_rows = 0
    fields = ("player_id", "date", "market_value_in_eur")
    for location, row in csv_rows(path, body, fields):
        source_id, valued_on, amount = (row[field] for field in fields)
        if not SOURCE_ID.fullmatch(source_id) or not VALUE_EUR.fullmatch(amount):
            raise ValueError(f"{location}: expected an integer player ID and EUR amount")
        if not VALUE_DATE.fullmatch(valued_on):
            raise ValueError(f"{location}: expected a valuation date in YYYY-MM-DD format")
        try:
            date.fromisoformat(valued_on)
        except ValueError as error:
            raise ValueError(f"{location}: invalid valuation date") from error
        source_rows += 1
        if source_max_date is None or valued_on > source_max_date:
            source_max_date = valued_on
        history = histories.setdefault(source_id, {})
        amount_eur = int(amount)
        if amount_eur > 2**53 - 1:
            raise ValueError(f"{location}: amount exceeds the exact integer range")
        observation = {"date": valued_on, "valueEur": amount_eur}
        club_name = (row.get("current_club_name") or "").strip()
        club_id = (row.get("current_club_id") or "").strip()
        if club_name and club_name.casefold() != "unknown":
            observation["clubName"] = club_name
        if SOURCE_ID.fullmatch(club_id):
            observation["clubId"] = club_id
        previous = history.setdefault(valued_on, observation)
        if previous != observation:
            raise ValueError(f"{location}: conflicting values for the same player and date")
    if not histories:
        raise ValueError("The valuation file contains no observations")

    matched = histories.keys() & links.keys()
    report = {
        "format": "player-market-values-v1",
        "distribution": "dcaribou/transfermarkt-datasets",
        "source_version": source_version,
        "source_sha256": source_hash,
        "source_rows": source_rows,
        "source_players": len(histories),
        "source_valuations": sum(map(len, histories.values())),
        "source_last_valuation_date": source_max_date,
        "identity_links": len(links),
        "matched_players": len(matched),
        "matched_valuations": sum(len(histories[source_id]) for source_id in matched),
        "unmatched_source_players": len(histories) - len(matched),
        "identity_links_without_valuations": len(links.keys() - histories.keys()),
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        # The source member retains the exact bytes, without indexing the full
        # CSV as one large SQL document. The other members are indexed by path.
        archive.writestr(
            zipfile.ZipInfo("source/valuation-export.original"), body,
            compress_type=zipfile.ZIP_DEFLATED,
        )
        write_document(archive, "manifest.json", report)
        for source_id, history in sorted(histories.items()):
            write_document(archive, f"source/{source_id}.json", {
                "kind": "source_market_value_history",
                "source_player_id": source_id,
                "history": [
                    value
                    for valued_on, value in sorted(history.items())
                ],
            })
        for source_id in sorted(matched):
            vega_id, evidence = links[source_id]
            write_document(archive, f"vega/{vega_id}.json", {
                "kind": "vega_market_value_identity",
                "vega_player_id": vega_id,
                "source_player_id": source_id,
                "identity_evidence": evidence,
            })
    payload = output.getvalue()
    archive_hash = hashlib.sha256(payload).hexdigest()
    report["archive_path"] = f"raw/enrichment/market-values/dcaribou/{archive_hash}.zip"
    return payload, report, [links[source_id][0] for source_id in matched]


def archive_snapshot(payload, report, player_ids, publish, expected_base=None):
    if publish and not player_ids:
        raise ValueError("No verified Vega players with valuations to publish")
    from aws_store import Store
    from psycopg.types.json import Jsonb

    path = report["archive_path"]
    store = Store()
    try:
        known = store.db.execute(
            "SELECT DISTINCT player_id FROM statarena_app.players WHERE player_id = ANY(%s)",
            (player_ids,),
        ).fetchall()
        unknown = set(player_ids) - {row[0] for row in known}
        if unknown:
            raise ValueError(f"Unknown Vega player IDs in identity links: {len(unknown)}")
        changed = store.put(path, payload, "application/zip")
        expected = report["source_players"] + report["matched_players"] + 1
        with store.db.transaction():
            receipt = store.db.execute(
                """SELECT document_count, error_count
                     FROM statarena.file_document_sources
                    WHERE source_path=%s AND source_sha256=%s AND status='ready'""",
                (path, hashlib.sha256(payload).digest()),
            ).fetchone()
            if receipt != (expected, 0):
                raise ValueError("The AWS archive index did not retain every expected document")
            counts = store.db.execute(
                """SELECT count(*), coalesce(sum(jsonb_array_length(document->'history')), 0)
                     FROM statarena.current_file_documents
                    WHERE source_path=%s AND document->>'kind'='source_market_value_history'""",
                (path,),
            ).fetchone()
            if counts != (report["source_players"], report["source_valuations"]):
                raise ValueError("The AWS valuation readback did not match the source")
            if publish:
                if expected_base is not None:
                    active = store.db.execute(
                        "SELECT value->>'path' FROM statarena.state WHERE name=%s FOR UPDATE",
                        (SNAPSHOT_STATE,),
                    ).fetchone()
                    if not active or active[0] not in (expected_base, path):
                        raise ValueError("Active valuation snapshot changed during replay")
                store.db.execute(
                    """INSERT INTO statarena.state(name,value) VALUES (%s,%s)
                       ON CONFLICT (name) DO UPDATE SET value=excluded.value, updated_at=now()
                       WHERE statarena.state.value IS DISTINCT FROM excluded.value""",
                    (SNAPSHOT_STATE, Jsonb({"path": path})),
                )
        return changed
    finally:
        store.db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("valuations", type=Path, help="player_valuations.csv or .csv.gz")
    parser.add_argument("identity_links", type=Path, help="CSV with verified identity links")
    parser.add_argument("--source-version", required=True, help="Published dataset version")
    parser.add_argument("--output", type=Path, help="Write the prepared ZIP locally")
    parser.add_argument("--archive", action="store_true", help="Write through the configured AWS source store")
    parser.add_argument("--publish", action="store_true", help="Activate the archived snapshot for Vega")
    args = parser.parse_args()
    if args.publish and not args.archive:
        parser.error("--publish requires --archive")
    try:
        payload, report, player_ids = prepare_snapshot(
            args.valuations, identity_links(args.identity_links), args.source_version
        )
        if args.output:
            with args.output.open("xb") as output:
                output.write(payload)
        if args.archive:
            report["archive_changed"] = archive_snapshot(payload, report, player_ids, args.publish)
    except (ValueError, OSError, csv.Error, EOFError) as error:
        parser.error(str(error))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
