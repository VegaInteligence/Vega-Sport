"""Generate migration 023 from the provider mappings and bounded SQL operations."""

import json
from pathlib import Path

from consolidated_model import CATALOG_MODELS, MODEL_DIGEST, NODES, manifest
from relational_match_ddl import projected
from relational_match_model import families

HERE = Path(__file__).resolve().parent
ARRAYS = {"integer[]": "integer_array", "text[]": "text_array", "integer[][]": "integer_matrix"}


def q(value):
    return '"' + value.replace('"', '""') + '"'


def lit(value):
    return "'" + value.replace("'", "''") + "'"


def path(node, alias="t"):
    keys = node.key_columns[1:]
    return "ARRAY[" + ",".join(alias + "." + q(k) for k in keys) + "]::integer[]"


def cursor(node, op, resource, record_path, alias="t"):
    left = [alias + "." + q(k) for k in node.key_columns]
    right = [resource, *(f"({record_path})[{i + 1}]" for i in range(len(left) - 1))]
    return "ROW(" + ",".join(left) + ") " + op + " ROW(" + ",".join(right) + ")"


def columns(node):
    return [*node.metadata_columns, *(col for col, _ in node.columns)]


def cast(col, kind):
    value = "r.attributes->" + lit(col)
    if kind in ARRAYS:
        return f"statarena_app.record_{ARRAYS[kind]}({value})"
    if kind == "double precision":
        return f"CASE WHEN {lit(col)}=ANY(r.negative_zero) THEN '-0'::double precision ELSE (r.attributes->>{lit(col)})::double precision END"
    return "(r.attributes->>" + lit(col) + ")::" + kind


def preview(node):
    values = {node.resource: "r.resource_id", "missing": "r.missing", "null_groups": "r.null_groups"}
    if node.domain == "support":
        values.update({"ordinal_" + str(i + 1): f"r.path[{i + 1}]" for i in range(node.depth)})
    else:
        values["record_no"] = "r.path[1]"
        if node.parent:
            values.update(parent_no="r.parent_path[1]", position="r.position")
        if node.keyed:
            values["metric_label"] = "r.metric_label"
    values.update({col: cast(col, kind) for col, kind in node.columns})
    return (f"CREATE OR REPLACE VIEW statarena_next.{node.table} AS SELECT\n "
            + ",\n ".join(values[col] + " AS " + q(col) for col in columns(node))
            + f"\nFROM statarena_app.{node.store} r WHERE r.record_kind={lit(node.table)};")


def attributes_valid(node):
    checks = ["jsonb_typeof(a)='object'", "(a - ARRAY[" + ",".join(lit(c) for c, _ in node.columns) + "]::text[])='{}'::jsonb"]
    for col, kind in node.columns:
        v = "a->" + lit(col)
        text = "a->>" + lit(col)
        if kind in ARRAYS:
            valid = f"CASE WHEN jsonb_typeof({v})='array' THEN to_jsonb(statarena_app.record_{ARRAYS[kind]}({v}))={v} ELSE false END"
        elif kind in ("integer", "double precision"):
            valid = f"CASE WHEN jsonb_typeof({v})='number' THEN ({text})::{kind} IS NOT NULL ELSE false END"
        elif kind == "date":
            valid = f"CASE WHEN jsonb_typeof({v})='string' AND ({text}) ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}$' THEN ({text})::date IS NOT NULL ELSE false END"
        else:
            valid = "jsonb_typeof(" + v + ")=" + lit("string" if kind == "text" else "boolean")
        checks.append(f"(a ? {lit(col)} AND ({v}='null'::jsonb OR ({valid})))")
    return " AND ".join(checks)


def shape(node):
    if node.parent:
        checks = [f"parent_kind={lit(node.parent)}", "parent_path IS NOT NULL", "position>=0"]
        if node.domain == "support":
            checks += [f"cardinality(path)={node.depth}", "parent_path=path[1:cardinality(path)-1]", "position=path[cardinality(path)]"]
        else:
            checks += ["cardinality(path)=1", "cardinality(parent_path)=1"]
    else:
        checks = ["path=" + ("'{}'" if node.domain == "support" else "'{0}'") + "::integer[]",
                  "parent_kind IS NULL", "parent_path IS NULL", "position IS NULL"]
    checks.append("metric_label IS " + ("NOT " if node.keyed else "") + "NULL")
    return " AND ".join(checks)


def plan():
    items = []
    for node in NODES:
        parent_path = ("t." + q("parent_no") if node.domain != "support" else None)
        if node.domain == "support":
            parent = ("ARRAY[" + ",".join("t." + q(k) for k in node.key_columns[1:-1]) + "]::integer[]") if node.parent else "NULL::integer[]"
            pos = "t." + q(node.key_columns[-1]) if node.parent else "NULL::integer"
        else:
            parent = f"ARRAY[{parent_path}]::integer[]" if node.parent else "NULL::integer[]"
            pos = "t.position" if node.parent else "NULL::integer"
        key_json = "ARRAY[" + ",".join(lit(c) for c in node.metadata_columns) + "]::text[]"
        negatives = "array_remove(ARRAY[" + ",".join(
            f"CASE WHEN float8send(t.{q(col)})=decode('8000000000000000','hex') THEN {lit(col)} END"
            for col, kind in node.columns if kind == "double precision") + "]::text[],NULL)"
        evidence = [f"float8send(t.{q(col)})" if kind == "double precision" else f"array_send(t.{q(col)})"
                    for col, kind in node.columns if kind == "double precision" or kind in ARRAYS]
        evidence = "jsonb_build_array(to_jsonb(t)," + ("jsonb_build_array(" + ",".join(evidence) + ")" if evidence else "'[]'::jsonb") + ")"
        select = ",".join([
            "t." + q(node.resource), lit(node.table), path(node),
            lit(node.parent) if node.parent else "NULL::text", parent, pos,
            "t.metric_label" if node.keyed else "NULL::text", "t.missing", "t.null_groups", negatives,
            "to_jsonb(t)-" + key_json,
        ])
        names = columns(node)
        nonkeys = [c for c in names if c not in node.key_columns]
        items.append(dict(table=node.table, store=node.store, domain=node.domain,
                          parent=node.parent, resource=node.resource,
                          keys=list(node.key_columns), columns=names,
                          path=path(node), order=",".join("t." + q(c) for c in node.key_columns),
                          cursor=cursor(node, ">", "$1", "$2"),
                          upper=cursor(node, "<=", "$3", "$4"),
                          lookup=cursor(node, "=", "r.resource_id", "r.path"),
                          select=select, evidence=evidence,
                          column_sql=",".join(map(q, names)),
                          select_columns=",".join("t." + q(c) for c in names),
                          conflict=",".join(map(q, node.key_columns)),
                          assignments=",".join(q(c) + "=excluded." + q(c) for c in nonkeys)))
    return items


def next_projection(model):
    value = projected(model, "r")
    for node in NODES:
        value = value.replace("FROM statarena_app." + node.table + " ", "FROM statarena_next." + node.table + " ")
    return value


def migration():
    sql = ["-- Generated by dashboard/scripts/consolidation_sql.py; do not edit this applied migration.",
           "-- 112 provider-shaped tables -> three bounded, constrained physical record stores.",
           """DO $schemas$ BEGIN
 IF to_regnamespace('statarena_next') IS NULL THEN CREATE SCHEMA statarena_next; END IF;
 IF to_regnamespace('statarena_retired_v1') IS NULL THEN CREATE SCHEMA statarena_retired_v1; END IF;
END $schemas$;
CREATE TABLE IF NOT EXISTS statarena_app.consolidation_state(key text PRIMARY KEY,value jsonb NOT NULL);
REVOKE ALL ON statarena_app.consolidation_state FROM PUBLIC;""",
           "INSERT INTO statarena_app.consolidation_state VALUES('control'," + lit(json.dumps(dict(mode="legacy", revision=0, model_digest=MODEL_DIGEST))) + "::jsonb) ON CONFLICT DO NOTHING;",
           "CREATE OR REPLACE FUNCTION statarena_app.consolidation_plan() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $plan$ SELECT " + lit(json.dumps(plan(), separators=(",", ":"))) + "::jsonb; $plan$;"]
    for kind, name in ARRAYS.items():
        sql.append(f"CREATE OR REPLACE FUNCTION statarena_app.record_{name}(value jsonb) RETURNS {kind} LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT v FROM jsonb_to_record(jsonb_build_object('v',value)) x(v {kind}); $$;")
    for domain, header, id_col in (("catalog", "catalog_editions", "resource_id"), ("support", "support_projection", "id"), ("detail", "match_families", "resource_id")):
        nodes = [n for n in NODES if n.domain == domain]
        sql.append(f"CREATE OR REPLACE FUNCTION statarena_app.{domain}_attributes_valid(kind text,a jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(CASE kind\n"
                   + "\n".join(f"WHEN {lit(n.table)} THEN ({attributes_valid(n)})" for n in nodes)
                   + "\nELSE false END,false); $$;")
        sql.append(f"""CREATE TABLE IF NOT EXISTS statarena_app.{domain}_records (
 resource_id bigint NOT NULL REFERENCES statarena_app.{header}({id_col}) ON DELETE CASCADE,
 record_kind text NOT NULL, path integer[] NOT NULL,
 parent_kind text, parent_path integer[], position integer, metric_label text,
 missing text[] NOT NULL, null_groups text[] NOT NULL, negative_zero text[] NOT NULL DEFAULT '{{}}', attributes jsonb NOT NULL,
 PRIMARY KEY(resource_id,record_kind,path),
 FOREIGN KEY(resource_id,parent_kind,parent_path)
   REFERENCES statarena_app.{domain}_records(resource_id,record_kind,path) ON DELETE CASCADE,
 UNIQUE NULLS NOT DISTINCT(resource_id,record_kind,parent_path,position),
 CHECK(coalesce(array_ndims(path)=1,true) AND array_position(path,NULL) IS NULL AND 0<=ALL(path)),
 CHECK(parent_path IS NULL OR (coalesce(array_ndims(parent_path)=1,true) AND array_position(parent_path,NULL) IS NULL AND 0<=ALL(parent_path))),
 CHECK(array_position(missing,NULL) IS NULL AND array_position(null_groups,NULL) IS NULL AND array_position(negative_zero,NULL) IS NULL),
 CHECK(octet_length(attributes::text)<=8388608),
 CHECK(statarena_app.{domain}_attributes_valid(record_kind,attributes)),
 CHECK(coalesce(CASE record_kind
""" + "\n".join(f" WHEN {lit(n.table)} THEN ({shape(n)})" for n in nodes) + "\n ELSE false END,false))\n);")
        sql.append(f"ALTER TABLE statarena_app.{domain}_records ADD CONSTRAINT {domain}_negative_zero_fields CHECK(coalesce(CASE record_kind\n"
                   + "\n".join(f" WHEN {lit(n.table)} THEN negative_zero <@ ARRAY[" + ",".join(lit(col) for col, kind in n.columns if kind == "double precision") + "]::text[]"
                                + "".join(f" AND (NOT {lit(col)}=ANY(negative_zero) OR attributes->{lit(col)}='0'::jsonb)" for col, kind in n.columns if kind == "double precision")
                                for n in nodes)
                   + "\n ELSE false END,false));")
        sql += [f"CREATE INDEX IF NOT EXISTS {domain}_records_scan ON statarena_app.{domain}_records(record_kind,resource_id,path);",
                f"CREATE INDEX IF NOT EXISTS {domain}_records_parent ON statarena_app.{domain}_records(resource_id,parent_kind,parent_path);",
                f"CREATE UNIQUE INDEX IF NOT EXISTS {domain}_records_labels ON statarena_app.{domain}_records(resource_id,record_kind,parent_path,metric_label) WHERE metric_label IS NOT NULL;"]
    sql.extend(preview(n) for n in NODES)
    # Selective predicates in public compatibility views use exactly these expressions.
    sql += [
        "CREATE INDEX IF NOT EXISTS catalog_records_entity ON statarena_app.catalog_records(resource_id,(attributes->>'entityId')) WHERE record_kind='cat_ranking_uefa_clubs_rows';",
        "CREATE INDEX IF NOT EXISTS catalog_records_club ON statarena_app.catalog_records(resource_id,metric_label) WHERE record_kind='cat_club_links_links';",
        "CREATE INDEX IF NOT EXISTS catalog_records_cup ON statarena_app.catalog_records(resource_id,(attributes->>'folder'),(attributes->>'season')) WHERE record_kind='cat_cup_worker_index_competitions';",
        "CREATE INDEX IF NOT EXISTS detail_records_event_type ON statarena_app.detail_records(resource_id,(attributes->>'event_type')) WHERE record_kind='match_events';",
    ]
    for spec in CATALOG_MODELS.values():
        # Only roots need a public response helper; subtree reconstruction uses indexed nodes.
        sql.append(f"CREATE OR REPLACE FUNCTION statarena_next.read_{spec.table}(r statarena_next.{spec.table}) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT {next_projection(spec.fields)}; $$;")
    sql.append("CREATE OR REPLACE FUNCTION statarena_next.catalog_response(c statarena_app.catalog_editions) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT CASE c.model\n"
               + "\n".join(f"WHEN {lit(key)} THEN (SELECT statarena_next.read_{spec.table}(r) FROM statarena_next.{spec.table} r WHERE r.resource_id=c.resource_id)" for key, spec in CATALOG_MODELS.items())
               + "\nEND; $$;")
    alternatives = []
    for family, spec in families.items():
        projection = next_projection(spec.fields) + (" -> 'players'" if family == "players" else "")
        schema = "statarena_next" if spec.table in {n.table for n in NODES} else "statarena_app"
        sql.append(f"CREATE OR REPLACE FUNCTION statarena_next.detail_data_{family}(rid bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT {projection} FROM {schema}.{spec.table} r WHERE r.resource_id=rid; $$;")
        alternatives.append(f"WHEN '{family}' THEN statarena_next.detail_data_{family}(f.resource_id)")
    alternatives += ["WHEN 'single_shot' THEN statarena_next.detail_data_shots(f.resource_id) #> '{periods,0,shots,0}'",
                     "WHEN 'single_player' THEN statarena_next.detail_data_players(f.resource_id) -> 0",
                     "WHEN 'single_halves' THEN (SELECT (payload #> '{players,0}') || (payload-'players') FROM statarena_next.detail_data_player_halves(f.resource_id) payload)",
                     "WHEN 'single_advanced' THEN statarena_next.detail_data_advanced_players(f.resource_id) #> '{players,0}'"]
    sql.append("""CREATE OR REPLACE FUNCTION statarena_next.detail_response(f statarena_app.match_families)
RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('status',f.status)
 || CASE WHEN f.has_data THEN jsonb_build_object('data',CASE f.family
""" + "\n".join(alternatives) + """
END) ELSE '{}'::jsonb END
 || CASE WHEN f.has_error THEN jsonb_build_object('error',CASE WHEN f.error_object THEN
 (CASE WHEN f.error_has_code THEN jsonb_build_object('code',f.error_code) ELSE '{}'::jsonb END) ||
 (CASE WHEN f.error_has_message THEN jsonb_build_object('message',f.error_message) ELSE '{}'::jsonb END)
 ELSE NULL END) ELSE '{}'::jsonb END; $$;""")
    sql.append((HERE / "consolidation_operations.sql").read_text())
    for table in [*(n.table for n in NODES), "catalog_editions", "support_projection", "match_families", "catalog_records", "support_records", "detail_records"]:
        sql.append(f"DROP TRIGGER IF EXISTS consolidation_revision ON statarena_app.{table};\nCREATE TRIGGER consolidation_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON statarena_app.{table} FOR EACH STATEMENT EXECUTE FUNCTION statarena_app.consolidation_changed();")
    sql.append("REVOKE ALL ON SCHEMA statarena_next,statarena_retired_v1 FROM PUBLIC;")
    return "\n\n".join(sql) + "\n"


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    output = migration()
    if args.write:
        (HERE.parent / "backend/migrations/023_consolidated_provider_records.sql").write_text(output)
        (HERE / "consolidation-manifest.json").write_text(json.dumps(manifest(), indent=2) + "\n")
    else:
        print(output, end="")
