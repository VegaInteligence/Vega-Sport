#!/usr/bin/env python3
"""Real publisher that also writes the per-build season read models.

Identical to orion_pro_publish_real.Publisher (planning, admission receipt,
READY verification, atomic activation, receipts) except that new builds carry
metrics contract ``orion_pro_season_aggregates_v1`` and get their aggregates
(orion_pro_season_aggregates.write) inside the build transaction before they
turn READY. Representation stays ``summary-v1-shots-v1``.
"""
from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import orion_pro_publish_real as base  # noqa: E402
import orion_pro_season_aggregates as aggregates  # noqa: E402
from orion_pro_publish import REPRESENTATION, products, require  # noqa: E402

METRICS = aggregates.CONTRACT


class AggregatePublisher(base.Publisher):
    def __init__(self, boundary, conn, model):
        super().__init__(boundary, conn, model)
        self.aggregate_counts = {}

    def matches_contract(self, build, closure):
        return all(build.get(k) == value for k, value in {
            "competition_season_id": int(closure["manifest"]["editionId"]),
            "competition_season_revision_id": closure["tables"]["football.competition_seasons"][0]["revision_id"],
            "dependencies_sha256": closure["sha256"], "code_content_sha256": self.code_sha,
            "environment_sha256": self.environment["sha256"], "code_commit": self.boundary.commit,
            "representation_version": REPRESENTATION, "transform_version": base.TRANSFORM,
            "metrics_contract_version": METRICS, "status": "ready",
        }.items())

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
                row = self.conn.execute("INSERT INTO analytics.aggregation_builds (competition_season_id,competition_season_revision_id,dataset_snapshot_id,catalog_snapshot_id,transform_version,metrics_contract_version,representation_version,code_commit,code_content_sha256,dependencies_sha256,environment_sha256,status) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'building') RETURNING id", (eid, selected["revision_id"], closure["dataset"]["id"], closure["catalogue"]["id"], base.TRANSFORM, METRICS, REPRESENTATION, self.boundary.commit, self.code_sha, closure["sha256"], self.environment["sha256"])).fetchone()
                build_id = row[0]
                output = products(closure)
                self.insert_rows("analytics.match_summary", ["build_id", *base.MATCH_COLUMNS], [{"build_id": build_id, **r} for r in output["matches"]])
                self.insert_rows("analytics.competition_summary", ["build_id", *base.EDITION_COLUMNS], [{"build_id": build_id, **output["edition"]}])
                self.aggregate_counts[str(eid)] = aggregates.write(self.conn, build_id, eid, closure["dataset"]["generation"])
                self.conn.execute("UPDATE analytics.aggregation_builds SET status='ready',finished_at=CURRENT_TIMESTAMP WHERE id=%s AND status='building'", (build_id,))
                created.append(build_id)
            if created:
                self.conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
                self.boundary.event("before_ready_commit", self.conn, editions=self.editions, builds=created)
            self.stage = "ready_commit_pending"
        self.ready_committed.extend(created)
        self.stage = "ready_committed"
        self.boundary.event("after_ready_commit", self.conn, editions=self.editions, builds=created)
        return self.plan(fresh=True)

    def receipt(self, status, plan, *, changed=(), generation=None):
        result = super().receipt(status, plan, changed=changed, generation=generation)
        result.update(metricsContractVersion=METRICS, aggregateCounts=self.aggregate_counts)
        return result
