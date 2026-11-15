"""Project the 2026-07-06 Transfermarkt snapshot into compact player facts.

Usage: python backend/tools/build_player_fact_snapshot.py SOURCE_DIR OUTPUT.jsonl.gz
The input directory contains players.csv, clubs.csv and appearances.csv from the
dcaribou/transfermarkt-datasets snapshot. The output is byte reproducible.
"""

import argparse
import csv
from datetime import date
import gzip
import json
from pathlib import Path
from urllib.parse import urlparse


AS_OF = date(2026, 7, 6)


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as source:
        yield from csv.DictReader(source)


def day(value):
    try:
        return date.fromisoformat((value or "")[:10]).isoformat()
    except ValueError:
        return None


def canonical_url(value, player_id):
    parsed = urlparse(value or "")
    if (parsed.scheme == "https" and parsed.hostname in {"www.transfermarkt.co.uk", "www.transfermarkt.com"}
            and parsed.path.endswith("/profil/spieler/" + player_id)):
        return "https://www.transfermarkt.com" + parsed.path
    return None


def build(source, output):
    clubs = {row["club_id"]: row["name"].strip() for row in rows(source / "clubs.csv") if row["name"].strip()}
    players = {}
    for row in rows(source / "players.csv"):
        player_id = row["player_id"].strip()
        if not player_id.isdigit() or player_id in players:
            raise ValueError(f"Invalid or duplicate player ID: {player_id!r}")
        names = []
        for value in (row["name"], " ".join((row["first_name"], row["last_name"]))):
            value = " ".join(value.split())
            if value and value not in names:
                names.append(value)
        foot = row["foot"].strip().lower()
        players[player_id] = {
            "id": player_id, "names": names, "birth": day(row["date_of_birth"]),
            "foot": foot if foot in {"left", "right", "both"} else None,
            "club": row["current_club_name"].strip() or None,
            "expires": day(row["contract_expiration_date"]), "evidence": [],
            "url": canonical_url(row["url"], player_id),
        }

    evidence = {}
    for row in rows(source / "appearances.csv"):
        player_id, club = row["player_id"], clubs.get(row["player_club_id"])
        match_day = day(row["date"])
        try:
            played = int(row["minutes_played"]) > 0
        except ValueError:
            played = False
        if player_id not in players or not club or not match_day or match_day > AS_OF.isoformat() or not played:
            continue
        # Keep one deterministic club per played date and only the six latest dates.
        dates = evidence.setdefault(player_id, {})
        dates[match_day] = min(club, dates.get(match_day, club))
        if len(dates) > 6:
            del dates[min(dates)]

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as zipped:
        for player_id in sorted(players, key=int):
            player = players[player_id]
            player["evidence"] = [[club, match_day] for match_day, club in sorted(evidence.get(player_id, {}).items(), reverse=True)]
            zipped.write((json.dumps(player, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.source, args.output)
