"""The reviewed artwork pack and UEFA crests (VI-27 lot 2), written before the code: FAILURE_MODES.md §21.

A small pack in the real layout (manifest + originals/<sha256> + images/<sha256>) of generated raster
bytes; the real 613-record pack runs in the evidence E2E. The importer writes to a dict standing for
the content store. Disposable local PostgreSQL: VEGA_V2_ARTWORK_TEST_DSN (vega_v2_artwork_test).
"""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import unittest
from urllib.parse import urlparse
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_ARTWORK_TEST_DSN")
NOW = datetime(2026, 11, 17, 21, tzinfo=timezone.utc)
UEFA = "https://img.uefa.com/imgml/TP/teams/logos/70x70/64125.png"


def png(width=2, height=2, tone=0):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\x00" + bytes([tone, 0, 0, 255]) * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>'


def sha(body):
    return hashlib.sha256(body).hexdigest()


def record(entity_type, provider, key, name, country, display, origin=None, image_url=None, fmt="png", **extra):
    origin = origin if origin is not None else display
    return {
        "entity_type": entity_type, "canonical_id_at_snapshot": None, "canonical_name": name, "country_code": country,
        "resolve_using": {"provider": provider, "key": key}, "selection": "fill_only_if_still_missing",
        "image_url": image_url or f"https://publisher.example/{key}.{'svg' if origin != display else 'png'}",
        "bytes": len(origin), "sha256": sha(origin), "format": "svg" if origin != display else fmt,
        "source": "test publisher", "source_page": f"https://publisher.example/{key}", "reported_license": None,
        "reported_author": "Test Publisher", "origin_sha256": sha(origin), "display_sha256": sha(display), "display_format": fmt, **extra,
    }


def write_pack(root, records, files, corrupt=None):
    """The pack's layout: manifest.json, originals/<sha256>, images/<sha256>."""
    root = Path(root)
    (root / "originals").mkdir(parents=True, exist_ok=True)
    (root / "images").mkdir(exist_ok=True)
    for r in records:
        if r["origin_sha256"] in files:
            (root / "originals" / r["origin_sha256"]).write_bytes(files[r["origin_sha256"]])
        if r["display_sha256"] in files:
            (root / "images" / r["display_sha256"]).write_bytes(files[r["display_sha256"]])
    counts = {}
    for r in records:
        counts[r["entity_type"]] = counts.get(r["entity_type"], 0) + 1
    manifest = root / "manifest.json"
    manifest.write_bytes(json.dumps({"records": len(records), "counts": counts, "attribution": "test", "artwork": records}).encode())
    return manifest, sha(manifest.read_bytes())


@unittest.skipUnless(DSN and psycopg, "requires a disposable local artwork DB (VEGA_V2_ARTWORK_TEST_DSN) and psycopg")
class ArtworkTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_artwork_test":
            raise RuntimeError("dedicated local artwork DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        x = self.x = self.db.execute
        x("""TRUNCATE core.teams, core.competitions, core.competition_seasons, core.provider_ids, core.assets, core.ranking_editions,
             ops.resource_versions RESTART IDENTITY CASCADE""")
        x("INSERT INTO core.countries(code) VALUES ('BEL'), ('SCO'), ('WAL') ON CONFLICT DO NOTHING")
        own = x("INSERT INTO core.assets(kind, source_url) VALUES ('crest', 'https://cdn.pitchapi.dev/images/teams/kept.png') RETURNING id").fetchone()[0]
        x("""INSERT INTO core.teams(id, name, country_code, is_national, crest_asset_id) VALUES
             (1, 'Union SG', 'BEL', false, NULL), (2, 'Airdrieonians', 'SCO', false, NULL), (3, 'Kept FC', 'SCO', false, %s),
             (4, 'Wales', 'WAL', true, NULL), (5, 'Renamed Now', 'SCO', false, NULL), (6, 'No Ranking', 'BEL', false, NULL)""", (own,))
        x("SELECT setval(pg_get_serial_sequence('core.teams', 'id'), 100)")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
             ('team', 'uefa', '64125', 1), ('team', 'open_matchday', 'name:Airdrieonians', 2), ('team', 'open_matchday', 'name:Kept FC', 3),
             ('team', 'open_matchday', 'name:Wales', 4), ('team', 'open_matchday', 'name:Renamed', 5), ('team', 'uefa', '99999', 6)""")
        comp = x("INSERT INTO core.competitions(name, country_code) VALUES ('Cymru Premier', 'WAL') RETURNING id").fetchone()[0]
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition', 'vega', 'cup:open-matchday:WAL_1_cymru-premier', %s)", (comp,))
        from vega.store import Store

        season = Store(self.db).season("2026/2027")
        self.edition = x("INSERT INTO core.competition_seasons(competition_id, season_id, native_label) VALUES (%s, %s, '2026/2027') RETURNING id",
                         (comp, season)).fetchone()[0]
        edition = x("INSERT INTO core.ranking_editions(kind, provider, label, is_current) VALUES ('uefa_clubs', 'uefa', '2027', true) RETURNING id").fetchone()[0]
        logo = x("INSERT INTO core.assets(kind, source_url) VALUES ('logo', %s) RETURNING id", (UEFA,)).fetchone()[0]
        x("""INSERT INTO core.ranking_rows(edition_id, row_no, team_id, position, provider_key, entity_name, image_asset_id)
             VALUES (%s, 1, 1, 1, '64125', 'Union SG', %s)""", (edition, logo))
        self.files, displays = {}, [png(70, 70, 1), png(64, 32, 2), png(8, 8, 3), png(8, 8, 4), png(8, 8, 5), png(8, 8, 6), png(16, 16, 7)]
        for body in displays + [SVG]:
            self.files[sha(body)] = body
        self.records = [
            record("team", "uefa", "64125", "Union SG", "BEL", displays[0], image_url=UEFA),
            record("team", "open_matchday", "name:Airdrieonians", "Airdrieonians", "SCO", displays[1], origin=SVG),
            record("team", "open_matchday", "name:Kept FC", "Kept FC", "SCO", displays[2]),
            record("team", "open_matchday", "name:Wales", "Wales", "WAL", displays[3]),
            record("team", "open_matchday", "name:Renamed", "Renamed", "SCO", displays[4]),
            record("team", "open_matchday", "name:Nobody", "Nobody", "SCO", displays[5]),
            record("team", "uefa", "99999", "No Ranking", "BEL", displays[5]),
            record("competition", "vega", "cup:open-matchday:WAL_1_cymru-premier", "Cymru Premier", "WAL", displays[6], origin=SVG),
        ]
        self.pack = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.pack, True)
        self.store = {}

    def run_pack(self, records=None, files=None, apply=False, expected=None, put=None):
        from vega import artwork

        manifest, digest = write_pack(self.pack, records or self.records, files or self.files)
        put = put or (lambda key, body, kind: self.store.setdefault(key, (body, kind)) and False)
        return artwork.run(self.db, manifest, self.pack, expected or digest, apply=apply, put=put)

    def snapshot(self):
        return (self.x("SELECT id, crest_asset_id, updated_at FROM core.teams ORDER BY id").fetchall(),
                self.x("SELECT id, logo_asset_id FROM core.competitions ORDER BY id").fetchall(),
                self.x("SELECT id, kind::text, source_url, s3_key, sha256, author FROM core.assets ORDER BY id").fetchall(),
                self.x("SELECT resource_kind::text, resource_id, version FROM ops.resource_versions ORDER BY 1, 2").fetchall())

    def outcomes(self, report):
        return {(r["entity_type"], r["key"]): r["outcome"] for r in report["records"]}

    def test_21_plan_writes_nothing_and_codes_every_record(self):
        before = self.snapshot()
        report = self.run_pack()
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.store, {})
        self.assertEqual(self.outcomes(report), {
            ("team", "64125"): "linked", ("team", "name:Airdrieonians"): "linked", ("team", "name:Kept FC"): "kept_existing",
            ("team", "name:Wales"): "identity_drift", ("team", "name:Renamed"): "identity_drift", ("team", "name:Nobody"): "entity_not_found",
            ("team", "99999"): "proof_missing", ("competition", "cup:open-matchday:WAL_1_cymru-premier"): "linked",
        })
        self.assertEqual(sum(report["counts"].values()), len(self.records))
        self.assertFalse(report["applied"])

    def test_21abd_apply_links_once_with_its_provenance(self):
        report = self.run_pack(apply=True)
        self.assertEqual(report["counts"]["linked"], 3)
        uefa = self.x("SELECT a.source_url, a.s3_key, encode(a.sha256, 'hex'), a.width FROM core.teams t JOIN core.assets a ON a.id = t.crest_asset_id WHERE t.id = 1").fetchone()
        self.assertEqual(uefa, (UEFA, f"sources/v2/images/{self.records[0]['display_sha256']}.png", self.records[0]["display_sha256"], 70))
        club = self.x("""SELECT a.source_url, a.s3_key, a.source_page_url, a.author, a.content_type FROM core.teams t
                         JOIN core.assets a ON a.id = t.crest_asset_id WHERE t.id = 2""").fetchone()
        display = self.records[1]["display_sha256"]
        self.assertEqual(club, (f"https://media.vega.invalid/sha256/{display}.png", f"sources/v2/images/{display}.png",
                                "https://publisher.example/name:Airdrieonians", "Test Publisher", "image/png"))
        self.assertEqual(self.store[f"sources/v2/images/{display}.png"], (self.files[display], "image/png"))
        self.assertEqual(self.x("SELECT crest_asset_id IS NOT NULL FROM core.teams WHERE id = 3").fetchone()[0], True)
        versions = {(k, i) for k, i, _ in self.snapshot()[3]}
        self.assertTrue({("team", 1), ("team", 2), ("home", 1), ("competition_season", self.edition)} <= versions)
        self.assertNotIn(("team", 3), versions)
        settled = self.snapshot()
        again = self.run_pack(apply=True)
        self.assertEqual(self.snapshot(), settled)
        self.assertEqual(self.outcomes(again)[("team", "64125")], "already_linked")

    def test_21f_a_corrupt_pack_is_refused_before_any_write(self):
        from vega.artwork import ArtworkError

        before = self.snapshot()
        good = dict(self.files)
        cases = {
            "wrong hash": {**good, self.records[0]["display_sha256"]: png(70, 70, 9)},
            "short file": {**good, self.records[0]["display_sha256"]: good[self.records[0]["display_sha256"]][:20]},
        }
        for name, files in cases.items():
            with self.subTest(name), self.assertRaises(ArtworkError):
                self.run_pack(files=files, apply=True)
        svg_display = [dict(self.records[0], display_sha256=sha(SVG), display_format="png")]
        escape = [dict(self.records[0], display_sha256="../../" + self.records[0]["display_sha256"])]
        for name, records in (("svg as display", svg_display), ("path leaving the pack", escape)):
            with self.subTest(name), self.assertRaises(ArtworkError):
                self.run_pack(records=records, apply=True)
        with self.assertRaises(ArtworkError):
            self.run_pack(apply=True, expected="0" * 64)
        self.assertEqual((self.snapshot(), self.store), (before, {}))

    def test_21g_one_entity_bound_to_two_displays_is_a_conflict(self):
        twice = self.records + [dict(self.records[1], display_sha256=self.records[2]["display_sha256"])]
        report = self.run_pack(records=twice, apply=True)
        self.assertEqual([r["outcome"] for r in report["records"] if r["key"] == "name:Airdrieonians"], ["manifest_conflict"] * 2)
        self.assertIsNone(self.x("SELECT crest_asset_id FROM core.teams WHERE id = 2").fetchone()[0])

    def test_21h_an_asset_with_the_reference_and_other_bytes_is_a_conflict(self):
        display = self.records[1]["display_sha256"]
        self.x("INSERT INTO core.assets(kind, source_url, s3_key, sha256) VALUES ('crest', %s, 'sources/v2/images/x.png', %s)",
               (f"https://media.vega.invalid/sha256/{display}.png", hashlib.sha256(b"other").digest()))
        report = self.run_pack(apply=True)
        self.assertEqual(self.outcomes(report)[("team", "name:Airdrieonians")], "asset_conflict")
        self.assertIsNone(self.x("SELECT crest_asset_id FROM core.teams WHERE id = 2").fetchone()[0])

    def test_21i_a_failed_storage_write_links_nothing(self):
        from vega.media import MediaError

        def put(key, body, kind):
            raise MediaError("STORAGE_ERROR")

        report = self.run_pack(apply=True, put=put)
        # §22: the run stops at the first failed write; what follows is not attempted.
        self.assertEqual(self.outcomes(report)[("team", "64125")], "storage_failed")
        self.assertEqual(self.outcomes(report)[("team", "name:Airdrieonians")], "unattempted")
        self.assertFalse(report["complete"])
        self.assertIsNone(self.x("SELECT crest_asset_id FROM core.teams WHERE id = 2").fetchone()[0])

    def test_21j_a_crest_written_meanwhile_wins(self):
        def put(key, body, kind):
            # PitchAPI writes Airdrieonians' crest while the importer stores its file.
            if key.endswith(self.records[1]["display_sha256"] + ".png"):
                mine = self.x("INSERT INTO core.assets(kind, source_url) VALUES ('crest', 'https://cdn.pitchapi.dev/images/teams/new.png') RETURNING id").fetchone()[0]
                self.x("UPDATE core.teams SET crest_asset_id = %s WHERE id = 2 AND crest_asset_id IS NULL", (mine,))
            return True

        report = self.run_pack(apply=True, put=put)
        self.assertEqual(self.outcomes(report)[("team", "name:Airdrieonians")], "kept_existing")
        self.assertEqual(self.x("SELECT a.source_url FROM core.teams t JOIN core.assets a ON a.id = t.crest_asset_id WHERE t.id = 2").fetchone()[0],
                         "https://cdn.pitchapi.dev/images/teams/new.png")

    def test_21k_uefa_fills_an_empty_crest_from_its_own_logo_once(self):
        from vega.sources import uefa

        row = {"id": "64125", "name": "Union SG", "names": ["Union SG"], "country": "BEL", "position": 1, "points": 80.0,
               "earned": None, "still": None, "logo": UEFA, "seasons": []}
        other = dict(row, id="12345", name="Kept FC", names=["Kept FC"], country="SCO", logo="https://img.uefa.com/imgml/TP/teams/logos/70x70/12345.png")
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'uefa', '12345', 3)")
        kept = self.x("SELECT crest_asset_id FROM core.teams WHERE id = 3").fetchone()[0]
        with self.db.transaction():
            uefa.save(self.db, "uefa_clubs", 2027, [row, other], "2026-11-06T22:00:00Z", NOW)
        crest = self.x("SELECT a.source_url FROM core.teams t JOIN core.assets a ON a.id = t.crest_asset_id WHERE t.id = 1").fetchone()
        self.assertEqual(crest, (UEFA,))
        self.assertEqual(self.x("SELECT crest_asset_id FROM core.teams WHERE id = 3").fetchone()[0], kept)
        settled = self.x("SELECT version FROM ops.resource_versions WHERE resource_kind = 'team' AND resource_id = 1").fetchone()
        self.assertIsNotNone(settled)
        with self.db.transaction():
            uefa.save(self.db, "uefa_clubs", 2027, [row, other], "2026-11-06T22:00:00Z", NOW)
        self.assertEqual(self.x("SELECT version FROM ops.resource_versions WHERE resource_kind = 'team' AND resource_id = 1").fetchone(), settled)
        self.assertEqual(self.x("SELECT count(*) FROM core.assets WHERE source_url = %s", (UEFA,)).fetchone()[0], 1)


@unittest.skipUnless(DSN and psycopg, "requires a disposable local artwork DB (VEGA_V2_ARTWORK_TEST_DSN) and psycopg")
class ArtworkCorrectionsTest(ArtworkTest):
    """22v-22y (FAILURE_MODES.md §22, written before the code): one canonical entity, one display; publication
    conditional on the binding and the asset still being the reviewed ones after the upload; any storage error
    stops with a receipt; UEFA's crest goes to the canonical club of a merged alias."""

    def other(self):
        from vega.store import connect_local

        conn = connect_local(DSN)
        self.addCleanup(conn.close)
        return conn

    def crest(self, team):
        return self.x("SELECT crest_asset_id FROM core.teams WHERE id = %s", (team,)).fetchone()[0]

    def test_22v_one_canonical_club_two_displays_is_a_conflict_for_every_record(self):
        self.x("INSERT INTO core.teams(id, name, country_code, is_national, merged_into) VALUES (7, 'Union SG', 'BEL', false, 1)")
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'open_matchday', 'name:Union Alias', 7)")
        body = png(9, 9, 9)
        alias = record("team", "open_matchday", "name:Union Alias", "Union SG", "BEL", body)
        report = self.run_pack(records=[alias, self.records[0]], files={**self.files, sha(body): body}, apply=True)
        self.assertEqual(self.outcomes(report), {("team", "name:Union Alias"): "manifest_conflict", ("team", "64125"): "manifest_conflict"})
        self.assertIsNone(self.crest(1))
        # The same display under both bindings: the club's own binding links it, the alias is a duplicate.
        same = record("team", "open_matchday", "name:Union Alias", "Union SG", "BEL", self.files[self.records[0]["display_sha256"]])
        for order in ([same, self.records[0]], [self.records[0], same]):
            with self.subTest(first=order[0]["resolve_using"]["key"]):
                self.x("UPDATE core.teams SET crest_asset_id = NULL WHERE id = 1")
                report = self.run_pack(records=order, apply=False)
                self.assertEqual(self.outcomes(report), {("team", "name:Union Alias"): "duplicate", ("team", "64125"): "linked"})

    def test_22w_a_binding_moved_during_the_upload_links_nothing(self):
        other = self.other()
        moved = other.execute("INSERT INTO core.teams(name, country_code, is_national) VALUES ('Airdrieonians', 'SCO', false) RETURNING id").fetchone()[0]

        def put(key, body, kind):
            if key.endswith(self.records[1]["display_sha256"] + ".png"):
                other.execute("UPDATE core.provider_ids SET entity_id = %s WHERE provider = 'open_matchday' AND provider_key = 'name:Airdrieonians'", (moved,))
            self.store[key] = (body, kind)
            return True

        report = self.run_pack(apply=True, put=put)
        self.assertEqual(self.outcomes(report)[("team", "name:Airdrieonians")], "identity_drift")
        self.assertEqual((self.crest(2), self.crest(moved)), (None, None))

    def test_22w_b_an_asset_changed_during_the_upload_is_a_conflict(self):
        url = "https://cdn.pitchapi.dev/images/teams/asset-race.png"
        self.x("INSERT INTO core.assets(kind, source_url) VALUES ('crest', %s)", (url,))
        mine, theirs = png(5, 5, 1), png(5, 5, 2)
        race = record("team", "open_matchday", "name:Airdrieonians", "Airdrieonians", "SCO", mine, image_url=url)
        other = self.other()

        def put(key, body, kind):
            other.execute("UPDATE core.assets SET s3_key = 'sources/v2/images/theirs.png', sha256 = %s WHERE source_url = %s",
                          (hashlib.sha256(theirs).digest(), url))
            self.store[key] = (body, kind)
            return True

        report = self.run_pack(records=[race], files={sha(mine): mine}, apply=True, put=put)
        self.assertEqual(self.outcomes(report)[("team", "name:Airdrieonians")], "asset_conflict")
        self.assertIsNone(self.crest(2))
        self.assertEqual(self.x("SELECT encode(sha256, 'hex') FROM core.assets WHERE source_url = %s", (url,)).fetchone()[0], sha(theirs))

    def test_22x_any_storage_exception_stops_with_a_receipt(self):
        from vega import artwork

        class ClientError(Exception):
            """botocore's, for this test: not a MediaError."""

        calls = []

        def put(key, body, kind):
            calls.append(key)
            if len(calls) == 2:
                raise ClientError("An error occurred (SlowDown) when calling the PutObject operation")
            self.store[key] = (body, kind)
            return True

        manifest, digest = write_pack(self.pack, self.records, self.files)
        receipt = Path(tempfile.mkdtemp()) / "receipt.json"
        self.addCleanup(shutil.rmtree, receipt.parent, True)
        report = artwork.run(self.db, manifest, self.pack, digest, apply=True, put=put, receipt=receipt)
        outcomes = [r["outcome"] for r in report["records_in_order"]]
        self.assertEqual(outcomes[:2], ["linked", "storage_failed"])
        self.assertEqual(set(outcomes[2:]), {"unattempted"})
        self.assertFalse(report["complete"])
        self.assertEqual(json.loads(receipt.read_text()), report)
        self.assertEqual(sum(report["counts"].values()), len(self.records))
        self.assertIsNotNone(self.crest(1))
        self.assertIsNone(self.crest(2))
        # A retry finds the first link and finishes.
        again = artwork.run(self.db, manifest, self.pack, digest, apply=True, put=lambda key, body, kind: self.store.setdefault(key, (body, kind)) and False)
        self.assertTrue(again["complete"])
        self.assertEqual(self.outcomes(again)[("team", "64125")], "already_linked")
        self.assertEqual(self.outcomes(again)[("team", "name:Airdrieonians")], "linked")

    def test_22y_uefa_fills_the_canonical_club_of_a_merged_alias(self):
        from vega.sources import uefa

        self.x("INSERT INTO core.teams(id, name, country_code, is_national, merged_into) VALUES (8, 'Union alias', 'BEL', false, 1)")
        self.x("UPDATE core.provider_ids SET entity_id = 8 WHERE provider = 'uefa' AND provider_key = '64125'")
        row = {"id": "64125", "name": "Union alias", "names": ["Union alias"], "country": "BEL", "position": 1, "points": 80.0,
               "earned": None, "still": None, "logo": UEFA, "seasons": []}
        with self.db.transaction():
            uefa.save(self.db, "uefa_clubs", 2027, [row], "2026-11-06T22:00:00Z", NOW)
        self.assertEqual(self.x("SELECT a.source_url FROM core.teams t JOIN core.assets a ON a.id = t.crest_asset_id WHERE t.id = 1").fetchone(), (UEFA,))
        self.assertIsNone(self.crest(8))
        versions = self.x("SELECT resource_id, version FROM ops.resource_versions WHERE resource_kind = 'team' ORDER BY 1").fetchall()
        self.assertEqual(versions, [(1, 1)])
        with self.db.transaction():
            uefa.save(self.db, "uefa_clubs", 2027, [row], "2026-11-06T22:00:00Z", NOW)
        self.assertEqual(self.x("SELECT resource_id, version FROM ops.resource_versions WHERE resource_kind = 'team' ORDER BY 1").fetchall(), versions)
        # An inconsistent chain (the canonical a national team, or merged again) is held: no crest anywhere.
        self.x("UPDATE core.teams SET crest_asset_id = NULL WHERE id = 1")
        self.x("UPDATE core.teams SET merged_into = 4 WHERE id = 8")
        with self.db.transaction():
            uefa.save(self.db, "uefa_clubs", 2027, [row], "2026-11-06T22:00:00Z", NOW)
        self.assertEqual((self.crest(1), self.crest(4), self.crest(8)), (None, None, None))

    # The parent's tests run once, in ArtworkTest.
    test_21_plan_writes_nothing_and_codes_every_record = test_21abd_apply_links_once_with_its_provenance = None
    test_21f_a_corrupt_pack_is_refused_before_any_write = test_21g_one_entity_bound_to_two_displays_is_a_conflict = None
    test_21h_an_asset_with_the_reference_and_other_bytes_is_a_conflict = test_21i_a_failed_storage_write_links_nothing = None
    test_21j_a_crest_written_meanwhile_wins = test_21k_uefa_fills_an_empty_crest_from_its_own_logo_once = None


class MirrorShapeTest(unittest.TestCase):
    """21k (mirror): the exact UEFA club logo form is copied; other UEFA paths and the Vega reference are not."""

    def test_the_mirror_accepts_the_exact_uefa_form_only(self):
        from vega import media

        for url in (UEFA, "https://cdn.pitchapi.dev/images/teams/a.png", "https://img.thesports.com/football/team/abc.png",
                    "https://upload.wikimedia.org/wikipedia/commons/a/ab/Logo.png"):
            self.assertTrue(media.allowed(url), url)
        for url in ("https://img.uefa.com/imgml/TP/teams/logos/140x140/64125.png", "https://img.uefa.com/imgml/flags/70x70/ESP.png",
                    "https://img.uefa.com/imgml/TP/teams/logos/70x70/64125.png?x", "https://img.uefa.com/imgml/TP/teams/logos/70x70/6412a.png",
                    "https://media.vega.invalid/sha256/" + "a" * 64 + ".png", "https://evil.example/x.png",
                    UEFA + "\n", UEFA + " ", "https://img.uefa.com/imgml/TP/teams/logos/70x70/64125.png\n.evil"):  # §22: no trailing newline
            self.assertFalse(media.allowed(url), url)


class StorageIntegrityTest(unittest.TestCase):
    """22x (storage, written before the code): an object already at the content address must hold these bytes; its HEAD
    alone does not prove it."""

    def client(self, stored):
        import io
        from botocore.exceptions import ClientError

        class Client:
            puts = []

            def head_object(self, Bucket, Key):
                if Key not in stored:
                    raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
                return {}

            def get_object(self, Bucket, Key):
                return {"Body": io.BytesIO(stored[Key])}

            def put_object(self, **kw):
                self.puts.append(kw["Key"])
                stored[kw["Key"]] = kw["Body"]
                return {"ETag": '"' + hashlib.md5(kw["Body"]).hexdigest() + '"'}

        return Client()

    def test_an_existing_object_is_read_back_before_it_is_trusted(self):
        from vega import media

        body = png(3, 3, 1)
        key = f"sources/v2/images/{sha(body)}.png"
        same = self.client({"data/" + key: body})
        self.assertFalse(media.s3_writer("bucket", client=same)(key, body, "image/png"))
        self.assertEqual(same.puts, [])
        other = self.client({"data/" + key: png(3, 3, 2)})
        with self.assertRaises(media.MediaError) as caught:
            media.s3_writer("bucket", client=other)(key, body, "image/png")
        self.assertEqual(caught.exception.code, "STORAGE_CHECKSUM")
        fresh = self.client({})
        self.assertTrue(media.s3_writer("bucket", client=fresh)(key, body, "image/png"))


if __name__ == "__main__":
    unittest.main()
