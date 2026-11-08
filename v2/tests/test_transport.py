import json, unittest
from vega_v2.pitchapi import PitchClient, PitchError


class TransportTest(unittest.TestCase):
    def test_valid_empty_and_unavailable_and_bad_id(self):
        results = iter(
            [
                (200, {}, b'{"data":{"periods":[]}}'),
                (
                    404,
                    {},
                    b'{"error":{"code":"ANALYTICS_UNAVAILABLE","message":"secret"}}',
                ),
                (404, {}, b'{"error":{"code":"RESOURCE_NOT_FOUND"}}'),
            ]
        )
        c = PitchClient(
            "pk_test_dummy",
            interval=0,
            transport=lambda *args: next(results),
            sleep=lambda x: None,
        )
        self.assertEqual(c.fetch("/matches/m_123456/shots").data, {"periods": []})
        self.assertEqual(c.fetch("/matches/m_123456/advanced").coverage, "unavailable")
        with self.assertRaisesRegex(PitchError, "RESOURCE_NOT_FOUND"):
            c.fetch("/matches/m_123456")

    def test_block_unknown_paths_and_heatmap_frame(self):
        c = PitchClient(
            "pk_test_dummy",
            interval=0,
            transport=lambda req, t: (200, {}, b'{"data":[]}'),
            sleep=lambda x: None,
        )
        with self.assertRaises(PitchError):
            c.fetch("/matches/m_123456/players/p_123456")
        with self.assertRaises(PitchError):
            c.fetch("/matches/m_123456/heatmaps", {"frame": "home_ltr"})

    def test_retry_429_and_secret_absent_error(self):
        delays = []
        records = iter(
            [
                (
                    429,
                    {"Retry-After": "2"},
                    b'{"error":{"code":"RATE_LIMIT_EXCEEDED"}}',
                ),
                (200, {}, b'{"data":[]}'),
            ]
        )
        c = PitchClient(
            "pk_test_secret",
            interval=0,
            transport=lambda *x: next(records),
            sleep=delays.append,
        )
        self.assertEqual(c.fetch("/leagues").data, [])
        self.assertIn(2, delays)
        c = PitchClient(
            "pk_test_secret",
            interval=0,
            transport=lambda *x: (500, {}, b'{"error":{"code":"pk_test_secret"}}'),
            sleep=lambda x: None,
            retries=0,
        )
        with self.assertRaises(PitchError) as e:
            c.fetch("/leagues")
        self.assertNotIn("pk_test_secret", str(e.exception))

    def test_observer_reports_only_bounded_metadata_each_attempt(self):
        calls = []
        responses = iter(
            [
                (
                    429,
                    {"X-Request-ID": "req_123"},
                    b'{"error":{"code":"RATE_LIMIT_EXCEEDED","message":"secret"}}',
                ),
                (200, {}, b'{"data":[]}'),
            ]
        )
        c = PitchClient(
            "pk_test_secret",
            interval=0,
            transport=lambda *x: next(responses),
            sleep=lambda _: None,
            on_attempt=calls.append,
        )
        c.fetch("/leagues")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["error_code"], "RATE_LIMIT_EXCEEDED")
        self.assertIsNone(calls[1]["error_code"])
        self.assertEqual(
            set(calls[0]),
            {"status", "error_code", "duration_ms", "fetched_at", "request_id"},
        )
        self.assertNotIn("secret", str(calls))

    def test_observer_transport_error(self):
        calls = []

        def bad(*a):
            raise OSError("secret")

        c = PitchClient(
            "pk_test_secret", interval=0, transport=bad, on_attempt=calls.append
        )
        with self.assertRaises(PitchError):
            c.fetch("/leagues")
        self.assertEqual(calls[0]["error_code"], "TRANSPORT_ERROR")
        self.assertNotIn("secret", str(calls))

    def test_null_error_success_and_sanitized_shape(self):
        c = PitchClient(
            "pk_test_secret",
            interval=0,
            transport=lambda *x: (200, {}, b'{"data":{"leagues":[]},"error":null}'),
            sleep=lambda x: None,
        )
        self.assertEqual(c.fetch("/leagues").data, {"leagues": []})
        for payload, shape in [
            (b"[]", "root_array"),
            (b'{"secret":"payload"}', "object_neither"),
            (b'{"data":[],"error":{"code":"x"}}', "object_both"),
        ]:
            c = PitchClient(
                "pk_test_secret",
                interval=0,
                transport=lambda *x: (200, {}, payload),
                sleep=lambda x: None,
            )
            with self.assertRaises(PitchError) as caught:
                c.fetch("/leagues")
            self.assertEqual(caught.exception.status, 200)
            self.assertEqual(caught.exception.envelope_shape, shape)
            self.assertNotIn("payload", str(caught.exception))

    def test_honest_user_agent_and_sanitized_403(self):
        captured = []
        events = []

        def transport(request, timeout):
            captured.append(request.get_header("User-agent"))
            return (403, {}, b'{"message":"API key expired, private detail"}')

        c = PitchClient(
            "pk_test_secret",
            interval=0,
            transport=transport,
            sleep=lambda x: None,
            on_attempt=events.append,
        )
        with self.assertRaises(PitchError) as e:
            c.fetch("/leagues")
        self.assertEqual(captured, ["VegaSport-V2Pilot/1.0"])
        self.assertEqual(e.exception.code, "HTTP_ACCESS_DENIED")
        self.assertEqual(e.exception.status, 403)
        self.assertEqual(e.exception.access_reason, "credential_expired")
        self.assertNotIn("private", str(e.exception))
        self.assertEqual(events[0]["error_code"], "HTTP_ACCESS_DENIED")

    def test_403_does_not_discard_documented_error(self):
        c = PitchClient(
            "pk_test_secret",
            interval=0,
            transport=lambda *a: (403, {}, b'{"error":{"code":"UNAUTHORIZED"}}'),
            sleep=lambda x: None,
        )
        with self.assertRaises(PitchError) as e:
            c.fetch("/leagues")
        self.assertEqual(e.exception.code, "UNAUTHORIZED")

    def test_521_retry_then_success_and_observe_each_attempt(self):
        events, waits = [], []
        responses = iter(
            [
                (521, {"Retry-After": "2"}, b"<html>private</html>"),
                (200, {}, b'{"data":[]}'),
            ]
        )
        client = PitchClient(
            "pk_test_secret",
            interval=0,
            transport=lambda *_: next(responses),
            sleep=waits.append,
            on_attempt=events.append,
        )
        self.assertEqual(client.fetch("/leagues").data, [])
        self.assertEqual(client.requests, 2)
        self.assertEqual([e["error_code"] for e in events], ["HTTP_SERVER_ERROR", None])
        self.assertIn(2, waits)
        self.assertNotIn("private", str(events))

    def test_521_exhaustion_distinct_and_4xx_not_retried(self):
        events = []
        client = PitchClient(
            "pk_test_secret",
            interval=0,
            retries=3,
            transport=lambda *_: (521, {}, b"<html>private</html>"),
            sleep=lambda _: None,
            on_attempt=events.append,
        )
        with self.assertRaises(PitchError) as error:
            client.fetch("/leagues")
        self.assertEqual(
            (error.exception.code, error.exception.status), ("HTTP_SERVER_ERROR", 521)
        )
        self.assertEqual(client.requests, 4)
        self.assertEqual(len(events), 4)
        client = PitchClient(
            "pk_test_secret",
            interval=0,
            retries=3,
            transport=lambda *_: (404, {}, b'{"error":{"code":"RESOURCE_NOT_FOUND"}}'),
            sleep=lambda _: None,
        )
        with self.assertRaises(PitchError):
            client.fetch("/leagues")
        self.assertEqual(client.requests, 1)

    def test_network_errors_retry_then_success_or_exhaust(self):
        from urllib.error import URLError

        events = []
        attempts = iter(
            [URLError("private"), TimeoutError("private"), (200, {}, b'{"data":[]}')]
        )

        def transport(*_):
            item = next(attempts)
            if isinstance(item, Exception):
                raise item
            return item

        client = PitchClient(
            "pk_test_secret",
            interval=0,
            transport=transport,
            sleep=lambda _: None,
            on_attempt=events.append,
        )
        self.assertEqual(client.fetch("/leagues").data, [])
        self.assertEqual(client.requests, 3)
        self.assertEqual(
            [e["error_code"] for e in events],
            ["TRANSPORT_ERROR", "TRANSPORT_ERROR", None],
        )
        self.assertNotIn("private", str(events))

        def broken(*_):
            raise OSError("private")

        client = PitchClient(
            "pk_test_secret",
            interval=0,
            retries=3,
            transport=broken,
            sleep=lambda _: None,
        )
        with self.assertRaises(PitchError) as error:
            client.fetch("/leagues")
        self.assertEqual(error.exception.code, "TRANSPORT_ERROR")
        self.assertEqual(client.requests, 4)
        self.assertNotIn("private", str(error.exception))

    def test_429_increases_interval_never_decreases(self):
        responses = iter(
            [
                (429, {}, b'{"error":{"code":"RATE_LIMIT_EXCEEDED"}}'),
                (200, {}, b'{"data":[]}'),
            ]
        )
        client = PitchClient(
            "pk_test_secret",
            interval=0.25,
            transport=lambda *_: next(responses),
            sleep=lambda _: None,
        )
        client.fetch("/leagues")
        self.assertEqual(client.interval, 1.0)
        client = PitchClient(
            "pk_test_secret",
            interval=2.0,
            retries=0,
            transport=lambda *_: (429, {}, b'{"error":{"code":"RATE_LIMIT_EXCEEDED"}}'),
            sleep=lambda _: None,
        )
        with self.assertRaises(PitchError):
            client.fetch("/leagues")
        self.assertEqual(client.interval, 2.0)
