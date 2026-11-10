#!/usr/bin/env python3
"""Validate dated market values and archive matched histories in the source store."""

import argparse
import csv
from datetime import date
import gzip
import hashlib
import io
import json
from pathlib import Path
import re


PLAYER_ID = re.compile(r"p_[A-Za-z0-9]{6}")
SOURCE_ID = re.compile(r"[1-9][0-9]*")
VALUE_EUR = re.compile(r"0|[1-9][0-9]*")
VALUE_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


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


def prepare_snapshot(path, links):
    body = path.read_bytes()
    source_hash = hashlib.sha256(body).hexdigest()
    histories = {}
    source_players = set()
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
        source_players.add(source_id)
        if source_max_date is None or valued_on > source_max_date:
            source_max_date = valued_on
        if source_id in links:
            history = histories.setdefault(source_id, {})
            amount_eur = int(amount)
            if history.setdefault(valued_on, amount_eur) != amount_eur:
                raise ValueError(f"{location}: conflicting values for the same player and date")

    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode="wb", mtime=0) as archive:
        for source_id, history in sorted(histories.items()):
            vega_id, evidence = links[source_id]
            document = {
                "kind": "player_market_value_history",
                "vega_player_id": vega_id,
                "source_player_id": source_id,
                "source": "Transfermarkt",
                "distribution": "dcaribou/transfermarkt-datasets",
                "source_sha256": source_hash,
                "identity_evidence": evidence,
                "valuations": [
                    {"date": valued_on, "market_value_in_eur": value}
                    for valued_on, value in sorted(history.items())
                ],
            }
            archive.write((json.dumps(document, separators=(",", ":")) + "\n").encode())
    payload = output.getvalue()
    archive_hash = hashlib.sha256(payload).hexdigest()
    report = {
        "source_sha256": source_hash,
        "source_rows": source_rows,
        "source_players": len(source_players),
        "source_last_valuation_date": source_max_date,
        "identity_links": len(links),
        "matched_players": len(histories),
        "matched_valuations": sum(map(len, histories.values())),
        "unmatched_source_players": len(source_players - links.keys()),
        "identity_links_without_valuations": len(links.keys() - histories.keys()),
        "archive_path": f"raw/enrichment/market-values/dcaribou/{archive_hash}.jsonl.gz",
    }
    return payload, report, [links[source_id][0] for source_id in histories]


def archive_snapshot(path, payload, player_ids):
    if not player_ids:
        raise ValueError("No linked players with valuations to archive")
    from aws_store import Store

    store = Store()
    try:
        known = store.db.execute(
            "SELECT DISTINCT player_id FROM statarena_app.players WHERE player_id = ANY(%s)",
            (player_ids,),
        ).fetchall()
        unknown = set(player_ids) - {row[0] for row in known}
        if unknown:
            raise ValueError(f"Unknown Vega player IDs in identity links: {len(unknown)}")
        return store.put(path, payload, "application/gzip")
    finally:
        store.db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("valuations", type=Path, help="player_valuations.csv or .csv.gz")
    parser.add_argument("identity_links", type=Path, help="CSV with verified identity links")
    parser.add_argument("--output", type=Path, help="Write the prepared .jsonl.gz archive locally")
    parser.add_argument("--archive", action="store_true", help="Write through the configured AWS source store")
    args = parser.parse_args()
    try:
        payload, report, player_ids = prepare_snapshot(args.valuations, identity_links(args.identity_links))
        if args.output:
            with args.output.open("xb") as output:
                output.write(payload)
        if args.archive:
            report["archive_changed"] = archive_snapshot(report["archive_path"], payload, player_ids)
    except (ValueError, OSError, csv.Error, EOFError) as error:
        parser.error(str(error))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
