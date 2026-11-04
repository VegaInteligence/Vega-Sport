"""Independent static inspection of a proposed schema and its rendered documentation."""
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
tables = {t["qualified_name"]: t for s in model["schemas"] for t in s["tables"]}
original = {t["qualified_name"]: t for s in baseline["schemas"] for t in s["tables"]}
viewer = json.loads((OUT / "viewer-data.json").read_text())
violations = []
warnings = []
names = collections.defaultdict(list)
for name, t in tables.items():
    if len(t["name"].encode()) > 63:
        violations.append({"table": name, "kind": "identifier_too_long"})
    cols = t["columns"]
    keys = [t["primary_key"]["columns"], *[u["columns"] for u in t["unique_constraints"]]]
    for key in keys:
        if any(c not in cols for c in key):
            violations.append({"table": name, "kind": "missing_key_column", "columns": key})
    for label in ("primary_key",):
        names[t[label]["name"]].append(name + "." + label)
    for label in ("unique_constraints", "foreign_keys", "checks", "indexes"):
        for e in t[label]:
            if len(e["name"].encode()) > 63:
                violations.append({"table": name, "kind": "constraint_identifier_too_long", "name": e["name"]})
            names[e["name"]].append(name + "." + label)
    for f in t["foreign_keys"]:
        target = tables.get(f["references"]["table"])
        if not target:
            violations.append({"table": name, "kind": "missing_fk_table", "fk": f["name"]})
            continue
        left, right = f["columns"], f["references"]["columns"]
        target_keys = [target["primary_key"]["columns"], *[u["columns"] for u in target["unique_constraints"]]]
        if right not in target_keys:
            violations.append({"table": name, "kind": "fk_target_not_unique", "fk": f["name"]})
        if len(left) != len(right) or any(c not in cols for c in left) or any(c not in target["columns"] for c in right):
            violations.append({"table": name, "kind": "fk_columns_invalid", "fk": f["name"]})
            continue
        for a, b in zip(left, right):
            if cols[a]["type"].lower() != target["columns"][b]["type"].lower():
                violations.append({"table": name, "kind": "fk_type_mismatch", "fk": f["name"], "columns": [a, b]})
    for removed in set(original.get(name, {}).get("columns", {})) - set(cols):
        for c in t["checks"]:
            if re.search(r"\b" + re.escape(removed) + r"\b", re.sub(r"'[^']*'", "", c["sql"])):
                violations.append({"table": name, "kind": "check_uses_removed_column", "column": removed})
for name, locations in names.items():
    # PostgreSQL constraint names are local to tables; backing index names are schema-wide.
    indexed = [x for x in locations if not x.endswith((".foreign_keys", ".checks"))]
    if len(indexed) > 1:
        warnings.append({"name": name, "locations": indexed})
if set(original) - set(tables):
    violations.append({"kind": "baseline_table_removed", "names": sorted(set(original)-set(tables))})
seen_tables = []
seen_columns = 0
for domain in viewer["domains"]:
    path = OUT / domain["file"]
    root = ET.parse(path).getroot()
    svg = {"s": "http://www.w3.org/2000/svg"}
    nodes = {g.find("s:title", svg).text: g for g in root.findall(".//s:g[@class='node']", svg)}
    edge_count = len(root.findall(".//s:g[@class='edge']", svg))
    if edge_count != domain["outgoing_fks"]:
        violations.append({"domain": domain["id"], "kind": "diagram_fk_count", "actual": edge_count, "expected": domain["outgoing_fks"]})
    for name in domain["tables"]:
        seen_tables.append(name)
        node = nodes.get(name)
        if node is None:
            violations.append({"table": name, "kind": "table_missing_from_svg"})
            continue
        node_text = {e.text.strip() for e in node.findall(".//s:text", svg) if e.text}
        for col in tables[name]["columns"]:
            if col not in node_text:
                violations.append({"table": name, "column": col, "kind": "column_missing_from_svg"})
            seen_columns += 1
if collections.Counter(seen_tables) != collections.Counter(tables.keys()):
    violations.append({"kind": "diagram_table_coverage"})
if seen_columns != sum(len(t["columns"]) for t in tables.values()):
    violations.append({"kind": "diagram_column_count"})
definitions = json.loads((OUT / "evidence/dictionary-review.json").read_text())
if definitions["fallback_definitions_requiring_review"] or definitions["unmapped_current_relations"]:
    violations.append({"kind": "dictionary_or_mapping_incomplete", "details": definitions})
flow = (OUT / "diagrams/architecture-cible.dot").read_text()
if " Jobs -> S3 " in flow or " MediaJobs -> S3 " not in flow:
    violations.append({"kind":"new_pitchapi_data_flow_must_bypass_s3"})
current_flow = (OUT / "diagrams/architecture-actuelle.dot").read_text()
if "JSON / CSV / SQLite / archives" not in current_flow or "ingest / football / analytics" in current_flow:
    violations.append({"kind":"current_architecture_must_not_claim_target_already_applied"})
if model["database"]["object_storage"].get("new_pitchapi_data") is None:
    violations.append({"kind":"direct_ingestion_policy_missing"})
source_meta=tables["ingest.source_documents"]
if source_meta["columns"]["storage_provider"].get("default_sql") != "'http_direct'":
    violations.append({"kind":"new_source_receipt_defaults_to_file_storage"})
receipt = {"atUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "command": "python3 docs/architecture/orion-plan-20261104/tools/inspect_proposal.py",
           "scope": "Static proposal: table preservation, key/FK targets and types, removed-column CHECK references, complete diagrams/dictionary/current relation inventory. No database execution.",
           "counts": {"baselineTables": len(original), "baselineColumns": sum(len(t["columns"]) for t in original.values()), "tables": len(tables), "columns": seen_columns, "foreignKeys": sum(len(t["foreign_keys"]) for t in tables.values()), "domainDiagrams": len(viewer["domains"]), "currentRelations": len(viewer["current_to_target"])},
           "violations": violations, "indexNameWarnings": warnings, "passed": not violations,
           "limits": "Does not validate SQL execution, intertable triggers, data migration, source reconciliation or application acceptance. Those require the user's plan approval first."}
(OUT / "evidence/proposal-inspection.json").write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n")
print(json.dumps({"passed": receipt["passed"], "counts": receipt["counts"], "violations": violations, "warnings": warnings}, ensure_ascii=False))
raise SystemExit(bool(violations))
