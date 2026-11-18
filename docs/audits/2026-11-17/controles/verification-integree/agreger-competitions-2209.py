"""Roll up a single observed edition grid; verify the published scoring denominators."""
import argparse
import csv
from collections import Counter
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("edition_csv", type=Path)
parser.add_argument("output_csv", type=Path)
args = parser.parse_args()
keys = ("competition_id", "entity_type", "competition")
measures = ("recorded_matches", "finished", "expected_algorithm", "actual_valid", "missing_from_storage", "role_unavailable")
sums = {}
seen = set()
with args.edition_csv.open(newline="") as stream:
    for row in csv.DictReader(stream):
        identity = (row["edition_id"], row["entity_type"])
        assert identity not in seen
        seen.add(identity)
        key = tuple(row[k] for k in keys)
        counts = sums.setdefault(key, Counter())
        counts["editions"] += 1
        assert int(row["expected_algorithm"]) == int(row["actual_valid"]) + int(row["missing_from_storage"])
        for field in measures:
            if row[field] != "":
                counts[field] += int(row[field])
assert len(seen) == 6447 and len(sums) == 624
actual = Counter()
for (_, kind, _), counts in sums.items():
    actual[kind] += counts["actual_valid"]
assert sorted(actual.values()) == [3252, 161934, 2282608], actual
with args.output_csv.open("w", newline="") as stream:
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow((*keys, "editions", *measures))
    for key, counts in sorted(sums.items(), key=lambda item: (int(item[0][0]), item[0][1], item[0][2])):
        writer.writerow((*key, counts["editions"], *(counts.get(field, "") for field in measures)))
print(len(sums), dict(actual))
