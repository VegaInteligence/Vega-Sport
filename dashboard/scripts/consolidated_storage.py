"""Publication adapters for the active, versioned provider record layout."""

from psycopg.types.json import Jsonb
import math

from consolidated_model import BY_TABLE, MODEL_DIGEST

LEASE = 97813003


def storage_mode(db):
    """Read once per publisher transaction; no process cache across a cutover.

    The shared transaction lease coordinates direct publishers as well as the
    worker's existing exclusive session lease. A maintenance phase keeps queued
    inputs intact instead of allowing a writer to invalidate a migration midway.
    """
    db.execute("SELECT pg_advisory_xact_lock_shared(%s)", (LEASE,))
    if not db.execute("SELECT to_regclass('statarena_app.consolidation_state')").fetchone()[0]:
        return False
    row = db.execute("SELECT value FROM statarena_app.consolidation_state WHERE key='control' FOR SHARE").fetchone()
    if not row:
        raise RuntimeError("Provider storage state is missing")
    value = row[0]
    if value["model_digest"] != MODEL_DIGEST:
        raise RuntimeError("Provider storage mapping differs from the installed migration")
    if value["mode"] not in ("legacy", "active"):
        raise RuntimeError("Provider publication is paused for a schema migration; retry queued input")
    return value["mode"] == "active"


def copy_tree_records(db, spec, parts):
    """COPY validated native nodes with source-scoped keys and parent references."""
    node = BY_TABLE.get(spec.table)
    if node is None:
        return False
    columns = ("resource_id,record_kind,path,parent_kind,parent_path,position,"
               "metric_label,missing,null_groups,negative_zero,attributes")
    with db.cursor().copy(f"COPY statarena_app.{node.store} ({columns}) FROM STDIN") as stream:
        for resource_id, rows in parts:
            for row in rows:
                stream.write_row((resource_id, node.table, [row["record_no"]], node.parent,
                                  [row["parent_no"]] if node.parent else None,
                                  row.get("position"), row.get("metric_label"),
                                  row["missing"], row["null_groups"],
                                  [col for col, kind in node.columns if kind == "double precision"
                                   and row.get(col) == 0 and math.copysign(1, row[col]) < 0],
                                  Jsonb({col: row.get(col) for col, _ in node.columns})))
    return True


def copy_support_records(db, model, rows):
    node = BY_TABLE[model["table"]]
    columns = ("resource_id,record_kind,path,parent_kind,parent_path,position,"
               "metric_label,missing,null_groups,negative_zero,attributes")
    with db.cursor().copy(f"COPY statarena_app.support_records ({columns}) FROM STDIN") as stream:
        for row in rows:
            resource_id, *rest = row
            path = rest[:node.depth]
            missing, nulls, *values = rest[node.depth:]
            attributes = dict(zip((c for c, _ in node.columns), values))
            stream.write_row((resource_id, node.table, path, node.parent,
                              path[:-1] if node.parent else None,
                              path[-1] if path else None, None, missing, nulls,
                              [col for col, kind in node.columns if kind == "double precision"
                               and attributes.get(col) == 0 and math.copysign(1, attributes[col]) < 0],
                              Jsonb(attributes)))
