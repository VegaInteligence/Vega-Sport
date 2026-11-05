#!/usr/bin/env python3
"""Qualify retained native SQL and apply explicit minimal publication derivations.

The default is offline. Owned source-free qualification and actual RDS releases
have distinct origins, endpoints and release kinds. Source bodies are never read.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))

from orion_pro_publish import (ROOT, MODEL_PATH, SCHEME, REPRESENTATION, METRICS,
    PROFILE_POLICY, POSTGRES_VERSION, RELEASE_FILES, Refused, require, sha, compact,
    tagged, positive_id, identifier, relation, decode_sql, SqlInputs, products)

POLICY = "real_source_core_v2_native31"
TRANSFORM = "real_core_four_readers_admission_v1"
PUBLISH_TRANSFORM = "orion_pro_publish_real_v1"
OWNED_KIND = "orion_real_publication_owned_fixture_admission_v1"
REAL_INPUT_KIND = "orion_real_four_readers_normalization_input_v1"
REAL_PUBLICATION_KIND = "orion_real_four_readers_publication_admission_v1"
OWNED_PRODUCER = "owned_real_publication_fixture_v1"
REAL_PRODUCER_SHA = "4b98a829bc7e32e11a7e66381ffecae6248ce536d17771aa080502374fe844bc"
BASE_PUBLISHER_SHA = "222c4647a850eb3fe51dcc8c9ba71e35dafbfe28f69443c558675ebcca8faf59"
FIELD_MATRIX_SHA = "1a3a46e5ece40ba5ac38defae5dc8484d15eab9f97769a1714b228b945b9e61a"
MIGRATIONS = {"012": RELEASE_FILES["dashboard/backend/migrations/012_orion_pro_domain.sql"],
    "013": RELEASE_FILES["dashboard/backend/migrations/013_orion_pro_integrity.sql"],
    "014": "e0810f8670b2cb627ade2c76e3c8eb527ab31fd595d5cf939fd63bfc5cf649d6",
    # Approved and independently adopted on RDS (adoption receipt be6ca7bd...).
    "015": "3b85fcb4fe9380cc5f96238620ff3f4bedee7485ed52c98fef0bddfac1092bd7",
    "016": "12d63eaab6f4d610de3f2ff4efc0dcd71059c4d2e489a5f30d62d2a8498fd087",
    "017": "87aac35a93b8b0455a7dcf13fde5bb0be468d1183a0bf4a96f36b04b4b770458",
    # Approved 6 Nov 2026: read-model indexes only.
    "018": "8b87d06725db474203ad3449aa6ed598fad19622a2945c4818b2fbadd99603ce"}
RDS_HOST = "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com"
MAX_FETCH = 1000
OPTIONS = "-c statement_timeout=8000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000 -c timezone=UTC -c datestyle=ISO,YMD -c extra_float_digits=3"


def exact_keys(value, keys, name):
    require(type(value) is dict and set(value) == set(keys), name + " has missing or unknown fields")


def digest_string(value, name):
    require(type(value) is str and re.fullmatch(r"[a-f0-9]{64}", value) is not None, name + " must be SHA256")
    return value


def strict_json(raw):
    def pairs(values):
        result = {}
        for key, value in values:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result
    def nonfinite(_):
        raise Refused("ADMISSION_MISMATCH", "Nonfinite JSON number")
    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=nonfinite)
    except (ValueError, UnicodeError):
        raise Refused("ADMISSION_MISMATCH", "Invalid JSON") from None


def read_bound(path, digest, *, limit=8 * 1024 * 1024):
    require(path is not None, "Explicit bound file required")
    raw = Path(path).read_bytes()
    require(len(raw) <= limit and sha(raw) == digest_string(digest, "File digest"), "File bytes differ from released digest")
    return strict_json(raw)


def snapshot_shape(value):
    exact_keys(value, ["snapshotId", "generation", "manifestSha256", "sourcePriorityVersion"], "Snapshot")
    positive_id(value["snapshotId"], "Snapshot ID"); positive_id(value["generation"], "Generation")
    digest_string(value["manifestSha256"], "Snapshot manifest")
    require(value["sourcePriorityVersion"] == POLICY, "Source priority policy differs")


def validate_input(body, stage, environment):
    def exact_native_ids(value):
        if type(value) is dict:
            for key, child in value.items():
                if (key.endswith("Id") and not key.startswith("public")) or key in {"match_id", "source_id", "recorded_from_gen", "dataRevision"}:
                    if child is not None: positive_id(child, key)
                exact_native_ids(child)
        elif type(value) is list:
            for child in value: exact_native_ids(child)
    exact_native_ids(body)
    owned = environment == "owned_local_tls"
    if owned:
        keys = {"schemaVersion", "kind", "dataOrigin", "fixtureContractSha256", "sourcePolicy", "modelSha256",
            "representationVersion", "dependencyScheme", "sourceReconciliationSha256", "sourceFieldMatrixSha256",
            "transport", "publisher", "admissionProducer", "admissionReceiptSha256", "dataset", "catalogue", "sourceInput",
            "sourceInputEpochSha256", "endpoint", "editions", "proofs", "fullAcceptance"}
        exact_keys(body, keys, "Owned input")
        require(body["kind"] == OWNED_KIND and body["dataOrigin"] == "owned_source_free_fixture", "Wrong owned origin")
        digest_string(body["fixtureContractSha256"], "Fixture contract")
    else:
        require(type(body) is dict and body.get("dataOrigin") == "existing_aws_saved_observations" and
                body.get("kind") == (REAL_INPUT_KIND if stage == "admit" else REAL_PUBLICATION_KIND),
                "Owned/fixture inputs cannot authorize RDS", "ORIGIN_NOT_ADMITTED")
        if stage == "publish":
            # The deployed RDS publication envelope has its own closed schema.
            schema = strict_json((ROOT / "docs/verification/orion-pro-publisher-20261105/real-boundary-precode/ADMISSION.schema.json").read_bytes())
            validate_schema(body, schema, schema)
        else:
            keys = {"schemaVersion", "kind", "dataOrigin", "sourcePolicy", "modelSha256", "representationVersion", "dependencyScheme",
                "sourceReconciliationSha256", "sourceFieldMatrixSha256", "transport", "publisher", "admissionProducer", "admissionReceiptSha256",
                "dataset", "catalogue", "sourceInput", "sourceInputEpochSha256", "endpoint", "editions", "proofs", "fullAcceptance"}
            exact_keys(body, keys, "Real normalization input")
    require(type(body["schemaVersion"]) is int and body["schemaVersion"] == 1 and body["fullAcceptance"] is False, "Wrong envelope version/acceptance")
    require(body["sourcePolicy"] == POLICY and body["modelSha256"] == RELEASE_FILES[str(MODEL_PATH.relative_to(ROOT))], "Wrong source/model policy")
    require(body["representationVersion"] == REPRESENTATION and body["dependencyScheme"] == SCHEME, "Wrong representation/dependencies")
    for key in ["sourceReconciliationSha256", "sourceFieldMatrixSha256"]:
        digest_string(body[key], key)
    require(body["sourceFieldMatrixSha256"] == FIELD_MATRIX_SHA, "Source field matrix was not qualified")
    transport = body["transport"]
    transport_keys = {"origin", "coreCheckpointSha256", "sourceNative94Sha256", "sourceNative31Sha256", "sourceTargetMappingSha256",
        "targetNative94ReadbackSha256", "targetNative31ReadbackSha256", "sourceProducerVersion", "sourceProducerSha256"}
    if not owned: transport_keys.add("transportReceiptSha256")
    exact_keys(transport, transport_keys, "Transport proof")
    require(transport["origin"] == ("owned_source_free_fixture" if owned else "real_native_sql_checkpoint"), "Wrong transport origin")
    require(transport["sourceProducerVersion"] == (OWNED_PRODUCER if owned else POLICY), "Unaccepted source producer")
    for key, value in transport.items():
        if key.endswith("Sha256"): digest_string(value, key)
    require(transport["sourceNative31Sha256"] == transport["targetNative31ReadbackSha256"], "Native31 transport proof differs")
    require(transport["sourceNative94Sha256"] == transport["targetNative94ReadbackSha256"], "Native94 transport proof differs")
    if owned:
        require(body["sourceReconciliationSha256"] == transport["coreCheckpointSha256"] == transport["sourceTargetMappingSha256"] and
                transport["sourceProducerSha256"] == body["fixtureContractSha256"], "Owned transport reconciliation differs")
    else:
        require(transport["sourceProducerSha256"] == REAL_PRODUCER_SHA, "Real core producer differs")
    publisher = body["publisher"]
    exact_keys(publisher, ["commit", "contentSha256", "environmentSha256", "transformVersion", "metricsContractVersion"], "Publisher identity")
    require(type(publisher["commit"]) is str and re.fullmatch(r"[a-f0-9]{40}", publisher["commit"]) is not None, "Immutable code commit required")
    digest_string(publisher["contentSha256"], "Publisher content"); digest_string(publisher["environmentSha256"], "Environment descriptor")
    require(publisher["transformVersion"] == PUBLISH_TRANSFORM and publisher["metricsContractVersion"] == METRICS, "Wrong publication transform")
    for key in ["dataset", "catalogue"]: snapshot_shape(body[key])
    if "sourceInput" in body:
        snapshot_shape(body["sourceInput"]); digest_string(body["sourceInputEpochSha256"], "Source input epoch")
        producer = body["admissionProducer"]
        exact_keys(producer, ["commit", "contentSha256", "transformVersion"], "Admission producer")
        require(producer["commit"] == publisher["commit"] and producer["transformVersion"] == TRANSFORM, "Wrong admission producer")
        digest_string(producer["contentSha256"], "Admission content")
        if body["admissionReceiptSha256"] is not None: digest_string(body["admissionReceiptSha256"], "Admission receipt")
    editions = body["editions"]
    require(type(editions) is list and bool(editions), "Explicit useful edition cohort required")
    seen_editions, seen_matches = set(), set()
    for edition in editions:
        if owned or stage == "admit":
            exact_keys(edition, ["editionId", "editionRevisionId", "competitionId", "publicLeagueId", "season", "completeUsefulCohort", "members"], "Edition")
        for key in ["editionId", "editionRevisionId", "competitionId"]: positive_id(edition[key], key)
        require(edition["editionId"] not in seen_editions and edition["completeUsefulCohort"] is True, "Repeated/incomplete edition")
        seen_editions.add(edition["editionId"])
        require(type(edition["publicLeagueId"]) is str and re.fullmatch(r"l_[A-Za-z0-9]{6}", edition["publicLeagueId"]) is not None, "Wrong league route")
        require(type(edition["season"]) is str and re.fullmatch(r"[0-9]{4}(/[0-9]{4})?", edition["season"]) is not None, "Wrong season")
        require(type(edition["members"]) is list and bool(edition["members"]), "Useful match cohort missing")
        for member in edition["members"]:
            if owned or stage == "admit": exact_keys(member, ["matchId", "matchRevisionId", "publicId", "sourceId", "sourceRecordId", "publicationState"], "Match member")
            for key in ["matchId", "matchRevisionId", "sourceId", "sourceRecordId"]: positive_id(member[key], key)
            require(member["matchId"] not in seen_matches, "Repeated match in complete cohort")
            seen_matches.add(member["matchId"])
            require(type(member["publicId"]) is str and re.fullmatch(r"m_[A-Za-z0-9]{6}", member["publicId"]) is not None, "Wrong match route")
            require(member["publicationState"] in {"draft", "published"}, "Quarantined or undeclared match cannot be admitted")


def validate_schema(value, spec, root):
    if "$ref" in spec:
        target = root
        for part in spec["$ref"].removeprefix("#/").split("/"): target = target[part]
        return validate_schema(value, target, root)
    if "const" in spec: require(type(value) is type(spec["const"]) and value == spec["const"], "Real admission constant differs")
    kind = spec.get("type")
    if kind == "object":
        require(type(value) is dict and set(spec.get("required", [])) <= set(value), "Incomplete real object")
        props = spec.get("properties", {})
        if spec.get("additionalProperties") is False: require(set(value) <= set(props), "Unknown real admission property")
        for key, item in value.items():
            if key in props: validate_schema(item, props[key], root)
    elif kind == "array":
        require(type(value) is list and len(value) >= spec.get("minItems", 0), "Incomplete real array")
        for item in value: validate_schema(item, spec.get("items", {}), root)
    elif kind == "integer":
        require(type(value) is int and value >= spec.get("minimum", -(2**63)) and value <= spec.get("maximum", 2**63-1), "Wrong real integer type/range")
    elif kind == "string":
        require(type(value) is str and len(value) >= spec.get("minLength", 0), "Wrong real string")
        if "pattern" in spec: require(re.fullmatch(spec["pattern"], value) is not None, "Wrong real string format")
    elif kind == "boolean": require(type(value) is bool, "Wrong real boolean")


class Boundary:
    def __init__(self, args, stage):
        self.args, self.stage = args, stage
        require(args.environment in {"owned_local_tls", "rds"}, "Explicit environment required")
        self.owned = args.environment == "owned_local_tls"
        for key in os.environ:
            require(not key.startswith("PG") and key not in {"DATABASE_URL", "POSTGRES_URL", "POSTGRESQL_URL"},
                    "Ambient libpq/DSN settings are forbidden", "AMBIENT_CONNECTION_FORBIDDEN")
        self.body = read_bound(args.input, args.input_sha256)
        validate_input(self.body, stage, args.environment)
        self.endpoint = read_bound(args.endpoint, args.endpoint_sha256)
        admitted_endpoint = self.body["endpoint"]
        require(self.endpoint == admitted_endpoint if self.owned else
                {k: v for k, v in self.endpoint.items() if k != "caPath"} == admitted_endpoint,
                "Endpoint differs from admitted target")
        self.release = read_bound(args.release, args.release_sha256)
        code_path = ROOT / "dashboard/scripts" / ("orion_pro_admit_real.py" if stage == "admit" else "orion_pro_publish_real.py")
        self.code_sha = sha(code_path.read_bytes())
        self.commit = self.body["publisher"]["commit"]
        if self.owned:
            required = {"kind", "scope", "stage", "mode", "helperSha256", "fixtureSha256", "inputSha256", "endpointSha256",
                "sourceReconciliationSha256", "sourceInputEpochSha256", "campaignReleaseSha256", "expiresAt"}
            exact_keys(self.release, required, "Owned operation release")
            require(self.release["kind"] == "real_publication_owned_operation_release_v1" and self.release["scope"] == "owned_source_free_fixture", "Wrong owned release")
            require(self.release["fixtureSha256"] == self.body["fixtureContractSha256"], "Fixture generator was not released")
            digest_string(self.release["campaignReleaseSha256"], "Campaign release")
            self.run = Path(args.input).resolve().parent
            expected = ROOT / "docs/verification/orion-pro-publisher-20261105/real-boundary-precode/runtime-runs"
            require(self.run.is_relative_to(expected) and os.environ.get("STATARENA_TEST_DATABASE") == "1", "Owned fixture outside its explicit namespace")
            for path in [args.input, args.endpoint, args.release, args.receipt]:
                require(path is not None and Path(path).resolve().is_relative_to(self.run), "Owned operation file outside run")
        else:
            required = {"kind", "scope", "stage", "mode", "helperSha256", "inputSha256", "endpointSha256", "sourceReconciliationSha256",
                "environmentSha256", "codeCommit", "targetReadbackSha256", "nativePolicySha256", "credentialFileSha256", "expiresAt", "allocationId"}
            exact_keys(self.release, required, "RDS operation release")
            require(self.release["kind"] == "real_publication_rds_operation_release_v1" and self.release["scope"] == "existing_aws_saved_observations", "Wrong RDS release")
            require(self.release["codeCommit"] == self.commit and self.release["environmentSha256"] == self.body["publisher"]["environmentSha256"], "RDS release code/environment differs")
            require(self.release["targetReadbackSha256"] == self.body["transport"]["targetNative94ReadbackSha256"], "RDS readback was not released")
            self.run = Path(args.receipt).resolve().parent
        for key, expected in [("stage", stage), ("mode", args.mode), ("helperSha256", self.code_sha), ("inputSha256", args.input_sha256),
                ("endpointSha256", args.endpoint_sha256), ("sourceReconciliationSha256", self.body["sourceReconciliationSha256"])]:
            require(self.release[key] == expected, "Operation release differs: " + key)
        if self.owned: require(self.release["sourceInputEpochSha256"] == self.body["sourceInputEpochSha256"], "Source epoch was not released")
        expiry = datetime.fromisoformat(self.release["expiresAt"])
        require(expiry.tzinfo is not None and datetime.now(timezone.utc) < expiry, "Operation release expired")
        require(self.body["publisher"]["contentSha256"] == sha((ROOT / "dashboard/scripts/orion_pro_publish_real.py").read_bytes()), "Publisher bytes differ")
        if "admissionProducer" in self.body:
            require(self.body["admissionProducer"]["contentSha256"] == sha(Path(__file__).read_bytes()), "Admission bytes differ")
        require(sha((ROOT / "dashboard/scripts/orion_pro_publish.py").read_bytes()) == BASE_PUBLISHER_SHA, "Qualified SQL dependency code differs")
        require(sha(MODEL_PATH.read_bytes()) == self.body["modelSha256"], "Actual model differs")
        self.validate_endpoint()
        self.events = self.control = None
        if self.owned and os.environ.get("ORION_REAL_E2E_EVENTS"):
            self.events = Path(os.environ["ORION_REAL_E2E_EVENTS"]).resolve()
            require(self.events.is_relative_to(self.run) and self.events.suffix == ".jsonl", "Events outside owned run")
            control = os.environ.get("ORION_REAL_E2E_CONTROL")
            if control:
                path = Path(control).resolve(); require(path.is_relative_to(self.run), "Control outside owned run")
                self.control = strict_json(path.read_bytes())
                exact_keys(self.control, ["phase", "fault", "releaseFile", "timeoutSeconds"], "Owned control")
                require(type(self.control["timeoutSeconds"]) is int and 0 < self.control["timeoutSeconds"] <= 3, "Unbounded owned barrier")
                require(Path(self.control["releaseFile"]).resolve().is_relative_to(self.run), "Barrier release outside owned run")
        consumed = Path(str(args.release) + ".consumed.json")
        try:
            with consumed.open("x") as out: out.write(compact({"releaseSha256": args.release_sha256, "stage": stage}) + "\n")
        except FileExistsError:
            raise Refused("RELEASE_CONSUMED", "Operation release already consumed") from None
        self.connections = 0

    def validate_endpoint(self):
        e = self.endpoint
        if self.owned:
            exact_keys(e, ["kind", "environment", "host", "hostaddr", "hostname", "port", "database", "actor", "ownedRoot", "caPath", "caSha256", "postmasterStartedAt"], "Owned endpoint")
            require(e["kind"] == "owned_real_publication_endpoint_v1" and e["environment"] == "owned_local_tls", "Wrong owned endpoint kind")
            require(e["host"] == e["hostaddr"] == e["hostname"] == "127.0.0.1" and e["database"] == "postgres", "Foreign owned address/database")
            owned_root = Path(e["ownedRoot"]).resolve()
            require(owned_root.parent == Path("/tmp").resolve() and owned_root.name.startswith("orion-pro-e2e-") and
                    owned_root.stat().st_uid == os.getuid(), "Foreign local PG directory")
            require(Path(e["caPath"]).resolve().is_relative_to(owned_root), "CA outside owned PG directory")
        else:
            exact_keys(e, ["hostname", "address", "dnsAddressSetSha256", "port", "database", "actor", "sslmode", "caSha256", "serverVersion", "postmasterStartedAt", "nativePolicySha256", "readbackSha256", "caPath"], "RDS endpoint")
            require(e["hostname"] == RDS_HOST and e["port"] == 5432 and e["database"] == "statarena_prod" and e["sslmode"] == "verify-full" and e["serverVersion"] == POSTGRES_VERSION, "Foreign RDS endpoint")
            ipaddress.ip_address(e["address"])
            for key in ["dnsAddressSetSha256", "nativePolicySha256", "readbackSha256"]: digest_string(e[key], key)
            require(e["nativePolicySha256"] == self.release["nativePolicySha256"], "Unreleased native policy")
        require(type(e["port"]) is int and 0 < e["port"] < 65536 and e["actor"] == "statarena_ingest", "Wrong writer actor/port")
        require(sha(Path(e["caPath"]).read_bytes()) == digest_string(e["caSha256"], "CA digest"), "CA bytes differ")
        require(datetime.fromisoformat(e["postmasterStartedAt"]).tzinfo is not None, "Postmaster start lacks timezone")

    def connect(self):
        import psycopg
        e = self.endpoint
        kwargs = dict(host=e["hostname"], hostaddr=e["hostaddr"] if self.owned else e["address"], port=e["port"], dbname=e["database"],
            user=e["actor"], sslmode="verify-full", sslrootcert=e["caPath"], options=OPTIONS,
            application_name="orion_real_" + self.stage, connect_timeout=2, autocommit=True, passfile=os.devnull)
        if not self.owned:
            require(self.args.credential_file is not None, "Explicit owned credential file required for released RDS")
            credential = Path(self.args.credential_file).resolve(); mode = credential.stat()
            require(mode.st_uid == os.getuid() and stat.S_ISREG(mode.st_mode) and stat.S_IMODE(mode.st_mode) == 0o600, "Credential file must be owned mode0600")
            raw = credential.read_bytes(); require(sha(raw) == self.release["credentialFileSha256"] and 0 < len(raw) <= 16384, "Credential file was not released")
            kwargs["password"] = raw.decode().rstrip("\n")
        conn = psycopg.connect(**kwargs)
        self.connections += 1
        try:
            row = conn.execute("""SELECT current_user,session_user,current_database(),inet_server_addr()::text,inet_server_port(),
                current_setting('statement_timeout'),current_setting('lock_timeout'),current_setting('idle_in_transaction_session_timeout'),
                pg_postmaster_start_time(),r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolbypassrls,
                (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) FROM pg_roles r WHERE r.rolname=current_user""").fetchone()
            address = str(ipaddress.ip_interface(row[3]).ip)
            require(row[:3] == (e["actor"], e["actor"], e["database"]) and address == kwargs["hostaddr"] and row[4:8] == (e["port"], "8s", "1s", "5s") and
                    row[8] == datetime.fromisoformat(e["postmasterStartedAt"]) and row[9:] == (False, False, False, False, True), "Actual native identity/TLS/deadlines differ", "TARGET_IDENTITY_MISMATCH")
            require(conn.info.server_version == POSTGRES_VERSION, "Unexpected PostgreSQL native release")
            actual = dict(conn.execute("SELECT version,content_sha256 FROM ingest.schema_migrations ORDER BY version").fetchall())
            require(actual == MIGRATIONS, "Actual migration journal differs")
            return conn
        except BaseException:
            conn.close(); raise

    def event(self, phase, conn, *, editions=(), builds=(), global_lock=False):
        if self.events is None: return
        value = {"phase": phase, "backendPid": conn.info.backend_pid, "editionIds": list(editions), "buildIds": list(builds),
            "globalGenerationLockHeld": global_lock}
        with self.events.open("a") as out: out.write(compact(value) + "\n")
        if self.control and self.control["phase"] == phase:
            deadline = time.monotonic() + self.control["timeoutSeconds"]
            while not Path(self.control["releaseFile"]).exists():
                require(time.monotonic() < deadline, "Owned barrier deadline", "STALE_PLAN")
                time.sleep(.01)

    def committed_ack(self):
        if self.control and self.control["fault"] == "after_commit_ack":
            raise Refused("COMMIT_ACK_UNKNOWN", "Commit completed but acknowledgment is deliberately withheld by the owned fault injection", retry=True)


class Inputs(SqlInputs):
    """Same canonical closure, streamed native typed reads without a row cutoff."""
    def __init__(self, conn, model, evidence_ids=()):
        super().__init__(conn, model, list(evidence_ids))
        self.max_buffered_rows = self.selected_rows = 0
        self.serial = 0

    @staticmethod
    def winning_profiles(rows, column, pairs, table):
        try: return SqlInputs.winning_profiles(rows, column, pairs, table)
        except Refused as error:
            if "Ambiguous winning" in str(error): raise Refused("PROFILE_AMBIGUOUS", str(error)) from None
            raise

    def stream(self, sql, params=()):
        self.serial += 1
        # A named cursor is transaction-local; each caller drains bounded batches.
        with self.conn.transaction():
            with self.conn.cursor(name="orion_native_" + str(self.serial)) as cursor:
                cursor.execute(sql, params)
                while True:
                    rows = cursor.fetchmany(MAX_FETCH)
                    self.max_buffered_rows = max(self.max_buffered_rows, len(rows))
                    if not rows: break
                    yield from rows

    def rows(self, table, where="TRUE", params=(), generation=None):
        specs = self.tables[table]["columns"]
        predicates, values = ["(" + where + ")"], list(params)
        if "recorded_from_gen" in specs:
            require(type(generation) is int, "Exact generation required")
            predicates += ["r.recorded_from_gen<=%s AND (r.recorded_to_gen IS NULL OR %s<r.recorded_to_gen)"]
            values += [generation, generation]
        if "is_canonical" in specs: predicates.append("r.is_canonical")
        if "is_deleted" in specs: predicates.append("NOT r.is_deleted")
        fields = [("to_jsonb(r." + identifier(c) + ")::text") if s["type"] == "text[]" else "r." + identifier(c) + "::text" for c, s in specs.items()]
        sql = "SELECT " + ",".join(fields) + " FROM " + relation(table) + " r WHERE " + " AND ".join(predicates)
        return [{c: decode_sql(v, s["type"]) for (c, s), v in zip(specs.items(), values)} for values in self.stream(sql, values)]

    def load(self, edition_ids, dg, cg, *, fresh=False):
        key = (tuple(sorted(edition_ids)), dg, cg)
        if not fresh and key in self.cache: return self.cache[key]
        ctes = ["s AS (SELECT %s::bigint dg,%s::bigint cg,%s::bigint[] editions,%s::bigint[] evidence_records)"]
        mapping = {}
        def add(name, table, where="TRUE", generation=None):
            selection = self.selected(table, "r", generation) if generation else "TRUE"
            ctes.append(name + " AS (SELECT r.* FROM " + relation(table) + " r CROSS JOIN s WHERE (" + where + ") AND " + selection + ")")
            mapping[table] = name
        add("editions", "football.competition_seasons", "r.id=ANY(s.editions)", "dg")
        add("matches", "football.matches", "r.competition_season_id IN (SELECT id FROM editions)", "dg")
        for name, table in [("sides", "football.match_teams"), ("squad", "football.match_players"), ("scores", "football.match_scores"), ("shots", "football.shots")]:
            add(name, table, "r.match_id IN (SELECT id FROM matches)", "dg")
        add("engagements", "football.competition_teams", "r.competition_season_id IN (SELECT id FROM editions)", "dg")
        add("coverage", "ingest.match_coverage", "r.feature_code='shots' AND r.match_id IN (SELECT id FROM matches)", "dg")
        add("minutes", "football.player_match_metric_values", "r.match_id IN (SELECT id FROM matches) AND r.metric_code='legacy_normalized_minutes' AND r.period_code='full_match'", "dg")
        ctes += ["team_ids AS (SELECT team_id id FROM sides UNION SELECT team_id FROM engagements UNION SELECT team_id FROM shots)",
                 "player_ids AS (SELECT player_id id FROM squad UNION SELECT player_id FROM shots)"]
        add("competitions", "football.competitions", "r.id IN (SELECT competition_id FROM editions)", "cg")
        for name, table, ids in [("teams", "football.teams", "team_ids"), ("players", "football.players", "player_ids")]: add(name, table, "r.id IN (SELECT id FROM " + ids + ")", "cg")
        add("aliases", "ingest.public_aliases", "(r.route_kind='competition' AND r.competition_id IN (SELECT competition_id FROM editions)) OR (r.route_kind='match' AND r.match_id IN (SELECT id FROM matches)) OR (r.route_kind='team' AND r.team_id IN (SELECT id FROM team_ids)) OR (r.route_kind='player' AND r.player_id IN (SELECT id FROM player_ids))", "cg")
        add("team_profiles", "football.team_profile_versions", "r.team_id IN (SELECT id FROM team_ids)", "cg")
        add("player_profiles", "football.player_profile_versions", "r.player_id IN (SELECT id FROM player_ids)", "cg")
        add("periods", "football.periods", "EXISTS (SELECT 1 FROM shots x WHERE (x.period_code,x.period_definition_version)=(r.code,r.definition_version))", "dg")
        record_names = [n for t, n in mapping.items() if "source_record_id" in self.tables[t]["columns"]]
        ctes.append("record_ids AS (" + " UNION ".join("SELECT source_record_id id FROM " + n for n in record_names) + " UNION SELECT unnest(evidence_records) FROM s)")
        add("records", "ingest.source_records", "r.id IN (SELECT id FROM record_ids)")
        add("documents", "ingest.source_documents", "r.id IN (SELECT document_id FROM records UNION SELECT document_id FROM coverage)")
        add("datasets", "ingest.source_datasets", "r.id IN (SELECT dataset_id FROM documents)")
        source_names = [n for t, n in mapping.items() if "source_id" in self.tables[t]["columns"]]
        add("sources", "ingest.sources", "r.id IN (" + " UNION ".join("SELECT source_id id FROM " + n for n in source_names) + ")")
        contract_names = [n for t, n in mapping.items() if "relation_code" in self.tables[t]["columns"]]
        add("contracts", "ingest.relation_contracts", "(r.relation_code,r.contract_version) IN (" + " UNION ".join("SELECT relation_code,contract_version FROM " + n for n in contract_names) + ") OR r.relation_code='analytics.publication_versions'")
        for name, table, where in [("snapshots", "ingest.dataset_snapshots", "TRUE"), ("journal", "ingest.schema_migrations", "TRUE"),
            ("dirty", "ingest.dirty_editions", "r.competition_season_id=ANY(s.editions)"), ("builds", "analytics.aggregation_builds", "r.competition_season_id=ANY(s.editions)"),
            ("pointers", "analytics.publication_versions", "r.competition_season_id=ANY(s.editions) AND r.published_to_gen IS NULL"),
            ("match_outputs", "analytics.match_summary", "r.build_id IN (SELECT id FROM builds)"),
            ("edition_outputs", "analytics.competition_summary", "r.build_id IN (SELECT id FROM builds)"), ("catalogue_pointer", "analytics.catalog_publication", "TRUE")]: add(name, table, where)
        chunks = []
        for table, name in mapping.items():
            fields = ["to_jsonb(r." + identifier(c) + ")::text" if s["type"] == "text[]" else "r." + identifier(c) + "::text" for c, s in self.tables[table]["columns"].items()]
            chunks.append("SELECT '" + table + "'::text,ARRAY[" + ",".join(fields) + "]::text[] FROM " + name + " r")
        sql = "WITH " + ",\n".join(ctes) + "\n" + "\nUNION ALL\n".join(chunks)
        result = {table: [] for table in mapping}
        for table, values in self.stream(sql, (dg, cg, list(edition_ids), self.evidence_ids)):
            specs = self.tables[table]["columns"]
            require(len(values) == len(specs), "Native SQL/model column mismatch")
            result[table].append({c: decode_sql(v, s["type"]) for (c, s), v in zip(specs.items(), values)})
        for table, rows in result.items():
            keys = self.tables[table]["primary_key"]["columns"]
            rows.sort(key=lambda r: compact(tagged({k: r[k] for k in keys})))
        require({r["version"]: r["content_sha256"] for r in result["ingest.schema_migrations"]} == MIGRATIONS, "Native migration release differs")
        self.selected_rows = max(self.selected_rows, sum(len(rows) for rows in result.values()))
        self.cache[key] = result
        return result


def validate_facts(body, loaded, tables, *, publish=False):
    snapshots = {r["generation"]: r for r in loaded["ingest.dataset_snapshots"]}
    for key in ["dataset", "catalogue"] + (["sourceInput"] if "sourceInput" in body else []):
        declared = body[key]; actual = snapshots.get(declared["generation"])
        require(actual is not None and actual["status"] == "sealed" and actual["id"] == declared["snapshotId"] and actual["manifest_sha256"] == declared["manifestSha256"] and actual["source_priority_version"] == POLICY, "Released sealed snapshot differs")
    editions = {r["id"]: r for r in loaded["football.competition_seasons"]}
    matches = {r["id"]: r for r in loaded["football.matches"]}
    if publish: require(all(r["publication_state"] == "published" for r in matches.values()), "Useful drafts must first be individually admitted", "DRAFT_NOT_ADMITTED")
    aliases = loaded["ingest.public_aliases"]
    records = {r["id"]: r for r in loaded["ingest.source_records"]}
    documents = {r["id"]: r for r in loaded["ingest.source_documents"]}
    sources = {r["id"] for r in loaded["ingest.sources"]}
    contracts = {(r["relation_code"], r["contract_version"]) for r in loaded["ingest.relation_contracts"]}
    for rows in loaded.values():
        for row in rows:
            if row.get("relation_code") and "contract_version" in row: require((row["relation_code"], row["contract_version"]) in contracts, "Missing retained row contract")
            rid, sid = row.get("source_record_id"), row.get("source_id")
            if rid is not None:
                record = records.get(rid); doc = documents.get(record["document_id"]) if record else None
                require(record is not None and doc is not None and sid == record["source_id"] == doc["source_id"] and sid in sources, "Typed source/record/document lineage differs")
    for edition in body["editions"]:
        actual = editions.get(edition["editionId"])
        require(actual is not None and actual["revision_id"] == edition["editionRevisionId"] and actual["competition_id"] == edition["competitionId"] and actual["season_key"] == edition["season"], "Exact edition differs")
        wanted = {m["matchId"]: m for m in edition["members"]}
        require(set(wanted) == {r["id"] for r in matches.values() if r["competition_season_id"] == edition["editionId"]}, "Complete useful cohort differs")
        require(any(r["route_kind"] == "competition" and r["competition_id"] == edition["competitionId"] and r["public_key"] == edition["publicLeagueId"] for r in aliases), "Exact league alias unavailable")
        for mid, member in wanted.items():
            row = matches[mid]
            require(all(member[k] == row[c] for k, c in [("matchRevisionId", "revision_id"), ("sourceId", "source_id"), ("sourceRecordId", "source_record_id"), ("publicationState", "publication_state")]), "Member source/revision/state differs")
            require(any(r["route_kind"] == "match" and r["public_key"] == member["publicId"] and r["match_id"] == mid and r["match_revision_id"] == row["revision_id"] for r in aliases), "Exact current match alias unavailable")
    if "proofs" not in body:
        return
    exact_keys(body["proofs"], ["minimumSource", "coverage", "labels"], "Minimum source proofs")
    public = {m["matchId"]: m["publicId"] for e in body["editions"] for m in e["members"]}
    require(set(body["proofs"]["minimumSource"]) == set(public.values()) and set(body["proofs"]["coverage"]) == set(public.values()), "Proof cohort differs")
    labels = body["proofs"]["labels"]
    require(type(labels) is list, "Label proofs absent")
    by_label = {(r.get("matchId"), r.get("side")): r for r in labels}
    require(len(by_label) == len(labels) == len(matches) * 2, "Label proof identities differ")
    teams = {r["id"]: r for r in loaded["football.teams"]}
    periods = {(r["code"], r["definition_version"]) for r in loaded["football.periods"]}
    for mid, match in matches.items():
        key = public[mid]; proof = body["proofs"]["minimumSource"][key]
        exact_keys(proof, ["timeState", "kickoffSha256", "sourceXyState", "sourceFrameState", "unresolvedActorIds", "finalScoreObservation", "shootoutObservation"], "Source field proof")
        require(not proof["unresolvedActorIds"], "Declared source actors remain unresolved", "ACTOR_UNRESOLVED")
        require(proof["timeState"] in {"available", "null", "absent"} and proof["kickoffSha256"] == sha(tagged(match["kickoff_at"])) and
            ((match["kickoff_at"] is not None) == (proof["timeState"] == "available")), "Known UTC time was lost or invented", "FIELD_STATE_MISMATCH")
        if match["kickoff_at"] is not None:
            require(match["kickoff_at"].utcoffset().total_seconds() == 0 and match["match_date"] == match["kickoff_at"].date(), "UTC time/date differs", "FIELD_STATE_MISMATCH")
        require(proof["sourceFrameState"] == "absent" and proof["sourceXyState"] in {"numeric_units_unqualified", "absent"},
            "Available unqualified coordinates cannot become observed NULL/metres", "FIELD_STATE_MISMATCH" if proof["sourceXyState"] == "observed_null" else "COORDINATES_UNQUALIFIED")
        sides = [r for r in loaded["football.match_teams"] if r["match_id"] == mid]
        require(len(sides) == 2 and {r["side"] for r in sides} == {"home", "away"} and len({r["team_id"] for r in sides}) == 2, "Exact two participants required")
        for side in sides:
            label = by_label[(mid, side["side"])]; team = teams.get(side["team_id"])
            allowed = {"matchId", "side", "teamId", "labelSha256", "sourceRecordId", "state"}
            if body["dataOrigin"] != "owned_source_free_fixture": allowed |= {"locator", "documentSha256"}
            exact_keys(label, allowed, "Label proof")
            require(team is not None and label["teamId"] == side["team_id"] and label["state"] == ("null" if team["name"] is None else "string") and
                label["labelSha256"] == sha(tagged(team["name"])) and label["sourceRecordId"] in records and records[label["sourceRecordId"]]["source_id"] == side["source_id"], "Same-ID source name proof differs")
            if "locator" in label:
                record = records[label["sourceRecordId"]]
                require(record["locator"] == label["locator"] and documents[record["document_id"]]["content_sha256"] == label["documentSha256"], "Exact name locator/document differs")
        score_proof = proof["finalScoreObservation"]
        exact_keys(score_proof, ["present", "scope", "home", "away"], "Final score proof")
        require(type(score_proof["present"]) is bool and score_proof["scope"] == ("final_without_shootout" if score_proof["present"] else None), "Final score scope differs")
        scores = {(r["side"], r["score_scope"]): r for r in loaded["football.match_scores"] if r["match_id"] == mid}
        for side in ["home", "away"]:
            actual = scores.get((side, "final_without_shootout"))
            state = "absent" if actual is None else "null" if actual["goals"] is None else "number"
            require(score_proof[side] == {"state": state, "sha256": sha(tagged(actual["goals"] if actual else None))} and score_proof["present"] is (actual is not None), "Final score state differs")
        shootout = proof["shootoutObservation"]
        require(shootout == {"present": any((side, "shootout") in scores for side in ["home", "away"]),
            "homeSha256": sha(tagged(scores.get(("home", "shootout"), {}).get("goals"))),
            "awaySha256": sha(tagged(scores.get(("away", "shootout"), {}).get("goals")))}, "Available shootout was ignored or invented")
        parents = [r for r in loaded["ingest.match_coverage"] if r["match_id"] == mid]
        require(len(parents) <= 1, "Ambiguous selected shot family", "COVERAGE_INVALID")
        parent = parents[0] if parents else None
        shot_rows = [r for r in loaded["football.shots"] if r["match_id"] == mid]
        coverage = body["proofs"]["coverage"][key]
        exact_keys(coverage, {"state", "matchRevisionId", "dataRevision", "key", "shotIds"} | ({"periodBindings"} if "periodBindings" in coverage else set()) | ({"actorBindings"} if "actorBindings" in coverage else set()), "Coverage proof")
        expected = {"state": parent["collection_state"] if parent else "unknown", "matchRevisionId": parent["match_revision_id"] if parent else None,
            "dataRevision": parent["data_revision"] if parent else None,
            "key": {k: parent[k] for k in tables["ingest.match_coverage"]["primary_key"]["columns"]} if parent else None,
            "shotIds": sorted(str(r["external_shot_id"]) for r in shot_rows)}
        require(all(coverage[k] == v for k, v in expected.items()), "Exact coverage PK/revision/shot IDs differ", "COVERAGE_INVALID")
        state = expected["state"]
        require((state == "present" and len(shot_rows) > 0 and parent["observed_row_count"] == len(shot_rows)) or
            (state == "empty" and not shot_rows and parent["observed_row_count"] == 0) or
            (state in {"unknown", "absent", "null", "unavailable"} and not shot_rows and (parent is None or parent["observed_row_count"] is None)), "Coverage completeness differs", "COVERAGE_INVALID")
        for shot in shot_rows:
            require(parent is not None and (shot["source_id"], shot["variant_key"]) == (parent["source_id"], parent["variant_key"]) and
                any(r["team_id"] == shot["team_id"] for r in sides), "Shot source/variant/team differs", "COVERAGE_INVALID")
            require(shot["period_code"] is None or (shot["period_code"], shot["period_definition_version"]) in periods, "Unaccepted shot period", "COVERAGE_INVALID")
            for field, column in [("periodBindings", "period_code"), ("actorBindings", "player_id")]:
                if field in coverage: require(coverage[field].get(shot["external_shot_id"]) == shot[column], "Shot proof actor/period differs", "COVERAGE_INVALID")
            require(all(shot[c] is None for c in ["x_m", "y_m", "coordinate_frame", "pitch_length_m", "pitch_width_m"]), "Unqualified coordinate projection", "COORDINATES_UNQUALIFIED")


class Admission:
    def __init__(self, boundary, conn, model):
        self.boundary, self.body, self.conn = boundary, boundary.body, conn
        self.reader = Inputs(conn, model, [r["sourceRecordId"] for r in self.body["proofs"]["labels"]])
        self.editions = sorted(e["editionId"] for e in self.body["editions"])
        self.stage, self.generation = "planning", None
        self.code_sha = boundary.code_sha
        self.input_closure = None
        self.qualified_pair = {k: self.body[k] for k in ["dataset", "catalogue"]}

    def plan(self):
        dg, cg = self.body["dataset"]["generation"], self.body["catalogue"]["generation"]
        loaded = self.reader.load(self.editions, dg, cg, fresh=True)
        validate_facts(self.body, loaded, self.reader.tables)
        actions = []
        matches = {r["id"]: r for r in loaded["football.matches"]}
        labels = {(r["matchId"], r["side"]): r for r in self.body["proofs"]["labels"]}
        teams = {r["id"]: r for r in loaded["football.teams"]}
        positive = {}
        for metric in loaded["football.player_match_metric_values"]:
            pair = (metric["match_id"], metric["player_id"], metric["team_id"])
            if metric["value_kind"] == "number" and metric["numeric_value"] is not None and metric["numeric_value"] > 0:
                positive.setdefault(pair, []).append("positive native minutes revision " + str(metric["revision_id"]))
        for shot in loaded["football.shots"]:
            if shot["player_id"] is not None:
                positive.setdefault((shot["match_id"], shot["player_id"], shot["team_id"]), []).append("accepted shot revision " + str(shot["revision_id"]))
        participants = {(r["match_id"], r["player_id"], r["team_id"]): r for r in loaded["football.match_players"]}
        player_ids = {r["id"] for r in loaded["football.players"]}
        for pair in positive:
            require(pair[1] in player_ids, "Positive observation actor is unresolved", "ACTOR_UNRESOLVED")
        for match in matches.values():
            if match["publication_state"] != "published": actions.append(("football.matches", match, {"publication_state": "published"}))
        for row in loaded["football.match_teams"]:
            label = labels[(row["match_id"], row["side"])]
            wanted = teams[row["team_id"]]["name"]
            if row["participant_label"] != wanted: actions.append(("football.match_teams", row, {"participant_label": wanted, "source_record_id": label["sourceRecordId"]}))
        for pair, row in participants.items():
            played = True if pair in positive else None
            if row["played"] is not played:
                actions.append(("football.match_players", row, {"played": played, "participation_evidence": "; ".join(sorted(positive[pair])) if played else None}))
        sides = loaded["football.match_teams"]
        for pair, evidence in positive.items():
            if pair in participants: continue
            side = next((r for r in sides if (r["match_id"], r["team_id"]) == (pair[0], pair[2])), None)
            require(side is not None, "Accepted shot actor lacks exact match/team", "ACTOR_UNRESOLVED")
            shot = next(r for r in loaded["football.shots"] if (r["match_id"], r["player_id"], r["team_id"]) == pair)
            actions.append(("football.match_players", None, {"match_id": pair[0], "player_id": pair[1], "team_id": pair[2], "match_team_revision_id": side["revision_id"],
                "played": True, "participation_evidence": "; ".join(sorted(evidence)), "squad_status": "observed", "source_id": shot["source_id"], "source_record_id": shot["source_record_id"],
                "canonical_policy_version": matches[pair[0]]["canonical_policy_version"], "contract_version": matches[pair[0]]["contract_version"],
                "variant_key": "derived:accepted-shot", "raw_position_code_state": "absent", "shirt_number_state": "absent"}))
        wanted_engagements = {(matches[r["match_id"]]["competition_season_id"], r["team_id"]): r for r in sides}
        existing = {(r["competition_season_id"], r["team_id"]): r for r in loaded["football.competition_teams"]}
        editions = {r["id"]: r for r in loaded["football.competition_seasons"]}
        for (eid, tid), side in sorted(wanted_engagements.items()):
            if (eid, tid) in existing: continue
            actions.append(("football.competition_teams", None, {"competition_season_id": eid, "competition_season_revision_id": editions[eid]["revision_id"], "team_id": tid,
                "status": "observed", "source_id": side["source_id"], "source_record_id": side["source_record_id"], "contract_version": editions[eid]["contract_version"], "variant_key": "derived:edition-participant"}))
        closure = {str(eid): self.reader.closure(loaded, eid, dg, cg)["sha256"] for eid in self.editions}
        return {"loaded": loaded, "actions": actions, "closure": closure, "fingerprint": sha(tagged({t: loaded[t] for t in ["football.matches", "football.match_teams", "football.match_players", "football.competition_teams", "football.player_match_metric_values", "football.shots", "ingest.match_coverage", "ingest.public_aliases", "football.team_profile_versions", "football.player_profile_versions"]}))}

    def write(self, table, values):
        return self.write_batch(table, [values])[0]

    def write_batch(self, table, rows):
        from psycopg.types.json import Jsonb
        cols = self.reader.tables[table]["columns"]
        groups = {}
        for values in rows:
            require(set(values) <= set(cols), "Unknown derived SQL column")
            groups.setdefault(tuple(sorted(values)), []).append(values)
        returned = []
        for names, group in groups.items():
            for offset in range(0, len(group), MAX_FETCH):
                batch = group[offset:offset + MAX_FETCH]
                params = [Jsonb(values[c]) if cols[c]["type"] == "jsonb" and values[c] is not None else values[c] for values in batch for c in names]
                values_sql = ",".join("(" + ",".join(["%s"] * len(names)) + ")" for _ in batch)
                cursor = self.conn.execute("INSERT INTO " + relation(table) + " (" + ",".join(identifier(c) for c in names) + ") VALUES " + values_sql + " RETURNING *", params)
                columns = [c.name for c in cursor.description]
                returned.extend(dict(zip(columns, row)) for row in cursor.fetchall())
        return returned

    def successors(self, table, actions):
        columns = self.reader.tables[table]["columns"]
        keys = self.reader.tables[table]["primary_key"]["columns"]
        values = []
        for offset in range(0, len(actions), MAX_FETCH):
            batch = actions[offset:offset + MAX_FETCH]
            predicates = " OR ".join("(" + " AND ".join(identifier(c) + "=%s" for c in keys) + ")" for _ in batch)
            params = [self.generation, *[old[c] for old, _ in batch for c in keys]]
            cursor = self.conn.execute("UPDATE " + relation(table) + " SET recorded_to_gen=%s WHERE recorded_to_gen IS NULL AND (" + predicates + ")", params)
            require(cursor.rowcount == len(batch), "Derived predecessors moved", "STALE_PLAN")
            for old, changes in batch:
                fresh = {c: v for c, v in old.items() if not columns[c].get("identity") and c not in {"recorded_to_gen", "updated_at"}}
                fresh.update(changes, recorded_from_gen=self.generation, transform_version=TRANSFORM, transform_code_sha256=self.code_sha, provenance_kind="derived")
                if "data_revision" in columns: fresh["data_revision"] = old["data_revision"] + 1
                values.append(fresh)
        return self.write_batch(table, values)

    def successor(self, table, old, changes):
        return self.successors(table, [(old, changes)])[0]

    def receipt(self, status, closure, *, committed=False):
        return {"kind": "orion_real_core_admission_receipt_v1", "status": status, "dataOrigin": self.body["dataOrigin"],
            "sourcePolicy": POLICY, "sourceInputEpochSha256": self.body["sourceInputEpochSha256"], "codeCommit": self.boundary.commit,
            "codeContentSha256": self.code_sha, "transformVersion": TRANSFORM, "dependenciesSha256": closure,
            "generation": self.qualified_pair["dataset"]["generation"], "snapshotId": self.qualified_pair["dataset"]["snapshotId"],
            "qualifiedSnapshotPair": self.qualified_pair, "inputClosureSha256": self.input_closure,
            "outputClosureSha256": sha(closure), "committed": committed, "connections": self.boundary.connections, "fullAcceptance": False}

    def run(self):
        initial = self.plan()
        self.input_closure = initial["fingerprint"]
        if self.boundary.args.mode == "plan": return self.receipt("planned", initial["closure"])
        if not initial["actions"]: return self.receipt("noop", initial["closure"])
        self.stage = "applying"
        with self.conn.transaction():
            self.conn.execute("SELECT pg_advisory_xact_lock(20261104,1)")
            current = self.plan()
            require(current["fingerprint"] == initial["fingerprint"], "Inputs changed before minimal normalization", "STALE_PLAN")
            latest = self.conn.execute("SELECT max(generation) FROM ingest.dataset_snapshots WHERE status='sealed'").fetchone()[0]
            live = self.reader.load(self.editions, latest, latest, fresh=True)
            for table in ["football.matches", "football.match_teams", "football.match_players", "football.player_match_metric_values", "football.shots", "ingest.match_coverage", "ingest.public_aliases"]:
                require(tagged(live[table]) == tagged(current["loaded"][table]), "Relevant accepted native input advanced", "STALE_PLAN")
            self.generation = self.conn.execute("SELECT ingest.begin_generation(%s,%s,%s)", ("real-admission:" + uuid.uuid4().hex, TRANSFORM, POLICY)).fetchone()[0]
            changed_matches = {}
            aliases = current["loaded"]["ingest.public_aliases"]
            for table in ["football.matches", "football.match_teams", "football.match_players", "football.competition_teams"]:
                replacements, additions = [], []
                for target, old, changes in current["actions"]:
                    if target != table: continue
                    if old is None:
                        additions.append(dict(changes, recorded_from_gen=self.generation, is_canonical=True, transform_version=TRANSFORM, transform_code_sha256=self.code_sha, provenance_kind="derived"))
                    else:
                        if table == "football.match_teams" and old["match_id"] in changed_matches:
                            changes = dict(changes, match_revision_id=changed_matches[old["match_id"]]["revision_id"])
                        replacements.append((old, changes))
                if replacements:
                    fresh = self.successors(table, replacements)
                    if table == "football.matches": changed_matches = {r["id"]: r for r in fresh}
                if additions: self.write_batch(table, additions)
            alias_actions = [(alias, {"match_revision_id": changed_matches[alias["match_id"]]["revision_id"]}) for alias in aliases
                if alias["route_kind"] == "match" and alias["match_id"] in changed_matches]
            if alias_actions: self.successors("ingest.public_aliases", alias_actions)
            for edition in current["loaded"]["football.competition_seasons"]:
                cursor = self.conn.execute("UPDATE ingest.dirty_editions SET generation=%s,competition_season_revision_id=%s,changed_at=CURRENT_TIMESTAMP,reason=%s WHERE competition_season_id=%s", (self.generation, edition["revision_id"], "Qualified minimal publication derivations", edition["id"]))
                if cursor.rowcount == 0:
                    self.conn.execute("INSERT INTO ingest.dirty_editions(competition_season_id,competition_season_revision_id,generation,reason) VALUES(%s,%s,%s,%s)", (edition["id"], edition["revision_id"], self.generation, "Qualified minimal publication derivations"))
            manifest = {"transform": TRANSFORM, "codeContentSha256": self.code_sha, "sourceInputEpochSha256": self.body["sourceInputEpochSha256"], "inputClosures": current["closure"]}
            self.conn.execute("SELECT ingest.seal_generation(%s,%s)", (self.generation, sha(manifest)))
            self.stage = "commit_pending"
        self.stage = "committed"
        self.reader.cache.clear()
        loaded = self.reader.load(self.editions, self.generation, self.generation, fresh=True)
        snapshot = next(r for r in loaded["ingest.dataset_snapshots"] if r["generation"] == self.generation)
        self.qualified_pair = {k: {"snapshotId": snapshot["id"], "generation": snapshot["generation"], "manifestSha256": snapshot["manifest_sha256"], "sourcePriorityVersion": snapshot["source_priority_version"]} for k in ["dataset", "catalogue"]}
        closure = {str(eid): self.reader.closure(loaded, eid, self.generation, self.generation)["sha256"] for eid in self.editions}
        result = self.receipt("admitted", closure, committed=True)
        self.boundary.committed_ack()
        return result


def parser_for(stage):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--environment", choices=["owned_local_tls", "rds"], help="Explicit released native endpoint; omitted means offline")
    parser.add_argument("--mode", choices=["plan", "apply"] if stage == "admit" else ["plan", "publish"], default="plan")
    for flag in ["input", "endpoint", "release"]:
        parser.add_argument("--" + flag, type=Path)
        parser.add_argument("--" + flag + "-sha256")
    parser.add_argument("--receipt", type=Path, help="Inspectable operation receipt")
    parser.add_argument("--credential-file", type=Path, help="Explicit released mode0600 RDS credential file")
    parser.add_argument("--admission-receipt", type=Path, help="Exact prior real admission receipt, never a source body")
    return parser


def execute(stage, implementation):
    args = parser_for(stage).parse_args()
    if args.environment is None:
        result = {"status": "offline_plan", "stage": stage, "connections": 0, "sourceReads": 0, "cloudCalls": 0}
        print(compact(result)); return 0
    boundary = conn = operation = None
    try:
        boundary = Boundary(args, stage)
        conn = boundary.connect()
        model = strict_json(MODEL_PATH.read_bytes())
        operation = implementation(boundary, conn, model)
        result = operation.run()
    except Refused as error:
        result = {"status": "retry" if error.retry or error.code == "STALE_PLAN" else "rejected", "error": {"code": error.code, "message": str(error)}}
        if error.code == "COMMIT_ACK_UNKNOWN": result["outcome"] = "acknowledgment_unknown"
    except Exception as error:
        state = getattr(error, "sqlstate", None)
        uncertain = operation is not None and operation.stage in {"commit_pending", "ready_commit_pending", "activation_commit_pending"} and (state is None or state.startswith("08"))
        result = {"status": "retry" if uncertain or state in {"55P03", "57014", "40001", "40P01"} else "rejected", "error": {"code": "COMMIT_ACK_UNKNOWN" if uncertain else "UNREADY_INPUT", "type": type(error).__name__, "sqlstate": state,
            "message": "Commit acknowledgment unknown; inspect retained state" if uncertain else "Native admission/publication could not qualify its released inputs"}}
        if uncertain: result["outcome"] = "acknowledgment_unknown"
    finally:
        if conn is not None: conn.close()
    if operation is not None: result["stage"] = operation.stage
    if boundary is not None: result["connections"] = boundary.connections
    if args.receipt is not None:
        temporary = args.receipt.with_suffix(".tmp")
        temporary.write_text(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
        temporary.replace(args.receipt)
    print(compact(result))
    return 0 if result["status"] in {"planned", "admitted", "published", "noop"} else 1


if __name__ == "__main__":
    raise SystemExit(execute("admit", Admission))
