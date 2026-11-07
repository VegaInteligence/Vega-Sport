"""Publish native association rankings, archives, competition calendars and profiles."""

import json
import re
from collections import defaultdict
from hashlib import sha256
from pathlib import Path

from relational_catalog_keys import records
from relational_match import canonical, _copy_rows, _values_sql, unpack_record, validate_scalar
from relational_match_ddl import column_lines, fields, projected
from relational_match_model import Children
from consolidated_storage import storage_mode
from archive_projection import archive_index_seasons, refresh_archive_projection

SPEC = Path(__file__).resolve().parents[1] / "backend/services/catalog-model.json"
spec = json.loads(SPEC.read_text(encoding="utf-8"))
model_version = sha256(SPEC.read_bytes()).hexdigest()


def compile_fields(value):
    if isinstance(value, str):
        return value
    if "@map" in value or "@rows" in value:
        return Children(
            value.get("@rows", value.get("@map")),
            compile_fields(value["fields"]),
            keyed="@map" in value,
        )
    return {name: compile_fields(item) for name, item in value.items()}


models = {key: Children("cat_" + key, compile_fields(obj)) for key, obj in spec.items()}


def scalar(value, kind, field):
    if value is None:
        return
    if kind in ("integer[]", "text[]"):
        if not isinstance(value, list):
            raise ValueError("Invalid collection " + field)
        for item in value:
            validate_scalar(item, kind[:-2], field)
    else:
        validate_scalar(value, kind, field)


def rows_for(spec, value):
    batches = defaultdict(list)
    by_table = {}

    def append(spec, obj, parent=None, pos=None, label=None):
        batch = batches[spec.table]
        by_table[spec.table] = spec
        ordinal = len(batch)

        def children(child, items):
            entries = items.items() if child.keyed else enumerate(items)
            for index, (key, item) in enumerate(entries):
                append(child, item, ordinal, index, key if child.keyed else None)

        row = unpack_record(spec.fields, obj, children, spec.table, scalar)
        row.update(
            record_no=ordinal, parent_no=parent, position=pos, metric_label=label
        )
        batch.append(row)

    append(spec, value)
    return [(by_table[k], v) for k, v in batches.items()]


def normalize(model, body):
    if model in ("supp_index", "cup_worker_index"):
        body = body.copy()
        body["competitions"] = [c.copy() for c in body["competitions"]]
        for comp in body["competitions"]:
            if "season" not in comp:
                ref = next(iter(comp["tables"].values()))["path"]
                m = re.search(r"/(\d{4})-(\d{4})/", ref)
                if not m:
                    raise ValueError("Unrecognized competition season")
                comp["season"] = m[1] + "/" + m[2]
    if model == "cup_open_cups":

        def match(row):
            if "scoreVector" in row:
                raise ValueError("Unknown cup source field scoreVector")
            if isinstance(row.get("score"), list):
                row = row.copy()
                row["scoreVector"] = row.pop("score")
            return row

        body = dict(body, matches=[match(r) for r in body["matches"]])
    if model == "cup_native" and isinstance(body.get("roundsChecked"), dict):
        body = dict(
            body,
            roundsChecked={
                mid: {"value": v} for mid, v in body["roundsChecked"].items()
            },
        )
    return body


def _publish_group(db, group, *, consolidated=False):
    """Compare headers once, then COPY each changed native table once per bounded group."""
    if not group:
        return 0, 0
    columns = list(zip(*group))
    previous = {
        (kind, scope, edition): (rid, digest)
        for kind, scope, edition, rid, digest in db.execute(
            """SELECT c.catalog,c.scope,c.edition,c.resource_id,c.source_digest
            FROM unnest(%s::text[],%s::text[],%s::text[]) requested(catalog,scope,edition)
            JOIN statarena_app.catalog_editions c USING(catalog,scope,edition)""",
            tuple(list(column) for column in columns),
        )
    }
    changed, headers, replaced = [], [], []
    unchanged = 0
    for key, (model, body, digest) in group.items():
        old = previous.get(key)
        if old and old[1] == digest:
            unchanged += 1
            continue
        batches = rows_for(models[model], normalize(model, body))
        headers.append((*key, model, digest, body.get("status", 200) if key[0] == "profile" else 200))
        changed.append((key, batches))
        if old:
            replaced.append(old[0])
    if not headers:
        return 0, unchanged
    if replaced:
        db.execute(
            "DELETE FROM statarena_app.catalog_editions WHERE resource_id=ANY(%s::bigint[])",
            (replaced,),
        )
    values, bindings = _values_sql(headers, ["text", "text", "text", "text", "text", "integer"])
    identifiers = {
        (kind, scope, edition): rid
        for kind, scope, edition, rid in db.execute(
            """INSERT INTO statarena_app.catalog_editions(catalog,scope,edition,model,source_digest,response_status)
            VALUES """ + values + " RETURNING catalog,scope,edition,resource_id",
            bindings,
        )
    }
    tables = {}
    for key, batches in changed:
        for spec, rows in batches:
            if spec.table not in tables:
                tables[spec.table] = (spec, [])
            tables[spec.table][1].append((identifiers[key], rows))
    # Each model traverses parents before children. Grouping retains that order.
    for spec, parts in tables.values():
        _copy_rows(db, spec, parts, consolidated=consolidated)
    return len(changed), unchanged


def publish_catalog(db, records_in):
    """Publish supplied inputs atomically, with bounded memory and sequential duplicate precedence."""
    changed = unchanged = 0
    group = {}
    size = 0
    archive_seasons = set()
    archive_indexes = {}
    with db.transaction():
        consolidated = storage_mode(db)
        db.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended('statarena_app.catalog_editions',0))"
        )
        for path, value in records_in:
            for model, kind, scope, edition, body in records(path, value):
                if kind == "archive-season":
                    archive_seasons.add(edition)
                elif kind == "archive-index" and scope in ("results", "goals") and scope not in archive_indexes:
                    archive_indexes[scope] = archive_index_seasons(db, scope)
                raw = canonical(body).encode()
                digest = sha256(model_version.encode() + raw).hexdigest()
                key = (kind, scope, edition)
                if group and (key in group or len(group) >= 64 or size + len(raw) > 8 * 1024 * 1024):
                    added, kept = _publish_group(db, group, consolidated=consolidated)
                    changed += added
                    unchanged += kept
                    group, size = {}, 0
                group[key] = (model, body, digest)
                size += len(raw)
        added, kept = _publish_group(db, group, consolidated=consolidated)
        changed += added
        unchanged += kept
        for scope, previous in archive_indexes.items():
            archive_seasons.update(previous ^ archive_index_seasons(db, scope))
        for season in sorted(archive_seasons):
            refresh_archive_projection(db, season)
    return {"changed": changed, "unchanged": unchanged}


def migration():
    sql = [
        "-- Generated by python3 dashboard/scripts/relational_catalog.py --migration",
        """CREATE SCHEMA IF NOT EXISTS statarena_app;
CREATE TABLE IF NOT EXISTS statarena_app.catalog_editions (
 resource_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 catalog text NOT NULL, scope text NOT NULL, edition text NOT NULL, model text NOT NULL,
 source_digest char(64) NOT NULL, response_status integer, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(catalog,scope,edition)
);""",
    ]

    def table(t, parent=None):
        cols = [
            "resource_id bigint NOT NULL REFERENCES statarena_app.catalog_editions ON DELETE CASCADE",
            "record_no integer NOT NULL",
            "missing text[] NOT NULL",
            "null_groups text[] NOT NULL",
        ]
        if parent:
            cols += ["parent_no integer NOT NULL", "position integer NOT NULL"]
        if t.keyed:
            cols += ["metric_label text NOT NULL"]
        cols += column_lines(t.fields) + ["PRIMARY KEY(resource_id,record_no)"]
        if parent:
            cols += [
                f"FOREIGN KEY(resource_id,parent_no) REFERENCES statarena_app.{parent}(resource_id,record_no) ON DELETE CASCADE",
                "UNIQUE(resource_id,parent_no,position)",
            ]
        else:
            cols += ["CHECK(record_no=0)"]
        sql.append(
            f"CREATE TABLE IF NOT EXISTS statarena_app.{t.table} (\n "
            + ",\n ".join(cols)
            + "\n);"
        )
        for _, child in fields(t.fields):
            if isinstance(child, Children):
                table(child, t.table)
        # Rich payloads are composed at read time from typed columns and child relations.
        sql.append(
            f"CREATE OR REPLACE FUNCTION statarena_app.read_{t.table}(r statarena_app.{t.table}) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT "
            + projected(t.fields, "r")
            + "; $$;"
        )

    for obj in models.values():
        table(obj)
    options = "\n".join(
        f"WHEN '{name}' THEN (SELECT statarena_app.read_{obj.table}(r) FROM statarena_app.{obj.table} r WHERE r.resource_id=c.resource_id)"
        for name, obj in models.items()
    )
    sql.append(
        "CREATE OR REPLACE FUNCTION statarena_app.catalog_response(c statarena_app.catalog_editions) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT CASE c.model\n"
        + options
        + "\nEND; $$;"
    )
    sql += [
        'CREATE INDEX IF NOT EXISTS catalog_ranking_entity ON statarena_app.cat_ranking_uefa_clubs_rows(resource_id,"entityId");',
        "CREATE INDEX IF NOT EXISTS catalog_club_identity ON statarena_app.cat_club_links_links(resource_id,metric_label);",
        "CREATE INDEX IF NOT EXISTS catalog_worker_folder ON statarena_app.cat_cup_worker_index_competitions(resource_id,folder,season);",
    ]
    return "\n\n".join(sql) + "\n"


if __name__ == "__main__":
    import sys

    if sys.argv[1:] == ["--migration"]:
        print(migration(), end="")
