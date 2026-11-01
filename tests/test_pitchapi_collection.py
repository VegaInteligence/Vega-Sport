"""Offline regression tests; no API key or external network is used."""

import contextlib
from datetime import datetime, timezone
import importlib.util
import io
import gzip
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("collect_pitchapi_all", ROOT / "scripts/collect_pitchapi_all.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
spec_data = importlib.util.spec_from_file_location("build_dashboard_data", ROOT / "scripts/build_dashboard_data.py")
builder = importlib.util.module_from_spec(spec_data)
spec_data.loader.exec_module(builder)
TEST_KEY = "pk_test_offlineFixtureCredential"


def encoded(body, status=200, headers=None):
    return status, headers or {}, json.dumps(body).encode("utf-8")


CATALOGUE = {"data": {"leagues": [
    {"id": "l_000001", "name": "League A", "seasons": ["2025/2026", "2026/2027"]},
    {"id": "l_000002", "name": "League B", "seasons": ["2026"]},
]}}
FINISHED = {
    "id": "m_000001", "status": "finished", "score_home": 1, "score_away": 0,
    "home_team": {"id": "t_000001", "name": "Home"},
    "away_team": {"id": "t_000002", "name": "Away"},
}
UPCOMING = dict(FINISHED, id="m_000002", status="upcoming", score_home=None, score_away=None)


class FixtureTransport:
    def __init__(self, fail_index=False):
        self.calls = []
        self.fail_index = fail_index

    def __call__(self, request, timeout):
        parsed = urlsplit(request.full_url)
        route = parsed.path.removeprefix("/v1")
        query = parse_qs(parsed.query)
        self.calls.append((route, query))
        if route == "/leagues":
            return encoded(CATALOGUE)
        if route.endswith("/matches") and route.startswith("/leagues/"):
            if self.fail_index and route == "/leagues/l_000002/matches":
                return encoded({"error": {"code": "RESOURCE_NOT_FOUND", "message": "Missing index"}}, 404)
            return encoded({"data": {"league": {"season": query["season"][0]}, "matches": [FINISHED, UPCOMING]}})
        if route == "/matches/m_000001/players":
            return encoded({"data": [{"player": {"id": "p_000001"}, "team_id": "t_000001", "stats": None}]})
        if route == "/matches/m_000001/advanced/network":
            return encoded({"error": {"code": "ANALYTICS_UNAVAILABLE", "message": "Not rated"}}, 404)
        if route == "/matches/m_000001/shots":
            return encoded({"data": {"periods": None, "unknown_future_field": {"value": None}}})
        if route.startswith("/matches/m_000001"):
            return encoded({"data": {"id": "m_000001", "value": None}})
        if route.startswith(("/teams/", "/players/", "/leagues/")):
            return encoded({"data": {"id": route.rsplit("/", 1)[-1], "image_url": None}})
        raise AssertionError(f"Unexpected route: {route}")


def make_client(transport, **kwargs):
    return collector.PitchClient(TEST_KEY, transport=transport, interval=0, max_retries=0, **kwargs)


class PitchCollectionTests(unittest.TestCase):
    def test_offline_plan_covers_every_catalogue_season_without_loading_credentials(self):
        catalogue = {"data": json.loads(gzip.decompress((ROOT / "data/sources/pitchapi/bundles/europe_2026_2027/metadata/catalogue.json.gz").read_bytes()).decode("utf-8-sig"))}
        leagues, pairs = collector.catalogue_pairs(catalogue)
        self.assertEqual((len(leagues), len(pairs)), (77, 303))
        with patch.object(collector, "load_api_key", side_effect=AssertionError("No key access in a plan")):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(collector.main(["--plan"]), 0)
        self.assertIn("303", output.getvalue())

    def test_all_indexes_precede_details_and_profiles_are_deduplicated(self):
        transport = FixtureTransport()
        with tempfile.TemporaryDirectory() as directory:
            result = collector.collect(make_client(transport), directory, details=True, progress=lambda _: None)
            routes = [route for route, query in transport.calls]
            index_positions = [i for i, route in enumerate(routes) if route.startswith("/leagues/") and route.endswith("/matches")]
            detail_positions = [i for i, route in enumerate(routes) if route.startswith("/matches/")]
            self.assertEqual(len(index_positions), 3)
            self.assertEqual(len(detail_positions), 13)
            self.assertLess(max(index_positions), min(detail_positions))
            self.assertFalse(any("m_000002" in route for route in routes))
            self.assertEqual(routes.count("/players/p_000001"), 1)
            self.assertEqual(routes.count("/teams/t_000001"), 1)
            self.assertEqual(routes.count("/teams/t_000002"), 1)
            self.assertTrue(all(query.get("status") == ["all"] for route, query in transport.calls if route.endswith("/matches")))
            self.assertEqual(result["status"], "complete")
            self.assertEqual(result["indexes"]["uniqueMatches"], 2)
            self.assertEqual(result["indexes"]["finishedMatches"], 1)
            self.assertEqual(result["details"]["unavailable"], 1)
            self.assertEqual(result["profiles"]["leagues"], 2)
            raw = collector.read_json(Path(directory) / "matches/m_000001/shots.json")
            self.assertIsNone(raw["response"]["data"]["periods"])
            self.assertEqual(raw["response"]["data"]["unknown_future_field"], {"value": None})
            self.assertTrue((Path(directory) / "seasons/l_000001/2026%2F2027/matches.json").is_file())
            self.assertFalse(any(TEST_KEY in file.read_text() for file in Path(directory).rglob("*.json")))

    def test_resume_uses_checkpoints_and_only_fetches_a_missing_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            collector.collect(make_client(FixtureTransport()), directory, details=True, progress=lambda _: None)
            resumed = FixtureTransport()
            result = collector.collect(make_client(resumed), directory, details=True, progress=lambda _: None)
            self.assertEqual(resumed.calls, [])
            self.assertEqual(result["networkRequestsThisRun"], 0)
            (Path(directory) / "matches/m_000001/events.json").unlink()
            resumed = FixtureTransport()
            collector.collect(make_client(resumed), directory, details=True, progress=lambda _: None)
            self.assertEqual(resumed.calls, [("/matches/m_000001/events", {})])

    def test_incomplete_index_prevents_detail_stage(self):
        transport = FixtureTransport(fail_index=True)
        with tempfile.TemporaryDirectory() as directory:
            result = collector.collect(make_client(transport), directory, details=True, progress=lambda _: None)
            self.assertEqual(result["status"], "index_incomplete")
            self.assertEqual(result["indexes"]["failed"], 1)
            self.assertFalse(any(route.startswith("/matches/") for route, query in transport.calls))

    def test_429_retry_after_and_error_envelope_are_preserved_and_redacted(self):
        responses = [
            encoded({"error": {"code": "RATE_LIMIT_EXCEEDED", "message": TEST_KEY}}, 429, {"Retry-After": "7"}),
            encoded({"data": {"metric": None, "echo": TEST_KEY}}),
        ]
        sleeps = []
        requests = []
        def transport(request, timeout):
            requests.append(request)
            return responses.pop(0)
        client = collector.PitchClient(TEST_KEY, interval=0, max_retries=2, transport=transport, sleep=sleeps.append)
        result = client.fetch("/leagues/l_000001/matches", {"season": "2026/2027", "status": "all"})
        self.assertTrue(result["ok"])
        self.assertEqual(sleeps, [7.0])
        self.assertEqual(len(requests), 2)
        self.assertIn("season=2026%2F2027", requests[0].full_url)
        self.assertEqual(requests[0].get_header("X-api-key"), TEST_KEY)
        self.assertNotIn(TEST_KEY, requests[0].full_url)
        self.assertNotIn(TEST_KEY, json.dumps(result))
        self.assertIsNone(result["response"]["data"]["metric"])
        self.assertEqual(result["attempts"][0]["response"]["error"]["code"], "RATE_LIMIT_EXCEEDED")

    def test_retry_after_http_date_and_transient_errors(self):
        now = datetime(2026, 10, 31, 12, 0, 0, tzinfo=timezone.utc)
        self.assertEqual(collector.retry_after_seconds("Sat, 31 Oct 2026 12:00:09 GMT", now), 9)
        self.assertIsNone(collector.retry_after_seconds("invalid"))
        responses = [encoded({"error": {"code": "INTERNAL_SERVER_ERROR"}}, 503), encoded({"data": None})]
        sleeps = []
        client = collector.PitchClient(TEST_KEY, interval=0, max_retries=1, transport=lambda *_: responses.pop(0), sleep=sleeps.append)
        result = client.fetch("/matches/m_000001/momentum")
        self.assertEqual(sleeps, [1.0])
        self.assertTrue(result["ok"])
        self.assertIsNone(result["response"]["data"])

    def test_authentication_failure_stops_after_one_request_and_is_checkpointed(self):
        calls = []
        def transport(request, timeout):
            calls.append(request)
            return encoded({"error": {"code": "UNAUTHORIZED", "message": TEST_KEY}}, 401)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(collector.AuthenticationError):
                collector.collect(make_client(transport), directory, details=True, progress=lambda _: None)
            self.assertEqual(len(calls), 1)
            self.assertEqual(collector.read_json(Path(directory) / "manifest.json")["status"], "authentication_failed")
            self.assertNotIn(TEST_KEY, (Path(directory) / "catalog.json").read_text())

    def test_stored_404_can_be_retried_explicitly(self):
        responses = [encoded({"error": {"code": "HALVES_UNAVAILABLE"}}, 404), encoded({"data": []})]
        with tempfile.TemporaryDirectory() as directory:
            store = collector.Checkpoints(directory, make_client(lambda *_: responses.pop(0)))
            first = store.get("halves.json", "/matches/m_000001/players/halves")
            self.assertEqual(first["status"], 404)
            self.assertEqual(store.get("halves.json", "/matches/m_000001/players/halves"), first)
            retried = collector.Checkpoints(directory, make_client(lambda *_: responses.pop(0)), retry_errors=True)
            self.assertTrue(retried.get("halves.json", "/matches/m_000001/players/halves")["ok"])

    def test_retry_after_is_honoured_after_restarting_from_a_429_checkpoint(self):
        responses = [encoded({"error": {"code": "RATE_LIMIT_EXCEEDED"}}, 429, {"Retry-After": "7"}), encoded({"data": None})]
        with tempfile.TemporaryDirectory() as directory:
            first = collector.Checkpoints(directory, make_client(lambda *_: responses.pop(0)))
            saved = first.get("request.json", "/matches/m_000001/heatmaps")
            self.assertIn("retryNotBefore", saved)
            sleeps = []
            resumed = collector.Checkpoints(directory, make_client(lambda *_: responses.pop(0), sleep=sleeps.append))
            self.assertTrue(resumed.get("request.json", "/matches/m_000001/heatmaps")["ok"])
            self.assertEqual(len(sleeps), 1)
            self.assertGreater(sleeps[0], 6.5)
            self.assertLessEqual(sleeps[0], 7)

    def test_environment_key_precedence_and_dotenv_quotes(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text('PITCHAPI_API_KEY="pk_test_fileCredential" # local only\n')
            self.assertEqual(collector.load_api_key({}, env_path), "pk_test_fileCredential")
            self.assertEqual(collector.load_api_key({"PITCHAPI_API_KEY": TEST_KEY}, env_path), TEST_KEY)
            with self.assertRaises(collector.AuthenticationError):
                collector.load_api_key({"PITCHAPI_API_KEY": "invalid"}, env_path)

    def test_dashboard_shards_expose_all_collected_fields_without_claiming_uncollected_endpoints(self):
        from test_dashboard_data import synthetic
        raw, _ = synthetic()
        with tempfile.TemporaryDirectory() as directory:
            builder.write_raw_match_shards(raw, directory)
            self.assertEqual(len(list(Path(directory).glob("*.json"))), 2)
            for sample in raw["samples"]:
                shard = collector.read_json(Path(directory) / f"{sample['match']['id']}.json")
                self.assertEqual(shard["players"]["data"], sample["players"]["data"])
                self.assertEqual(shard["lineups"]["data"], sample["lineups"]["data"])
                self.assertEqual(shard["stats"]["data"], sample["team_stats"]["data"])
                self.assertEqual(shard["shots"]["data"], sample["shots"]["data"])
                self.assertEqual(shard["availability"]["advanced"]["state"], "not_collected")
                self.assertEqual(shard["availability"]["match"]["state"], "fixture_only")
                self.assertNotIn("advanced", shard)


if __name__ == "__main__":
    unittest.main()
