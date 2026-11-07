"""Source freshness and coverage regressions, without a database or provider call."""

import copy
import datetime as dt
import io
import sys
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard/scripts"))
import aws_ingest
import relational_materialize as publisher
from test_dashboard_data import synthetic


class Rows:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def __iter__(self):
        return iter(self.rows)

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class PublicationSource:
    """Saved responses fed through the actual spool, merge and snapshot builder."""

    def __init__(self, archive_date="2026-11-02T23:00:00Z", previous_date=None):
        self.db = self
        sample = synthetic()[0]["samples"][0]
        self.fixture = dict(sample["match"], date="2026-11-02", time_utc="2026-11-02T20:00:00Z")
        self.mid = self.fixture["id"]
        self.current = []
        self.fallback = []
        self.archive = {
            "document": {"path": "documents"},
            "tables": {f: {"path": f} for f in ("match", "players", "shots", "lineups", "stats")},
        }
        self.objects = {"documents": [{"id": "doc-one", "metadata": {"retrieved_at_utc": archive_date}}]}
        for family, source in (("match", "match"), ("players", "players"), ("shots", "shots"),
                               ("lineups", "lineups"), ("stats", "team_stats")):
            data = self.fixture if source == "match" else sample[source]["data"]
            self.objects[family] = [{"documentId": "doc-one", "response": {"status": 200, "data": data}}]
        self.previous = {"meta": {"retrievedAt": previous_date, "endDate": "2026-08-01",
                                   "ratedAppearanceCount": 999, "source": "Saved provider archive"},
                         "metrics": [], "tables": {t: [] for t in publisher.TABLES}}

    def execute(self, query, params=None):
        if "FROM work_dirty" in query or "FROM work_scopes" in query:
            return Rows()
        if "FROM work_matches w LEFT" in query:
            return Rows([(self.mid, self.fixture)])
        if "FROM statarena.resources WHERE" in query:
            return Rows()
        if "FROM statarena.observations" in query:
            return Rows([(self.mid, "one-shard", 0)])
        if "FROM statarena.shards" in query:
            return Rows([("one-shard", self.archive)])
        if "FROM work_resources" in query:
            return Rows(sorted(self.current, key=lambda r: (r[4] or {}).get("path", "")))
        if "FROM statarena_app.match_families" in query:
            return Rows(self.fallback)
        if "SELECT source_digest FROM statarena_app.partitions" in query or "FROM statarena_app.worker_inputs" in query:
            return Rows()
        if query.lstrip().startswith("INSERT INTO statarena_app.worker_inputs"):
            return Rows()
        if query.lstrip().startswith("DELETE FROM"):
            return Rows()
        raise AssertionError("Unexpected database access: " + query)

    def prefetch(self, *args):
        pass

    def ref(self, ref):
        return copy.deepcopy(self.objects[ref["path"]])

    def current_response(self, family, status, retrieved_at, data=None):
        path = "new-" + family
        self.objects[path] = {"data": data}
        self.current.append((self.mid, "/matches/" + self.mid + "/" + family, "{}", status,
                             {"path": path, "retrievedAt": retrieved_at}, None))

    def publish(self):
        with patch.object(publisher, "read_partition", return_value=self.previous), \
             patch.object(publisher, "capacity", return_value=100_000_000), \
             patch.object(publisher, "publish_match_batch"), \
             patch.object(publisher, "partition_calendar"), \
             patch.object(publisher, "publish_snapshot") as save:
            publisher.publish_partition(self, {}, "2026/2027", "l_000001", None)
        return save.call_args.args[3]


class MetadataTests(unittest.TestCase):
    def test_coverage_uses_merged_facts_not_old_counts_or_future_fixtures(self):
        tables = {t: [] for t in publisher.TABLES}
        tables.update(
            matches=[
                {"id": "m1", "date": "2026-08-01", "leagueId": "l1", "season": "2026/2027",
                 "detailCollected": True, "coverage": {}},
                {"id": "m2", "date": "2026-11-02", "leagueId": "l1", "season": "2026/2027",
                 "detailCollected": False, "coverage": {"shots": True}},
                {"id": "m3", "date": None, "coverage": {"shots": True}},
            ],
            fixtures=[{"status": "finished"}, {"status": "finished"},
                      {"status": "not_started", "date": "2027-05-01"}],
            performances=[
                {"matchId": "m1", "playerId": "p1", "teamId": "t1", "minutes": 90, "rating": 0, "xg": 0, "xa": None},
                {"matchId": "m2", "playerId": "p1", "teamId": "t1", "minutes": 20, "rating": 7, "xg": None, "xa": 0},
                {"matchId": "m2", "playerId": "p2", "teamId": "t2", "minutes": 0, "rating": 9, "xg": 1},
                {"matchId": "m2", "playerId": "p3", "teamId": None, "minutes": None},
            ],
            shots=[{"matchId": "m1", "xg": 0}, {"matchId": "m1", "xg": None}],
            players=[{"id": "unused-profile", "playerId": "unused"}],
            competitions=[{"seasons": ["2026/2027"]}],
        )
        old = {"matchCount": 999, "shotMatchCount": 999, "endDate": "2025-01-01",
               "retrievedAt": "2026-10-01T12:00:00Z", "source": "Archive", "notes": ["Missing stays null"]}
        meta = publisher.partition_metadata(tables, old)
        self.assertEqual({k: meta[k] for k in ("matchCount", "collectedMatches", "expectedFinishedMatches",
                          "playerCount", "activePlayerCount", "listedAppearanceCount", "appearanceCount",
                          "teamCount", "shotCount", "knownShotXgCount", "ratedAppearanceCount",
                          "xgAppearanceCount", "xaAppearanceCount", "xgMatchCount", "ratedMatchCount", "shotMatchCount")},
                         dict(matchCount=3, collectedMatches=1, expectedFinishedMatches=2,
                              playerCount=3, activePlayerCount=1, listedAppearanceCount=4, appearanceCount=2,
                              teamCount=2, shotCount=2, knownShotXgCount=1, ratedAppearanceCount=2,
                              xgAppearanceCount=1, xaAppearanceCount=1, xgMatchCount=1, ratedMatchCount=2, shotMatchCount=3))
        self.assertEqual((meta["startDate"], meta["endDate"]), ("2026-08-01", "2026-11-02"))
        self.assertEqual(meta["retrievedAt"], old["retrievedAt"])
        self.assertEqual((meta["source"], meta["notes"]), (old["source"], old["notes"]))
        self.assertEqual(old["matchCount"], 999)

    def test_empty_partition_has_no_inherited_coverage_or_fake_retrieval(self):
        meta = publisher.partition_metadata({t: [] for t in publisher.TABLES},
                                            {"matchCount": 8, "activePlayerCount": 22, "startDate": "2025-01-01"})
        self.assertEqual((meta["matchCount"], meta["activePlayerCount"]), (0, 0))
        self.assertIsNone(meta["startDate"])
        self.assertIsNone(meta["endDate"])
        self.assertIsNone(meta["retrievedAt"])

    def test_retrieval_requires_explicit_timezone_and_compares_instants(self):
        self.assertEqual(publisher.latest_retrieval("2026-11-06T22:00:00+02:00", "2026-11-06T20:30:00Z",
                                                  "2027-01-01", "2027-01-01T12:00:00", "invalid", None),
                         "2026-11-06T20:30:00Z")

    def test_failed_newer_request_keeps_archive_facts_and_collection_time(self):
        source = PublicationSource()
        source.current_response("players", 503, "2026-11-06T12:00:00Z")
        result = source.publish()
        self.assertEqual(result["meta"]["retrievedAt"], "2026-11-02T23:00:00Z")
        self.assertEqual(result["meta"]["endDate"], "2026-11-02")
        self.assertEqual(result["appearances"][0]["goals"], 1)
        self.assertEqual(result["meta"]["ratedAppearanceCount"], 0)

    def test_only_successful_selected_response_advances_collection_time(self):
        source = PublicationSource()
        source.current_response("players", 503, "2026-11-06T12:00:00Z")
        source.current_response("stats", 200, "2026-11-05T12:00:00Z",
                                source.objects["stats"][0]["response"]["data"])
        # A newer parameter variant is saved as detail, but does not enter the partition facts.
        source.objects["variant"] = {"data": {"periods": []}}
        source.current.append((source.mid, "/matches/" + source.mid + "/shots", '{"period":"first"}', 200,
                               {"path": "variant", "retrievedAt": "2026-11-06T20:00:00Z"}, None))
        result = source.publish()
        self.assertEqual(result["meta"]["retrievedAt"], "2026-11-05T12:00:00Z")
        self.assertEqual(result["appearances"][0]["goals"], 1)

    def test_legacy_reused_document_reference_keeps_original_archive_date(self):
        source = PublicationSource()
        source.archive["tables"] = {"players": {"path": "players"}}
        source.current.append((source.mid, "/matches/" + source.mid + "/players", "{}", 200,
                               {"path": "players", "documentId": "doc-one"}, None))
        self.assertEqual(source.publish()["meta"]["retrievedAt"], "2026-11-02T23:00:00Z")

    def test_previous_typed_fallback_does_not_acquire_failed_request_time(self):
        source = PublicationSource(archive_date=None, previous_date="2026-11-01T12:00:00Z")
        previous_players = source.objects["players"][0]["response"]
        source.objects["players"][0]["response"] = {"status": 404, "data": None}
        source.current_response("players", 503, "2026-11-06T12:00:00Z")
        source.fallback = [("players", previous_players)]
        result = source.publish()
        self.assertEqual(result["meta"]["retrievedAt"], "2026-11-01T12:00:00Z")
        self.assertEqual(result["appearances"][0]["goals"], 1)

    def test_undated_observation_updates_coverage_without_claiming_freshness(self):
        result = PublicationSource(archive_date=None).publish()
        self.assertEqual(result["meta"]["endDate"], "2026-11-02")
        self.assertIsNone(result["meta"]["retrievedAt"])


class CollectorProvenanceTests(unittest.TestCase):
    def test_reusing_an_archive_preserves_known_or_unknown_collection_time(self):
        for stamp in ("2026-10-12T12:00:00Z", None):
            with self.subTest(stamp=stamp):
                docs = {"doc": [{"id": "source-one", "metadata": {"retrieved_at_utc": stamp}}],
                        "players": [{"documentId": "source-one", "response": {"status": 200, "data": []}}]}
                ref = {"document": {"path": "doc"}, "tables": {"players": {"path": "players"}}}
                store = SimpleNamespace(db=SimpleNamespace(execute=lambda *args: Rows([(0, ref)])), json=docs.__getitem__)
                with patch.object(aws_ingest, "source_table", side_effect=lambda s, path: s.json(path)), \
                     patch.object(aws_ingest, "request") as fetch, \
                     patch.object(aws_ingest.dt, "datetime") as clock:
                    status, body, reference, reused = aws_ingest.collect_response(
                        store, "/matches/m_000001/players", {}, "historical", "test-key", "https://example.invalid")
                self.assertTrue(reused)
                self.assertEqual(status, 200)
                self.assertEqual(reference.get("retrievedAt"), stamp)
                self.assertEqual(reference["documentId"], "source-one")
                fetch.assert_not_called()
                clock.now.assert_not_called()

    def test_real_fetch_records_collection_time_without_reusing_archive(self):
        stamp = dt.datetime(2026, 11, 6, 12, 30, tzinfo=dt.timezone.utc)
        with patch.object(aws_ingest, "existing_observation") as archive, \
             patch.object(aws_ingest, "request", return_value=(200, {"data": []})) as fetch, \
             patch.object(aws_ingest.dt, "datetime") as clock:
            clock.now.return_value = stamp
            status, body, ref, reused = aws_ingest.collect_response(
                object(), "/matches/m_000001/players", {}, "pulse", "test-key", "https://example.invalid")
        self.assertFalse(reused)
        self.assertEqual(ref, {"retrievedAt": "2026-11-06T12:30:00+00:00"})
        self.assertEqual((status, body), (200, {"data": []}))
        fetch.assert_called_once()
        archive.assert_not_called()


class MetadataPublicationTests(unittest.TestCase):
    def decision(self, value, source_digest, proof, previous_facts=None):
        class DB:
            def execute(self, query, params=None):
                if "SELECT source_digest" in query:
                    return Rows([(source_digest,)])
                if "SELECT digest" in query:
                    return Rows([(proof,)]) if proof else Rows()
                if query.lstrip().startswith("INSERT INTO statarena_app.worker_inputs"):
                    self.receipt = params
                    return Rows()
                raise AssertionError("Unexpected access: " + query)

        db = DB()
        with patch.object(publisher, "publish_snapshot", return_value=1) as publish:
            publisher.publish_partition_snapshot(db, "2026/2027", "l1", value, previous_facts)
        self.assertEqual(db.receipt[2], publisher.facts_receipt(publisher.publication_digest(value), publisher.snapshot_facts(value)))
        self.assertEqual(len(publisher.publication_digest(value)), 64)
        return publish.call_args.kwargs["metadata_only"]

    def test_new_collection_time_only_uses_bound_facts_receipt(self):
        value = {"meta": {"retrievedAt": "2026-11-06T12:00:00Z"},
                 "matches": [{"id": "m1", "goals": 0}], "metrics": [{"key": "goals", "label": "Goals"}]}
        old_digest = "a" * 64
        proof = publisher.facts_receipt(old_digest, publisher.snapshot_facts(value))
        self.assertTrue(self.decision(value, old_digest, proof))
        # A stale receipt from a different full publication cannot prove equality.
        self.assertFalse(self.decision(value, "b" * 64, proof))
        for changed in (
            {**value, "matches": [{"id": "m1", "goals": None}]},
            {**value, "matches": [{"id": "m1", "goals": False}]},
            {**value, "matches": [{"id": "m2", "goals": 0}]},
            {**value, "metrics": [{"key": "goals", "label": "Changed label"}]},
        ):
            with self.subTest(changed=changed):
                self.assertFalse(self.decision(changed, old_digest, proof))

    def test_legacy_partition_requires_exact_facts_or_a_complete_publication(self):
        value = {"meta": {"matchCount": 2}, "matches": [{"id": "m1"}, {"id": "m2"}]}
        self.assertFalse(self.decision(value, "a" * 64, None))
        self.assertTrue(self.decision(value, "a" * 64, None, publisher.snapshot_facts(value)))
        reordered = {**value, "matches": list(reversed(value["matches"]))}
        self.assertFalse(self.decision(reordered, "a" * 64, None, publisher.snapshot_facts(value)))


class FailureReportingTests(unittest.TestCase):
    def test_closed_connection_does_not_mask_original_publication_error(self):
        original = publisher.psycopg.OperationalError("server closed during source preparation")

        class DB:
            closed = False

            def execute(self, query, params=None):
                if "pg_try_advisory_lock" in query:
                    return Rows([(True,)])
                if "workflow_state" in query:
                    raise publisher.psycopg.OperationalError("connection is closed")
                raise AssertionError("A closed session must not be unlocked")

        db = DB()

        def fail(*args):
            db.closed = True
            raise original

        source = SimpleNamespace(read=lambda *args: {})
        with patch.object(publisher, "capacity"), patch.object(publisher, "install"), \
             patch.object(publisher, "Inputs", return_value=source), \
             patch.object(publisher, "prepare", side_effect=fail), redirect_stderr(io.StringIO()):
            with self.assertRaises(publisher.psycopg.OperationalError) as caught:
                publisher.run(SimpleNamespace(db=db))
        self.assertIs(caught.exception, original)


if __name__ == "__main__":
    unittest.main()
