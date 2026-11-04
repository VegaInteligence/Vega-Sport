import gzip
import io
import json
import sqlite3
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard/scripts"))
from sql_document_parser import iter_documents


class SqlDocumentParserTest(unittest.TestCase):
    def test_json_preserves_exact_number_and_array(self):
        body = b'{"value":0.123456789012345678901,"items":[1,2]}'
        rows = list(iter_documents("raw/x.json.gz", gzip.compress(body)))
        self.assertEqual(rows, [("raw/x.json.gz", "json", body.decode(), None)])

    def test_csv_preserves_headers_and_quoted_values(self):
        rows = list(iter_documents("data/results.csv", b'name,score\n"A,B",2\n'))
        self.assertEqual(json.loads(rows[0][2]), {"headers": ["name", "score"], "rows": [["A,B", "2"]]})
        compressed = list(iter_documents("data/results.csv.gz", gzip.compress(b'name,score\nCaen,1\n')))
        self.assertEqual(json.loads(compressed[0][2])["rows"], [["Caen", "1"]])

    def test_jsonl_and_archive_members_get_distinct_paths(self):
        lines = list(iter_documents("backup/manifest.jsonl.gz", gzip.compress(b'{"n":1}\n{"n":2}\n')))
        self.assertEqual([row[0] for row in lines], ["backup/manifest.jsonl.gz!line/1", "backup/manifest.jsonl.gz!line/2"])
        self.assertEqual(len(list(iter_documents("backup/manifest.jsonl", b'{"n":1}\n{"n":2}\n'))), 2)
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
            body = b'{"club":"Caen"}'
            member = tarfile.TarInfo("clubs/a.json")
            member.size = len(body)
            archive.addfile(member, io.BytesIO(body))
        self.assertEqual(list(iter_documents("sources/a.tar.gz", buffer.getvalue()))[0][0], "sources/a.tar.gz!/clubs/a.json")

    def test_invalid_json_and_binary_are_not_silently_treated_as_data(self):
        invalid = list(iter_documents("raw/bad.json", b'{"x":NaN}'))
        self.assertIsNone(invalid[0][2])
        self.assertTrue(invalid[0][3])
        self.assertEqual(list(iter_documents("raw/logo.png", b"image")), [])

    def test_sqlite_rows_are_queryable_documents(self):
        with tempfile.NamedTemporaryFile(suffix=".sqlite") as file:
            db = sqlite3.connect(file.name)
            db.execute("create table teams(name text, data blob)")
            db.execute("insert into teams values(?,?)", ("Caen", b"abc"))
            db.commit()
            db.close()
            payload = Path(file.name).read_bytes()
        rows = list(iter_documents("backup/queue.sqlite", payload))
        self.assertEqual(rows[0][0], "backup/queue.sqlite!sqlite/teams/1")
        self.assertEqual(json.loads(rows[0][2]), {"name": "Caen", "data": {"base64": "YWJj"}})


if __name__ == "__main__":
    unittest.main()
