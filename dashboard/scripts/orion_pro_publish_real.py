#!/usr/bin/env python3
"""Publish the four existing V1 readers from explicitly admitted native SQL.

Default offline. Source bodies/providers are never opened. READY products and
retained publication intervals are immutable; dirty markers are retained.
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))

from orion_pro_publish import ROOT, REPRESENTATION, METRICS, SCHEME, MATCH_COLUMNS, EDITION_COLUMNS, products, identifier, relation, require, sha, Refused
from orion_pro_admit_real import Boundary, Inputs, validate_facts, strict_json, execute, POLICY, PUBLISH_TRANSFORM

TRANSFORM = PUBLISH_TRANSFORM


class Publisher:
    def __init__(self, boundary, conn, model):
        self.boundary, self.conn = boundary, conn
        self.body = dict(boundary.body)
        self.args = SimpleNamespace(mode=boundary.args.mode,
            dataset_generation=self.body["dataset"]["generation"], catalog_generation=self.body["catalogue"]["generation"])
        self.reader = Inputs(conn, model)
        self.environment = {"sha256": self.body["publisher"]["environmentSha256"]}
        self.code_sha = boundary.code_sha
        self.editions = sorted(e["editionId"] for e in self.body["editions"])
        self.declared = {e["editionId"]: e for e in self.body["editions"]}
        self.ready_committed = []
        self.stage = "planning"
        self.activation_generation = None
        self.admission = self.read_admission_receipt()

    def read_admission_receipt(self):
        digest = self.body.get("admissionReceiptSha256")
        if digest is None and "admissionPhase" in self.body:
            digest = self.body["admissionPhase"]["receiptSha256"]
        if digest is None: return None
        candidates = [self.boundary.args.admission_receipt] if self.boundary.args.admission_receipt else sorted(self.boundary.run.glob("*.json")) if self.boundary.owned else []
        for path in candidates:
            if path is not None and sha(Path(path).read_bytes()) == digest:
                receipt = strict_json(Path(path).read_bytes())
                require(receipt.get("kind") == "orion_real_core_admission_receipt_v1" and receipt.get("status") in {"admitted", "noop"}, "Unaccepted admission receipt", "ADMISSION_STALE")
                require(receipt.get("dataOrigin") == self.body["dataOrigin"] and receipt.get("sourcePolicy") == POLICY and
                    receipt.get("codeCommit") == self.boundary.commit and receipt.get("codeContentSha256") == sha((ROOT / "dashboard/scripts/orion_pro_admit_real.py").read_bytes()), "Admission producer identity differs", "ADMISSION_STALE")
                if "admissionPhase" in self.body:
                    phase = self.body["admissionPhase"]
                    require(phase["version"] == receipt["transformVersion"] and phase["commit"] == receipt["codeCommit"] and
                        phase["codeSha256"] == receipt["codeContentSha256"] and phase["inputClosureSha256"] == receipt["inputClosureSha256"] and
                        phase["outputClosureSha256"] == receipt["outputClosureSha256"] and phase["generation"] == receipt["generation"] and phase["snapshotId"] == receipt["snapshotId"], "Real admission phase differs from exact receipt", "ADMISSION_STALE")
                return receipt
        return None

    def matches_contract(self, build, closure):
        return all(build.get(k) == value for k, value in {
            "competition_season_id": int(closure["manifest"]["editionId"]),
            "competition_season_revision_id": closure["tables"]["football.competition_seasons"][0]["revision_id"],
            "dependencies_sha256": closure["sha256"], "code_content_sha256": self.code_sha,
            "environment_sha256": self.environment["sha256"], "code_commit": self.boundary.commit,
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
        validate_facts(self.body, loaded, self.reader.tables, publish=True)
        require(self.admission is not None, "Exact successful admission receipt unavailable", "ADMISSION_STALE")
        if "sourceInputEpochSha256" in self.body:
            require(self.admission.get("sourceInputEpochSha256") == self.body["sourceInputEpochSha256"], "Source input epoch changed after admission", "ADMISSION_STALE")
        closures = {eid: self.reader.closure(loaded, eid, self.args.dataset_generation, self.args.catalog_generation) for eid in self.editions}
        for eid, closure in closures.items():
            require(self.admission.get("dependenciesSha256", {}).get(str(eid)) == closure["sha256"], "Admission output closure changed", "ADMISSION_STALE")
        engagements = {(r["competition_season_id"], r["team_id"]) for r in loaded["football.competition_teams"]}
        matches = {r["id"]: r for r in loaded["football.matches"]}
        for side in loaded["football.match_teams"]:
            require((matches[side["match_id"]]["competition_season_id"], side["team_id"]) in engagements, "Missing exact edition engagement", "MISSING_ENGAGEMENT")
        for shot in loaded["football.shots"]:
            if shot["player_id"] is not None:
                require(any((p["match_id"],p["player_id"],p["team_id"]) == (shot["match_id"],shot["player_id"],shot["team_id"]) and p["played"] is True for p in loaded["football.match_players"]), "Shot actor lacks proved playing participation", "ACTOR_UNRESOLVED")
        versions = {r["contract_version"] for r in loaded["ingest.relation_contracts"] if r["relation_code"] == "analytics.publication_versions"}
        requested = {r["contract_version"] for r in matches.values()}
        require(len(requested) == 1 and requested <= versions, "Publication row contract unavailable")
        self.body["upstreamRowContracts"] = {"contractVersion": next(iter(requested))}
        current = {r["competition_season_id"]: r for r in loaded["analytics.publication_versions"]}
        builds = {r["id"]: r for r in loaded["analytics.aggregation_builds"]}
        chosen, changed = {}, []
        for eid, closure in closures.items():
            pointer = current.get(eid)
            candidates = [r for r in builds.values() if self.matches_contract(r, closure)]
            candidates.sort(key=lambda b: (0 if pointer and pointer["build_id"] == b["id"] else 1, b["id"]))
            if candidates:
                self.verify_ready(candidates[0], closure, loaded)
                chosen[eid] = candidates[0]
            if not pointer or eid not in chosen or pointer["build_id"] != chosen[eid]["id"]: changed.append(eid)
        return {"loaded": loaded, "closures": closures, "current": current, "chosen": chosen,
            "changed": changed, "watermarks": self.watermarks(loaded, self.editions)}

    def lock_editions(self):
        # bigint advisory locks live in a different namespace from the native
        # two-int generation lock. The same sorted positive edition IDs are used
        # by both build deduplication and final activation.
        self.conn.execute("SELECT pg_advisory_xact_lock(eid) FROM (SELECT unnest(%s::bigint[]) eid ORDER BY 1) sorted_editions", (self.editions,)).fetchall()

    def insert_rows(self, table, columns, rows):
        require(bool(rows), "Cannot insert an empty output batch")
        for offset in range(0, len(rows), 1000):
            batch = rows[offset:offset+1000]
            names = ",".join(identifier(c) for c in columns)
            placeholders = ",".join("(" + ",".join(["%s"] * len(columns)) + ")" for _ in batch)
            values = [r[c] for r in batch for c in columns]
            self.conn.execute(f"INSERT INTO {relation(table)} ({names}) VALUES {placeholders}", values)

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
                row = self.conn.execute("INSERT INTO analytics.aggregation_builds (competition_season_id,competition_season_revision_id,dataset_snapshot_id,catalog_snapshot_id,transform_version,metrics_contract_version,representation_version,code_commit,code_content_sha256,dependencies_sha256,environment_sha256,status) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'building') RETURNING id", (eid, selected["revision_id"], closure["dataset"]["id"], closure["catalogue"]["id"], TRANSFORM, METRICS, REPRESENTATION, self.boundary.commit, self.code_sha, closure["sha256"], self.environment["sha256"])).fetchone()
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
            key = "orion-pro-publish-real:" + uuid.uuid4().hex
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
        return {"kind": "orion_real_four_readers_publication_receipt_v1", "status": status,
            "dataOrigin": self.body["dataOrigin"], "sourcePolicy": POLICY, "representationVersion": REPRESENTATION,
            "dependencyScheme": SCHEME, "codeCommit": self.boundary.commit, "codeContentSha256": self.code_sha,
            "environmentSha256": self.environment["sha256"], "environmentBinding": "explicit released descriptor",
            "requestedPair": {"datasetGeneration": self.args.dataset_generation, "catalogGeneration": self.args.catalog_generation},
            "changedEditionIds": list(changed), "publicationGeneration": generation,
            "committedReadyBuildIds": list(self.ready_committed), "dirtyWatermarksRetained": True,
            "dependenciesSha256": {str(eid): plan["closures"][eid]["sha256"] for eid in self.editions},
            "profileSelections": {str(eid): plan["closures"][eid]["manifest"]["profileSelections"] for eid in self.editions},
            "matchProducts": [{"matchId": r["match_id"], "scoreScope": r["score_scope"], "homeGoals": r["home_goals"], "awayGoals": r["away_goals"]} for eid in self.editions for r in products(plan["closures"][eid])["matches"]],
            "selectedRows": self.reader.selected_rows, "maxBufferedRows": self.reader.max_buffered_rows, "omittedRows": 0,
            "editions": [{"editionId": str(eid), "dependencySha256": plan["closures"][eid]["sha256"],
                "buildId": str(plan["chosen"][eid]["id"]) if eid in plan["chosen"] else None,
                "effectiveSnapshotIds": {"dataset": str(plan["chosen"][eid]["dataset_snapshot_id"]), "catalogue": str(plan["chosen"][eid]["catalog_snapshot_id"])} if eid in plan["chosen"] else None} for eid in self.editions],
            "fullAcceptance": False}

    def run(self):
        plan = self.plan()
        self.boundary.event("after_plan", self.conn, editions=self.editions,
                            builds=[b["id"] for b in plan["chosen"].values()])
        if self.args.mode == "plan":
            return self.receipt("planned", plan, changed=plan["changed"])
        if not plan["changed"]:
            return self.receipt("noop", plan)
        prepared = self.build(plan)
        result = self.activate(plan, prepared)
        self.boundary.committed_ack()
        return result



if __name__ == "__main__":
    raise SystemExit(execute("publish", Publisher))
