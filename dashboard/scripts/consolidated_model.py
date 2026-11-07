"""One checked-in mapping for the bounded provider records, writers and migration.

The public match/appearance facts stay relational. This replaces tables generated
for every branch of a provider document, not those canonical facts or the compact
player-metric dictionaries. Each stored object is one node; collections remain
ordered children with enforced foreign keys, never season-sized JSON documents.
"""

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path

from relational_match_model import Children, families
from relational_match_ddl import dbname, fields, leaves

ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / "backend/services/catalog-model.json").read_text(encoding="utf-8"))
SUPPORT = json.loads((ROOT / "backend/services/support-model.json").read_text(encoding="utf-8"))


def compile_fields(value):
    if isinstance(value, str):
        return value
    if "@rows" in value or "@map" in value:
        return Children(value.get("@rows", value.get("@map")),
                        compile_fields(value["fields"]), "@map" in value)
    return {key: compile_fields(item) for key, item in value.items()}


CATALOG_MODELS = {key: Children("cat_" + key, compile_fields(value))
                  for key, value in CATALOG.items()}


@dataclass(frozen=True)
class Node:
    table: str
    domain: str
    parent: str | None
    columns: tuple
    depth: int = 0
    keyed: bool = False

    @property
    def store(self):
        return self.domain + "_records"

    @property
    def resource(self):
        return "projection_id" if self.domain == "support" else "resource_id"

    @property
    def key_columns(self):
        return (self.resource, *(
            tuple("ordinal_" + str(i + 1) for i in range(self.depth))
            if self.domain == "support" else ("record_no",)
        ))

    @property
    def metadata_columns(self):
        if self.domain == "support":
            return (*self.key_columns, "missing", "null_groups")
        return ("resource_id", "record_no", "missing", "null_groups",
                *(("parent_no", "position") if self.parent else ()),
                *(("metric_label",) if self.keyed else ()))


def tree(spec, domain, parent=None):
    yield Node(spec.table, domain, parent,
               tuple((dbname(path), kind) for path, kind in leaves(spec.fields)),
               keyed=spec.keyed)
    for _, child in fields(spec.fields):
        if isinstance(child, Children):
            yield from tree(child, domain, spec.table)


def support_tree(key, parent=None, depth=0):
    model = SUPPORT["models"][key]
    yield Node(model["table"], "support", parent,
               tuple(tuple(item) for item in model["fields"].values()), depth)
    for child in model["children"].values():
        yield from support_tree(child, model["table"], depth + 1)


NODES = [node for spec in CATALOG_MODELS.values() for node in tree(spec, "catalog")]
NODES += [node for root in SUPPORT["families"].values() for node in support_tree(root)]
# These two families already have physically compact, typed metric dictionaries.
# Flattening them back into a row for every metric would increase storage sharply.
NODES += [node for family, spec in families.items() if family not in ("players", "player_halves")
          for node in tree(spec, "detail")]
BY_TABLE = {node.table: node for node in NODES}
assert len(BY_TABLE) == len(NODES) == 112
MODEL_DIGEST = hashlib.sha256(b"consolidated-records-v1-negative-zero\0" + json.dumps([
    dict(table=n.table, domain=n.domain, parent=n.parent, columns=n.columns,
         depth=n.depth, keyed=n.keyed) for n in NODES
], sort_keys=True).encode()).hexdigest()


def manifest():
    return dict(version=1, model_digest=MODEL_DIGEST,
                physical_sources=len(NODES), physical_stores=3,
                state_tables=1, reduction=len(NODES) - 4,
                targets=[dict(table=n.table, domain=n.domain, store=n.store,
                              parent=n.parent, keys=n.key_columns,
                              columns=[*n.metadata_columns, *(c for c, _ in n.columns)])
                         for n in NODES])
