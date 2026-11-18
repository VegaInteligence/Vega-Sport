#!/usr/bin/env python3
"""Read-only Fjelstul comparison with the fixed Vega RDS export and archived FIFA match sheets."""
import argparse
from collections import Counter, defaultdict
from contextlib import ExitStack
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import unicodedata
from urllib.request import urlopen

COMMIT = "35a8667f518b07469182ae16d35574dd0e7a00fb"
BASE = f"https://raw.githubusercontent.com/jfjelstul/worldcup/{COMMIT}/"
HERE = Path(__file__).resolve().parent
YEARS = set(range(1970, 2019, 4))
TOURNEYS = {f"WC-{y}": y for y in YEARS}
TABLES = ("matches", "player_appearances", "substitutions", "goals", "bookings", "squads")
UPSTREAM = [f"data-csv/{name}.csv" for name in TABLES] + [
    "README.md", "DESCRIPTION", "codebook/csv/datasets.csv", "codebook/csv/variables.csv",
]
EVIDENCE = {
    "rds_fixtures": "db/worldcup_editions_nov18_verified/fixtures.json",
    "rds_query": "db/worldcup_editions_nov18_verified/fixtures.sql",
    "rds_receipt": "db/worldcup_editions_nov18_verified/receipt.json",
    "fifa_matches": "tracks/2-ingestion/world-cup-calendar/matches.csv",
    "vega_player_coverage": "tracks/2-ingestion/world-cup-calendar/official-participations-by-edition.csv",
}
TEAM_ALIASES = {
    "Bosnia-Herzegovina": "Bosnia and Herzegovina",
    "China PR": "China",
    "Côte d'Ivoire": "Ivory Coast",
    "Czechia": "Czech Republic",
    "German DR": "East Germany",
    "Germany FR": "West Germany",
    "IR Iran": "Iran",
    "Ireland": "Republic of Ireland",
    "Korea DPR": "North Korea",
    "Korea Republic": "South Korea",
    "USA": "United States",
}
TARGET_FIELDS = (
    "minutes_played", "touches", "npxg", "xa", "shots_on_target",
    "passes_into_final_third", "accurate_passes", "accurate_passes_total",
    "duels_won", "duels_attempted", "aerials_won", "aerials_total",
    "tackles", "interceptions", "recoveries", "goals_prevented",
)
FIFA_CAPTURES = "tracks/2-ingestion/world-cup-calendar/lineups"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def norm(s):
    stripped = unicodedata.normalize("NFKD", s.casefold())
    return "".join(c for c in stripped if c.isalnum())


def team(s):
    return norm(TEAM_ALIASES.get(s, s))


def fixture_key(year, day, h, a):
    return year, day, tuple(sorted((team(h), team(a))))


def records(data):
    return list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"))))


def years(rows):
    return [r for r in rows if r["tournament_id"] in TOURNEYS and "Men's" in r["tournament_name"]]


def grouped(rows, key):
    out = defaultdict(list)
    for row in rows:
        out[key(row)].append(row)
    return out


def write_csv(path, rows, keys=None):
    keys = keys or list(dict.fromkeys(key for row in rows for key in row))
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=keys, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def load_inputs(source_dir, archives):
    source, archived = {}, {}
    for rel in UPSTREAM:
        if source_dir is None:
            with urlopen(BASE + rel, timeout=30) as response:
                data = response.read()
        else:
            path = source_dir / rel
            if not path.exists():
                path = source_dir / rel.replace("/", "__")
            data = path.read_bytes()
        source[rel] = data
    for label, rel in EVIDENCE.items():
        archived[label] = (archives / rel).read_bytes()
    source_fingerprints = {rel: {"source_url": BASE + rel, "sha256": sha(data), "bytes": len(data)}
                           for rel, data in source.items()}
    archive_fingerprints = {rel: {"sha256": sha(archived[label]), "bytes": len(archived[label])}
                            for label, rel in EVIDENCE.items()}
    return source, archived, source_fingerprints, archive_fingerprints


def load_fifa(root, row):
    fifa_id = row["fifa_id"]
    folder = root / FIFA_CAPTURES
    raw = gzip.decompress((folder / f"{fifa_id}.json.gz").read_bytes())
    receipt = json.loads((folder / f"{fifa_id}.meta.json").read_bytes())
    checksum = sha(raw)
    assert receipt["status"] == 200 and checksum == receipt["sha256"] and len(raw) == receipt["size"]
    data = json.loads(raw)
    assert (data["IdCompetition"], data["IdMatch"], data["IdSeason"]) == ("17", fifa_id, row["season_id"])
    return data, checksum


def fifa_side(side, totals):
    players = [p for p in (side.get("Players") or []) if p.get("IdPlayer") and p.get("IdTeam") == side["IdTeam"]]
    changes = [p for p in (side.get("Substitutions") or []) if p.get("IdTeam") == side["IdTeam"]]
    starters = {p["IdPlayer"] for p in players if p["Status"] == 1}
    arrivals = {p["IdPlayerOn"] for p in changes if p.get("IdPlayerOn")}
    departures = {p["IdPlayerOff"] for p in changes if p.get("IdPlayerOff")}
    participants = starters | arrivals | departures
    listed_jerseys = grouped(players, lambda p: str(p.get("ShirtNumber", "")))
    by_identity = Counter(p["IdPlayer"] for p in players)
    totals["fifa_shirt_collision_keys"] += sum(len(roster) > 1 for roster in listed_jerseys.values())
    totals["fifa_match_side_player_collision_keys"] += sum(n > 1 for n in by_identity.values())
    totals["fifa_playing"] += len(participants)
    totals["fifa_starters"] += len(starters)
    totals["fifa_entrants"] += len(arrivals - starters)
    totals["fifa_departure_without_other_cue"] += len(departures - (starters | arrivals))
    totals["fifa_player_bookings"] += sum(bool(b.get("IdPlayer")) for b in side.get("Bookings") or [])
    totals["fifa_non_shootout_goals"] += sum(g.get("Period") != 11 for g in side.get("Goals") or [])
    return listed_jerseys, participants, starters, arrivals


def analyse(source, archives, evidence_root):
    tables = {name: years(records(source[f"data-csv/{name}.csv"])) for name in TABLES}
    for name, rows in tables.items():
        all_keys = [r["key_id"] for r in rows]
        assert len(all_keys) == len(set(all_keys)), f"Clé source répétée dans {name}"
    match_ids = {r["match_id"] for r in tables["matches"]}
    assert len(match_ids) == len(tables["matches"])
    assert all(r["match_id"] in match_ids for name in TABLES[1:-1] for r in tables[name])

    rds_data = json.loads(archives["rds_fixtures"])
    rds = [dict(zip(rds_data["columns"], row, strict=True)) for row in rds_data["rows"]
           if int(row[0].split(":")[-1]) in YEARS]
    rds_index = grouped(rds, lambda r: fixture_key(int(r["cup_key"].split(":")[-1]), r["match_date"],
                                                    r["home_team_name"], r["away_team_name"]))
    fifa_rows = [r for r in records(archives["fifa_matches"]) if int(r["year"]) in YEARS]
    fifa_index = defaultdict(list)
    for r in fifa_rows:
        for day in set((r["local_day"], r["utc_day"])):
            fifa_index[fixture_key(int(r["year"]), day, r["fifa_home"], r["fifa_away"])].append(r)
    by_match = {name: grouped(tables[name], lambda r: r["match_id"]) for name in TABLES[1:-1]}
    squads = {(r["tournament_id"], r["team_id"], r["player_id"]): r["position_code"] for r in tables["squads"]}
    assert len(squads) == len(tables["squads"])
    vega = {int(r["year"]): r for r in records(archives["vega_player_coverage"]) if int(r["year"]) in YEARS}

    findings, sheet_hashes, used_rds, scope_aliases = [], {}, set(), set()
    counts = {year: Counter() for year in sorted(YEARS)}
    for match in tables["matches"]:
        ident, tourney = match["match_id"], match["tournament_id"]
        year = TOURNEYS[tourney]
        c = counts[year]
        c["fjel_matches"] += 1
        h, a = match["home_team_name"], match["away_team_name"]
        key = fixture_key(year, match["match_date"], h, a)
        rds_matches, fifa_matches = rds_index[key], fifa_index[key]
        c["rds_key_collision_matches"] += len(rds_matches) > 1
        c["fifa_key_collision_matches"] += len(fifa_matches) > 1
        c["rds_no_direct_match"] += not rds_matches
        c["fifa_no_direct_match"] += not fifa_matches
        if len(rds_matches) != 1 or len(fifa_matches) != 1:
            findings.append(dict(year=year, match_id=ident, kind="fixture_join", rds=len(rds_matches), fifa=len(fifa_matches)))
            continue

        old, fifa = rds_matches[0], fifa_matches[0]
        assert old["public_match"] == fifa["public_match"] and str(old["id"]) == fifa["candidate_id"]
        c["rds_unique_pairs"] += 1
        c["rds_reused_fixture"] += old["id"] in used_rds
        used_rds.add(old["id"])
        c["rds_finished_in_snapshot"] += old["status"] == "finished"
        c["rds_reversed_orientation"] += team(h) != team(old["home_team_name"])
        c["fifa_reversed_orientation"] += team(h) != team(fifa["fifa_home"])
        if team(h) == team(fifa["fifa_home"]):
            score_home, score_away = "home_team_score", "away_team_score"
        else:
            score_home, score_away = "away_team_score", "home_team_score"
        score = f"{match[score_home]}-{match[score_away]}"
        c["fifa_final_score_equal"] += score == fifa["official_final"]
        if score != fifa["official_final"]:
            findings.append(dict(year=year, match_id=ident, fifa_match=fifa["fifa_id"], kind="final_score",
                                 fjel=score, fifa=fifa["official_final"]))

        def note(kind, nation="", shirt="", *, fjel="", official="", extra=""):
            findings.append(dict(year=year, match_id=ident, fifa_match=fifa["fifa_id"], vega_match=old["public_match"],
                                 kind=kind, team=nation, shirt=shirt, fjel=fjel, fifa=official, detail=extra))

        for label, labels in (
            ("Fjelstul", (h, a)), ("RDS", (old["home_team_name"], old["away_team_name"])),
            ("FIFA", (fifa["fifa_home"], fifa["fifa_away"])),
        ):
            for name in labels:
                if name in TEAM_ALIASES:
                    scope_aliases.add((year, label, name, TEAM_ALIASES[name]))

        sheet, checksum = load_fifa(evidence_root, fifa)
        fifa_id = fifa["fifa_id"]
        assert fifa_id not in sheet_hashes
        sheet_hashes[fifa_id] = checksum
        people = by_match["player_appearances"][ident]
        substitutions = by_match["substitutions"][ident]
        booked, goals = by_match["bookings"][ident], by_match["goals"][ident]
        c["fjel_starters"] += sum(r["starter"] == "1" for r in people)
        c["fjel_entrants"] += sum(r["substitute"] == "1" for r in people)
        c["fjel_participations"] += len(people)
        c["fjel_invalid_role_flags"] += sum({r["starter"], r["substitute"]} != {"0", "1"} for r in people)
        c["fjel_goals"] += len(goals)
        c["fjel_bookings"] += len(booked)
        c["fjel_substitutions"] += sum(r["coming_on"] == "1" for r in substitutions)
        assert {team(r["team_name"]) for r in people} == {team(h), team(a)}
        by_person = Counter(r["player_id"] for r in people)
        by_appearance = Counter((r["team_id"], r["player_id"]) for r in people)
        c["fjel_player_on_both_sides"] += sum(n > 1 and sum(k[1] == p for k in by_appearance) > 1 for p, n in by_person.items())
        c["fjel_appearance_collision_keys"] += sum(n > 1 for n in by_appearance.values())
        event_keys = Counter(r["substitution_id"] for r in substitutions)
        c["fjel_substitution_row_id_collision_keys"] += sum(n > 1 for n in event_keys.values())
        c["fjel_substitution_invalid_flags"] += sum({r["going_off"], r["coming_on"]} != {"0", "1"} for r in substitutions)
        # FIFA pairs incoming/outgoing in one row. Fjelstul gives the two movements separate IDs.
        # Count actors by minute bucket without inventing a pairing when changes are simultaneous.
        move_groups = grouped(substitutions, lambda r: (r["team_name"], r["minute_regulation"],
                                                        r["minute_stoppage"], r["match_period"]))
        c["fjel_substitution_minute_groups"] += len(move_groups)
        for (nation, regulation, added, period), lines in move_groups.items():
            entering = sum(r["coming_on"] == "1" for r in lines)
            leaving = sum(r["going_off"] == "1" for r in lines)
            c["fjel_substitution_minute_group_multiples"] += max(entering, leaving) > 1
            if entering != leaving:
                c["fjel_substitution_minute_group_imbalance"] += 1
                note("substitution_minute_group_imbalance", nation, fjel=f"{entering} on / {leaving} off",
                     extra=f"{regulation}+{added}, {period}")

        for field, side in (("fifa_home", "HomeTeam"), ("fifa_away", "AwayTeam")):
            nation = fifa[field]
            side_people = [r for r in people if team(r["team_name"]) == team(nation)]
            c["fjel_sides_with_11_starters"] += sum(r["starter"] == "1" for r in side_people) == 11
            side_subs = [r for r in substitutions if team(r["team_name"]) == team(nation)]
            entries = {r["player_id"] for r in side_subs if r["coming_on"] == "1"}
            shirts = Counter(r["shirt_number"] for r in side_people)
            c["fjel_shirt_collision_keys"] += sum(n > 1 for n in shirts.values())
            sheet_side = sheet[side]
            assert team(sheet_side["TeamName"][0]["Description"]) == team(nation)
            shown, participating, starting, entering = fifa_side(sheet_side, c)
            side_goals = sum(team(g["team_name"]) == team(nation) for g in goals)
            official_goals = sum(g.get("Period") != 11 for g in sheet_side.get("Goals") or [])
            c["fjel_fifa_equal_goal_counts_on_side"] += side_goals == official_goals
            side_bookings = sum(team(b["team_name"]) == team(nation) for b in booked)
            official_bookings = sum(bool(b.get("IdPlayer")) for b in sheet_side.get("Bookings") or [])
            c["fjel_more_bookings_on_side"] += side_bookings > official_bookings
            c["fjel_fewer_bookings_on_side"] += side_bookings < official_bookings
            c["fjel_equal_bookings_on_side"] += side_bookings == official_bookings
            known = set()
            for r in side_people:
                player, jersey = r["player_id"], r["shirt_number"]
                position = squads.get((tourney, r["team_id"], player))
                c["fjel_position_equals_squad"] += bool(position) and position == r["position_code"]
                c["fjel_specific_position"] += r["position_code"] not in {"GK", "DF", "MF", "FW", ""}
                c["fjel_position_with_squad_reference"] += bool(position)
                c["fjel_entrant_without_substitution"] += r["substitute"] == "1" and player not in entries
                recognised = shown[jersey]
                if len(recognised) != 1 or shirts[jersey] != 1:
                    c["ambiguous_or_missing_jersey"] += 1
                    note("jersey_unresolved", nation, jersey, fjel=player, extra=f"FIFA={len(recognised)}")
                    continue
                q = recognised[0]
                qid = q["IdPlayer"]
                known.add(qid)
                fq = norm((q.get("PlayerName") or [{}])[0].get("Description", ""))
                given, family = r["given_name"], r["family_name"]
                exact_name = fq in {norm(given + family), norm(family + given)} and bool(fq)
                c["unique_jersey_links"] += 1
                c["exact_normalised_names"] += exact_name
                c["name_variants_on_linked_jerseys"] += not exact_name
                has_coordinates = q.get("LineupX") is not None and q.get("LineupY") is not None
                c["fifa_coordinates_present_on_linked_jerseys"] += has_coordinates
                c["fjel_specific_position_when_no_fifa_coordinates"] += (
                    not has_coordinates and r["position_code"] not in {"GK", "DF", "MF", "FW", ""}
                )
                if qid in participating:
                    c["fjel_also_playing_fifa"] += 1
                    c["fjel_also_playing_fifa_exact_name"] += exact_name
                else:
                    c["fjel_playing_fifa_bench"] += 1
                    c["fjel_playing_fifa_bench_fjel_event"] += player in entries
                    note("fjel_playing_fifa_bench", nation, jersey, fjel=player, official=qid,
                         extra=f"nom_exact={int(exact_name)},entrée_événement={int(player in entries)}")
                if (qid in starting) != (r["starter"] == "1") or (qid in entering) != (r["substitute"] == "1"):
                    c["fjel_fifa_role_disagreements"] += 1
                    if qid in participating:
                        note("different_playing_role", nation, jersey, fjel=player, official=qid,
                             extra=f"nom_exact={int(exact_name)},titulaire_fjel={r['starter']},titulaire_fifa={int(qid in starting)}")
            unmatched_events = entries - {r["player_id"] for r in side_people if r["substitute"] == "1"}
            c["fjel_substitution_entrant_not_marked_entrant"] += len(unmatched_events)
            for player in sorted(unmatched_events):
                note("fjel_substitution_without_entrant_flag", nation, fjel=player,
                     extra="déjà titulaire" if any(r["player_id"] == player for r in side_people) else "sans ligne apparition")
            for player in sorted(participating - known):
                c["fifa_playing_not_in_fjel"] += 1
                jersey = next((j for j, roster in shown.items() if any(p["IdPlayer"] == player for p in roster)), "")
                note("fifa_playing_not_in_fjel", nation, jersey, official=player)

    columns_by_table = {name: list(records(source[f"data-csv/{name}.csv"])[0]) for name in TABLES}
    coverage = []
    for year, c in counts.items():
        vr = vega.get(year, {})
        c["vega_known_participations_on_archived_copy"] = int(vr["vega_secondary_known_participations"])
        c["vega_grades_on_archived_copy"] = int(vr["vega_secondary_grades"])
        c["rds_fixtures_in_year"] = sum(int(r["cup_key"].split(":")[-1]) == year for r in rds)
        c["match_sides"] = 2 * c["fjel_matches"]
        c["direct_vega_scoring_rows_from_fjel"] = 0
        coverage.append(dict(year=year, **c))
    audit = {
        "fifa_sheet_count": len(sheet_hashes),
        "fifa_sheet_sha256_index": sha("".join(f"{k} {v}\n" for k, v in sorted(sheet_hashes.items())).encode()),
        "fifa_sheet_index_rule": "SHA-256 des lignes '<FIFA id> <SHA-256 JSON brut>\\n' triées par identifiant",
        "missing_model_columns": sorted(set(TARGET_FIELDS) - set().union(*map(set, columns_by_table.values()))),
        "upstream_table_columns": columns_by_table,
        "totals": {k: sum(c[k] for c in counts.values()) for k in sorted({k for c in counts.values() for k in c})},
    }
    return coverage, findings, sorted(scope_aliases), audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-root", type=Path, required=True, help="Racine de production-architecture-review")
    parser.add_argument("--output", type=Path, required=True, help="Dossier jetable pour les sorties calculées")
    parser.add_argument("--source-dir", type=Path, help="Copie locale des CSV figés. Sinon téléchargement du SHA immuable")
    parser.add_argument("--manifest", type=Path, default=HERE / "manifeste.json")
    parser.add_argument("--record-inputs", action="store_true", help="Première capture du manifeste, sans l'écraser")
    args = parser.parse_args()
    source, archived, sf, af = load_inputs(args.source_dir, args.evidence_root)
    assert "License: CC-BY-SA 4.0" in source["DESCRIPTION"].decode()
    assert "https://creativecommons.org/licenses/by-sa/4.0/legalcode" in source["README.md"].decode()
    coverage, findings, aliases, audit = analyse(source, archived, args.evidence_root)
    manifest = {"commit": COMMIT, "licence": "CC BY-SA 4.0", "copyright": "© 2023 Joshua C. Fjelstul, Ph.D.",
                "license_declared_in": ["README.md", "DESCRIPTION"], "license_url": "https://creativecommons.org/licenses/by-sa/4.0/legalcode",
                "source_manifest": sf, "archive_manifest": af, "fifa_sheets": audit["fifa_sheet_count"],
                "fifa_sheets_sha256_index": audit["fifa_sheet_sha256_index"]}
    if args.record_inputs:
        with args.manifest.open("x", encoding="utf-8") as f:
            f.write(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    else:
        expected = json.loads(args.manifest.read_bytes())
        assert manifest == expected, "Les empreintes des entrées ont changé."
    args.output.mkdir(parents=True, exist_ok=True)
    all_keys = list(dict.fromkeys(k for r in coverage for k in r))
    coverage = [{k: r.get(k, 0) for k in all_keys} for r in coverage]
    write_csv(args.output / "editions.csv", coverage)
    write_csv(args.output / "ecarts.csv", sorted(findings, key=lambda r: (r["year"], r["match_id"], r["kind"], r.get("shirt", ""))))
    write_csv(args.output / "alias-equipes.csv",
              [dict(year=y, source=provider, libelle=a, forme=b) for y, provider, a, b in aliases])
    (args.output / "controle.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print(json.dumps(audit["totals"], ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
