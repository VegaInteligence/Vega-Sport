"""Offline writer of typed match detail rows. Caller owns the publication transaction."""

import json
import math
import re
from collections import defaultdict
from hashlib import sha256

from relational_match_ddl import dbname, leaves, quoted
from relational_match_model import Children, context, families, nested_families


def canonical(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def validate_scalar(value, kind, field):
    if value is None:
        return
    if kind == "text":
        valid = isinstance(value, str)
    elif kind == "integer":
        valid = type(value) is int
    elif kind == "double precision":
        valid = type(value) in (int, float) and math.isfinite(value)
    elif kind == "boolean":
        valid = type(value) is bool
    else:
        valid = isinstance(value, list) and all(
            isinstance(cell, list)
            and len(cell) == 3
            and all(type(n) is int for n in cell)
            for cell in value
        )
    if not valid:
        raise ValueError(f"Unexpected {field} type for {kind}: {type(value).__name__}")


def unpack_record(spec, value, children, location, scalar=validate_scalar):
    """Capture source presence separately from SQL NULL, including nullable collections."""
    if not isinstance(value, dict):
        raise TypeError(f"Expected an object at {location}")
    row = {"missing": [], "null_groups": []}

    def unpack(model, obj, prefix):
        extra = obj.keys() - model.keys()
        if extra:
            raise ValueError(
                f"Unmapped fields at {location}.{'.'.join(prefix)}: {sorted(extra)}"
            )
        for key, kind in model.items():
            field = (*prefix, key)
            dotted = ".".join(field)
            if key not in obj:
                row["missing"].append(dotted)
                continue
            item = obj[key]
            if isinstance(kind, str):
                scalar(item, kind, location + "." + dotted)
                row[dbname(field)] = item
            elif item is None:
                row["null_groups"].append(dotted)
            elif isinstance(kind, Children):
                if not isinstance(item, dict if kind.keyed else list):
                    raise TypeError(f"Invalid collection at {location}.{dotted}")
                children(kind, item)
            elif isinstance(item, dict):
                unpack(kind, item, field)
            else:
                raise ValueError(f"Invalid object at {location}.{dotted}")

    unpack(spec, value, ())
    return row


def ordered_rows(family, data):
    batches = defaultdict(list)
    specs = {}

    def append(spec, obj, parent_no=None, position=None, label=None):
        specs[spec.table] = spec
        batch = batches[spec.table]
        ordinal = len(batch)

        def children(child, items):
            entries = items.items() if child.keyed else enumerate(items)
            for pos, (key, item) in enumerate(entries):
                append(child, item, ordinal, pos, key if child.keyed else None)

        row = unpack_record(spec.fields, obj, children, spec.table)
        row.update(
            record_no=ordinal,
            parent_no=parent_no,
            position=position,
            metric_label=label,
        )
        batch.append(row)

    if family == "single_shot":
        data = {"periods": [{"shots": [data]}]}
    elif family == "single_halves":
        data = dict(data)
        match = {"match_id": data.pop("match_id")} if "match_id" in data else {}
        data = dict(match, players=[data])
    elif family in ("single_advanced", "single_player"):
        data = {"players": [data]}
    elif family == "players":
        data = {"players": data}
    root = families[nested_families.get(family, family)]
    append(root, data)
    return [(specs[name], rows) for name, rows in batches.items()]


def prepare(family, response):
    if family not in families and family not in nested_families:
        raise ValueError(f"Unsupported match family {family}")
    if not isinstance(response, dict):
        raise TypeError(f"Expected response for {family}")
    response = response.get("response", response)
    if (
        not isinstance(response, dict)
        or response.keys() - {"status", "error", "data"}
        or "status" not in response
    ):
        raise ValueError(f"Invalid {family} response envelope")
    status, error = response["status"], response.get("error")
    validate_scalar(status, "integer", family + ".status")
    if error is not None and (
        not isinstance(error, dict) or error.keys() - {"code", "message"}
    ):
        raise ValueError(f"Unmapped error fields for {family}")
    error_fields = error or {}
    for key, value in error_fields.items():
        validate_scalar(value, "text", family + ".error." + key)
    header = (
        status,
        "data" in response,
        "error" in response,
        error is not None,
        error_fields.get("code"),
        error_fields.get("message"),
        "code" in error_fields,
        "message" in error_fields,
    )
    batches = (
        [] if response.get("data") is None else ordered_rows(family, response["data"])
    )
    return header, batches


def save_rows(db, resource, spec, rows):
    keys = ["record_no", "missing", "null_groups"]
    if rows[0]["parent_no"] is not None:
        keys += ["parent_no", "position"]
    if spec.keyed:
        keys += ["metric_label"]
    keys += [dbname(p) for p, _ in leaves(spec.fields)]
    sql = (
        f"COPY statarena_app.{spec.table} (resource_id,"
        + ",".join(map(quoted, keys))
        + ") FROM STDIN"
    )
    with db.cursor() as cursor, cursor.copy(sql) as stream:
        for row in rows:
            stream.write_row((resource, *(row.get(key) for key in keys)))


def publish_match_details(
    db, match_id, endpoints, metadata=None, params=None, *, subject_id=""
):
    """Publish provided families atomically. Missing families retain their prior rows.

    Input is an archive's endpoints mapping or overlaid saved responses, already
    selected for freshness by the importer. params selects a separate endpoint variant.
    """
    variant = canonical(params or {})
    if metadata is not None:
        record = unpack_record(context, metadata, None, "metadata")
    with db.transaction():
        db.execute(
            "INSERT INTO statarena_app.match_details(match_id) VALUES(%s) ON CONFLICT DO NOTHING",
            (match_id,),
        )
        db.execute(
            "SELECT match_id FROM statarena_app.match_details WHERE match_id=%s FOR UPDATE",
            (match_id,),
        )
        if metadata is not None:
            record["context_digest"] = sha256(canonical(metadata).encode()).hexdigest()
            keys = [
                "context_digest",
                "missing",
                "null_groups",
                *[dbname(p) for p, _ in leaves(context)],
            ]
            updates = ",".join(quoted(key) + "=%s" for key in keys)
            db.execute(
                "UPDATE statarena_app.match_details SET has_context=true,"
                + updates
                + " WHERE match_id=%s AND context_digest IS DISTINCT FROM %s",
                (
                    *[record.get(key) for key in keys],
                    match_id,
                    record["context_digest"],
                ),
            )
        existing = dict(
            db.execute(
                "SELECT family,source_digest FROM statarena_app.match_families WHERE match_id=%s AND params=%s AND subject_id=%s",
                (match_id, variant, subject_id),
            )
        )
        for family, source in endpoints.items():
            response = (
                source.get("response", source) if isinstance(source, dict) else source
            )
            digest = sha256(canonical(response).encode()).hexdigest()
            if existing.get(family) == digest:
                continue
            header, batches = prepare(family, response)
            if family in existing:
                db.execute(
                    "DELETE FROM statarena_app.match_families WHERE match_id=%s AND family=%s AND params=%s AND subject_id=%s",
                    (match_id, family, variant, subject_id),
                )
            resource = db.execute(
                """INSERT INTO statarena_app.match_families
                (match_id,family,params,subject_id,status,has_data,has_error,error_object,error_code,error_message,
                 error_has_code,error_has_message,source_digest) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING resource_id""",
                (match_id, family, variant, subject_id, *header, digest),
            ).fetchone()[0]
            for spec, rows in batches:
                save_rows(db, resource, spec, rows)


_MATCH = re.compile(r"/matches/(m_[A-Za-z0-9]{6})(?:/(.+))?")
_PARENT_SUFFIXES = {
    "": "match",
    "players/halves": "player_halves",
    "advanced": "advanced_teams",
    "advanced/players": "advanced_players",
    "advanced/network": "pass_networks",
    **{
        f: f
        for f in (
            "shots",
            "momentum",
            "events",
            "players",
            "lineups",
            "h2h",
            "stats",
            "heatmaps",
        )
    },
}
_NESTED_SUFFIXES = [
    (re.compile(r"shots/(s_[A-Za-z0-9]{6})"), "single_shot"),
    (re.compile(r"players/(p_[A-Za-z0-9]{6})"), "single_player"),
    (re.compile(r"players/(p_[A-Za-z0-9]{6})/halves"), "single_halves"),
    (re.compile(r"players/(p_[A-Za-z0-9]{6})/shots"), "player_shots"),
    (re.compile(r"advanced/players/(p_[A-Za-z0-9]{6})"), "single_advanced"),
]


def publish_match_resource(db, endpoint, params, response):
    match = _MATCH.fullmatch(endpoint)
    if not match:
        return False
    mid, suffix = match[1], match[2] or ""
    family = _PARENT_SUFFIXES.get(suffix)
    subject = ""
    if family is None:
        for pattern, family_name in _NESTED_SUFFIXES:
            nested = pattern.fullmatch(suffix)
            if nested:
                family, subject = family_name, nested[1]
                break
    if family is None:
        return False
    publish_match_details(
        db, mid, {family: response}, params=params, subject_id=subject
    )
    return True
