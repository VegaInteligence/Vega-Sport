"""Summarise the already metered RDS receipts. No network calls, database login or writes."""
import csv
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path

root = Path(__file__).resolve().parent
with gzip.open(root / "releve-21h-coverage-by-edition-and-entity.csv.gz", "rt") as src:
    grid = list(csv.DictReader(src))
players = {int(row["edition_id"]): row for row in grid if row["entity_type"] == "player"}

def read_receipts(kind, prefix):
    records = []
    for file in sorted((root / "preuves" / "score-pipeline" / (kind + "_verified")).glob(prefix + "-20*.json")):
        sample = json.loads(file.read_text())
        for row in sample["rows"]:
            records.append({"source_season": int(file.stem[-4:]), "sampled_at": sample["at"], **dict(zip(sample["columns"], row))})
    return records

def aggregate(records, group, fields):
    totals = defaultdict(Counter)
    for row in records:
        for field in fields:
            totals[group(row)][field] += int(row.get(field) or 0)
    return dict(sorted(totals.items()))

pending = read_receipts("pending", "player-pending")
grades = read_receipts("grades", "player-scores")
pfields = ("pending_inputs", "definitely_assignable_role", "with_role_and_measured_touches", "need_role_history", "no_published_award", "stats_newer_than_run", "role_before_published_run")
gfields = ("algorithm_inputs_before_coverage", "admitted_without_power_match", "insufficient_contribution", "insufficient_role_reference", "scorable_valid_persisted")
for group, records, fields in [("pending", pending, pfields), ("grades", grades, gfields)]:
    print(group, fields)
    for season, data in aggregate(records, lambda row: row["source_season"], fields).items():
        print(season, *(data[f] for f in fields))
print("recent raw inputs by competition")
for row in sorted(pending, key=lambda x: -x["with_role_and_measured_touches"])[:12]:
    print(row["source_season"], row["edition_id"], players[row["edition_id"]]["country_code"], players[row["edition_id"]]["competition"], row["with_role_and_measured_touches"], row["last_published_run"])
print("unresolved role history")
for row in sorted(pending, key=lambda x: -x["need_role_history"])[:6]:
    print(row["source_season"], row["edition_id"], players[row["edition_id"]]["country_code"], players[row["edition_id"]]["competition"], row["need_role_history"])
def domain(row):
    if row["archive_key"]:
        return "historical archive"
    if row["cup_key"]:
        family = row["cup_key"].split(":")[1]
        return "supplementary nations" if family in {"nations-league","euro","world-cup-history","afcon","copa-america","asian-cup","gold-cup"} else "supplementary clubs"
    return "native national" if row["competition_kind"] == "international" else "native club"
dfields = ("recorded_matches", "finished", "known_participations_minimum", "positive_minutes", "actual_valid", "known_participants_without_stats", "known_participants_without_measured_minutes")
print("player universe", dfields)
for k,data in aggregate(players.values(),domain,dfields).items():print(k,*(data[f] for f in dfields))
print("team Elo", aggregate((r for r in grid if r["entity_type"] != "player"),lambda x:x["entity_type"],("expected_proven","actual_valid","archive_policy_excluded")))
