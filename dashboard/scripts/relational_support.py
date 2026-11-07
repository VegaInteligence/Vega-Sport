"""Publish typed supporting football facts in the caller's rematerialize transaction."""

from collections import defaultdict
from collections.abc import Mapping
from datetime import date
import hashlib
import json
import math
from pathlib import Path
from consolidated_storage import copy_support_records, storage_mode

_SPEC = json.loads(
    (
        Path(__file__).resolve().parents[1] / "backend/services/support-model.json"
    ).read_text(encoding="utf-8")
)
FAMILIES, MODELS = _SPEC["families"], _SPEC["models"]
# A physical layout or encoding change must republish identical source data.
_MODEL_VERSION = hashlib.sha256(
    ("v1:" + json.dumps(_SPEC, sort_keys=True)).encode()
).digest()


def _canonical(value):
    return json.dumps(
        value,
        sort_keys=True,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    )


def _scalar(kind, value, field):
    if value is None:
        return None
    valid = {
        "integer": lambda: type(value) is int and -(2**31) <= value < 2**31,
        "double precision": lambda: (
            type(value) in (int, float) and math.isfinite(value)
        ),
        "boolean": lambda: type(value) is bool,
        "text": lambda: isinstance(value, str),
        "date": lambda: (
            isinstance(value, str) and date.fromisoformat(value).isoformat() == value
        ),
        "integer[]": lambda: (
            isinstance(value, list)
            and len(value) == 2
            and all(type(i) is int for i in value)
        ),
        "text[]": lambda: (
            isinstance(value, list) and all(isinstance(i, str) for i in value)
        ),
    }
    if not valid[kind]():
        raise ValueError(f"Invalid {kind} field {field}")
    return value


def _encode(model_key, value, indexes, records):
    model = MODELS[model_key]
    if "scalar" in model:
        value = {model["scalar"]: value}
    if not isinstance(value, dict):
        raise ValueError(f"Invalid {model_key} record")
    if model_key == "cup_fixture":
        if "scoreVector" in value or "scorePeriods" in value:
            raise ValueError("Unknown cup score field")
        if "score" in value:
            value = value.copy()
            score = value.pop("score")
            value["scorePeriods" if isinstance(score, dict) else "scoreVector"] = score
    fields, children = model["fields"], model["children"]
    missing, nulls, cells = [], [], {}
    paths = set(fields) | set(children)

    def visit(obj, prefix, remaining):
        names = {path.split(".", 1)[0] for path in remaining}
        extra = set(obj) - names
        if extra:
            raise ValueError(f"Unknown {model_key} fields at {prefix}: {sorted(extra)}")
        for name in sorted(names):
            key = prefix + name
            if name not in obj:
                missing.append(key)
                continue
            item = obj[name]
            if key in fields:
                col, kind = fields[key]
                cells[col] = _scalar(kind, item, key)
            elif item is None:
                nulls.append(key)
            elif key in children:
                if not isinstance(item, list):
                    raise ValueError(f"Expected collection for {key}")
                for index, child in enumerate(item):
                    _encode(children[key], child, (*indexes, index), records)
            elif isinstance(item, dict):
                visit(
                    item,
                    key + ".",
                    {p[len(name) + 1 :] for p in remaining if p.startswith(name + ".")},
                )
            else:
                raise ValueError(f"Expected object for {key}")

    visit(value, "", paths)
    records[model_key].append(
        (*indexes, missing, nulls, *[cells.get(c) for c, _ in fields.values()])
    )


def publish_supporting(db, rows=None):
    """Publish the full supported staging snapshot or supplied (name, params, body) records.

    A missing staging key never deletes a published projection. Every changed projection
    replaces its entire own graph, including removed children. Input shape changes abort
    the savepoint. Returns counts for the caller's worker receipt.
    """
    with db.transaction():
        consolidated = storage_mode(db)
        db.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended('statarena_app.support_projection',0))"
        )
        if rows is None:
            rows = db.execute(
                "SELECT name,params,body FROM statarena.projections WHERE name=ANY(%s)",
                (list(FAMILIES),),
            ).fetchall()
        existing = dict(
            ((n, p), digest)
            for n, p, digest in db.execute(
                "SELECT name,params,digest FROM statarena_app.support_projection"
            ).fetchall()
        )
        changed, seen = {}, set()
        for row in rows:
            name, params, body = (
                (row[k] for k in ("name", "params", "body"))
                if isinstance(row, Mapping)
                else row
            )
            if name not in FAMILIES:
                raise ValueError(f"Unsupported projection family {name}")
            params = json.loads(params) if isinstance(params, str) else params
            if not isinstance(params, dict) or not all(
                isinstance(v, str) for v in params.values()
            ):
                raise ValueError("Projection params must map names to strings")
            key = (name, _canonical(params))
            digest = hashlib.sha256(
                _MODEL_VERSION + _canonical(body).encode()
            ).hexdigest()
            if key in seen:
                raise ValueError("Duplicate projection key in one input batch")
            seen.add(key)
            if existing.get(key) == digest:
                continue
            records = defaultdict(list)
            _encode(FAMILIES[name], body, (), records)
            changed[key] = (digest, records)
        receipt = {"seen": len(seen), "changed": len(changed), "rows": 0}
        if not changed:
            return receipt
        keys = list(changed)
        ids = db.execute(
            """INSERT INTO statarena_app.support_projection(name,params,digest)
            SELECT * FROM unnest(%s::text[],%s::text[],%s::text[])
            ON CONFLICT(name,params) DO UPDATE SET digest=excluded.digest
            RETURNING name,params,id""",
            ([k[0] for k in keys], [k[1] for k in keys], [changed[k][0] for k in keys]),
        ).fetchall()
        batches = defaultdict(list)
        for name, params, pid in ids:
            for model, record_set in changed[name, params][1].items():
                batches[model].extend((pid, *row) for row in record_set)
        for model_key in FAMILIES.values():
            if batches.get(model_key):
                # Target IDs are indexed. ON DELETE CASCADE removes only this family's changed children.
                if consolidated:
                    db.execute(
                        "DELETE FROM statarena_app.support_records WHERE record_kind=%s AND resource_id=ANY(%s)",
                        (MODELS[model_key]["table"], [row[0] for row in batches[model_key]]),
                    )
                else:
                    db.execute(
                        "DELETE FROM statarena_app." + MODELS[model_key]["table"] + " WHERE projection_id=ANY(%s)",
                        ([row[0] for row in batches[model_key]],),
                    )
        # The checked-in model lists parent tables before child tables for FK order.
        for name, model in MODELS.items():
            if not batches.get(name):
                continue
            if consolidated:
                copy_support_records(db, model, batches[name])
                receipt["rows"] += len(batches[name])
                continue
            fields = [column for column, kind in model["fields"].values()]
            depth = len(batches[name][0]) - len(fields) - 3
            cols = [
                "projection_id",
                *["ordinal_" + str(i + 1) for i in range(depth)],
                "missing",
                "null_groups",
                *fields,
            ]
            with db.cursor().copy(
                "COPY statarena_app."
                + model["table"]
                + " ("
                + ",".join(cols)
                + ") FROM STDIN"
            ) as copy:
                for row in batches[name]:
                    copy.write_row(row)
            receipt["rows"] += len(batches[name])
        return receipt
