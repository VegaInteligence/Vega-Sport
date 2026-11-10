#!/usr/bin/env python3
"""Build a separate, attributable archive of the source's goal-event records."""

import argparse
import collections
import csv
import gzip
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "data/sources/worldclub/goals"
OUTPUT = ROOT / "data/raw/historical-goals"
COMPETITIONS = {
    "aut-bundesliga": ("Bundesliga", "Autriche"),
    "bel-pro-league": ("Pro League", "Belgique"),
    "bundesliga": ("Bundesliga", "Allemagne"),
    "champions-league": ("Ligue des champions", "Europe"),
    "cze-1-fotbalova-liga": ("Première division", "Tchéquie"),
    "dfb-pokal": ("Coupe d’Allemagne", "Allemagne"),
    "eng-fa-cup": ("FA Cup", "Angleterre"),
    "eng-league-cup": ("Coupe de la Ligue", "Angleterre"),
    "eng-premier-league": ("Première division", "Angleterre"),
    "esp-copa-del-rey": ("Coupe du Roi", "Espagne"),
    "esp-primera-division": ("Liga", "Espagne"),
    "europa-league": ("Ligue Europa", "Europe"),
    "fra-coupe-de-france": ("Coupe de France", "France"),
    "fra-ligue-1": ("Ligue 1", "France"),
    "gre-super-league": ("Super League", "Grèce"),
    "ita-serie-a": ("Serie A", "Italie"),
    "ned-eredivisie": ("Eredivisie", "Pays-Bas"),
    "nor-eliteserien": ("Eliteserien", "Norvège"),
    "pol-ekstraklasa": ("Ekstraklasa", "Pologne"),
    "por-primeira-liga": ("Primeira Liga", "Portugal"),
    "sco-premiership": ("Premiership", "Écosse"),
    "sui-super-league": ("Super League", "Suisse"),
    "tur-sueperlig": ("Süper Lig", "Turquie"),
}
FINAL_SCORE = re.compile(r"(\d+):(\d+)$")
SEASON = re.compile(r"^(\d{4})-(\d{4})$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def season_for(row, competition):
    match = SEASON.fullmatch(row["season"])
    if match and int(match.group(2)) == int(match.group(1)) + 1:
        return f"{match.group(1)}/{match.group(2)}", False
    # Norway's top division plays by calendar year and the source uses NA.
    if competition == "nor-eliteserien" and row["season"] == "NA" and DATE.fullmatch(row["date"]):
        year = int(row["date"][:4])
        return f"{year}/{year + 1}", True
    return None, False


def read_competition(path, competition):
    seen, groups = set(), collections.defaultdict(list)
    duplicates = unassigned = 0
    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            key = tuple(row.values())
            if key in seen:
                duplicates += 1
                continue
            seen.add(key)
            season, calendar = season_for(row, competition)
            if season is None:
                unassigned += 1
                continue
            if not DATE.fullmatch(row["date"]) or not row["GH"].isdigit() or not row["GA"].isdigit():
                raise ValueError(f"Invalid date or score in {path.name}: {row!r}")
            event = {
                "date": row["date"],
                "player": row["scoring_player"],
                "team": row["scoring_team"],
                "minute": row["time"],
                "score": [int(row["GH"]), int(row["GA"])],
                "match": row["game"],
                "sourceSeason": row["season"],
            }
            groups[(season, calendar, row["date"], row["game"])].append(event)
    for (_, _, _, game), events in groups.items():
        match = FINAL_SCORE.search(game)
        # Flag disagreements; extra time or source errors may explain them.
        if match and sum(map(int, match.groups())) != len(events):
            for event in events:
                event["scoreDisagreement"] = True
    return groups, duplicates, unassigned


def build(source, output):
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    seasons = collections.defaultdict(dict)
    duplicates = unassigned = 0
    for file in manifest["files"]:
        path = source / (file["name"] + ".gz")
        raw = gzip.decompress(path.read_bytes())
        if hashlib.sha256(raw).hexdigest() != file["sha256"]:
            raise ValueError(f"Source checksum mismatch: {path.name}")
        competition = file["name"].removesuffix(".csv")
        if competition not in COMPETITIONS:
            raise ValueError(f"Unknown competition: {competition}")
        groups, removed, missing = read_competition(path, competition)
        duplicates += removed
        unassigned += missing
        for (season, calendar, _, _), events in groups.items():
            entry = seasons[season].setdefault(competition, {
                "id": competition,
                "name": COMPETITIONS[competition][0],
                "country": COMPETITIONS[competition][1],
                "calendarYear": int(season[:4]) if calendar else None,
                "events": [],
            })
            entry["events"].extend(events)

    output.mkdir(parents=True, exist_ok=True)
    source_info = {
        "name": "schochastics/football-data (World Club Ratings)",
        "url": manifest["repository"],
        "revision": manifest["revision"],
        "license": "ODC-BY-1.0",
        "licenseUrl": "https://opendatacommons.org/licenses/by/1-0/",
        "coverage": "Événements de buts disponibles uniquement ; couverture partielle, sans xG ni type de but garanti.",
    }
    index = {"schemaVersion": 1, "source": source_info, "duplicatesRemoved": duplicates,
             "unassignedEvents": unassigned, "seasons": []}
    for season in sorted(seasons, reverse=True):
        competitions = list(seasons[season].values())
        competitions.sort(key=lambda entry: (entry["country"], entry["name"]))
        for comp in competitions:
            comp["events"].sort(key=lambda event: (event["date"], event["match"], event["score"]))
        obj = {"season": season, "source": source_info, "competitions": competitions}
        body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        compressed = gzip.compress(body, compresslevel=9, mtime=0)
        filename = f"{season.replace('/', '-')}.json.gz"
        (output / filename).write_bytes(compressed)
        all_events = [event for comp in competitions for event in comp["events"]]
        index["seasons"].append({
            "id": season, "path": f"raw/historical-goals/{filename}",
            "competitions": len(competitions), "events": len(all_events),
            "matches": sum(len({(e["date"], e["match"]) for e in c["events"]}) for c in competitions),
            "scoreDisagreements": sum(1 for e in all_events if e.get("scoreDisagreement")),
            "latestEvent": max(e["date"] for e in all_events),
            "sha256": hashlib.sha256(compressed).hexdigest(),
        })
    (output / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return index


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    result = build(args.source, args.output)
    print(f"{len(result['seasons'])} saisons ; {sum(s['events'] for s in result['seasons'])} événements ; "
          f"{result['duplicatesRemoved']} doublons exclus ; {result['unassignedEvents']} sans saison fiable")
