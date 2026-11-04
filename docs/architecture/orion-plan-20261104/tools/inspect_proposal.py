"""Independent static inspection of the proposal and its rendered documentation."""
import collections
import datetime
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

OUT = Path(__file__).resolve().parents[1]
baseline = json.loads((OUT / "inputs/Orion_schema_bdd.original.json").read_text())
model = json.loads((OUT / "target-schema.proposed.json").read_text())
all_tables = [t for s in model["schemas"] for t in s["tables"]]
tables = {t["qualified_name"]: t for t in all_tables}
original = {t["qualified_name"]: t for s in baseline["schemas"] for t in s["tables"]}
viewer = json.loads((OUT / "viewer-data.json").read_text())
violations = []
removed_registries = {"ingest.row_versions", "ingest.dataset_snapshot_rows", "ingest.field_states", "ingest.record_row_links"}

def fail(kind, **details):
    violations.append(dict(kind=kind, **details))

def real_key(table, key, primary=False):
    columns = key.get("columns", [])
    return (bool(columns) and len(columns) == len(set(columns))
            and all(c in table["columns"] for c in columns)
            and not key.get("where_sql") and not key.get("deferrable", False)
            and (not primary or all(table["columns"][c].get("nullable") is False for c in columns)))

if len(tables) != len(all_tables):
    fail("duplicate_table_names")
indexed_names = collections.defaultdict(list)
for name, t in tables.items():
    if len(t["name"].encode()) > 63:
        fail("identifier_too_long", table=name)
    cols = t["columns"]
    pk = t["primary_key"]
    if not real_key(t, pk, primary=True):
        fail("primary_key_not_real_nonnullable_key", table=name, columns=pk.get("columns"))
    local_names = []
    for label, entries in (("primary_key", [pk]), ("unique_constraints", t["unique_constraints"]),
                           ("foreign_keys", t["foreign_keys"]), ("checks", t["checks"]), ("indexes", t["indexes"])):
        for e in entries:
            local_names.append(e["name"])
            if len(e["name"].encode()) > 63:
                fail("constraint_identifier_too_long", table=name, name=e["name"])
            if label in ("primary_key", "unique_constraints", "indexes"):
                indexed_names[(name.split(".")[0], e["name"])].append(name + "." + label)
    if len(local_names) != len(set(local_names)):
        fail("duplicate_local_constraint_names", table=name)
    for key in t["unique_constraints"]:
        if not key.get("columns") or any(c not in cols for c in key["columns"]):
            fail("missing_unique_key_column", table=name, columns=key.get("columns"))
        if key.get("where_sql"):
            fail("partial_unique_declared_as_constraint", table=name, name=key["name"])
    for index in t["indexes"]:
        if any(k.get("column") not in cols for k in index["keys"] if "column" in k):
            fail("missing_index_column", table=name, name=index["name"])
    for f in t["foreign_keys"]:
        target = tables.get(f["references"]["table"])
        if not target:
            fail("missing_fk_table", table=name, fk=f["name"])
            continue
        left, right = f["columns"], f["references"]["columns"]
        target_keys = [target["primary_key"]] + target["unique_constraints"]
        valid_targets = [k["columns"] for k in target_keys if real_key(target, k, primary=k is target["primary_key"])]
        if right not in valid_targets:
            fail("fk_target_not_real_nonpartial_unique", table=name, fk=f["name"])
        if not left or len(left) != len(right) or any(c not in cols for c in left) or any(c not in target["columns"] for c in right):
            fail("fk_columns_invalid", table=name, fk=f["name"])
            continue
        for a, b in zip(left, right):
            if cols[a]["type"].lower() != target["columns"][b]["type"].lower():
                fail("fk_type_mismatch", table=name, fk=f["name"], columns=[a, b])
    for removed in set(original.get(name, {}).get("columns", {})) - set(cols):
        for c in t["checks"]:
            if re.search(r"\b" + re.escape(removed) + r"\b", re.sub(r"'[^']*'", "", c["sql"])):
                fail("check_uses_removed_column", table=name, column=removed)
    if name in removed_registries or "row_version_id" in cols or t.get("history_of") or t["name"].endswith("_history"):
        fail("universal_registry_or_separate_history_remaining", table=name)
for (schema, name), locations in indexed_names.items():
    if len(locations) > 1:
        fail("schema_index_name_collision", schema=schema, name=name, locations=locations)

# The initial tables are responsibilities, never a count quota or a preservation rule.
dispositions = model["planning"].get("baseline_dispositions", {})
if set(dispositions) != set(original):
    fail("baseline_responsibility_disposition_coverage", missing=sorted(set(original)-set(dispositions)), extra=sorted(set(dispositions)-set(original)))
for name, item in dispositions.items():
    if item.get("action") not in {"retained_adapted", "retained", "merged", "renamed", "deferred"} or not item.get("reason", "").strip():
        fail("invalid_baseline_disposition", table=name)
    targets = item.get("targets", [])
    if (not targets and item.get("action") != "deferred") or any(n not in tables for n in targets):
        fail("invalid_baseline_destination", table=name, targets=targets)

policy = model.get("selective_versioning", {})
classes = {k: policy.get(k, []) for k in ("selected_relations", "parent_version_children", "existing_append_only", "stable_identities")}
classified = [n for names in classes.values() for n in names]
if len(classified) != len(set(classified)) or set(classified) - set(tables):
    fail("version_classes_overlap_or_unknown")
allowed_selected = {"inline_fact", "inline_resolution", "inline_definition", "inline_mapping", "profile_observation", "atomic_collection", "immutable_family_parent", "inline_publication_pointer"}
expected_kind = {"parent_version_children": {"parent_version_child"}, "existing_append_only": {"existing_append_only"}, "stable_identities": {"stable_identity"}, "selected_relations": allowed_selected}
for group, names in classes.items():
    for name in names:
        if name not in tables:
            continue
        t, meta = tables[name], tables[name].get("versioning", {})
        if meta.get("kind") not in expected_kind[group]:
            fail("incorrect_version_class", table=name, group=group)
        if group in ("selected_relations", "parent_version_children"):
            if meta.get("physical_key") != t["primary_key"]["columns"] or meta.get("physical_grain") != t["grain"] or not meta.get("logical_grain_description"):
                fail("physical_logical_grain_metadata_invalid", table=name)
            if not meta.get("logical_key") or any(c not in t["columns"] for c in meta.get("logical_key", [])):
                fail("logical_key_metadata_invalid", table=name)
        if group == "parent_version_children":
            binding = meta.get("parent_version_binding", {})
            parent = tables.get(meta.get("parent"))
            if not parent or binding.get("references") != dict(table=meta["parent"], columns=parent["primary_key"]["columns"]):
                fail("parent_version_binding_invalid", table=name)
        if group == "selected_relations":
            start, end = ("published_from_gen", "published_to_gen") if meta.get("kind") == "inline_publication_pointer" else ("recorded_from_gen", "recorded_to_gen")
            if t["columns"].get(start, {}).get("nullable") is not False or end not in t["columns"]:
                fail("version_interval_columns_missing", table=name)
            for index in meta.get("selection_indexes", []):
                actual = next((i for i in t["indexes"] if i["name"] == index["name"]), None)
                if not actual or not actual.get("unique") or not actual.get("where_sql") or [k["column"] for k in actual["keys"]] != index["columns"] or actual["where_sql"] != index["where_sql"] or actual.get("nulls_not_distinct", False) != index["nulls_not_distinct"]:
                    fail("selection_index_metadata_invalid", table=name, index=index["name"])
for name, t in tables.items():
    if t.get("versioning") and name not in classified:
        fail("unmanifested_version_class", table=name)
if policy.get("policy") != "selective_inline_versions_v1" or policy.get("sql_execution") != "not_performed" or policy.get("purge_authorized") is not False:
    fail("version_policy_or_execution_scope_invalid")
if model["planning"].get("version_classes") != {k: len(v) for k, v in classes.items()}:
    fail("version_class_count_mismatch")
standing_context = ["source_record_id", "competition_season_id", "stage_id", "group_id", "group_label", "scope"]
standing = tables["football.standing_snapshots"]
if not any(u["columns"] == standing_context + ["data_revision"] and u.get("nulls_not_distinct") for u in standing["unique_constraints"]) or any(u["columns"] == standing_context for u in standing["unique_constraints"]):
    fail("standing_same_record_normalization_revision_blocked")
details = tables["football.match_observation_details"]
if details["primary_key"]["columns"] != ["source_record_id", "recorded_from_gen"]:
    fail("match_detail_same_record_normalization_revision_blocked")
append_rules = policy.get("append_only_revision_rules", {})
expected_append_rules = {"football.standing_snapshots": "data_revision", "football.ranking_snapshots": "revision", "football.match_observation_details": "recorded_from_gen"}
if set(append_rules) != set(expected_append_rules):
    fail("append_only_normalization_rule_coverage")
for name, revision in expected_append_rules.items():
    rule, meta = append_rules.get(name, {}), tables[name]["versioning"]
    if rule.get("revision_column") != revision or rule.get("seal_gate") != "strict_revision_generation_order_and_immutable_prior_rows" or rule.get("no_op_reimport") != "reuse_existing_revision_and_generation" or meta.get("physical_key") != tables[name]["primary_key"]["columns"] or meta.get("historical_selection") != rule.get("historical_selection"):
        fail("append_only_normalization_contract_invalid", table=name)
h2h = tables["football.match_h2h_entries"]
if not any(f["columns"] == ["source_id", "source_record_id"] and f["references"] == dict(table="ingest.source_records", columns=["source_id", "id"]) for f in h2h["foreign_keys"]):
    fail("h2h_provider_provenance_unbound")

bootstrap = model.get("bootstrap", {})
seed_details = []
for name, rows in model.get("seed_data", {}).items():
    t = tables[name]
    bindings = bootstrap.get("seed_bindings", {}).get(name, {})
    if any(token not in bootstrap.get("bindings", {}) for token in bindings.values()):
        fail("unknown_seed_runtime_binding", table=name)
    for row in rows:
        missing = [c for c, spec in t["columns"].items() if spec.get("nullable") is False
                   and c not in row and c not in bindings and not any(k in spec for k in ("default_sql", "identity", "generated_sql"))]
        if missing or set(row)-set(t["columns"]) or any(row.get(c) is None for c in row if t["columns"][c].get("nullable") is False):
            fail("seed_template_incomplete", table=name, key=row.get("code"), missing=missing)
        contract = (row.get("relation_code"), row.get("contract_version"))
        if not any((r["relation_code"], r["contract_version"]) == contract for r in bootstrap.get("relation_contracts", [])):
            fail("seed_contract_missing", table=name, contract=contract)
    seed_details.append(dict(table=name, rows=len(rows), runtimeBindings=bindings))
if bootstrap.get("status") != "templates_require_runtime_bindings_not_a_complete_sql_seed":
    fail("bootstrap_must_not_claim_executed_seed")

# Compare the browser dictionary to every actual key/constraint and version contract.
vt = {t["name"]: t for t in viewer["tables"]}
if set(vt) != set(tables):
    fail("viewer_table_coverage")
for name, t in tables.items():
    rendered = vt.get(name, {})
    for section in ("primary_key", "unique_constraints", "foreign_keys", "checks", "indexes", "grain", "versioning", "description"):
        if rendered.get(section) != t.get(section, {} if section == "versioning" else None):
            fail("viewer_model_mismatch", table=name, section=section)
    if [{k:v for k,v in c.items() if k not in ("name", "keys")} for c in rendered.get("columns", [])] != list(t["columns"].values()) or [c["name"] for c in rendered.get("columns", [])] != list(t["columns"]):
        fail("viewer_column_mismatch", table=name)
for mapping in viewer["current_to_target"]:
    for target in mapping["targets"]:
        if any(n in target for n in removed_registries):
            fail("mapping_targets_removed_registry", current=mapping["current"], target=target)
        if re.fullmatch(r"(?:ingest|football|analytics)\.[a-z_]+", target) and target not in tables:
            fail("mapping_targets_missing_table", current=mapping["current"], target=target)
for mapping in model.get("migration_mapping", []):
    if set(mapping.get("targets", [])) & removed_registries:
        fail("model_mapping_targets_removed_registry", source=mapping["source"])

seen_tables, seen_columns = [], 0
for domain in viewer["domains"]:
    root = ET.parse(OUT / domain["file"]).getroot()
    svg = {"s": "http://www.w3.org/2000/svg"}
    nodes = {g.find("s:title", svg).text: g for g in root.findall(".//s:g[@class='node']", svg)}
    edges = root.findall(".//s:g[@class='edge']", svg)
    if len(edges) != domain["outgoing_fks"]:
        fail("diagram_fk_count", domain=domain["id"], actual=len(edges), expected=domain["outgoing_fks"])
    for name in domain["tables"]:
        seen_tables.append(name)
        node = nodes.get(name)
        if node is None:
            fail("table_missing_from_svg", table=name)
            continue
        node_text = {e.text.strip() for e in node.findall(".//s:text", svg) if e.text}
        for col in tables[name]["columns"]:
            if col not in node_text:
                fail("column_missing_from_svg", table=name, column=col)
            seen_columns += 1
if collections.Counter(seen_tables) != collections.Counter(tables.keys()):
    fail("diagram_table_coverage")
if seen_columns != sum(len(t["columns"]) for t in tables.values()):
    fail("diagram_column_count")
for diagram in (OUT / "diagrams").glob("*.dot"):
    text = diagram.read_text()
    if any(n in text for n in removed_registries):
        fail("diagram_uses_removed_registry", file=diagram.name)
definitions = json.loads((OUT / "evidence/dictionary-review.json").read_text())
if definitions["fallback_definitions_requiring_review"] or definitions["unmapped_current_relations"]:
    fail("dictionary_or_mapping_incomplete", details=definitions)
flow = (OUT / "diagrams/architecture-cible.dot").read_text()
if " Jobs -> S3 " in flow or " MediaJobs -> S3 " not in flow:
    fail("new_pitchapi_data_flow_must_bypass_s3")
current_flow = (OUT / "diagrams/architecture-actuelle.dot").read_text()
if "JSON / CSV / SQLite / archives" not in current_flow or "ingest / football / analytics" in current_flow:
    fail("current_architecture_must_not_claim_target_applied")
if model["database"]["object_storage"].get("new_pitchapi_data") is None:
    fail("direct_ingestion_policy_missing")
if tables["ingest.source_documents"]["columns"]["storage_provider"].get("default_sql") != "'http_direct'":
    fail("new_source_receipt_defaults_to_file_storage")
counts = dict(baselineResponsibilities=len(original), baselineColumns=sum(len(t["columns"]) for t in original.values()),
              dispositions=len(dispositions), tables=len(tables), columns=seen_columns,
              activeTables=sum(t["phase"] != "models" for t in tables.values()),
              activeColumns=sum(len(t["columns"]) for t in tables.values() if t["phase"] != "models"),
              activeForeignKeys=sum(len(t["foreign_keys"]) for t in tables.values() if t["phase"] != "models"),
              foreignKeys=sum(len(t["foreign_keys"]) for t in tables.values()),
              uniqueConstraints=sum(len(t["unique_constraints"]) for t in tables.values()),
              indexes=sum(len(t["indexes"]) for t in tables.values()),
              uniquePartialIndexes=sum(bool(i.get("unique") and i.get("where_sql")) for t in tables.values() for i in t["indexes"]),
              checks=sum(len(t["checks"]) for t in tables.values()),
              jsonb=sum(c["type"] == "jsonb" for t in tables.values() for c in t["columns"].values()),
              domainDiagrams=len(viewer["domains"]), currentRelations=len(viewer["current_to_target"]),
              versionClasses={k: len(v) for k,v in classes.items()},
              otherOperationalOrDerivedTables=len(tables)-len(classified),
              separateHistoryTables=sum(bool(t.get("history_of")) or t["name"].endswith("_history") for t in tables.values()))
receipt = {"atUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "command": "python3 docs/architecture/orion-plan-20261104/tools/inspect_proposal.py",
           "modelSha256": hashlib.sha256((OUT / "target-schema.proposed.json").read_bytes()).hexdigest(),
           "scope": "Static responsibilities/dispositions, actual nonnullable PK/nonpartial UQ FK targets/types, version classes, seed templates/bindings, rendered dictionary and complete domain diagrams. No SQL execution.",
           "counts": counts, "seedTemplates": seed_details, "violations": violations, "passed": not violations,
           "limits": "This static inspection does not execute bootstrap or SQL. Separate bounded local pilot receipts now exist; complete source reconciliation, numeric/state fidelity, public application/cache parity, RDS performance and full acceptance remain open."}
(OUT / "evidence/proposal-inspection.json").write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n")
print(json.dumps({"passed": receipt["passed"], "counts": counts, "violations": violations}, ensure_ascii=False))
raise SystemExit(bool(violations))
