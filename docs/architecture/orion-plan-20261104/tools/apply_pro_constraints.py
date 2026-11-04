"""Pure in-memory Pro A/B/E/G amendments to a constructed Orion proposal.

No I/O, SQL execution, schema-count policy or version-model changes. See the
adjacent PRO_CONSTRAINT_PROTOCOL.md, written before this implementation.
"""

from copy import deepcopy
import hashlib
import re


COLLECTION_ACQUIRE_SQL = """WITH candidate AS (
    SELECT source_id, endpoint, params
    FROM ingest.collection_jobs
    WHERE state = 'pending'
      AND available_at <= statement_timestamp()
      AND attempts < 2147483647
    ORDER BY priority, available_at, source_id, endpoint, params
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
UPDATE ingest.collection_jobs AS job
SET state = 'running', attempts = job.attempts + 1,
    lease_owner = $1::text,
    lease_expires_at = statement_timestamp() + interval '10 minutes'
FROM candidate
WHERE (job.source_id, job.endpoint, job.params) =
      (candidate.source_id, candidate.endpoint, candidate.params)
RETURNING job.*;"""

COLLECTION_RECLAIM_SQL = """UPDATE ingest.collection_jobs
SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL
WHERE state = 'running' AND lease_expires_at <= statement_timestamp()
RETURNING source_id, endpoint, params, attempts;"""

# $1/$2/$3 are the original primary key; $4/$5 are the claimed owner/attempt.
COLLECTION_COMPLETE_SQL = """UPDATE ingest.collection_jobs AS job
SET state = 'done', lease_owner = NULL, lease_expires_at = NULL
WHERE job.source_id = $1::bigint AND job.endpoint = $2::text
  AND job.params = $3::text AND job.state = 'running'
  AND job.lease_owner = $4::text AND job.attempts = $5::integer
  AND job.lease_expires_at > statement_timestamp()
RETURNING job.source_id, job.endpoint, job.params, job.attempts;"""


def _short(name):
    encoded = name.encode("utf-8")
    if len(encoded) <= 63:
        return name
    prefix = encoded[:52].decode("utf-8", errors="ignore")
    return prefix + "_" + hashlib.sha256(encoded).hexdigest()[:10]


def _tables(model):
    result = {}
    for schema in model.get("schemas", []):
        for table in schema.get("tables", []):
            name = table["qualified_name"]
            if name in result:
                raise ValueError(f"Duplicate table {name}")
            result[name] = table
    return result


def _types_equal(left, right):
    aliases = {"int8": "bigint", "int4": "integer", "int": "integer",
               "int2": "smallint", "bool": "boolean",
               "timestamp with time zone": "timestamptz"}
    def normalize(value):
        value = re.sub(r"\s+", " ", value.lower().strip())
        return aliases.get(value, value)
    return normalize(left) == normalize(right)


def _require(table, columns):
    for column, kind in columns.items():
        actual = table.get("columns", {}).get(column)
        if actual is None or not _types_equal(actual["type"], kind):
            raise ValueError(f"{table['qualified_name']}.{column} must exist with type {kind}")
    for key in ("unique_constraints", "foreign_keys", "checks", "indexes"):
        if not isinstance(table.get(key), list):
            raise ValueError(f"{table['qualified_name']}.{key} must be a list")


def _usable_key(table, columns):
    keys = [table.get("primary_key", {})] + table.get("unique_constraints", [])
    return any(len(key.get("columns", [])) == len(columns)
               and set(key.get("columns", [])) == set(columns)
               and not key.get("deferrable", False)
               and not key.get("where_sql") for key in keys)


def _validate_fk(table, fk, tables):
    parent_name = fk["references"]["table"]
    parent = tables.get(parent_name)
    local, remote = fk["columns"], fk["references"]["columns"]
    if not parent or not local or len(local) != len(remote):
        raise ValueError(f"Invalid FK target/arity: {table['qualified_name']}.{fk['name']}")
    for left, right in zip(local, remote):
        a = table["columns"].get(left)
        b = parent["columns"].get(right)
        if a is None or b is None or not _types_equal(a["type"], b["type"]):
            raise ValueError(f"Incompatible FK columns: {table['qualified_name']}.{fk['name']}")
    if not _usable_key(parent, remote):
        raise ValueError(f"FK needs a nonpartial, nondeferrable key: {parent_name}{remote}")


def _profile_pairs(shots, tables):
    result = []
    for actor in ("player", "keeper"):
        identity = actor + "_id"
        profiles = [name for name in (actor + "_profile_version_id", actor + "_profile_id")
                    if name in shots["columns"]]
        if not profiles or identity not in shots["columns"]:
            raise ValueError(f"Shot {actor} profile/identity columns are not ready")
        for profile in profiles:
            candidates = [fk for fk in shots["foreign_keys"]
                          if profile in fk["columns"] and identity in fk["columns"]]
            if not candidates:
                raise ValueError(f"Shot {profile} needs an existing composite actor FK")
            for fk in candidates:
                _validate_fk(shots, fk, tables)
                parent = tables[fk["references"]["table"]]
                actor_column = fk["references"]["columns"][fk["columns"].index(identity)]
                actor_links = [link for link in parent["foreign_keys"]
                               if actor_column in link["columns"]
                               and link["references"]["table"] == "football.players"
                               and link["references"]["columns"][link["columns"].index(actor_column)] == "id"]
                if not actor_links:
                    raise ValueError(f"Shot profile target does not bind {actor_column} to a player identity")
                for link in actor_links:
                    _validate_fk(parent, link, tables)
                if fk.get("match", "SIMPLE").upper() != "SIMPLE":
                    raise ValueError(f"Shot {profile} must allow a known actor without a profile")
                # A nullable third component would still bypass MATCH SIMPLE.
                for component in fk["columns"]:
                    if component not in (profile, identity) and shots["columns"][component].get("nullable", True):
                        raise ValueError(f"Shot profile FK has another nullable component: {component}")
            result.append((profile, identity))
    return result


def _change(changes, table, operation, column, reason, **details):
    changes.append(dict(table=table["qualified_name"], operation=operation,
                        column=column, reason=reason, **details))


def _column(table, name, changes, reason, **properties):
    old = deepcopy(table["columns"].get(name))
    if old is None:
        table["columns"][name] = properties
    else:
        table["columns"][name].update(properties)
    current = table["columns"][name]
    if current != old:
        _change(changes, table, "add_column" if old is None else "change_column",
                name, reason, before=old, after=deepcopy(current))


def _put(table, group, entry, changes, columns, reason):
    name = entry["name"]
    operation = {"checks": "check", "indexes": "index",
                 "unique_constraints": "unique_constraint",
                 "foreign_keys": "foreign_key"}[group]
    for other in ("unique_constraints", "foreign_keys", "checks", "indexes"):
        if other != group and any(x["name"] == name for x in table[other]):
            raise ValueError(f"Constraint/index name already used: {name}")
    for position, old in enumerate(table[group]):
        if old["name"] == name:
            if old != entry:
                table[group][position] = entry
                _change(changes, table, "change_" + operation, columns,
                        reason, before=deepcopy(old), after=deepcopy(entry))
            return
    table[group].append(entry)
    _change(changes, table, "add_" + operation, columns, reason,
            after=deepcopy(entry))


def _check(table, label, sql, changes, columns, reason):
    normalized = re.sub(r"\s+", "", sql)
    if any(re.sub(r"\s+", "", item["sql"]) == normalized for item in table["checks"]):
        return
    _put(table, "checks", dict(name=_short(table["qualified_name"].replace(".", "_")
                                          + "_pro_" + label + "_ck"), sql=sql),
         changes, columns, reason)


def _unique(table, label, columns, changes, reason):
    entry = dict(name=_short(table["qualified_name"].replace(".", "_")
                             + "_pro_" + label + "_uq"),
                 columns=columns, nulls_not_distinct=False)
    for old in table["unique_constraints"]:
        if old["columns"] == columns and not old.get("deferrable", False):
            if not old.get("nulls_not_distinct", False):
                return
            entry = deepcopy(old)
            entry["nulls_not_distinct"] = False
            break
    _put(table, "unique_constraints", entry, changes, ",".join(columns), reason)


def _index(table, label, columns, predicate, changes, reason):
    entry = dict(name=_short(table["qualified_name"].replace(".", "_")
                             + "_pro_" + label + "_idx"), method="btree", unique=False,
                 keys=[dict(column=column, order="ASC") for column in columns],
                 where_sql=predicate, description=reason)
    if any(all(old.get(key) == entry[key] for key in ("method", "unique", "keys", "where_sql"))
           for old in table["indexes"]):
        return
    _put(table, "indexes", entry, changes, ",".join(columns), reason)


def _note(table, note, changes, column, reason):
    if note not in table.setdefault("notes", []):
        table["notes"].append(note)
        _change(changes, table, "add_note", column, reason, after=note)


def _amend(model, changes):
    tables = _tables(model)
    required = {
        "ingest.source_documents": dict(dataset_id="bigint", source_id="bigint",
            content_sha256="text", origin_kind="text", storage_provider="text",
            storage_bucket="text", storage_key="text", storage_version="text", retention_state="text"),
        "ingest.resource_fetches": dict(request_fingerprint="text", attempt_no="integer", document_id="bigint"),
        "football.shots": {},
        "ingest.field_states": dict(source_state="text", source_text="text", source_number="numeric", source_boolean="boolean"),
        "football.match_heatmap_cells": dict(heatmap_id="bigint", column_index="smallint", row_index="smallint", cell_ordinal="integer", action_count="integer"),
        "ingest.collection_jobs": dict(source_id="bigint", endpoint="text", params="text", priority="smallint", state="text", attempts="integer", available_at="timestamptz", lease_owner="text", lease_expires_at="timestamptz"),
    }
    for name, columns in required.items():
        if name not in tables:
            raise ValueError(f"Constructed proposal missing {name}")
        _require(tables[name], columns)
        for fk in tables[name]["foreign_keys"]:
            _validate_fk(tables[name], fk, tables)
    docs = tables["ingest.source_documents"]
    if "request_fingerprint" in docs["columns"]:
        _require(docs, dict(request_fingerprint="text"))
    legacy = ["dataset_id", "storage_bucket", "storage_key", "content_sha256"]
    if not any(u["columns"] == legacy for u in docs["unique_constraints"]):
        raise ValueError("Preserve the legacy source_documents provenance unique constraint before applying Pro A")
    profiles = _profile_pairs(tables["football.shots"], tables)
    queue = tables["ingest.collection_jobs"]
    if queue.get("primary_key", {}).get("columns") != ["source_id", "endpoint", "params"]:
        raise ValueError("Collection acquisition requires the existing source/endpoint/params primary key")

    # A: conditional non-null identity makes ordinary UNIQUE effective for HTTP,
    # while a NULL fingerprint excludes legacy receipts from the new identity.
    reason = "Pro A: deduplicate HTTP content by canonical request, keeping attempts and legacy provenance separate"
    _column(docs, "request_fingerprint", changes, reason, type="text", nullable=True,
            description="SHA-256 hexadécimal minuscule de la requête canonique sans secret ; obligatoire en HTTP direct, NULL pour un ancien fichier. Aucun body conservé.")
    for column in ("dataset_id", "content_sha256", "origin_kind", "storage_provider", "retention_state"):
        _column(docs, column, changes, reason, nullable=False)
    _column(docs, "content_sha256", changes, reason,
            description="SHA-256 hexadécimal minuscule des octets reçus et hachés en mémoire, ou de l’ancien artefact vérifié. Empreinte seulement ; aucune réponse conservée.")
    for column in ("storage_bucket", "storage_key", "storage_version"):
        _column(docs, column, changes, reason, nullable=True)
    _check(docs, "request_origin_identity", "(origin_kind = 'http_response' AND request_fingerprint IS NOT NULL AND request_fingerprint ~ '^[0-9a-f]{64}$' AND storage_provider = 'http_direct' AND storage_bucket IS NULL AND storage_key IS NULL AND storage_version IS NULL AND retention_state = 'not_stored') OR (origin_kind = 'legacy_file' AND request_fingerprint IS NULL AND retention_state IN ('staged','reconciled','deleted'))",
           changes, "request_fingerprint", reason)
    _unique(docs, "http_request_content", ["dataset_id", "request_fingerprint", "content_sha256"], changes, reason)
    _note(docs, "Un reçu HTTP dédupliqué peut être référencé par plusieurs tentatives resource_fetches. Le fingerprint est calculé sur la requête canonique versionnée, le hash de contenu pendant le décodage en mémoire ; aucun octet de réponse n’est conservé.", changes, "request_fingerprint", reason)
    fetches = tables["ingest.resource_fetches"]
    _column(fetches, "request_fingerprint", changes, reason, nullable=False)
    _check(fetches, "request_fingerprint", "request_fingerprint ~ '^[0-9a-f]{64}$'", changes, "request_fingerprint", reason)

    # B: do not use MATCH FULL; identity without an optional profile is valid.
    for profile, actor in profiles:
        _check(tables["football.shots"], profile + "_identity",
               f"{profile} IS NULL OR {actor} IS NOT NULL", changes, profile,
               "Pro B: prevent nullable MATCH SIMPLE from bypassing the shot profile/actor composite FK")

    # E: redundant native scalars may be omitted; supplied ones match their state.
    states = tables["ingest.field_states"]
    reason = "Pro E: structural source states have no scalar; supplied native scalars match source_state"
    _column(states, "source_state", changes, reason, nullable=False)
    _check(states, "source_scalar_state", "source_state IN ('absent','null','number','string','boolean','empty_array','empty_object') AND (source_state = 'string' OR source_text IS NULL) AND (source_state = 'number' OR source_number IS NULL) AND (source_state = 'boolean' OR source_boolean IS NULL)", changes, "source_state", reason)

    # G: only row-local spatial guarantees; grid dimensions need a parent gate.
    cells = tables["football.match_heatmap_cells"]
    reason = "Pro G: one nonnegative cell per coordinate of the exact retained parent grid"
    for column in ("heatmap_id", "column_index", "row_index", "cell_ordinal", "action_count"):
        _column(cells, column, changes, reason, nullable=False)
    _unique(cells, "grid_coordinate", ["heatmap_id", "column_index", "row_index"], changes, reason)
    _check(cells, "nonnegative", "cell_ordinal >= 0 AND column_index >= 0 AND row_index >= 0 AND action_count >= 0", changes, "column_index,row_index,cell_ordinal,action_count", reason)
    _note(cells, "heatmap_id identifie la grille parente retenue exacte. Les bornes supérieures et cells_state se contrôlent séparément sous verrou parent, sur les mutations des cellules comme des dimensions ; aucun CHECK local ne lit une autre table.", changes, "heatmap_id", reason)

    reason = "Pro G: preserve the existing collection queue with explicit states, attempts, atomic leases and an indexed SKIP LOCKED claim"
    for column in ("source_id", "endpoint", "params", "priority", "state", "attempts", "available_at"):
        _column(queue, column, changes, reason, nullable=False)
    for column in ("lease_owner", "lease_expires_at"):
        _column(queue, column, changes, reason, nullable=True)
    for column, default in (("state", "'pending'"), ("attempts", "0"), ("priority", "3"), ("available_at", "CURRENT_TIMESTAMP")):
        _column(queue, column, changes, reason, default_sql=default)
    _column(queue, "state", changes, reason, allowed_values=["pending", "running", "done", "unavailable"])
    _check(queue, "state", "state IN ('pending','running','done','unavailable')", changes, "state", reason)
    _check(queue, "attempts", "attempts >= 0", changes, "attempts", reason)
    _check(queue, "lease", "(state = 'running' AND lease_owner IS NOT NULL AND btrim(lease_owner) <> '' AND lease_expires_at IS NOT NULL AND attempts > 0) OR (state <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL)", changes, "state,attempts,lease_owner,lease_expires_at", reason)
    _index(queue, "pending_claim", ["priority", "available_at", "source_id", "endpoint", "params"], "state = 'pending'", changes, reason)
    _index(queue, "running_expiry", ["lease_expires_at"], "state = 'running'", changes, reason)
    contract = dict(acquire_sql=COLLECTION_ACQUIRE_SQL, reclaim_sql=COLLECTION_RECLAIM_SQL,
                    complete_sql=COLLECTION_COMPLETE_SQL, lease_seconds=600,
                    lost_ownership="Completion/retry/unavailable must match the entire primary key, running state, owner, claimed attempt number and an unexpired lease; zero updated rows means lost ownership.",
                    transitions="Claim increments attempts. Retry moves available_at and clears both lease fields; done/unavailable and reclaim clear both fields. Reclaim preserves attempts. Before requeueing an old ownerless running job, verify its actual worker terminal/quiesced and retain expiry/orphan evidence; do not replay jobs owned by another transfer.",
                    limits="No clock-dependent CHECK/index predicate, invented retry limit or additional queue. Benchmark a realistic future-heavy pending backlog before claiming performance.")
    if queue.get("queue_contract") != contract:
        before = deepcopy(queue.get("queue_contract"))
        queue["queue_contract"] = contract
        _change(changes, queue, "define_queue_contract", "source_id,endpoint,params", reason,
                before=before, after=deepcopy(contract))


def apply(model, changes):
    """Mutate/return model and append only real amendments to changes, atomically.

    Both arguments are caller-owned. No reads/writes outside those values occur.
    Work is staged so invalid FK/key input leaves both arguments untouched.
    Existing table dictionary identities are retained for builder table maps.
    """
    draft = deepcopy(model)
    amendments = []
    _amend(draft, amendments)
    if amendments:
        original, updated = _tables(model), _tables(draft)
        for name in {change["table"] for change in amendments}:
            original[name].clear()
            original[name].update(updated[name])
        changes.extend(amendments)
    return model
