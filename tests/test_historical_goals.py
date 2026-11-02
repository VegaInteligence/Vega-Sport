"""Verify source deduplication, uncertainty and calendar-season mapping."""
import csv, gzip, hashlib, io, json, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard/scripts"))
import build_historical_goals as builder

class HistoricalGoalTests(unittest.TestCase):
    def test_deduplicates_exact_events_and_preserves_calendar_and_disagreement(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source"
            output = Path(directory) / "output"
            source.mkdir()
            fields = ["scoring_player", "scoring_team", "time", "GH", "GA", "game", "date", "season"]
            def record(player, score, game, season="NA"):
                return dict(zip(fields, [player, "A", "12", str(score), "0", game, "2020-08-01", season]))
            rows = [record("Ada", 1, "A vs. B 1:0"), record("Ada", 1, "A vs. B 1:0"), record("Bob", 1, "C vs. D 2:0")]
            stream = io.StringIO(newline="")
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
            raw = stream.getvalue().encode()
            (source / "nor-eliteserien.csv.gz").write_bytes(gzip.compress(raw, mtime=0))
            (source / "manifest.json").write_text(json.dumps({"repository": "https://example.org", "revision": "abc", "files": [{"name": "nor-eliteserien.csv", "sha256": hashlib.sha256(raw).hexdigest()}]}), encoding="utf-8")
            index = builder.build(source, output)
            self.assertEqual((index["duplicatesRemoved"], index["unassignedEvents"]), (1, 0))
            self.assertEqual((index["seasons"][0]["id"], index["seasons"][0]["events"]), ("2020/2021", 2))
            data = json.loads(gzip.decompress((output / "2020-2021.json.gz").read_bytes()))
            league = data["competitions"][0]
            self.assertEqual(league["calendarYear"], 2020)
            self.assertEqual(league["events"][0]["sourceSeason"], "NA")
            self.assertNotIn("scoreDisagreement", league["events"][0])
            self.assertTrue(league["events"][1]["scoreDisagreement"])
            checksum = index["seasons"][0]["sha256"]
            self.assertEqual(builder.build(source, output)["seasons"][0]["sha256"], checksum)

    def test_does_not_guess_unknown_non_calendar_seasons(self):
        row = {"season": "NA", "date": "2020-08-01"}
        self.assertEqual(builder.season_for(row, "bel-pro-league"), (None, False))
        self.assertEqual(builder.season_for(row, "nor-eliteserien"), ("2020/2021", True))
        self.assertEqual(builder.season_for({"season": "2020-2022", "date": "2020-08-01"}, "bundesliga"), (None, False))

if __name__ == "__main__":
    unittest.main()
