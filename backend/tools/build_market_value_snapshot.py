"""Project dated EUR valuations from the snapshot through 6 July 2026.

Usage: python backend/tools/build_market_value_snapshot.py player_valuations.csv OUTPUT.csv.gz
Identical observations collapse; a player/date with differing amounts is omitted.
"""

import argparse
import csv
from datetime import date
import gzip
import io
from pathlib import Path


AS_OF = date(2026, 7, 6)


def build(source, output):
    observations = {}
    with source.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            player = row["player_id"].strip()
            amount = row["market_value_in_eur"].strip()
            try:
                valued = date.fromisoformat(row["date"].strip())
            except ValueError:
                continue
            if not player.isdigit() or not amount.isdigit() or valued > AS_OF:
                continue
            observations.setdefault((player, valued), set()).add(int(amount))

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as zipped:
        with io.TextIOWrapper(zipped, encoding="utf-8", newline="") as text:
            writer = csv.writer(text, lineterminator="\n")
            writer.writerow(("source_player_id", "valued_at", "value_eur"))
            for (player, valued), amounts in sorted(observations.items(), key=lambda x: (int(x[0][0]), x[0][1])):
                if len(amounts) == 1:
                    writer.writerow((player, valued.isoformat(), next(iter(amounts))))
    print(f"Discarded {sum(len(values) > 1 for values in observations.values())} conflicting player/date keys")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.source, args.output)
