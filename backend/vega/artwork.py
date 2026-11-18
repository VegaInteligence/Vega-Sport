"""The reviewed artwork pack: authentic club crests and competition logos (VI-27 lot 2, FAILURE_MODES.md §21).

The pack is a manifest (its records bind an entity to its publisher's image, with evidence) and two
directories of files named by their SHA-256: `originals/` (the publisher's bytes) and `images/` (the
raster shown, the original itself or its offline PNG rendition). Nothing is fetched: the bytes are the
pack's. Dry run by default:

  python -m vega.artwork --manifest M --pack D --expected-manifest-sha256 H --plan report.json [--apply] [--store DIR]

`H` comes from the reviewed handoff, not from the manifest. `--apply` writes the display bytes (to the media
bucket, V2_MEDIA_BUCKET, or a local `--store`) and links each image where the entity has none.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

from psycopg.types.json import Jsonb

from . import media
from .sources import normalize


class ArtworkError(RuntimeError):
    pass


SHA = re.compile(r"[0-9a-f]{64}")
FORMATS = {"png": "png", "jpg": "jpg", "jpeg": "jpg", "webp": "webp"}
# The reference of a packed image without an accepted provider URL: resolved by the base, never fetched.
REFERENCE = "https://media.vega.invalid/sha256/{sha}.{ext}"
OUTCOMES = ("linked", "already_linked", "kept_existing", "duplicate", "entity_not_found", "identity_drift", "proof_missing", "asset_conflict",
            "manifest_conflict", "storage_failed", "unattempted")
# The link transaction waits this long for a row another writer holds, then the record is left for a retry (§22).
LOCK_TIMEOUT = "5s"
TABLES = {
    "team": ("core.teams", "crest_asset_id", "crest"),
    "competition": ("core.competitions", "logo_asset_id", "logo"),
    "competition_edition": ("core.competition_seasons", "emblem_asset_id", "logo"),
}
EDITION_TYPES = ("cup_key", "archive_key", "native_family_season")
PROFILE_ROLES = {
    "team": {None, "team_crest", "club_profile_emblem", "current_club_profile_emblem", "historical_club_profile_emblem"},
    "competition": {None, "competition_logo"},
}


def publisher_url(value):
    if not isinstance(value, str):
        return False
    try:
        url = urlsplit(value)
        return url.scheme == "https" and bool(url.hostname) and url.hostname != "media.vega.invalid" and not url.username and not url.password
    except ValueError:
        return False


def edition_contract(record):
    using, guard = record["resolve_using"], record.get("edition_guard")
    if not isinstance(guard, dict) or record.get("asset_role") != "edition_emblem" or record.get("competition_identity_only", False) is not False:
        return False
    if not all(type(guard.get(k)) is int and guard[k] > 0 for k in ("competition_id_at_snapshot", "edition_id_at_snapshot", "season_id_at_snapshot")):
        return False
    if (record.get("canonical_id_at_snapshot") != guard["edition_id_at_snapshot"]
            or not isinstance(guard.get("season_label_at_snapshot"), str)
            or using.get("season_id", guard["season_id_at_snapshot"]) != guard["season_id_at_snapshot"]):
        return False
    kind, key = using.get("edition_key_type"), using.get("source_edition_key")
    if kind not in EDITION_TYPES or guard.get("source_edition_key") != key:
        return False
    if kind == "native_family_season":
        return key is None and isinstance(guard.get("native_label_at_snapshot"), str) and isinstance(record.get("fixture_witness"), dict)
    return isinstance(key, str) and bool(key.strip()) and publisher_url(record.get("source_page"))


def _sha(body):
    return hashlib.sha256(body).hexdigest()


def load(manifest, pack, expected_sha256):
    """(records, display bytes by sha256): the whole pack checked before anything is written."""
    raw = Path(manifest).read_bytes()
    if _sha(raw) != expected_sha256:
        raise ArtworkError(f"the manifest's SHA-256 {_sha(raw)} is not the reviewed {expected_sha256}")
    data = json.loads(raw)
    records = data.get("artwork")
    if not isinstance(records, list) or data.get("records") != len(records):
        raise ArtworkError("the manifest does not list the records it counts")
    counts = {}
    for record in records:
        counts[record.get("entity_type")] = counts.get(record.get("entity_type"), 0) + 1
    if counts != data.get("counts"):
        raise ArtworkError(f"the manifest's counts {data.get('counts')} are not its records' {counts}")
    root = Path(pack).resolve()
    displays = {}
    for n, record in enumerate(records):
        where = f"record {n} ({record.get('entity_type')} {record.get('resolve_using')})"
        using = record.get("resolve_using") or {}
        if record.get("entity_type") not in TABLES or not isinstance(using.get("provider"), str) or not isinstance(using.get("key"), str):
            raise ArtworkError(f"{where}: no typed entity binding")
        if record["entity_type"] == "competition_edition":
            if not edition_contract(record):
                raise ArtworkError(f"{where}: no exact edition emblem certificate")
        elif record.get("asset_role") not in PROFILE_ROLES[record["entity_type"]]:
            raise ArtworkError(f"{where}: asset role belongs to another target")
        origin, display = record.get("origin_sha256"), record.get("display_sha256")
        if not isinstance(origin, str) or not SHA.fullmatch(origin) or not isinstance(display, str) or not SHA.fullmatch(display):
            raise ArtworkError(f"{where}: its file hashes are not SHA-256 names")
        if FORMATS.get(record.get("display_format")) is None:
            raise ArtworkError(f"{where}: display format {record.get('display_format')!r} is not a raster the site shows")
        if not publisher_url(record.get("image_url")):
            raise ArtworkError(f"{where}: no publisher image URL")
        bodies = {}
        for folder, digest in (("originals", origin), ("images", display)):
            path = (root / folder / digest).resolve()
            if path.parent != root / folder or not path.is_file():
                raise ArtworkError(f"{where}: {folder}/{digest} is not a file of the pack")
            body = path.read_bytes()
            if _sha(body) != digest:
                raise ArtworkError(f"{where}: {folder}/{digest} does not hash to its name")
            bodies[folder] = body
        if isinstance(record.get("bytes"), int) and len(bodies["originals"]) != record["bytes"]:
            raise ArtworkError(f"{where}: the original has {len(bodies['originals'])} bytes, not {record['bytes']}")
        if isinstance(record.get("sha256"), str) and record["sha256"] != origin:
            raise ArtworkError(f"{where}: the original's sha256 and origin_sha256 differ")
        if origin != display and record.get("mirror_sha256") not in (None, display):
            raise ArtworkError(f"{where}: the rendition's hash is not the display's")
        body = bodies["images"]
        if len(body) > media.MAX_BYTES:
            raise ArtworkError(f"{where}: the display is over {media.MAX_BYTES} bytes")
        try:
            ext, width, height = media.sniff(body)
        except media.MediaError:
            raise ArtworkError(f"{where}: the display is not a PNG, JPEG or WebP image") from None
        if ext != FORMATS[record["display_format"]]:
            raise ArtworkError(f"{where}: the display is a {ext}, not the declared {record['display_format']}")
        displays[display] = (body, ext, width, height)
    return records, displays


def source_url(record, ext):
    """The asset's URL: the publisher's own when the site accepts it and it serves these very bytes, else the reference."""
    if record["entity_type"] != "competition_edition" and media.allowed(record["image_url"]) and record["origin_sha256"] == record["display_sha256"]:
        return record["image_url"]
    return REFERENCE.format(sha=record["display_sha256"], ext=ext)


def resolve_edition(conn, record, lock):
    using, guard = record["resolve_using"], record["edition_guard"]
    family = conn.execute(
        "SELECT entity_id FROM core.provider_ids WHERE entity_type='competition' AND provider=%s AND provider_key=%s"
        + (" FOR SHARE" if lock else ""), (using["provider"], using["key"]),
    ).fetchone()
    if family is None:
        return None, None, "entity_not_found", None
    kind, key = using["edition_key_type"], using["source_edition_key"]
    season = guard["season_id_at_snapshot"]
    predicate, args = {
        "cup_key": ("cs.cup_key=%s", (key,)),
        "archive_key": ("cs.archive_key=%s AND cs.season_id=%s", (key, season)),
        "native_family_season": ("cs.competition_id=%s AND cs.season_id=%s AND cs.cup_key IS NULL AND cs.archive_key IS NULL", (family[0], season)),
    }[kind]
    rows = conn.execute(
        """SELECT cs.id,cs.competition_id,cs.season_id,s.label,cs.native_label,cs.cup_key,cs.archive_key,cs.emblem_asset_id
           FROM core.competition_seasons cs JOIN core.seasons s ON s.id=cs.season_id WHERE """ + predicate
        + (" FOR UPDATE OF cs" if lock else ""), args,
    ).fetchall()
    if len(rows) != 1:
        return None, None, "entity_not_found" if not rows else "identity_drift", None
    ident, comp, sid, label, native, cup, archive, current = rows[0]
    expected_cup = key if kind == "cup_key" else None
    expected_archive = key if kind == "archive_key" else None
    expected_native = guard.get("native_label_at_snapshot", key.split(":")[-1] if kind == "cup_key" else label)
    if (ident != guard["edition_id_at_snapshot"] or comp != family[0] or comp != guard["competition_id_at_snapshot"]
            or (sid, label, native) != (season, guard["season_label_at_snapshot"], expected_native)
            or (cup, archive) != (expected_cup, expected_archive)
            or guard.get("cup_key_at_snapshot", expected_cup) != expected_cup
            or guard.get("archive_key_at_snapshot", expected_archive) != expected_archive):
        return ident, current, "identity_drift", None
    return ident, current, None, [family[0], *rows[0][:-1]]


def resolve(conn, record, lock=False):
    """(entity id, current image asset id, outcome or None, binding): the record's typed binding, followed to the club a
    merged team is, checked against the record's identity and proof. `binding` (the bound id and the merge chain) is
    what a link must still find after the upload (§22)."""
    kind, using = record["entity_type"], record["resolve_using"]
    if kind == "competition_edition":
        return resolve_edition(conn, record, lock)
    table, column, _ = TABLES[kind]
    found = conn.execute("SELECT entity_id FROM core.provider_ids WHERE entity_type=%s AND provider=%s AND provider_key=%s"
                         + (" FOR SHARE" if lock else ""), (kind, using["provider"], using["key"])).fetchone()
    if found is None:
        return None, None, "entity_not_found", None
    first = ident = found[0]
    names, chain = set(), [first]
    for _ in range(4):
        if kind == "team":
            row = conn.execute(f"SELECT name, country_code, is_national, merged_into, {column} FROM core.teams WHERE id=%s"
                               + (" FOR UPDATE" if lock else ""), (ident,)).fetchone()
        else:
            row = conn.execute(f"SELECT name, country_code, false, NULL::integer, {column} FROM core.competitions WHERE id=%s"
                               + (" FOR UPDATE" if lock else ""), (ident,)).fetchone()
        if row is None:
            return None, None, "entity_not_found", None
        names.add(normalize(row[0]))
        if row[3] is None:
            break
        ident = row[3]
        chain.append(ident)
    else:
        return ident, None, "identity_drift", None
    binding = chain
    name, country, national, _, current = row
    snapshot = record.get("canonical_id_at_snapshot")
    if (normalize(record.get("canonical_name")) not in names or national
            or (record.get("country_code") and country and record["country_code"] != country)
            or (snapshot is not None and snapshot not in (first, ident))):
        return ident, current, "identity_drift", binding
    if kind == "competition" and conn.execute("SELECT core.family_artwork_requires_proof(%s)", (ident,)).fetchone()[0]:
        if (record.get("asset_role") != "competition_logo" or record.get("competition_identity_only") is not True
                or not publisher_url(record.get("source_page")) or not record.get("basis")):
            return ident, current, "proof_missing", binding
    if using["provider"] == "uefa":
        proof = conn.execute(
            """SELECT 1 FROM core.ranking_rows r JOIN core.ranking_editions e ON e.id = r.edition_id AND e.provider = 'uefa'
               JOIN core.assets a ON a.id = r.image_asset_id
               WHERE r.provider_key = %s AND r.team_id IN (%s, %s) AND a.source_url = %s LIMIT 1""",
            (using["key"], first, ident, record["image_url"]),
        ).fetchone()
        if proof is None:
            return ident, current, "proof_missing", binding
    return ident, current, None, binding


def _asset(conn, url):
    return conn.execute("SELECT id, s3_key, encode(sha256, 'hex') FROM core.assets WHERE source_url = %s", (url,)).fetchone()


def _key(record):
    using = record["resolve_using"]
    key = (record["entity_type"], using["provider"], using["key"])
    if record["entity_type"] != "competition_edition":
        return key
    return (*key, record["asset_role"], using["edition_key_type"], using["source_edition_key"] or "",
            record["edition_guard"]["season_id_at_snapshot"])


def decide(conn, record, displays, conflicts, lock=False):
    """(outcome, entity id, asset URL, seen) of one record, without writing; `seen` is the state a link must find again."""
    if conflicts.get(_key(record)):
        return conflicts[_key(record)], None, None, None
    ext = displays[record["display_sha256"]][1]
    url = source_url(record, ext)
    ident, current, problem, binding = resolve(conn, record, lock)
    if problem:
        return problem, ident, url, None
    asset = conn.execute("""SELECT id, s3_key, encode(sha256, 'hex'), author, license, source_page_url, content_type
                            FROM core.assets WHERE source_url = %s""" + (" FOR UPDATE" if lock else ""),
                         (url,)).fetchone()
    if current is not None:
        mine = asset is not None and asset[0] == current
        if mine and (asset[1] != f"{media.PREFIX}{record['display_sha256']}.{ext}" or asset[2] != record["display_sha256"]):
            return "asset_conflict", ident, url, None
        return ("already_linked" if mine else "kept_existing"), ident, url, None
    if asset is not None and asset[2] is not None and asset[2] != record["display_sha256"]:
        return "asset_conflict", ident, url, None
    return "linked", ident, url, {"binding": binding, "asset": list(asset) if asset else None}


def _bump(conn, kind, ident):
    conn.execute(
        """INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES (%s, %s)
           ON CONFLICT (resource_kind, resource_id) DO UPDATE SET version = ops.resource_versions.version + 1, updated_at = now()""",
        (kind, ident),
    )


def link(conn, record, displays, conflicts, put, manifest_sha256=None):
    """Write one record's image and link it where the entity has none; returns (outcome, entity id, asset URL, detail).

    The upload runs outside any transaction or lock. The link then re-reads, locked, the binding, the merge chain,
    the entity's image and the asset: if any of them moved during the upload, nothing is linked (§22)."""
    with conn.transaction():
        conn.execute("SET TRANSACTION READ ONLY")
        outcome, ident, url, seen = decide(conn, record, displays, conflicts)
    if outcome != "linked":
        return outcome, ident, url, None
    body, ext, width, height = displays[record["display_sha256"]]
    key = f"{media.PREFIX}{record['display_sha256']}.{ext}"
    try:
        put(key, body, media.TYPES[ext])
    except Exception as error:  # noqa: BLE001 - botocore, transport and MediaError alike: the run stops on it
        code = getattr(error, "code", None) or type(error).__name__
        return "storage_failed", ident, url, f"{code}: {str(error)[:200]}"
    with conn.transaction():
        conn.execute(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'")
        again, ident_now, _, now = decide(conn, record, displays, conflicts, lock=True)
        if again != "linked":
            return again, ident_now, url, "changed during the upload"
        if now["binding"] != seen["binding"] or ident_now != ident:
            return "identity_drift", ident_now, url, "the binding or merge chain moved during the upload"
        asset = now["asset"]
        if asset != seen["asset"]:
            return "asset_conflict", ident, url, "the asset changed during the upload"
        table, column, kind = TABLES[record["entity_type"]]
        author = record.get("reported_author") or record.get("source")
        if asset is None:
            asset_id = conn.execute(
                """INSERT INTO core.assets(kind, source_url, s3_key, sha256, content_type, width, height, author, license, source_page_url)
                   VALUES (%s,%s,%s,decode(%s,'hex'),%s,%s,%s,%s,%s,%s) ON CONFLICT (source_url) DO NOTHING RETURNING id""",
                (kind, url, key, record["display_sha256"], media.TYPES[ext], media._dimension(width), media._dimension(height),
                 author, record.get("reported_license"), record.get("source_page") or None),
            ).fetchone()
            if asset_id is None:
                return "asset_conflict", ident, url, "an asset with this URL was created during the upload"
            asset_id = asset_id[0]
        else:
            asset_id = asset[0]
            if asset[1] is None:
                # The ranking row's UEFA logo, never copied: its bytes are the pack's (same URL, checked hash).
                if not conn.execute(
                    """UPDATE core.assets SET s3_key=%s, sha256=decode(%s,'hex'), content_type=%s, width=%s, height=%s,
                         source_page_url=coalesce(source_page_url, %s), author=coalesce(author, %s), updated_at=now()
                       WHERE id=%s AND s3_key IS NULL AND sha256 IS NULL""",
                    (key, record["display_sha256"], media.TYPES[ext], media._dimension(width), media._dimension(height),
                     record.get("source_page") or None, author, asset_id),
                ).rowcount:
                    return "asset_conflict", ident, url, "the asset was mirrored during the upload"
        if record["entity_type"] == "competition" and record.get("competition_identity_only") is True and record.get("asset_role") == "competition_logo":
            conn.execute(
                """INSERT INTO core.family_artwork_qualifications(competition_id,asset_id,certificate,manifest_sha256)
                   VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING""", (ident, asset_id, Jsonb(record), manifest_sha256),
            )
        if not conn.execute(f"UPDATE {table} SET {column}=%s, updated_at=now() WHERE id=%s AND {column} IS NULL", (asset_id, ident)).rowcount:
            return "kept_existing", ident, url, None  # an image landed meanwhile: it wins
        if record["entity_type"] == "competition_edition":
            conn.execute(
                """INSERT INTO core.edition_artwork_provenance(competition_season_id,asset_id,manifest_sha256,certificate)
                   VALUES (%s,%s,%s,%s)""", (ident, asset_id, manifest_sha256, Jsonb(record)),
            )
            key_type = record["resolve_using"]["edition_key_type"]
            if key_type == "archive_key":
                _bump(conn, "archive_season", record["edition_guard"]["season_id_at_snapshot"])
            elif key_type == "native_family_season":
                # Normal publication adds this version to the fixture and manifest fence.
                _bump(conn, "competition_season", ident)
            return "linked", ident, url, None
        if record["entity_type"] == "team":
            _bump(conn, "team", ident)
        else:
            for (edition,) in conn.execute("SELECT id FROM core.competition_seasons WHERE competition_id=%s ORDER BY id", (ident,)):
                _bump(conn, "competition_season", edition)
        _bump(conn, "home", 1)
        return "linked", ident, url, None


def conflicts_of(conn, records):
    """{record key: manifest_conflict | duplicate}. A binding or a resolved canonical entity shown by two displays is a
    conflict for every record involved; one display under several bindings of one entity is linked once, by the
    entity's own binding (then the first in key order), the others `duplicate`. Manifest order never decides (§22)."""
    bound, entities = {}, {}
    with conn.transaction():
        conn.execute("SET TRANSACTION READ ONLY")
        for record in records:
            bound.setdefault(_key(record), set()).add(record["display_sha256"])
            ident, _, problem, binding = resolve(conn, record)
            if ident is not None and problem in (None, "proof_missing"):
                entities.setdefault((record["entity_type"], ident), []).append((len(binding or []) > 1, _key(record), record["display_sha256"]))
    out = {key: "manifest_conflict" for key, shown in bound.items() if len(shown) > 1}
    for members in entities.values():
        if len({display for _, _, display in members}) > 1:
            out.update({key: "manifest_conflict" for _, key, _ in members})
        elif len({key for _, key, _ in members}) > 1:
            for _, key, _ in sorted(members)[1:]:
                out.setdefault(key, "duplicate")
    return out


def _row(record, outcome, ident, url, detail=None):
    return {"entity_type": record["entity_type"], "provider": record["resolve_using"]["provider"], "key": record["resolve_using"]["key"],
            "canonical_name": record.get("canonical_name"), "entity_id": ident, "outcome": outcome, "asset_url": url,
            "image_url": record["image_url"], "source_page": record.get("source_page"),
            "origin_sha256": record["origin_sha256"], "display_sha256": record["display_sha256"],
            **({"role": record["asset_role"], "edition": record["resolve_using"], "edition_guard": record["edition_guard"]}
               if record["entity_type"] == "competition_edition" else {}), **({"detail": detail} if detail else {})}


def _report(expected_sha256, apply, rows, complete):
    ordered = sorted(rows, key=lambda r: (r["entity_type"], r["provider"], r["key"], r["display_sha256"]))
    counts = {o: sum(1 for r in rows if r["outcome"] == o) for o in OUTCOMES}
    return {"manifest_sha256": expected_sha256, "applied": apply, "complete": complete, "records": ordered, "records_in_order": rows,
            "counts": {k: v for k, v in counts.items() if v}}


def run(conn, manifest, pack, expected_sha256, *, apply=False, put=None, receipt=None):
    """The report of a pack (every record's outcome, `complete` false if the run stopped); with `apply`, its images
    written and linked. With `receipt`, the report is rewritten after every record, so that a stopped run still says
    what it committed, what failed and what it did not attempt."""
    records, displays = load(manifest, pack, expected_sha256)
    conflicts = conflicts_of(conn, records)
    rows, stopped = [], False

    def save(complete):
        report = _report(expected_sha256, apply, rows + [_row(r, "unattempted", None, None) for r in records[len(rows):]], complete)
        if receipt:
            tmp = Path(str(receipt) + ".tmp")
            tmp.write_text(json.dumps(report, indent=1, sort_keys=True) + "\n", encoding="utf-8")
            tmp.replace(receipt)
        return report

    for record in records:
        if stopped:
            break
        if apply:
            outcome, ident, url, detail = link(conn, record, displays, conflicts, put, expected_sha256)
        else:
            with conn.transaction():
                conn.execute("SET TRANSACTION READ ONLY")
                outcome, ident, url, _ = decide(conn, record, displays, conflicts)
            detail = None
        rows.append(_row(record, outcome, ident, url, detail))
        stopped = outcome == "storage_failed"
        if apply and receipt:
            save(False)
    return save(not stopped)


def local_store(root):
    """put(key, body, content_type) into a directory laid out as the bucket (data/<key>)."""
    root = Path(root)

    def put(key, body, content_type):
        path = root / media.OBJECT_PREFIX / key
        if path.exists():
            if path.read_bytes() != body:
                raise media.MediaError("STORAGE_CHECKSUM")
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        return True

    return put


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--expected-manifest-sha256", required=True)
    parser.add_argument("--plan", type=Path, required=True, help="the report, written in every case")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--store", type=Path, help="a local content store instead of V2_MEDIA_BUCKET")
    parser.add_argument("--receipt", type=Path, help="with --apply: the report, rewritten after every record (default: --plan's path + .receipt)")
    args = parser.parse_args(argv)
    dsn = os.environ.get("V2_DATABASE_URL")
    if not dsn:
        print("V2_DATABASE_URL is required", file=sys.stderr)
        return 2
    from .worker import connect

    put = None
    if args.apply:
        put = local_store(args.store) if args.store else media.s3_writer(os.environ["V2_MEDIA_BUCKET"])
    receipt = (args.receipt or Path(str(args.plan) + ".receipt")) if args.apply else None
    report = run(connect(dsn), args.manifest, args.pack, args.expected_manifest_sha256, apply=args.apply, put=put, receipt=receipt)
    args.plan.write_text(json.dumps(report, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report["counts"], sort_keys=True), flush=True)
    return 0 if report["complete"] else 1


if __name__ == "__main__":
    sys.exit(main())
