import base64
import hashlib
import io
import json
import os
import sys
import tarfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard/scripts"))
import psycopg
from neon_store import Store


class MemoryStorage:
    def __init__(self):
        self.objects = {}

    def put_object(self, Bucket, Key, Body, ContentMD5, **kwargs):
        assert base64.b64decode(ContentMD5) == hashlib.md5(Body).digest()
        self.objects[Key] = Body
        return {"ETag": '"' + hashlib.md5(Body).hexdigest() + '"'}

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(self.objects[Key])}


@unittest.skipUnless(os.environ.get("STATARENA_RDS_TEST") == "1", "requires the isolated AWS migration database")
class SqlDocumentRdsIntegrationTest(unittest.TestCase):
    def test_file_update_and_sql_document_change_together(self):
        credentials = json.loads(Path(os.environ["STATARENA_RDS_TEST_CREDENTIAL_FILE"]).read_text())
        db = psycopg.connect(host=os.environ["STATARENA_RDS_TEST_HOST"], dbname=os.environ["STATARENA_RDS_TEST_DATABASE"],
                             user="statarena_ingest", password=credentials["statarena_ingest"], autocommit=True,
                             sslmode="verify-full", sslrootcert=os.environ["STATARENA_RDS_TEST_CA"])
        store = Store.__new__(Store)
        store.db, store.s3, store.bucket, store.external, store.sql_documents = db, MemoryStorage(), "test", True, True
        path = "raw/testing/sql-" + uuid.uuid4().hex + ".json"
        class Rollback(Exception):
            pass
        try:
            with self.assertRaises(Rollback):
                with db.transaction():
                    store.put(path, b'{"team":"Caen","version":1}', hot=True)
                    first = db.execute("select document->>'team',document->>'version' from statarena.current_file_documents where document_path=%s", (path,)).fetchone()
                    self.assertEqual(first, ("Caen", "1"))
                    store.put(path, b'{"team":"Caen","version":2}', hot=True)
                    second = db.execute("select document->>'version' from statarena.current_file_documents where document_path=%s", (path,)).fetchone()
                    self.assertEqual(second, ("2",))
                    archive_buffer = io.BytesIO()
                    with tarfile.open(fileobj=archive_buffer, mode="w:gz") as archive:
                        payload = b'{"club":"Caen"}'
                        item = tarfile.TarInfo("clubs/a.json")
                        item.size = len(payload)
                        archive.addfile(item, io.BytesIO(payload))
                    archive_path = path + ".tar.gz"
                    store.put(archive_path, archive_buffer.getvalue())
                    archived = db.execute("select document->>'club' from statarena.current_file_documents where source_path=%s", (archive_path,)).fetchone()
                    self.assertEqual(archived, ("Caen",))
                    csv_path = path + ".csv"
                    store.put(csv_path, b'team,score\nCaen,2\n')
                    csv_value = db.execute("select document->'rows'->0->>0 from statarena.current_file_documents where source_path=%s", (csv_path,)).fetchone()
                    self.assertEqual(csv_value, ("Caen",))
                    clean_lines_path = path + ".clean.jsonl"
                    store.put(clean_lines_path, b'{"team":"Caen"}\n{"team":"Bristol"}\n')
                    clean_names = db.execute("select document->>'team' from statarena.current_file_documents where source_path=%s order by document_path", (clean_lines_path,)).fetchall()
                    self.assertEqual(clean_names, [("Caen",), ("Bristol",)])
                    lines_path = path + ".jsonl"
                    other_path = path + ".txt"
                    store.put(other_path, b"other file")
                    other_sha = hashlib.sha256(b"other file").digest()
                    db.execute("""insert into statarena.file_documents
                        (document_path,source_path,source_sha256,format,document,error)
                        values(%s,%s,%s,'json',%s::jsonb,null)""",
                        (lines_path + "!line/1", other_path, other_sha, '{"old":true}'))
                    # The first line collides with another virtual path. COPY
                    # rolls back to a savepoint and the upsert fallback handles it.
                    store.put(lines_path, b'{"team":"Caen"}\n{"team":"Bristol"}\n')
                    names = db.execute("select document->>'team' from statarena.current_file_documents where source_path=%s order by document_path", (lines_path,)).fetchall()
                    self.assertEqual(names, [("Caen",), ("Bristol",)])
                    raise Rollback()
            self.assertIsNone(db.execute("select 1 from statarena.objects where path=%s", (path,)).fetchone())
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
