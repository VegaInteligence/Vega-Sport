"""Offline writer of typed match detail rows. Caller owns the publication transaction."""

import json
import math
import re
from collections import defaultdict
from hashlib import sha256
from itertools import islice

from relational_match_ddl import dbname, leaves, quoted
from relational_match_model import Children, context, families, nested_families
from consolidated_storage import copy_tree_records, storage_mode


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


def _copy_rows(db, spec, parts, *, consolidated=False):
    if consolidated and copy_tree_records(db, spec, parts):
        return
    keys = ["record_no", "missing", "null_groups"]
    if parts[0][1][0]["parent_no"] is not None:
        keys += ["parent_no", "position"]
    if spec.keyed:
        keys.append("metric_label")
    keys += [dbname(p) for p, _ in leaves(spec.fields)]
    # Keep the existing batched COPY protocol. For the two compact metric
    # families, temporary typed cells feed the same SQL fold used by migration.
    metric_kind = {"half_stat_metrics": "half", "player_stat_metrics": "player"}.get(
        spec.table
    )
    target = "statarena_app." + spec.table
    if metric_kind:
        db.execute("SELECT statarena_app.begin_metric_batch()")
        target = "pg_temp.statarena_metric_input"
    sql = f"COPY {target} (resource_id," + ",".join(map(quoted, keys)) + ") FROM STDIN"
    with db.cursor() as cursor, cursor.copy(sql) as stream:
        for resource, rows in parts:
            for row in rows:
                stream.write_row((resource, *(row.get(k) for k in keys)))
    if metric_kind:
        db.execute(f"SELECT statarena_app.finish_{metric_kind}_metric_batch()")


def save_rows(db, resource, spec, rows):
    _copy_rows(db, spec, [(resource, rows)], consolidated=storage_mode(db))


def publish_match_details(
    db, match_id, endpoints, metadata=None, params=None, *, subject_id=""
):
    """Publish provided families atomically. Missing families retain their prior rows.

    Input is an archive's endpoints mapping or overlaid saved responses, already
    selected for freshness by the importer. params selects a separate endpoint variant.
    """
    _publish_bounded(
        db, [(match_id, endpoints, metadata, ())], canonical(params or {}), subject_id
    )


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
    address = _resource_address(endpoint)
    if address is None:
        return False
    mid, family, subject = address
    publish_match_details(
        db, mid, {family: response}, params=params, subject_id=subject
    )
    return True


# Amortize remote SQL round trips across matches. Typed COPY groups retain the
# independent 8 MiB source ceiling, including exceptionally large matches.
MAX_MATCH_RECORDS = 64
_MAX_COPY_MATCHES = MAX_MATCH_RECORDS
_MAX_COPY_SOURCE_BYTES = 8 * 1024 * 1024


def _resource_address(endpoint):
    match = _MATCH.fullmatch(endpoint)
    if not match:
        return None
    suffix = match[2] or ""
    parent = _PARENT_SUFFIXES.get(suffix)
    if parent:
        return match[1], parent, ""
    for pattern, family in _NESTED_SUFFIXES:
        nested = pattern.fullmatch(suffix)
        if nested:
            return match[1], family, nested[1]
    return None


def _family_sources(record, base_params, base_subject):
    mid, endpoints, _, variants = record
    for family, response in endpoints.items():
        yield (mid, base_params, base_subject, family), response
    for endpoint, params, response in variants:
        address = _resource_address(endpoint)
        if address:
            variant_mid, family, subject = address
            if variant_mid != mid:
                raise ValueError("Variant belongs to a different match")
            yield (mid, canonical(params or {}), subject, family), response


def _values_sql(rows, types):
    """Explicit types also cover batches containing only NULL in a column."""
    placeholders = "(" + ",".join("%s::" + kind for kind in types) + ")"
    return ",".join([placeholders] * len(rows)), [
        value for row in rows for value in row
    ]


def _context_updates(db, records, previous):
    types = ["text", "text", "text[]", "text[]", *[kind for _, kind in leaves(context)]]
    keys = [
        "context_digest",
        "missing",
        "null_groups",
        *[dbname(p) for p, _ in leaves(context)],
    ]
    updates = []
    for mid, _, meta, _ in records:
        if meta is None:
            continue
        digest = sha256(canonical(meta).encode()).hexdigest()
        if previous[mid] == digest:
            continue
        value = unpack_record(context, meta, None, "metadata")
        value["context_digest"] = digest
        updates.append((mid, *(value.get(k) for k in keys)))
    if updates:
        values, bindings = _values_sql(updates, types)
        assignments = ",".join(f"{quoted(k)}=v.{quoted(k)}" for k in keys)
        columns = ",".join(map(quoted, ["match_id", *keys]))
        db.execute(
            f"UPDATE statarena_app.match_details d SET has_context=true,{assignments} FROM (VALUES {values}) v({columns}) WHERE d.match_id=v.match_id",
            bindings,
        )


def _known_families(db, addresses):
    columns = list(zip(*addresses))
    return {
        (mid, params, subject, family): (rid, digest)
        for mid, params, subject, family, rid, digest in db.execute(
            """SELECT f.match_id,f.params,f.subject_id,f.family,f.resource_id,f.source_digest
            FROM unnest(%s::text[],%s::text[],%s::text[],%s::text[]) requested(match_id,params,subject_id,family)
            JOIN statarena_app.match_families f USING(match_id,params,subject_id,family)""",
            tuple(list(col) for col in columns),
        )
    }


def _insert_headers(db, rows):
    keys = "match_id,params,subject_id,family,status,has_data,has_error,error_object,error_code,error_message,error_has_code,error_has_message,source_digest"
    types = [
        "text",
        "text",
        "text",
        "text",
        "integer",
        "boolean",
        "boolean",
        "boolean",
        "text",
        "text",
        "boolean",
        "boolean",
        "text",
    ]
    ids = {}
    for start in range(0, len(rows), 256):
        values, bindings = _values_sql(rows[start : start + 256], types)
        inserted = db.execute(
            "INSERT INTO statarena_app.match_families ("
            + keys
            + ") VALUES "
            + values
            + " RETURNING match_id,params,subject_id,family,resource_id",
            bindings,
        )
        for mid, params, subject, family, rid in inserted:
            ids[mid, params, subject, family] = rid
    return ids


def _copy_group(db, sources, *, consolidated=False):
    if not sources:
        return
    existing = _known_families(db, list(sources))
    headers = []
    changed = []
    replace = []
    for address, (response, digest) in sources.items():
        old = existing.get(address)
        if old and old[1] == digest:
            continue
        header, batches = prepare(address[3], response)
        headers.append((*address, *header, digest))
        changed.append((address, batches))
        if old:
            replace.append(old[0])
    if not headers:
        return
    if replace:
        db.execute(
            "DELETE FROM statarena_app.match_families WHERE resource_id=ANY(%s::bigint[])",
            (replace,),
        )
    ids = _insert_headers(db, headers)
    # Each table is copied once. Parent tables precede their children within
    # every family's traversal, including children absent from earlier matches.
    groups = {}
    for address, batches in changed:
        for spec, rows in batches:
            if spec.table not in groups:
                groups[spec.table] = (spec, [])
            groups[spec.table][1].append((ids[address], rows))
    for spec, parts in groups.values():
        _copy_rows(db, spec, parts, consolidated=consolidated)


def publish_match_batch(db, records):
    """Publish up to 64 distinct matches and their saved variants atomically.

    Each input is (match_id, family_responses, optional_metadata, saved_variants).
    A saved variant is (endpoint, params, response). The importer selects source
    precedence. Absent families and metadata retain their previous published values.
    """
    _publish_bounded(db, records, "{}", "")


def _publish_bounded(db, records, base_params, base_subject):
    records = list(islice(records, MAX_MATCH_RECORDS + 1))
    if not records:
        return
    if len(records) > MAX_MATCH_RECORDS:
        raise ValueError(f"A match publication batch accepts at most {MAX_MATCH_RECORDS} records")
    mids = sorted(row[0] for row in records)
    if len(set(mids)) != len(mids):
        raise ValueError("A match may appear only once per batch")
    with db.transaction():
        consolidated = storage_mode(db)
        db.execute(
            """WITH dictionary_writer AS MATERIALIZED (
                     SELECT pg_advisory_xact_lock(hashtextextended('statarena_app.match_metric_dictionary_writer',0))
                   )
                   INSERT INTO statarena_app.match_details(match_id)
                   SELECT mid FROM dictionary_writer CROSS JOIN unnest(%s::text[]) mid ORDER BY mid
                   ON CONFLICT DO NOTHING""",
            (mids,),
        )
        previous = dict(
            db.execute(
                """SELECT match_id,context_digest FROM statarena_app.match_details
                   WHERE match_id=ANY(%s::text[]) ORDER BY match_id FOR UPDATE""",
                (mids,),
            )
        )
        _context_updates(db, records, previous)
        group = {}
        size = 0
        count = 0
        for record in records:
            if count == _MAX_COPY_MATCHES:
                _copy_group(db, group, consolidated=consolidated)
                group = {}
                size = 0
                count = 0
            count += 1
            for address, source in _family_sources(record, base_params, base_subject):
                if address in group:
                    # Preserve sequential precedence for equivalent parameter encodings.
                    _copy_group(db, group, consolidated=consolidated)
                    group = {}
                    size = 0
                    count = 1
                response = (
                    source.get("response", source)
                    if isinstance(source, dict)
                    else source
                )
                raw = canonical(response).encode()
                if group and size + len(raw) > _MAX_COPY_SOURCE_BYTES:
                    _copy_group(db, group, consolidated=consolidated)
                    group = {}
                    size = 0
                    count = 1
                group[address] = (response, sha256(raw).hexdigest())
                size += len(raw)
        _copy_group(db, group, consolidated=consolidated)
