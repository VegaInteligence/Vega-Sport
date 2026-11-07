"""Transactional, exact archive read projections; no public-request rebuilds."""
import json
from pathlib import Path
import re
import subprocess

from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
MODEL = json.loads((ROOT / "backend/services/archive-projection-model.json").read_text())


def _query(db, name, values=()):
    bindings = []

    def parameter(match):
        bindings.append(values[int(match[1]) - 1])
        return "%s"

    statement = re.sub(r"\$(\d+)", parameter, MODEL[name])
    return db.execute(statement, tuple(bindings))


def _row(cursor):
    values = cursor.fetchone()
    return dict(zip((column.name for column in cursor.description), values)) if values else None


def archive_index_seasons(db, scope):
    return {row[0] for row in _query(db, "index_seasons", [scope])}


def refresh_archive_projection(db, season):
    """Caller owns the source publication transaction, storage and catalogue locks.

    Normal publish_catalog already rejects backfill/rollback storage modes.
    Maintenance uses the dedicated Node entrypoint with its exclusive lease.
    """
    if not re.fullmatch(r"\d{4}(?:/\d{4})?", season):
        raise ValueError("Invalid archive season")
    if db.info.transaction_status.name != "INTRANS":
        raise RuntimeError("Archive refresh requires the source publication transaction")
    header = _row(_query(db, "metadata", [season]))
    source = header["source_fence"]
    editions = source.get("editions", [])
    if not editions or any(scope not in {e["scope"] for e in editions} for scope in source.get("expected_scopes", [])) \
            or any(e.get("response_status") not in (None, 200) for e in editions):
        return {"season": season, "ready": False, "changed": False}
    current = header.get("projection")
    if current and current["revision"] == MODEL["revision"] and current["source_fence"] == source:
        return {"season": season, "ready": True, "changed": False}
    record = _row(_query(db, "source", [season]))
    projection = json.loads(subprocess.run(
        ["node", str(ROOT / "scripts/archive_projection.mjs")],
        input=json.dumps({"season": season, "row": record}, ensure_ascii=False, separators=(",", ":")),
        text=True, capture_output=True, check=True, timeout=90,
    ).stdout)
    if not projection["ready"] or projection["source_fence"] != source:
        raise RuntimeError("Archive sources changed during the publication")
    _query(db, "delete", [season])
    _query(db, "insert_header", [season, projection["revision"], Jsonb(source), projection["version"],
                                Jsonb(projection["competitions"]), Jsonb(projection["summary"]), len(projection["matches"])])
    for start in range(0, len(projection["matches"]), 250):
        _query(db, "insert_matches", [season, Jsonb(projection["matches"][start:start + 250])])
    if _query(db, "count", [season]).fetchone()[0] != len(projection["matches"]):
        raise RuntimeError("Archive projection count differs from the exact merger")
    return {"season": season, "ready": True, "changed": True}
