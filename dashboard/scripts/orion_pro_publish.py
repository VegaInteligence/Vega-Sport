#!/usr/bin/env python3
"""Publish the existing four Pro V1 readers from admitted, retained typed SQL.

This first execution boundary is deliberately an explicit owned-local mode.
An admission document describes synthetic business scope; its digest provides
integrity, never source acceptance or permission to publish real data. Neither
source bodies nor providers are opened. Ready outputs and historical pointers
remain immutable. Dirty rows are durable hints, not a queue to delete or reset.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time
import uuid


ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = ROOT / "docs/architecture/orion-plan-20261104/target-schema.proposed.json"
SCHEME = "orion-four-readers-dependencies-v1"
REPRESENTATION = "summary-v1-shots-v1"
TRANSFORM = "orion_pro_publish_v1"
METRICS = "orion_pro_four_readers_v1"
LOCAL_COMMIT = "local-owned-e2e-v1"
PROFILE_POLICY = "same-source-provider-exact-normalized-manual-v1"
POSTGRES_VERSION = 180006

# Release inputs are pinned definitions, not source documents. The local
# launcher permits model/Python code reads, but intentionally fences SQL/JS
# files. SQL pins are additionally checked against the actual migration journal;
# the independent campaign verifies every release file against these pins.
RELEASE_FILES = {
    "docs/architecture/orion-plan-20261104/target-schema.proposed.json": "18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08",
    "dashboard/backend/migrations/012_orion_pro_domain.sql": "f255868599c72d69f40f575a919045325ea1093a00fe4f5a6b96eae9f2c49f65",
    "dashboard/backend/migrations/013_orion_pro_integrity.sql": "85525221cad51b32aff79a777098211b4112f9f00ea7161ac93945654eeb6968",
    "dashboard/backend/services/orion-pro.js": "4815cdfb184fbae31fa501b50695b235c2ca14b85660db6e6aee8f5fef979616",
    "dashboard/scripts/orion_pro_integrity.py": "32aa1c84cbf3900b28fe2c1e186e4ba56695f83aeea17d5d1336882fec9aae85",
    "dashboard/scripts/orion_pro_schema.py": "6f4578b10c2344885bbf79ab0853fe0f0fd7fffa0663ee74600f5c6ebbe544c3",
    "dashboard/scripts/orion_pro_migrate.py": "d9bdf60ef48a527276499fedb82a435c26b42653432d3a1a3c94cc2db02ee2dd",
}
DECLARED_TYPES = {
    "match_date": ["date", "null"], "score": ["integer", "null"],
    "shot_expected_goals": ["number", "null"], "source_event_type": ["string", "null"],
    "is_goal": ["boolean", "null"],
    "shots_state": ["present", "empty", "unavailable", "unknown", "absent", "null"],
}
PHYSICAL_DOCUMENT_FIELDS = {
    "storage_provider", "storage_bucket", "storage_key", "storage_version",
    "legacy_object_path", "retention_state", "content_verified_at", "deleted_at",
}


class Refused(Exception):
    def __init__(self, code, message, *, retry=False):
        super().__init__(message)
        self.code, self.retry = code, retry


def require(condition, message, code="ADMISSION_MISMATCH"):
    if not condition:
        raise Refused(code, message)


def compact(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else compact(value).encode("utf-8")).hexdigest()


def tagged(value):
    """Lossless canonical representation; missing JSON keys remain missing."""
    if value is None:
        return ["null"]
    if type(value) is bool:
        return ["bool", value]
    if type(value) is int:
        require(-(2**63) <= value < 2**63, "Integer outside signed BIGINT")
        return ["i64", str(value)]
    if type(value) is float:
        require(math.isfinite(value), "Nonfinite floating observation")
        return ["f64", value.hex()]
    if isinstance(value, Decimal):
        require(value.is_finite(), "Nonfinite decimal observation")
        return ["decimal", format(value, "f")]
    if isinstance(value, datetime):
        require(value.tzinfo is not None, "Timestamp lacks a timezone")
        return ["timestamp", value.astimezone(timezone.utc).isoformat(timespec="microseconds")]
    if isinstance(value, date):
        return ["date", value.isoformat()]
    if isinstance(value, str):
        return ["text", value]
    if isinstance(value, (list, tuple)):
        return ["array", [tagged(v) for v in value]]
    if isinstance(value, dict):
        require(all(isinstance(k, str) for k in value), "Object keys must be text")
        return ["object", [[k, tagged(v)] for k, v in sorted(value.items())]]
    raise Refused("ADMISSION_MISMATCH", "Unsupported typed observation")


def positive_id(value, name):
    require(type(value) is int and 0 < value < 2**63, name + " must be a positive BIGINT")
    return value


def identifier(value):
    require(re.fullmatch(r"[a-z_][a-z0-9_]*", value) is not None, "Invalid model identifier")
    return '"' + value + '"'


def relation(value):
    return ".".join(identifier(p) for p in value.split("."))


def decode_sql(value, kind):
    """Decode text emitted by PostgreSQL using the approved column type.

    JSONB and text arrays use JSON only for their own declared SQL types. No
    row-to-JSON conversion can round a BIGINT, float or fixed decimal column.
    PostgreSQL's round-trip float output retains the original binary float.
    """
    if value is None:
        return None
    if kind in {"bigint", "integer", "smallint"}:
        return int(value)
    if kind == "boolean":
        require(value in {"true", "false"}, "Invalid PostgreSQL boolean")
        return value == "true"
    if kind == "double precision":
        result = float(value)
        require(math.isfinite(result), "Nonfinite PostgreSQL float")
        return result
    if kind.startswith("numeric"):
        result = Decimal(value)
        require(result.is_finite(), "Nonfinite PostgreSQL numeric")
        return result
    if kind == "date":
        return date.fromisoformat(value)
    if kind == "timestamptz":
        result = datetime.fromisoformat(value)
        require(result.tzinfo is not None, "PostgreSQL timestamp lacks timezone")
        return result
    if kind in {"jsonb", "text[]"}:
        return json.loads(value)
    require(kind in {"text", "tsvector"}, "Unsupported approved column type")
    return value


def environment_binding():
    for name, expected in RELEASE_FILES.items():
        if name.endswith(".py") or name == str(MODEL_PATH.relative_to(ROOT)):
            require(sha((ROOT / name).read_bytes()) == expected, "Publisher release definition changed", "UNREADY_INPUT")
    descriptor = {
        "scheme": SCHEME, "postgresVersion": POSTGRES_VERSION,
        "representationVersion": REPRESENTATION, "transformVersion": TRANSFORM,
        "metricsContractVersion": METRICS, "files": RELEASE_FILES,
    }
    return {"descriptor": descriptor, "sha256": sha(descriptor)}


class LocalBoundary:
    """No implicit environment, remote URL, credential or source fallback."""
    def __init__(self, args):
        require(args.local and os.environ.get("STATARENA_TEST_DATABASE") == "1",
                "Explicit --local owned test boundary required", "UNREADY_INPUT")
        root = os.environ.get("ORION_PUBLISHER_TEST_RUN", "")
        require(bool(root), "Owned local run directory required", "UNREADY_INPUT")
        self.run = Path(root).resolve()
        campaign = ROOT / "docs/verification/orion-pro-publisher-20261105"
        require(any(self.run.is_relative_to(campaign / name / "runs") for name in ["product-campaign", "qualified-precode"]),
                "Run directory is outside the owned campaign", "UNREADY_INPUT")
        require(self.run.is_dir(), "Owned run directory is missing", "UNREADY_INPUT")
        for path in [args.admission, args.receipt]:
            require(path is not None and path.resolve().is_relative_to(self.run) and path.suffix == ".json",
                    "Admission/receipt must be JSON inside the owned run", "UNREADY_INPUT")
        self.dsn = os.environ.get("ORION_PUBLISHER_DATABASE_URL", "")
        self.port = positive_id(int(os.environ.get("ORION_PUBLISHER_OWNED_PORT", "0")), "Owned port")
        require(self.port < 65536, "Invalid owned port", "UNREADY_INPUT")
        self.events = None
        if os.environ.get("ORION_PUBLISHER_E2E_EVENTS"):
            self.events = Path(os.environ["ORION_PUBLISHER_E2E_EVENTS"]).resolve()
            require(self.events.is_relative_to(self.run) and self.events.suffix == ".jsonl",
                    "Events must remain inside the owned run", "UNREADY_INPUT")
        self.control = None
        if os.environ.get("ORION_PUBLISHER_E2E_BARRIER"):
            path = Path(os.environ["ORION_PUBLISHER_E2E_BARRIER"]).resolve()
            require(self.events is not None and path.is_relative_to(self.run) and path.suffix == ".json",
                    "Barrier must remain inside the owned run", "UNREADY_INPUT")
            self.control = json.loads(path.read_text())
            release = Path(self.control.get("releaseFile", "")).resolve()
            require(release.is_relative_to(self.run) and release.suffix == ".release",
                    "Release must remain inside the owned run", "UNREADY_INPUT")
            self.control["release"] = release
            timeout = self.control.get("timeoutSeconds")
            require(type(timeout) in {int, float} and 0 < timeout <= 3, "Barrier exceeds its bound", "UNREADY_INPUT")

    def connect(self, psycopg):
        from psycopg.conninfo import conninfo_to_dict
        info = conninfo_to_dict(self.dsn)
        require(info.get("host") == "127.0.0.1" and int(info.get("port", "0")) == self.port,
                "Publisher only accepts its exact owned loopback target", "UNREADY_INPUT")
        require(info.get("dbname") == "postgres" and info.get("user") == "statarena_ingest" and not info.get("password"),
                "Publisher requires the existing owned writer identity", "UNREADY_INPUT")
        options = info.get("options", "")
        require(all(v in options for v in ["statement_timeout=8000", "lock_timeout=1000", "idle_in_transaction_session_timeout=5000"]),
                "Startup deadlines are required", "UNREADY_INPUT")
        conn = psycopg.connect(self.dsn, autocommit=True, connect_timeout=2, passfile=os.devnull)
        try:
            row = conn.execute("SELECT current_user,inet_server_addr()::text,inet_server_port(),current_setting('statement_timeout'),current_setting('lock_timeout'),current_setting('idle_in_transaction_session_timeout'),r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user").fetchone()
            require(row == ("statarena_ingest", "127.0.0.1/32", self.port, "8s", "1s", "5s", False, False, False, False)
                    or row == ("statarena_ingest", "127.0.0.1", self.port, "8s", "1s", "5s", False, False, False, False),
                    "Unexpected local database identity or deadlines", "UNREADY_INPUT")
            require(conn.info.server_version == POSTGRES_VERSION, "PostgreSQL release differs", "UNREADY_INPUT")
            return conn
        except BaseException:
            conn.close()
            raise

    def event(self, phase, conn, *, editions=(), builds=(), global_lock=False):
        if self.events is None:
            return
        value = {"phase": phase, "backendPid": conn.info.backend_pid,
                 "editionIds": list(editions), "buildIds": list(builds),
                 "globalGenerationLockHeld": global_lock}
        with self.events.open("a") as out:
            out.write(compact(value) + "\n")
        if self.control and self.control.get("phase") == phase:
            deadline = time.monotonic() + self.control["timeoutSeconds"]
            while not self.control["release"].exists():
                if time.monotonic() >= deadline:
                    raise Refused("STALE_PLAN", "Owned phase release timed out", retry=True)
                time.sleep(.01)


class SqlInputs:
    """One bounded statement reads one coherent, typed scope at an exact pair."""
    def __init__(self, conn, model, evidence_ids):
        self.conn = conn
        self.tables = {t["qualified_name"]: t for s in model["schemas"] for t in s["tables"] if t["phase"] != "models"}
        require(len(self.tables) == 94 and sum(len(t["columns"]) for t in self.tables.values()) == 1709,
                "Approved native model dimensions differ", "UNREADY_INPUT")
        self.evidence_ids = evidence_ids
        self.cache = {}

    def selected(self, table, alias, generation):
        columns = self.tables[table]["columns"]
        terms = []
        if "recorded_from_gen" in columns:
            terms.append(f"{alias}.recorded_from_gen<=s.{generation} AND ({alias}.recorded_to_gen IS NULL OR s.{generation}<{alias}.recorded_to_gen)")
        if "is_canonical" in columns:
            terms.append(alias + ".is_canonical")
        if "is_deleted" in columns:
            terms.append("NOT " + alias + ".is_deleted")
        return " AND ".join(terms) or "TRUE"

    def load(self, edition_ids, dg, cg, *, fresh=False):
        key = (tuple(sorted(edition_ids)), dg, cg)
        if not fresh and key in self.cache:
            return self.cache[key]
        ctes = ["s AS (SELECT %s::bigint dg,%s::bigint cg,%s::bigint[] editions,%s::bigint[] evidence_records)"]
        mapping = {}

        def add(name, table, predicate="TRUE", generation=None):
            selected = self.selected(table, "r", generation) if generation else "TRUE"
            ctes.append(f"{name} AS (SELECT r.* FROM {relation(table)} r CROSS JOIN s WHERE ({selected}) AND ({predicate}) LIMIT 5001)")
            mapping[table] = name

        add("editions", "football.competition_seasons", "r.id=ANY(s.editions)", "dg")
        add("matches", "football.matches", "r.competition_season_id IN (SELECT id FROM editions)", "dg")
        for name, table in [("sides", "football.match_teams"), ("squad", "football.match_players"),
                            ("scores", "football.match_scores"), ("shots", "football.shots")]:
            add(name, table, "r.match_id IN (SELECT id FROM matches)", "dg")
        add("engagements", "football.competition_teams", "r.competition_season_id IN (SELECT id FROM editions)", "dg")
        add("coverage", "ingest.match_coverage", "r.feature_code='shots' AND r.match_id IN (SELECT id FROM matches)", "dg")
        ctes.append("team_ids AS (SELECT team_id id FROM sides UNION SELECT team_id FROM engagements UNION SELECT team_id FROM shots)")
        ctes.append("player_ids AS (SELECT player_id id FROM squad UNION SELECT player_id FROM shots)")
        add("competitions", "football.competitions", "r.id IN (SELECT competition_id FROM editions)", "cg")
        add("teams", "football.teams", "r.id IN (SELECT id FROM team_ids)", "cg")
        add("players", "football.players", "r.id IN (SELECT id FROM player_ids)", "cg")
        add("aliases", "ingest.public_aliases", "(r.route_kind='competition' AND r.competition_id IN (SELECT competition_id FROM editions)) OR (r.route_kind='match' AND r.match_id IN (SELECT id FROM matches)) OR (r.route_kind='team' AND r.team_id IN (SELECT id FROM team_ids)) OR (r.route_kind='player' AND r.player_id IN (SELECT id FROM player_ids))", "cg")
        add("team_profiles", "football.team_profile_versions", "r.team_id IN (SELECT id FROM team_ids)", "cg")
        add("player_profiles", "football.player_profile_versions", "r.player_id IN (SELECT id FROM player_ids)", "cg")
        add("periods", "football.periods", "EXISTS (SELECT 1 FROM shots x WHERE (x.period_code,x.period_definition_version)=(r.code,r.definition_version))", "dg")
        sporting = [name for table, name in mapping.items() if "source_record_id" in self.tables[table]["columns"]]
        record_query = " UNION ".join("SELECT source_record_id id FROM " + n for n in sporting)
        ctes.append("record_ids AS (" + record_query + " UNION SELECT unnest(evidence_records) FROM s)")
        add("records", "ingest.source_records", "r.id IN (SELECT id FROM record_ids)")
        add("documents", "ingest.source_documents", "r.id IN (SELECT document_id FROM records UNION SELECT document_id FROM coverage)")
        add("datasets", "ingest.source_datasets", "r.id IN (SELECT dataset_id FROM documents)")
        source_names = [name for table, name in mapping.items() if "source_id" in self.tables[table]["columns"]]
        source_query = " UNION ".join("SELECT source_id id FROM " + n for n in source_names)
        add("sources", "ingest.sources", "r.id IN (" + source_query + ")")
        contract_names = [name for table, name in mapping.items() if "relation_code" in self.tables[table]["columns"]]
        contract_query = " UNION ".join("SELECT relation_code,contract_version FROM " + n for n in contract_names)
        add("contracts", "ingest.relation_contracts", "(r.relation_code,r.contract_version) IN (" + contract_query + ") OR r.relation_code='analytics.publication_versions'")
        add("snapshots", "ingest.dataset_snapshots")
        add("journal", "ingest.schema_migrations", "r.version IN ('012','013')")
        add("dirty", "ingest.dirty_editions", "r.competition_season_id=ANY(s.editions)")
        add("builds", "analytics.aggregation_builds", "r.competition_season_id=ANY(s.editions)")
        add("pointers", "analytics.publication_versions", "r.competition_season_id=ANY(s.editions) AND r.published_to_gen IS NULL")
        add("match_outputs", "analytics.match_summary", "r.build_id IN (SELECT id FROM builds)")
        add("edition_outputs", "analytics.competition_summary", "r.build_id IN (SELECT id FROM builds)")
        add("catalogue_pointer", "analytics.catalog_publication")
        chunks = []
        for table, name in mapping.items():
            fields = []
            for column, spec in self.tables[table]["columns"].items():
                value = "r." + identifier(column)
                fields.append(f"to_jsonb({value})::text" if spec["type"] == "text[]" else value + "::text")
            chunks.append(f"SELECT '{table}'::text relation_name,ARRAY[{','.join(fields)}]::text[] typed_values FROM {name} r")
        sql = "WITH " + ",\n".join(ctes) + "\n" + "\nUNION ALL\n".join(chunks) + " LIMIT 5001"
        result = {table: [] for table in mapping}
        rows = self.conn.execute(sql, (dg, cg, list(edition_ids), self.evidence_ids)).fetchall()
        require(len(rows) <= 5000, "Owned publisher scope exceeds its row bound", "UNREADY_INPUT")
        for table, values in rows:
            specs = self.tables[table]["columns"]
            require(len(values) == len(specs), "SQL/model column mismatch", "UNREADY_INPUT")
            result[table].append({c: decode_sql(v, spec["type"]) for (c, spec), v in zip(specs.items(), values)})
        journal = {r["version"]: r["content_sha256"] for r in result["ingest.schema_migrations"]}
        require(journal == {v: RELEASE_FILES[f"dashboard/backend/migrations/{v}_orion_pro_{suffix}.sql"] for v, suffix in [("012", "domain"), ("013", "integrity")]},
                "Actual migration journal differs from the approved publisher release", "UNREADY_INPUT")
        self.cache[key] = result
        return result

    @staticmethod
    def winning_profiles(rows, column, pairs, table):
        chosen, selections = [], []
        for actor, source in sorted(pairs):
            ranked = []
            for row in rows:
                if row[column] != actor:
                    continue
                priority = None
                if row["profile_context"] == "provider_global" and row["variant_key"] == "provider:exact" and row["source_id"] == source:
                    priority = 0
                elif row["profile_context"] == "legacy_normalized_global" and row["source_id"] == source:
                    priority = 1
                elif row["profile_context"] == "global" and row["provenance_kind"] == "manual" and row["source_id"] is None:
                    priority = 2
                if priority is not None:
                    ranked.append((priority, row))
            best = min((p for p, _ in ranked), default=None)
            winners = [r for p, r in ranked if p == best]
            require(len(winners) <= 1, "Ambiguous winning same-source profile", "UNREADY_INPUT")
            chosen.extend(winners)
            selections.append({"table": table, "actor": actor, "source": source, "priority": best, "winnerIds": [r["id"] for r in winners]})
        return chosen, selections

    def closure(self, loaded, edition_id, dg, cg):
        tables = {}

        def put(table, rows):
            pk = self.tables[table]["primary_key"]["columns"]
            unique = {tuple(r[c] for c in pk): r for r in rows}
            tables[table] = list(unique.values())
            return tables[table]

        edition = put("football.competition_seasons", [r for r in loaded["football.competition_seasons"] if r["id"] == edition_id])
        require(len(edition) == 1, "Edition is not selected exactly once", "UNREADY_INPUT")
        matches = put("football.matches", [r for r in loaded["football.matches"] if r["competition_season_id"] == edition_id])
        by_match = {r["id"]: r for r in matches}
        mids = set(by_match)
        for table in ["football.match_teams", "football.match_players", "football.match_scores", "ingest.match_coverage", "football.shots"]:
            put(table, [r for r in loaded[table] if r["match_id"] in mids])
        sides, squad, shots = (tables[n] for n in ["football.match_teams", "football.match_players", "football.shots"])
        engagements = put("football.competition_teams", [r for r in loaded["football.competition_teams"] if r["competition_season_id"] == edition_id])
        tids = {r["team_id"] for r in sides + engagements + shots if r["team_id"] is not None}
        pids = {r["player_id"] for r in squad + shots if r["player_id"] is not None}
        competition_id = edition[0]["competition_id"]
        put("football.competitions", [r for r in loaded["football.competitions"] if r["id"] == competition_id])
        put("football.teams", [r for r in loaded["football.teams"] if r["id"] in tids])
        put("football.players", [r for r in loaded["football.players"] if r["id"] in pids])
        put("ingest.public_aliases", [r for r in loaded["ingest.public_aliases"] if
            (r["route_kind"] == "competition" and r["competition_id"] == competition_id) or
            (r["route_kind"] == "match" and r["match_id"] in mids) or
            (r["route_kind"] == "team" and r["team_id"] in tids) or
            (r["route_kind"] == "player" and r["player_id"] in pids)])
        team_pairs = {(r["team_id"], by_match[r["match_id"]]["source_id"]) for r in sides if r["team_id"] is not None}
        player_pairs = {(r["player_id"], r["source_id"] if r["source_id"] is not None else by_match[r["match_id"]]["source_id"]) for r in squad + shots if r["player_id"] is not None}
        selections = []
        for table, column, pairs in [("football.team_profile_versions", "team_id", team_pairs), ("football.player_profile_versions", "player_id", player_pairs)]:
            winners, policy = self.winning_profiles(loaded[table], column, pairs, table)
            put(table, winners)
            selections.extend(policy)
        periods = {(r["period_code"], r["period_definition_version"]) for r in shots if r["period_code"] is not None}
        if periods:
            put("football.periods", [r for r in loaded["football.periods"] if (r["code"], r["definition_version"]) in periods])
        records = {r["source_record_id"] for rows in tables.values() for r in rows if r.get("source_record_id") is not None}
        record_rows = put("ingest.source_records", [r for r in loaded["ingest.source_records"] if r["id"] in records])
        documents = {r["document_id"] for r in record_rows} | {r["document_id"] for r in tables["ingest.match_coverage"] if r["document_id"] is not None}
        docs = put("ingest.source_documents", [r for r in loaded["ingest.source_documents"] if r["id"] in documents])
        datasets = {r["dataset_id"] for r in docs}
        put("ingest.source_datasets", [r for r in loaded["ingest.source_datasets"] if r["id"] in datasets])
        sources = {r["source_id"] for rows in tables.values() for r in rows if r.get("source_id") is not None}
        put("ingest.sources", [r for r in loaded["ingest.sources"] if r["id"] in sources])
        contracts = {(r["relation_code"], r["contract_version"]) for rows in tables.values() for r in rows if r.get("relation_code") is not None}
        if contracts:
            put("ingest.relation_contracts", [r for r in loaded["ingest.relation_contracts"] if (r["relation_code"], r["contract_version"]) in contracts])
        snapshots = {r["generation"]: r for r in loaded["ingest.dataset_snapshots"]}
        require(all(g in snapshots and snapshots[g]["status"] == "sealed" for g in {dg, cg}),
                "Requested snapshots are not sealed", "UNREADY_INPUT")
        entries = {}
        for table, rows in sorted(tables.items()):
            excluded = {"recorded_to_gen", "updated_at"} | (PHYSICAL_DOCUMENT_FIELDS if table == "ingest.source_documents" else set())
            columns = sorted(set(self.tables[table]["columns"]) - excluded)
            keys = self.tables[table]["primary_key"]["columns"]
            encoded = [{"key": {k: tagged(r[k]) for k in keys}, "sha256": sha(tagged({c: r[c] for c in columns}))} for r in rows]
            entries[table] = {"columns": columns, "rows": sorted(encoded, key=compact)}
        manifest = {"scheme": SCHEME, "representation": REPRESENTATION, "editionId": str(edition_id),
                    "policies": {"dataset": snapshots[dg]["source_priority_version"], "catalogue": snapshots[cg]["source_priority_version"]},
                    "profilePolicy": PROFILE_POLICY, "tables": entries, "profileSelections": sorted(selections, key=compact)}
        return {"sha256": sha(manifest), "manifest": manifest, "tables": tables,
                "dataset": snapshots[dg], "catalogue": snapshots[cg]}


def validate_envelope(args, raw):
    require(sha(raw) == args.admission_sha256, "Admission bytes differ from declared SHA256")
    body = json.loads(raw)
    require(isinstance(body, dict) and body.get("schemaVersion") == 1 and body.get("kind") == "synthetic_declared_business_admission" and body.get("fixtureOnly") is True,
            "This local boundary requires explicit synthetic business admission")
    require(body.get("representationVersion") == REPRESENTATION and body.get("dependencyScheme") == SCHEME,
            "Unsupported representation or dependency scheme")
    require(body.get("sourcePolicy") == "pilot_priority_v1" and body.get("snapshotPolicyColumn") == "source_priority_version",
            "Unaccepted source selection policy")
    require(body.get("declaredTypes") == DECLARED_TYPES, "Declared native types differ")
    require(body.get("requirements") == {"noUsefulDraftOmission": True, "explicitEngagements": True, "exactSourceRevisionTypes": True, "scoreScope": "final_without_shootout"},
            "Required admission semantics are absent")
    require(body.get("datasetGeneration") == args.dataset_generation and body.get("catalogGeneration") == args.catalog_generation,
            "Admission snapshot pair differs from invocation")
    require(isinstance(body.get("businessDecision"), str) and bool(body["businessDecision"].strip()), "Business scope decision is absent")
    for key in ["datasetGeneration", "catalogGeneration"]:
        positive_id(body[key], key)
    sources = body.get("allowedSourceIds")
    require(isinstance(sources, list) and bool(sources) and len(sources) == len(set(sources)), "Admitted sources are absent or repeated")
    for source in sources:
        positive_id(source, "Source ID")
    evidence = body.get("sourceEvidence")
    require(isinstance(evidence, list) and bool(evidence), "Retained source reconciliation evidence is absent")
    for record in evidence:
        require(isinstance(record, dict) and record.get("sourceId") in sources, "Source evidence is outside admission")
        for key in ["recordId", "sourceId", "documentId"]:
            positive_id(record.get(key), key)
        require(isinstance(record.get("contentSha256"), str) and re.fullmatch("[0-9a-f]{64}", record["contentSha256"]) is not None,
                "Source content identity is absent")
    require(len({r["recordId"] for r in evidence}) == len(evidence), "Source evidence repeats records")
    upstream = body.get("upstreamRowContracts")
    require(isinstance(upstream, dict) and all(isinstance(upstream.get(k), str) and upstream[k] for k in ["contractVersion", "transformVersion", "canonicalPolicyVersion", "transformCodeSha256", "bootstrapDefinitionVersion", "bootstrapCodeSha256"]),
            "Upstream retained contracts are absent")
    bundle = {"model": RELEASE_FILES[str(MODEL_PATH.relative_to(ROOT))], "migrator": RELEASE_FILES["dashboard/scripts/orion_pro_migrate.py"],
              "migrations": {v: RELEASE_FILES[f"dashboard/backend/migrations/{v}_orion_pro_{name}.sql"] for v, name in [("012", "domain"), ("013", "integrity")]}}
    require(upstream["bootstrapDefinitionVersion"] == "bootstrap_v1" and upstream["bootstrapCodeSha256"] == sha(bundle),
            "Bootstrap definition does not bind the approved model/migrator/migrations")
    editions = body.get("editions")
    require(isinstance(editions, list) and bool(editions), "Declared edition scope is absent")
    for edition in editions:
        require(isinstance(edition, dict), "Malformed edition scope")
        positive_id(edition.get("editionId"), "Edition ID")
        positive_id(edition.get("editionRevision"), "Edition revision")
        require(isinstance(edition.get("intendedMatches"), list) and bool(edition["intendedMatches"]), "Edition has no admitted useful matches")
        for match in edition["intendedMatches"]:
            require(isinstance(match, dict), "Malformed match declaration")
            positive_id(match.get("matchId"), "Match ID")
            positive_id(match.get("matchRevision"), "Match revision")
    declared = {e["editionId"]: e for e in editions}
    require(len(declared) == len(editions), "Repeated edition in admission")
    require(set(args.editions) <= set(declared), "Requested edition is outside admission")
    return body


def validate_admission(body, edition, closure, loaded, tables):
    scope = closure["tables"]
    native_edition = scope["football.competition_seasons"][0]
    require(native_edition["revision_id"] == edition["editionRevision"] and native_edition["season_key"] == edition.get("season"),
            "Declared edition revision or season differs from selected facts")
    require(len(scope["football.competitions"]) == 1, "Edition competition is unavailable", "UNREADY_INPUT")
    require(all(v == body["sourcePolicy"] for v in closure["manifest"]["policies"].values()), "Selected snapshot source policy differs")
    matches = scope["football.matches"]
    require(all(r["publication_state"] == "published" for r in matches), "Useful selected draft/quarantined match cannot be omitted", "DRAFT_NOT_ADMITTED")
    intended = {m["matchId"]: m for m in edition["intendedMatches"]}
    require(len(intended) == len(edition["intendedMatches"]) and set(intended) == {m["id"] for m in matches}, "Intended match set differs from retained selected cohort")
    aliases = scope["ingest.public_aliases"]
    require(any(r["route_kind"] == "competition" and re.fullmatch(r"l_[A-Za-z0-9]{6}", r["public_key"]) for r in aliases), "Competition public route is unavailable", "UNREADY_INPUT")
    engagements = scope["football.competition_teams"]
    upstream = body["upstreamRowContracts"]
    evidence = {r["recordId"]: r for r in body["sourceEvidence"]}
    records = {r["id"]: r for r in loaded["ingest.source_records"]}
    documents = {r["id"]: r for r in loaded["ingest.source_documents"]}
    for rid, item in evidence.items():
        row = records.get(rid)
        doc = documents.get(item["documentId"])
        require(row is not None and doc is not None and row["source_id"] == item["sourceId"] == doc["source_id"] and row["document_id"] == doc["id"] and doc["content_sha256"] == item["contentSha256"] and row["locator_kind"] == item.get("locatorKind") and row["locator"] == item.get("locator"),
                "Source reconciliation evidence differs from retained SQL metadata")
    for table, rows in scope.items():
        for row in rows:
            if row.get("source_id") is not None:
                require(row["source_id"] in body["allowedSourceIds"], "Selected source is outside accepted scope")
            if row.get("source_record_id") is not None:
                require(row["source_record_id"] in evidence, "Selected source record lacks reconciliation evidence")
            if "transform_code_sha256" in row:
                bootstrap = table == "football.periods"
                expected_sha = upstream["bootstrapCodeSha256"] if bootstrap else upstream["transformCodeSha256"]
                expected_transform = upstream["bootstrapDefinitionVersion"] if bootstrap else upstream["transformVersion"]
                require(row["transform_code_sha256"] == expected_sha and row["transform_version"] == expected_transform, "Selected upstream transform contract differs")
            if "canonical_policy_version" in row:
                require(row["canonical_policy_version"] == upstream["canonicalPolicyVersion"], "Selected canonical policy differs")
            if "contract_version" in row and table not in {"ingest.source_datasets", "ingest.relation_contracts"}:
                require(row["contract_version"] == (upstream["bootstrapDefinitionVersion"] if table == "football.periods" else upstream["contractVersion"]), "Selected row contract differs")
    contracts = {(r["relation_code"], r["contract_version"]) for r in loaded["ingest.relation_contracts"]}
    require(("analytics.publication_versions", upstream["contractVersion"]) in contracts, "Existing publication row contract is missing", "UNREADY_INPUT")
    for m in matches:
        declared = intended[m["id"]]
        require(declared.get("publicationState") == "published" and declared["matchRevision"] == m["revision_id"] and declared.get("sourceId") == m["source_id"] and declared.get("sourceRecordId") == m["source_record_id"], "Declared match revision/source/state differs")
        aliases_for_match = [r for r in aliases if r["route_kind"] == "match" and r["public_key"] == declared.get("publicId")]
        require(len(aliases_for_match) == 1 and aliases_for_match[0]["match_id"] == m["id"] and aliases_for_match[0]["match_revision_id"] == m["revision_id"], "Declared public match route differs")
        sides = [r for r in scope["football.match_teams"] if r["match_id"] == m["id"]]
        require(len(sides) == 2 and {r["side"] for r in sides} == {"home", "away"} and len({r["team_id"] for r in sides}) == 2, "A published match requires exact home/away participants", "UNREADY_INPUT")
        for side in sides:
            require(side["match_revision_id"] == m["revision_id"], "Participant revision binding differs")
            require(side["team_id"] is not None and any(r["team_id"] == side["team_id"] for r in engagements), "Selected participant lacks explicit edition engagement", "MISSING_ENGAGEMENT")
            require(any(r["route_kind"] == "team" and r["team_id"] == side["team_id"] for r in aliases), "Participant public route is unavailable", "UNREADY_INPUT")
        selected_scores = [r for r in scope["football.match_scores"] if r["match_id"] == m["id"]]
        observation = declared.get("finalScoreObservation")
        require(isinstance(observation, dict) and type(observation.get("present")) is bool, "Final score observation declaration is absent")
        final = [r for r in selected_scores if r["score_scope"] == "final_without_shootout"]
        require((len(final) == 2 and {r["side"] for r in final} == {"home", "away"}) if observation["present"] else not final,
                "Final score observation presence differs from retained facts")
        require(observation.get("scope") == ("final_without_shootout" if observation["present"] else None), "Final score scope differs")
        for score in selected_scores:
            side = next((r for r in sides if r["side"] == score["side"]), None)
            require(side is not None and score["match_team_revision_id"] == side["revision_id"], "Score participant revision differs")
        parents = [r for r in scope["ingest.match_coverage"] if r["match_id"] == m["id"]]
        require(len(parents) <= 1, "Ambiguous canonical shot coverage", "COVERAGE_INVALID")
        parent = parents[0] if parents else None
        state = parent["collection_state"] if parent else "unknown"
        require(declared.get("declaredShotsState") == state, "Declared shot collection state differs", "COVERAGE_INVALID")
        coverage = declared.get("coverage")
        if parent is None:
            require(coverage is None, "Coverage declaration invents an absent observation", "COVERAGE_INVALID")
        else:
            require(isinstance(coverage, dict), "Selected coverage declaration is missing", "COVERAGE_INVALID")
            pk = tables["ingest.match_coverage"]["primary_key"]["columns"]
            require(coverage.get("key") == {c: parent[c] for c in pk}, "Coverage physical key is not selected at the declared snapshot", "COVERAGE_INVALID")
            mapping = {"dataRevision": "data_revision", "matchRevisionId": "match_revision_id", "sourceRecordId": "source_record_id", "documentId": "document_id", "coverageState": "coverage_state", "collectionState": "collection_state", "observedRowCount": "observed_row_count", "isCanonical": "is_canonical", "isStale": "is_stale"}
            require(all(k in coverage and type(coverage[k]) is type(parent[c]) and coverage[k] == parent[c] for k, c in mapping.items()), "Coverage typed values/revisions differ", "COVERAGE_INVALID")
            end = coverage.get("recordedToGeneration")
            require(end == parent["recorded_to_gen"] if end is not None else parent["recorded_to_gen"] is None or closure["dataset"]["generation"] < parent["recorded_to_gen"], "Coverage interval declaration differs", "COVERAGE_INVALID")
            require(parent["match_revision_id"] == m["revision_id"] and parent["is_stale"] is False, "Coverage is stale or binds another match revision", "COVERAGE_INVALID")
        shots = [r for r in scope["football.shots"] if r["match_id"] == m["id"]]
        count = len(shots) if state == "present" else 0 if state == "empty" else None
        require(type(declared.get("declaredShotsCount")) is type(count) and declared.get("declaredShotsCount") == count, "Declared shot count differs", "COVERAGE_INVALID")
        if state in {"present", "empty"}:
            require(parent["observed_row_count"] == count and (count > 0 if state == "present" else count == 0), "Coverage count does not describe selected family", "COVERAGE_INVALID")
        else:
            require(not shots and (parent is None or parent["observed_row_count"] is None), "Unavailable collection must not become accepted empty", "COVERAGE_INVALID")
        wanted = declared.get("selectedShotObservations", [])
        require(isinstance(wanted, list) and len(wanted) == len(shots), "Selected shot observation set differs", "COVERAGE_INVALID")
        by_shot = {r["shotId"]: r for r in wanted if isinstance(r, dict) and type(r.get("shotId")) is int}
        require(len(by_shot) == len(shots), "Selected shot identities are repeated or malformed", "COVERAGE_INVALID")
        shot_map = {"shotId": "id", "revision": "revision_id", "sourceId": "source_id", "sourceRecordId": "source_record_id", "externalShotId": "external_shot_id", "period": "period_code", "periodDefinitionVersion": "period_definition_version", "playerId": "player_id", "teamId": "team_id", "variant": "variant_key"}
        for shot in shots:
            want = by_shot.get(shot["id"])
            require(want is not None and all(k in want and type(want[k]) is type(shot[c]) and want[k] == shot[c] for k, c in shot_map.items()), "Shot source/revision/period/actor declaration differs", "COVERAGE_INVALID")
            require(parent is not None and parent["collection_state"] == "present" and (shot["source_id"], shot["variant_key"]) == (parent["source_id"], parent["variant_key"]), "Shot lies outside selected coverage family", "COVERAGE_INVALID")
            require(any(r["team_id"] == shot["team_id"] and r["revision_id"] == shot["match_team_revision_id"] for r in sides), "Shot participant binding differs", "COVERAGE_INVALID")
            if shot["period_code"] is not None:
                require(any((r["code"], r["definition_version"]) == (shot["period_code"], shot["period_definition_version"]) for r in scope.get("football.periods", [])), "Shot period definition is absent", "COVERAGE_INVALID")
            if shot["player_id"] is not None:
                require(any(r["match_id"] == m["id"] and r["player_id"] == shot["player_id"] and r["team_id"] == shot["team_id"] and r["played"] is True for r in scope["football.match_players"]), "Shot actor has no accepted playing participation", "COVERAGE_INVALID")


MATCH_COLUMNS = ["competition_season_id", "match_id", "match_revision_id", "match_date", "kickoff_at", "status", "home_team_id", "away_team_id", "home_label", "away_label", "home_goals", "away_goals", "score_scope", "home_shootout_goals", "away_shootout_goals"]
EDITION_COLUMNS = ["competition_season_id", "matches_count", "finished_matches_count", "teams_count", "players_count", "goals"]


def products(closure):
    tables = closure["tables"]
    edition_id = tables["football.competition_seasons"][0]["id"]
    matches = tables["football.matches"]
    rows = []
    for m in sorted(matches, key=lambda r: r["id"]):
        sides = {r["side"]: r for r in tables["football.match_teams"] if r["match_id"] == m["id"]}
        scores = {(r["side"], r["score_scope"]): r for r in tables["football.match_scores"] if r["match_id"] == m["id"]}
        final_present = any(scope == "final_without_shootout" for _, scope in scores)
        values = {"competition_season_id": edition_id, "match_id": m["id"], "match_revision_id": m["revision_id"],
                  "match_date": m["match_date"], "kickoff_at": m["kickoff_at"], "status": m["status"],
                  "score_scope": "final_without_shootout" if final_present else None}
        for side in ["home", "away"]:
            values[side + "_team_id"] = sides[side]["team_id"]
            values[side + "_label"] = sides[side]["participant_label"]
            values[side + "_goals"] = scores.get((side, "final_without_shootout"), {}).get("goals")
            values[side + "_shootout_goals"] = scores.get((side, "shootout"), {}).get("goals")
        rows.append(values)
    summary = {"competition_season_id": edition_id, "matches_count": len(matches),
               "finished_matches_count": sum(r["status"] == "finished" for r in matches),
               "teams_count": len(tables["football.competition_teams"]),
               "players_count": len({r["player_id"] for r in tables["football.match_players"]}), "goals": None}
    return {"matches": rows, "edition": summary}


class Publisher:
    def __init__(self, args, body, boundary, conn, model, environment):
        self.args, self.body, self.boundary, self.conn = args, body, boundary, conn
        self.reader = SqlInputs(conn, model, [r["recordId"] for r in body["sourceEvidence"]])
        self.environment = environment
        self.code_sha = sha(Path(__file__).read_bytes())
        self.editions = sorted(args.editions)
        self.declared = {e["editionId"]: e for e in body["editions"]}
        self.ready_committed = []
        self.stage = "planning"
        self.activation_generation = None

    def matches_contract(self, build, closure):
        return all(build.get(k) == value for k, value in {
            "competition_season_id": int(closure["manifest"]["editionId"]),
            "competition_season_revision_id": closure["tables"]["football.competition_seasons"][0]["revision_id"],
            "dependencies_sha256": closure["sha256"], "code_content_sha256": self.code_sha,
            "environment_sha256": self.environment["sha256"], "code_commit": LOCAL_COMMIT,
            "representation_version": REPRESENTATION, "transform_version": TRANSFORM,
            "metrics_contract_version": METRICS, "status": "ready",
        }.items())

    @staticmethod
    def watermarks(loaded, editions):
        return {r["competition_season_id"]: r for r in loaded["ingest.dirty_editions"] if r["competition_season_id"] in editions}

    def verify_ready(self, build, closure, loaded):
        snapshots = {r["id"]: r for r in loaded["ingest.dataset_snapshots"]}
        dg, cg = (snapshots.get(build[k]) for k in ["dataset_snapshot_id", "catalog_snapshot_id"])
        require(dg is not None and cg is not None and dg["status"] == cg["status"] == "sealed", "Ready build snapshots are unavailable", "UNREADY_INPUT")
        require(dg["generation"] <= self.args.dataset_generation and cg["generation"] <= self.args.catalog_generation, "Ready build pair is outside requested snapshots", "UNREADY_INPUT")
        if (dg["generation"], cg["generation"]) != (self.args.dataset_generation, self.args.catalog_generation):
            historical = self.reader.load([build["competition_season_id"]], dg["generation"], cg["generation"])
            actual = self.reader.closure(historical, build["competition_season_id"], dg["generation"], cg["generation"])
            require(actual["sha256"] == closure["sha256"], "Ready build effective snapshot closure differs", "UNREADY_INPUT")
        expected = products(closure)
        actual_matches = [{c: r[c] for c in MATCH_COLUMNS} for r in loaded["analytics.match_summary"] if r["build_id"] == build["id"]]
        actual_editions = [{c: r[c] for c in EDITION_COLUMNS} for r in loaded["analytics.competition_summary"] if r["build_id"] == build["id"]]
        require(sorted(actual_matches, key=lambda r: r["match_id"]) == expected["matches"] and actual_editions == [expected["edition"]], "Ready orphan outputs differ from exact selected facts", "UNREADY_INPUT")

    def plan(self, *, fresh=False, admission=True):
        loaded = self.reader.load(self.editions, self.args.dataset_generation, self.args.catalog_generation, fresh=fresh)
        closures = {eid: self.reader.closure(loaded, eid, self.args.dataset_generation, self.args.catalog_generation) for eid in self.editions}
        if admission:
            for eid, closure in closures.items():
                validate_admission(self.body, self.declared[eid], closure, loaded, self.reader.tables)
        current = {r["competition_season_id"]: r for r in loaded["analytics.publication_versions"]}
        builds = {r["id"]: r for r in loaded["analytics.aggregation_builds"]}
        chosen, changed = {}, []
        for eid, closure in closures.items():
            pointer = current.get(eid)
            candidates = [r for r in builds.values() if self.matches_contract(r, closure)]
            # Prefer the exact already public ID; deterministic reuse must not
            # move an unchanged pointer to another otherwise equivalent orphan.
            candidates.sort(key=lambda b: (0 if pointer and pointer["build_id"] == b["id"] else 1, b["id"]))
            if candidates:
                candidate = candidates[0]
                self.verify_ready(candidate, closure, loaded)
                chosen[eid] = candidate
            if not pointer or eid not in chosen or pointer["build_id"] != chosen[eid]["id"]:
                changed.append(eid)
        return {"loaded": loaded, "closures": closures, "current": current, "chosen": chosen,
                "changed": changed, "watermarks": self.watermarks(loaded, self.editions)}

    def lock_editions(self):
        # bigint advisory locks live in a different namespace from the native
        # two-int generation lock. The same sorted positive edition IDs are used
        # by both build deduplication and final activation.
        self.conn.execute("SELECT pg_advisory_xact_lock(eid) FROM (SELECT unnest(%s::bigint[]) eid ORDER BY 1) sorted_editions", (self.editions,)).fetchall()

    def insert_rows(self, table, columns, rows):
        require(bool(rows), "Cannot insert an empty output batch", "UNREADY_INPUT")
        names = ",".join(identifier(c) for c in columns)
        placeholders = ",".join("(" + ",".join(["%s"] * len(columns)) + ")" for _ in rows)
        values = [r[c] for r in rows for c in columns]
        return self.conn.execute(f"INSERT INTO {relation(table)} ({names}) VALUES {placeholders}", values)

    def build(self, initial):
        self.stage = "building"
        created = []
        with self.conn.transaction():
            self.lock_editions()
            plan = self.plan(fresh=True)
            for eid in self.editions:
                require(plan["closures"][eid]["sha256"] == initial["closures"][eid]["sha256"], "Selected build inputs changed after planning", "STALE_PLAN")
                if eid in plan["chosen"]:
                    continue
                closure = plan["closures"][eid]
                selected = closure["tables"]["football.competition_seasons"][0]
                row = self.conn.execute("INSERT INTO analytics.aggregation_builds (competition_season_id,competition_season_revision_id,dataset_snapshot_id,catalog_snapshot_id,transform_version,metrics_contract_version,representation_version,code_commit,code_content_sha256,dependencies_sha256,environment_sha256,status) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'building') RETURNING id", (eid, selected["revision_id"], closure["dataset"]["id"], closure["catalogue"]["id"], TRANSFORM, METRICS, REPRESENTATION, LOCAL_COMMIT, self.code_sha, closure["sha256"], self.environment["sha256"])).fetchone()
                build_id = row[0]
                output = products(closure)
                self.insert_rows("analytics.match_summary", ["build_id", *MATCH_COLUMNS], [{"build_id": build_id, **r} for r in output["matches"]])
                self.insert_rows("analytics.competition_summary", ["build_id", *EDITION_COLUMNS], [{"build_id": build_id, **output["edition"]}])
                self.conn.execute("UPDATE analytics.aggregation_builds SET status='ready',finished_at=CURRENT_TIMESTAMP WHERE id=%s AND status='building'", (build_id,))
                created.append(build_id)
            if created:
                # This exercises the real owner-run deferred READY trigger. The
                # writer never calls its ungranted validate function directly.
                self.conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
                self.boundary.event("before_ready_commit", self.conn, editions=self.editions, builds=created)
            self.stage = "ready_commit_pending"
        self.ready_committed.extend(created)
        self.stage = "ready_committed"
        self.boundary.event("after_ready_commit", self.conn, editions=self.editions, builds=created)
        return self.plan(fresh=True)

    def activate(self, initial, prepared):
        # Intentionally outside any activation transaction/global lock: a source
        # generation must be able to commit while this diagnostic barrier waits.
        self.boundary.event("before_activation_recheck", self.conn, editions=self.editions,
                            builds=[prepared["chosen"][eid]["id"] for eid in self.editions], global_lock=False)
        self.stage = "activating"
        with self.conn.transaction():
            self.conn.execute("SELECT pg_advisory_xact_lock(20261104,1)")
            self.lock_editions()
            final = self.plan(fresh=True)
            require(final["watermarks"] == initial["watermarks"], "Relevant dirty watermark advanced after planning", "STALE_PLAN")
            for eid in self.editions:
                require(final["closures"][eid]["sha256"] == initial["closures"][eid]["sha256"] and eid in final["chosen"], "Prepared build no longer matches selected inputs", "STALE_PLAN")
            snapshots = final["loaded"]["ingest.dataset_snapshots"]
            latest = max(r["generation"] for r in snapshots if r["status"] == "sealed")
            # Detect changes in old *or* newly selected membership, preferred
            # profiles, aliases and coverage. Ambient generations alone do not
            # affect the closure and do not force unrelated edition rebuilds.
            live = self.reader.load(self.editions, latest, latest, fresh=True)
            for eid in self.editions:
                current = self.reader.closure(live, eid, latest, latest)
                require(current["sha256"] == initial["closures"][eid]["sha256"], "Relevant accepted typed inputs moved after planning", "STALE_PLAN")
            changed = final["changed"]
            if not changed:
                return self.receipt("noop", final)
            for eid in changed:
                require(final["current"].get(eid) == initial["current"].get(eid), "Current pointer compare-and-swap no longer matches plan", "STALE_PLAN")
            key = "orion-pro-publish-local:" + uuid.uuid4().hex
            generation = self.conn.execute("SELECT ingest.begin_generation(%s,%s,%s)", (key, TRANSFORM, self.body["sourcePolicy"])).fetchone()[0]
            self.activation_generation = generation
            for index, eid in enumerate(changed):
                old = final["current"].get(eid)
                if old:
                    closed = self.conn.execute("UPDATE analytics.publication_versions SET published_to_gen=%s WHERE competition_season_id=%s AND published_from_gen=%s AND build_id=%s AND published_to_gen IS NULL", (generation, eid, old["published_from_gen"], old["build_id"]))
                    require(closed.rowcount == 1, "Current publication changed before close", "STALE_PLAN")
                build = final["chosen"][eid]
                self.conn.execute("INSERT INTO analytics.publication_versions (competition_season_id,build_id,catalog_snapshot_id,representation_version,published_from_gen,contract_version,transform_version,transform_code_sha256,provenance_kind) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'derived')", (eid, build["id"], build["catalog_snapshot_id"], REPRESENTATION, generation, self.body["upstreamRowContracts"]["contractVersion"], TRANSFORM, self.code_sha))
                if index == 0:
                    self.boundary.event("after_first_pointer_write", self.conn, editions=changed,
                                        builds=[final["chosen"][v]["id"] for v in changed], global_lock=True)
            desired_catalogue = max((final["closures"][eid]["catalogue"] for eid in changed), key=lambda r: r["generation"])
            pointers = final["loaded"]["analytics.catalog_publication"]
            existing = pointers[0] if pointers else None
            snapshots_by_id = {r["id"]: r for r in snapshots}
            if existing is None or snapshots_by_id[existing["catalog_snapshot_id"]]["generation"] < desired_catalogue["generation"] or existing["representation_version"] != REPRESENTATION:
                if existing is None:
                    self.conn.execute("INSERT INTO analytics.catalog_publication (singleton,catalog_snapshot_id,representation_version,published_at) VALUES (true,%s,%s,CURRENT_TIMESTAMP)", (desired_catalogue["id"], REPRESENTATION))
                else:
                    updated = self.conn.execute("UPDATE analytics.catalog_publication SET catalog_snapshot_id=%s,representation_version=%s,published_at=CURRENT_TIMESTAMP WHERE singleton AND catalog_snapshot_id=%s AND representation_version=%s", (desired_catalogue["id"], REPRESENTATION, existing["catalog_snapshot_id"], existing["representation_version"]))
                    require(updated.rowcount == 1, "Catalogue discovery pointer changed before activation", "STALE_PLAN")
            manifest = {"scheme": SCHEME, "representation": REPRESENTATION, "publisherCodeSha256": self.code_sha,
                        "environmentSha256": self.environment["sha256"],
                        "publications": [{"editionId": str(eid), "buildId": str(final["chosen"][eid]["id"]), "dependencySha256": final["closures"][eid]["sha256"]} for eid in changed]}
            self.conn.execute("SELECT ingest.seal_generation(%s,%s)", (generation, sha(manifest)))
            self.stage = "activation_commit_pending"
        self.stage = "activation_committed"
        return self.receipt("published", final, changed=changed, generation=generation)

    def receipt(self, status, plan, *, changed=(), generation=None):
        return {"status": status, "scope": "owned-local-synthetic-only", "representationVersion": REPRESENTATION,
                "dependencyScheme": SCHEME, "requestedPair": {"datasetGeneration": self.args.dataset_generation, "catalogGeneration": self.args.catalog_generation},
                "codeCommit": LOCAL_COMMIT, "codeContentSha256": self.code_sha, "environmentSha256": self.environment["sha256"],
                "changedEditionIds": list(changed), "publicationGeneration": generation,
                "committedReadyBuildIds": list(self.ready_committed), "dirtyWatermarksRetained": True,
                "editions": [{"editionId": str(eid), "dependencySha256": plan["closures"][eid]["sha256"],
                              "buildId": str(plan["chosen"][eid]["id"]) if eid in plan["chosen"] else None,
                              "effectiveSnapshotIds": {"dataset": str(plan["chosen"][eid]["dataset_snapshot_id"]), "catalogue": str(plan["chosen"][eid]["catalog_snapshot_id"])} if eid in plan["chosen"] else None} for eid in self.editions]}

    def run(self):
        plan = self.plan()
        self.boundary.event("after_plan", self.conn, editions=self.editions,
                            builds=[b["id"] for b in plan["chosen"].values()])
        if self.args.mode == "plan":
            return self.receipt("planned", plan, changed=plan["changed"])
        if not plan["changed"]:
            return self.receipt("noop", plan)
        prepared = self.build(plan)
        return self.activate(plan, prepared)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local", action="store_true", help="Require explicit owned local PostgreSQL; no remote mode exists")
    parser.add_argument("--mode", choices=["plan", "publish"], default="plan")
    parser.add_argument("--admission", type=Path, help="Explicit retained synthetic business admission JSON")
    parser.add_argument("--admission-sha256")
    parser.add_argument("--dataset-generation", type=int)
    parser.add_argument("--catalog-generation", type=int)
    parser.add_argument("--editions", help="Comma-separated admitted edition BIGINT IDs")
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    conn = publisher = boundary = None
    result = None
    try:
        boundary = LocalBoundary(args)
        require(isinstance(args.admission_sha256, str) and re.fullmatch(r"[0-9a-f]{64}", args.admission_sha256) is not None, "Admission SHA256 is required")
        require(isinstance(args.editions, str) and re.fullmatch(r"[1-9][0-9]*(,[1-9][0-9]*)*", args.editions) is not None, "Explicit edition IDs are required")
        args.editions = [positive_id(int(v), "Edition ID") for v in args.editions.split(",")]
        require(len(set(args.editions)) == len(args.editions), "Requested editions repeat")
        positive_id(args.dataset_generation, "Dataset generation")
        positive_id(args.catalog_generation, "Catalogue generation")
        raw = args.admission.read_bytes()
        require(len(raw) <= 1024 * 1024, "Admission exceeds local envelope bound")
        body = validate_envelope(args, raw)
        environment = environment_binding()
        model = json.loads(MODEL_PATH.read_bytes())
        import psycopg
        conn = boundary.connect(psycopg)
        publisher = Publisher(args, body, boundary, conn, model, environment)
        result = publisher.run()
    except Refused as error:
        result = {"status": "retry" if error.retry or error.code == "STALE_PLAN" else "rejected",
                  "error": {"code": error.code, "message": str(error)}}
    except Exception as error:
        sqlstate = getattr(error, "sqlstate", None)
        uncertain = publisher is not None and publisher.stage in {"ready_commit_pending", "activation_commit_pending"} and (sqlstate is None or sqlstate.startswith("08"))
        result = {"status": "retry" if uncertain or sqlstate in {"55P03", "57014", "40001", "40P01"} else "rejected",
                  "error": {"code": "COMMIT_ACK_UNKNOWN" if uncertain else "UNREADY_INPUT",
                            "message": "Commit acknowledgment is unknown; inspect retained state before retry" if uncertain else "Publisher could not qualify its admitted SQL workflow",
                            "type": type(error).__name__, "sqlstate": sqlstate}}
    finally:
        if publisher is not None and result is not None:
            result.update(stage=publisher.stage, committedReadyBuildIds=publisher.ready_committed)
            if result["status"] in {"retry", "rejected"}:
                result["publicationOutcome"] = "acknowledgment_unknown" if result["error"]["code"] == "COMMIT_ACK_UNKNOWN" else "not_activated"
                result["allocatedPublicationGeneration"] = publisher.activation_generation
        if conn is not None:
            conn.close()
        if boundary is not None and result is not None:
            temporary = args.receipt.with_suffix(".tmp")
            temporary.write_text(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
            temporary.replace(args.receipt)
    print(compact({"status": result["status"], "errorCode": result.get("error", {}).get("code")}))
    return 0 if result["status"] in {"planned", "published", "noop"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
