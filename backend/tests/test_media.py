"""Image copies (vega/media.py): recognition by bytes, keys, retries."""

from datetime import datetime, timedelta, timezone
import hashlib
import os
from pathlib import Path
import struct
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega.media import MediaError, mirror, sniff

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_MEDIA_TEST_DSN")
NOW = datetime(2026, 11, 9, 8, tzinfo=timezone.utc)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + struct.pack(">II", 120, 80) + b"\x08\x06\x00\x00\x00" + b"\x00" * 8
JPEG = (b"\xff\xd8\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00" + b"\x00" * 9
        + b"\xff\xc0" + struct.pack(">HBHH", 17, 8, 300, 200) + b"\x00" * 12)
WEBP = b"RIFF" + struct.pack("<I", 30) + b"WEBP" + b"VP8X" + struct.pack("<I", 10) + b"\x00" * 4 + (63).to_bytes(3, "little") + (31).to_bytes(3, "little") + b"\x00" * 4


class SniffTest(unittest.TestCase):
    def test_formats_by_their_bytes(self):
        self.assertEqual(sniff(PNG), ("png", 120, 80))
        self.assertEqual(sniff(JPEG), ("jpg", 200, 300))
        self.assertEqual(sniff(WEBP), ("webp", 64, 32))
        for body in (b"<html></html>", b"GIF89a" + b"\x00" * 20, b""):
            with self.assertRaises(MediaError):
                sniff(body)


@unittest.skipUnless(DSN and psycopg, "requires disposable local media DB and psycopg")
class MirrorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_media_test":
            raise RuntimeError("dedicated local media DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def test_copies_and_retries(self):
        x = self.db.execute
        x("""INSERT INTO core.assets(id, kind, source_url) VALUES
             (1, 'crest', 'https://cdn.pitchapi.dev/teams/1.png'),
             (2, 'photo', 'https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg'),
             (3, 'crest', 'https://evil.example/1.png'),
             (4, 'logo', 'https://cdn.pitchapi.dev/leagues/missing.png'),
             (5, 'logo', 'https://cdn.pitchapi.dev/leagues/page.png')""")
        bodies = {"https://cdn.pitchapi.dev/teams/1.png": PNG, "https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg": JPEG,
                  "https://cdn.pitchapi.dev/leagues/page.png": b"<html>"}
        fetched, stored = [], {}

        def get(url):
            fetched.append(url)
            if url not in bodies:
                raise MediaError("HTTP_404")
            return bodies[url]

        def put(key, body, content_type):
            stored[key] = (body, content_type)

        self.assertEqual(mirror(self.db, get, put, NOW), {"ok": 2, "HTTP_404": 1, "NOT_AN_IMAGE": 1})
        self.assertNotIn("https://evil.example/1.png", fetched)
        png_key = f"sources/v2/images/{hashlib.sha256(PNG).hexdigest()}.png"
        self.assertEqual(stored[png_key], (PNG, "image/png"))
        self.assertEqual(x("SELECT s3_key, content_type, width, height FROM core.assets WHERE id=1").fetchone(), (png_key, "image/png", 120, 80))
        self.assertEqual(x("SELECT width, height FROM core.assets WHERE id=2").fetchone(), (200, 300))
        self.assertEqual(x("SELECT count(*) FROM api.media_assets").fetchone()[0], 2)
        self.assertEqual(
            x("SELECT asset_id, attempts, next_attempt_at, error_code FROM ops.asset_mirror ORDER BY 1").fetchall(),
            [(4, 1, NOW + timedelta(hours=1), "HTTP_404"), (5, 1, NOW + timedelta(hours=1), "NOT_AN_IMAGE")],
        )
        # Not due yet: nothing is fetched again. Due: one more attempt, the delay doubles.
        fetched.clear()
        self.assertEqual(mirror(self.db, get, put, NOW + timedelta(minutes=30)), {})
        later = NOW + timedelta(hours=2)
        bodies["https://cdn.pitchapi.dev/leagues/missing.png"] = WEBP
        self.assertEqual(mirror(self.db, get, put, later), {"ok": 1, "NOT_AN_IMAGE": 1})
        self.assertEqual(x("SELECT attempts, next_attempt_at FROM ops.asset_mirror WHERE asset_id=5").fetchone(), (2, later + timedelta(hours=2)))
        self.assertIsNone(x("SELECT 1 FROM ops.asset_mirror WHERE asset_id=4").fetchone())


if __name__ == "__main__":
    unittest.main()
