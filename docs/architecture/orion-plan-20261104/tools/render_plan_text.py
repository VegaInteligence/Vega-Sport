"""Render narrative counts from the very same model used by the diagrams."""
import datetime
import hashlib
import json
from pathlib import Path
import re

OUT = Path(__file__).resolve().parents[1]
model = json.loads((OUT / "target-schema.proposed.json").read_text())
tables = [t for s in model["schemas"] for t in s["tables"]]
domains = json.loads((OUT / "diagrams/index.json").read_text())
baseline = json.loads((OUT / "inputs/Orion_schema_bdd.original.json").read_text())
counts = {"tables": len(tables), "columns": sum(len(t["columns"]) for t in tables),
          "foreign_keys": sum(len(t["foreign_keys"]) for t in tables),
          "jsonb": sum(c["type"] == "jsonb" for t in tables for c in t["columns"].values()),
          "active_tables": sum(t["phase"] != "models" for t in tables),
          "baseline_tables": sum(len(s["tables"]) for s in baseline["schemas"]),
          "domain_diagrams": len(domains),
          "separate_history_tables": sum(t.get("history_of") is not None or t["name"].endswith("_history") for t in tables)}
classes = {k: len(model["selective_versioning"][k]) for k in ("selected_relations", "parent_version_children", "existing_append_only", "stable_identities")}
counts["version_classes"] = classes
counts["other_operational_or_derived_tables"] = counts["tables"] - sum(classes.values())
policy = model.get("planning", {}).get("version_policy", "design_not_finalized")
policy_label = {
    "selective_inline_versions_per_pro": "versions sélectives conservées dans les tables métier, conformément à la revue Pro priorisée par l'utilisateur",
}.get(policy, "révision en cours ; clés et garanties encore à finaliser avant migration")
values = {"TABLES": str(counts["tables"]),
          "COLUMNS_FR": f"{counts['columns']:,}".replace(",", " "),
          "FOREIGN_KEYS": str(counts["foreign_keys"]),
          "DOMAIN_DIAGRAMS": str(counts["domain_diagrams"]),
          "JSONB_COUNT": str(counts["jsonb"]),
          "ACTIVE_TABLES": str(counts["active_tables"]),
          "BASELINE_TABLES": str(counts["baseline_tables"]),
          "SELECTED_RELATIONS": str(classes["selected_relations"]),
          "PARENT_VERSION_CHILDREN": str(classes["parent_version_children"]),
          "APPEND_ONLY": str(classes["existing_append_only"]),
          "STABLE_IDENTITIES": str(classes["stable_identities"]),
          "OTHER_TABLES": str(counts["other_operational_or_derived_tables"]),
          "REVISION_POLICY_STATUS": policy_label}
template = (OUT / "tools/PLAN.template.md").read_text()
unknown = set(re.findall(r"\{\{([A-Z_]+)\}\}", template)) - set(values)
if unknown:
    raise ValueError("Unknown plan placeholders: " + ",".join(sorted(unknown)))
for name, value in values.items():
    template = template.replace("{{" + name + "}}", value)
if "{{" in template or "}}" in template:
    raise ValueError("Unresolved plan placeholder")
(OUT / "PLAN.md").write_text(template)
receipt = {"atUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "command": "python3 docs/architecture/orion-plan-20261104/tools/render_plan_text.py",
           "modelSha256": hashlib.sha256((OUT / "target-schema.proposed.json").read_bytes()).hexdigest(),
           "planSha256": hashlib.sha256((OUT / "PLAN.md").read_bytes()).hexdigest(),
           "counts": counts, "policy": policy,
           "scope": "Plan text, JSON counts and domain index share one model. No SQL execution or service acceptance.",
           "passed": counts["separate_history_tables"] == 0 and all(counts[k] == model["planning"][p] for k,p in (("tables","tables"),("columns","columns"),("foreign_keys","foreign_keys"))) and classes == model["planning"]["version_classes"]}
(OUT / "evidence/plan-coherence.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt))
if not receipt["passed"]:
    raise SystemExit("Separate history table remains in rendered model")
