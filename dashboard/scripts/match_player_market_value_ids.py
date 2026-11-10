#!/usr/bin/env python3
"""Link players with exact names corroborated by two shared club match dates."""

import argparse
from collections import Counter, defaultdict
import csv
import json
from pathlib import Path
import re
import unicodedata

from import_player_market_values import identity_links


CLUB_AFFIXES = {"ac", "afc", "as", "cf", "fc", "fk", "sc", "sk", "sv"}


def normalized(value):
    plain = unicodedata.normalize("NFKD", value.casefold())
    plain = "".join(c for c in plain if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^\w]+", " ", plain).split())


def club_key(value):
    words = normalized(value).split()
    if len(words) > 1 and words[0] in CLUB_AFFIXES:
        words.pop(0)
    if len(words) > 1 and words[-1] in CLUB_AFFIXES:
        words.pop()
    return " ".join(words)


def rows(path, fields):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not set(fields) <= set(reader.fieldnames or []):
            raise ValueError(f"{path.name}: expected columns {', '.join(fields)}")
        yield from reader


def source_catalogue(directory):
    names = {}
    for row in rows(directory / "players.csv", ("player_id", "name", "first_name", "last_name")):
        source_id = row["player_id"]
        if not source_id or source_id in names:
            raise ValueError("Blank or duplicate player_id in players.csv")
        aliases = {normalized(row["name"])}
        if row["first_name"] and row["last_name"]:
            aliases.add(normalized(f"{row['first_name']} {row['last_name']}"))
        names[source_id] = aliases - {""}

    clubs = defaultdict(set)
    for row in rows(directory / "clubs.csv", ("club_id", "name")):
        name = club_key(row["name"])
        if name:
            clubs[name].add(row["club_id"])
    return names, {next(iter(ids)): name for name, ids in clubs.items() if len(ids) == 1}


def read_evidence(path, source_names, source_clubs):
    appearances = defaultdict(set)
    players = set()
    clubs = defaultdict(set)
    fields = ("vega_player_id", "player_name", "vega_team_id", "team_name", "match_date")
    for row in rows(path, fields):
        player, team = row["vega_player_id"], row["vega_team_id"]
        players.add(player)
        club = club_key(row["team_name"])
        if club not in source_clubs:
            continue
        clubs[club].add(team)
        name = normalized(row["player_name"])
        if name in source_names:
            appearances[(name, club, row["match_date"][:10])].add((player, team))
    return players, appearances, clubs


def appearance_candidates(directory, names, clubs, evidence_path):
    players, appearances, vega_clubs = read_evidence(
        evidence_path, set().union(*names.values()), set(clubs.values())
    )
    corroboration = defaultdict(set)
    for row in rows(directory / "appearances.csv", ("player_id", "player_club_id", "date")):
        source_id, source_club = row["player_id"], row["player_club_id"]
        club = clubs.get(source_club)
        if club is None or len(vega_clubs[club]) != 1:
            continue
        day = row["date"][:10]
        for name in names.get(source_id, ()):
            for vega_id, vega_club in appearances.get((name, club, day), ()):
                corroboration[(source_id, vega_id, source_club, vega_club)].add(day)
    qualified = {}
    for (source_id, vega_id, source_club, vega_club), dates in sorted(corroboration.items()):
        if len(dates) >= 2:
            first, second = sorted(dates)[:2]
            qualified.setdefault(
                (source_id, vega_id),
                f"exact-name-club: {first}, {second}, clubs {source_club}/{vega_club}",
            )
    return players, qualified


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--vega-evidence", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--verified-crosswalk", type=Path)
    args = parser.parse_args()

    names, clubs = source_catalogue(args.data_dir)
    players, candidates = appearance_candidates(args.data_dir, names, clubs, args.vega_evidence)
    verified = identity_links(args.verified_crosswalk) if args.verified_crosswalk else {}
    if verified.keys() - names.keys():
        raise ValueError("Verified links contain an unknown source player")
    used_vega = {vid for vid, _ in verified.values()}
    source_degree = Counter(sid for sid, _ in candidates)
    vega_degree = Counter(vid for _, vid in candidates)
    matches = verified.copy()
    ambiguous = 0
    for (sid, vid), evidence in candidates.items():
        if source_degree[sid] > 1 or vega_degree[vid] > 1:
            ambiguous += 1
        elif sid not in verified and vid not in used_vega:
            matches[sid] = (vid, evidence)

    with args.output.open("x", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(("source_player_id", "vega_player_id", "evidence"))
        for sid, (vid, evidence) in sorted(matches.items()):
            writer.writerow((sid, vid, evidence))
    print(json.dumps({
        "vega_players_with_evidence": len(players),
        "source_players": len(names),
        "qualified_pairs": len(candidates),
        "ambiguous_pairs": ambiguous,
        "verified_external_links": len(verified),
        "matched_players": len(matches),
    }))


if __name__ == "__main__":
    main()
