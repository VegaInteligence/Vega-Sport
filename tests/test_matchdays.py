import gzip
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "dashboard/scripts/build_matchdays.py"
spec = importlib.util.spec_from_file_location("build_matchdays", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MatchdayExtractionTest(unittest.TestCase):
    def test_uses_latest_exact_document_and_rejects_wrong_league_or_season(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def write(path, value):
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                body = json.dumps(value).encode()
                target.write_bytes(gzip.compress(body) if path.endswith(".gz") else body)

            league = "l_3FJFUl"
            fixtures = [
                {"id": "m_good01", "season": "2026/2027"},
                {"id": "m_wrong1", "season": "2026/2027"},
                {"id": "m_wrong2", "season": "2026/2027"},
                {"id": "m_missing", "season": "2026/2027"},
            ]
            write("raw/index.json", {"seasons": [{"id": "2026/2027", "chunks": [
                {"leagueId": league, "tables": {"fixtures": {"path": "raw/fixtures.json.gz"}}}
            ]}]})
            write("raw/fixtures.json.gz", fixtures)
            write("raw/match-observations.json", {
                f["id"]: [{"shard": "s", "ordinal": i}] for i, f in enumerate(fixtures)
            })
            write("raw/observation-shards.json", {"s": {
                "document": {"path": "raw/documents.json.gz"},
                "tables": {"match": {"path": "raw/matches.json.gz"}}
            }})
            write("raw/documents.json.gz", [{"id": str(i), "metadata": {"competition_id": league}} for i in range(4)])
            def detail(mid, lid, season, name):
                return {"id": mid, "league": {"id": lid}, "season": season, "round_name": name, "has_playoff": False}
            write("raw/matches.json.gz", [
                {"documentId": "0", "response": {"status": 200, "data": detail("m_good01", league, "2026/2027", "9")}},
                {"documentId": "1", "response": {"status": 200, "data": detail("m_wrong1", "l_wrong0", "2026/2027", "9")}},
                {"documentId": "2", "response": {"status": 200, "data": detail("m_wrong2", league, "2025/2026", "9")}},
                {"documentId": "3", "response": {"status": 200, "data": detail("m_missing", league, "2026/2027", None)}},
            ])
            self.assertEqual(module.build_matchdays(root), {"2026/2027": 1})
            actual = module.read(root / "computed/matchdays/2026-2027.json.gz")
            self.assertEqual(actual[league], {"m_good01": {"name": "9", "playoff": False}})


if __name__ == "__main__":
    unittest.main()
