"""Live (vega_v2/live): a recorded feed through the ingestor, its store and broadcast, and
the hand-over to core with the discrepancies (doc "Live")."""

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega_v2.live import handoff
from vega_v2.live.adapters import ReplayAdapter, snapshot
from vega_v2.live.broadcast import AppSyncPublisher, MemoryPublisher
from vega_v2.live.ingestor import Ingestor, main
from vega_v2.live.model import Event, LiveError, TeamStats
from vega_v2.live.store import DynamoStore, MemoryStore

DSN = os.environ.get("VEGA_V2_LIVE_TEST_DSN")
KICKOFF = datetime(2025, 9, 20, 19, 0, tzinfo=timezone.utc)

GOAL1 = {"provider_event_id": "e1", "event_type": "goal", "minute": 9, "side": "home", "player_key": "p_aaaaa1", "player_name": "A. Striker"}
GOAL2 = {"provider_event_id": "e2", "event_type": "goal", "minute": 70, "side": "home", "player_key": "p_aaaaa1", "player_name": "A. Striker"}
CARD = {"provider_event_id": "e3", "event_type": "yellow_card", "minute": 40, "side": "away", "player_name": "B. Back"}
GOAL4 = {"provider_event_id": "e4", "event_type": "goal", "minute": 85, "side": "home", "player_key": "p_aaaaa1", "player_name": "A. Striker"}
GOAL5 = {"provider_event_id": "e5", "event_type": "goal", "minute": 88, "side": "away", "player_name": "C. Forward"}
STATS = lambda h, a: [{"side": "home", "values": {"possession_pct": 52, "total_shots": h}}, {"side": "away", "values": {"possession_pct": 48, "total_shots": a}}]
FEED = {
    "provider": "pitchapi",  # the replay feed carries PitchAPI's player ids
    "fixtures": [{"key": "f1", "kickoff_at": "2025-09-20T19:00:00Z", "home": "Olympique Lyonnais", "away": "Paris Saint-Germain"},
                 {"key": "f2", "kickoff_at": "2025-09-20T19:00:00Z", "home": "Nobody FC", "away": "Elsewhere"}],
    "snapshots": {"f1": [
        {"status": "scheduled"},
        {"status": "in_play", "minute": 12, "period": "first_half", "home_score": 1, "away_score": 0, "events": [GOAL1], "stats": STATS(3, 1)},
        {"status": "in_play", "minute": 75, "period": "second_half", "home_score": 2, "away_score": 0, "events": [GOAL1, GOAL2, CARD], "stats": STATS(9, 4)},
        # VAR cancels the second goal: the same event, a new revision.
        {"status": "in_play", "minute": 80, "period": "second_half", "home_score": 1, "away_score": 0,
         "events": [GOAL1, dict(GOAL2, is_cancelled=True), CARD], "stats": STATS(9, 4)},
        {"status": "finished", "minute": 90, "minute_added": 4, "period": "second_half", "home_score": 2, "away_score": 1,
         "events": [GOAL1, dict(GOAL2, is_cancelled=True), CARD, GOAL4, GOAL5], "stats": STATS(14, 9)},
    ]},
}


class PureTest(unittest.TestCase):
    def test_typed_values(self):
        with self.assertRaises(LiveError):
            Event(provider_event_id="x", event_type="tackle", minute=3, side="home")
        with self.assertRaises(LiveError):
            TeamStats(side="home", values={"xg_chain": 1})
        with self.assertRaises(LiveError):
            snapshot({"status": "in_play", "events": [GOAL1, dict(GOAL1, minute=10)]})  # one id, one event

    def test_expiry_and_discrepancies(self):
        complete = KICKOFF + timedelta(hours=3)
        self.assertEqual(handoff.expiry(KICKOFF), KICKOFF + timedelta(hours=72))
        self.assertEqual(handoff.expiry(KICKOFF, complete), complete + timedelta(hours=24))
        self.assertEqual(handoff.expiry(KICKOFF, KICKOFF + timedelta(hours=60)), KICKOFF + timedelta(hours=72))
        view = {"score": (2, 0), "events": True, "stats": False, "goals": [(1, 9, 7), (1, 70, 7)]}
        state = {"home_score": 2, "away_score": 1}
        events = [{"event_type": "goal", "team_id": "t_a", "player_id": "p_x"}, {"event_type": "yellow_card"},
                  {"event_type": "goal", "team_id": "t_a", "player_id": "p_x", "is_cancelled": True},  # not counted
                  {"event_type": "goal", "team_id": "t_a", "player_id": "p_x"}, {"event_type": "goal", "team_id": "t_b"}]
        self.assertEqual(handoff.discrepancies(state, events, view), [("score", "2-1", "2-0"), ("goals", "3", "2")])
        self.assertEqual(handoff.families(view), ["score", "events"])

    def test_appsync_publish_is_signed(self):
        from botocore.credentials import Credentials

        class Session:
            def get_credentials(self):
                return Credentials("AKIDEXAMPLE", "secret", "token")

        sent = []

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        publisher = AppSyncPublisher("abc.appsync-api.us-east-2.amazonaws.com", "us-east-2", session=Session(),
                                     opener=lambda request, timeout: sent.append(request) or Response())
        publisher.publish("m_aaaaaa", [{"type": "state", "n": i} for i in range(7)])
        self.assertEqual(len(sent), 2)  # at most 5 events per request
        request = sent[0]
        self.assertEqual(request.full_url, "https://abc.appsync-api.us-east-2.amazonaws.com/event")
        headers = {k.lower(): v for k, v in request.header_items()}
        self.assertTrue(headers["authorization"].startswith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/"))
        self.assertIn("/us-east-2/appsync/aws4_request", headers["authorization"])
        body = json.loads(request.data)
        self.assertEqual(body["channel"], "/live/match/m-aaaaaa")
        self.assertEqual([json.loads(e)["n"] for e in body["events"]], [0, 1, 2, 3, 4])

    def test_dynamo_store_types(self):
        import boto3
        from botocore.stub import Stubber

        client = boto3.client("dynamodb", region_name="us-east-2", aws_access_key_id="x", aws_secret_access_key="y")
        store = DynamoStore({"state": "s", "events": "e", "stats": "t"}, client=client)
        with Stubber(client) as stub:
            # One revision in one transaction: the statistics first, the state last.
            stub.add_response("transact_write_items", {}, {"TransactItems": [
                {"Put": {"TableName": "t", "Item": {"match": {"S": "m_aaaaaa"}, "team_id": {"S": "t_aaaaaa"},
                                                   "possession_pct": {"N": "55.5"}, "revision": {"N": "2"}, "expires_at": {"N": "10"}}}},
                {"Put": {"TableName": "s", "Item": {"match": {"S": "m_aaaaaa"}, "revision": {"N": "2"}}}},
            ]})
            store.write_round({"match": "m_aaaaaa", "revision": 2}, [],
                              [{"match": "m_aaaaaa", "team_id": "t_aaaaaa", "possession_pct": 55.5, "total_shots": None, "revision": 2, "expires_at": 10}])
            stub.add_response("get_item", {"Item": {"match": {"S": "m_aaaaaa"}, "minute": {"N": "12"}, "core_families": {"L": [{"S": "score"}]}}},
                              {"TableName": "s", "Key": {"match": {"S": "m_aaaaaa"}}, "ConsistentRead": True})
            self.assertEqual(store.get_state("m_aaaaaa"), {"match": "m_aaaaaa", "minute": 12, "core_families": ["score"]})
            # The lease is a conditional write: held by another, it is refused.
            stub.add_client_error("update_item", service_error_code="ConditionalCheckFailedException")
            self.assertFalse(store.lease("m_aaaaaa", "me", 200, 100))

    def test_no_provider_no_feed(self):
        os.environ.pop("V2_LIVE_PROVIDER", None)
        self.assertEqual(main(["--once"]), 2)


@unittest.skipUnless(DSN, "requires VEGA_V2_LIVE_TEST_DSN")
class IngestorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega_v2.store import Store, connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_live_test":
            raise RuntimeError("dedicated local live DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        x = cls.db.execute
        with cls.db.transaction():
            Store(cls.db).season("2025/2026")
        x("INSERT INTO core.competitions(id, name) VALUES (1, 'Ligue 1')")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label) VALUES (1, 1, 2025, '2025/2026')")
        x("INSERT INTO core.teams(id, name) VALUES (1, 'Olympique Lyonnais'), (2, 'Paris Saint-Germain')")
        x("INSERT INTO core.players(id, name) VALUES (7, 'A. Striker')")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
             ('team','pitchapi','t_lyon01',1), ('team','pitchapi','t_psg001',2), ('player','pitchapi','p_aaaaa1',7), ('match','pitchapi','m_live01',10)""")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, match_date, kickoff_at)
             VALUES (10, 1, 2025, 'pitchapi', 'not_started', 1, 2, '2025-09-20', '2025-09-20T19:00:00Z')""")
        x("INSERT INTO core.match_coverage(season_id, match_id) VALUES (2025, 10)")
        # The same fixture as a cup source wrote it: another row, never the one a feed is linked to.
        x("INSERT INTO core.competitions(id, name) VALUES (2, 'Coupe')")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, cup_key) VALUES (2, 2, 2025, '2025/2026', 'open-cups:coupe:2025')")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, match_date, kickoff_at)
             VALUES (11, 2, 2025, 'openfootball', 'not_started', 1, 2, '2025-09-20', '2025-09-20T19:00:00Z')""")

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def test_feed_then_hand_over_to_core(self):
        x = self.db.execute
        store, publisher, lines = MemoryStore(), MemoryPublisher(), []
        now = {"t": KICKOFF - timedelta(minutes=20)}
        ingestor = Ingestor(self.db, ReplayAdapter(FEED), store, publisher, clock=lambda: now["t"], log=lines.append, owner="first")

        current = {"ingestor": ingestor}

        def at(minutes, who=None):
            now["t"] = KICKOFF + timedelta(minutes=minutes)
            return (who or current["ingestor"]).step()

        # 20 minutes before kick-off: linked by date and team names (the other fixture is
        # not), and polled once: still scheduled, nothing to broadcast.
        self.assertTrue(ingestor.step())
        state = store.get_state("m_live01")
        self.assertEqual((state["match_id"], state["status"], state["home_team"], state["away_team"], state["revision"]),
                         (10, "scheduled", "t_lyon01", "t_psg001", 0))
        self.assertEqual(state["expires_at"], int((KICKOFF + timedelta(hours=72)).timestamp()))
        self.assertIn("live provider=replay fixture=f2 outcome=unlinked", lines)
        self.assertEqual(publisher.sent, [])
        # A second ingestor started meanwhile stops at once: one feed per match.
        second = Ingestor(self.db, ReplayAdapter(FEED), store, MemoryPublisher(), clock=lambda: now["t"], log=lines.append, owner="second")
        self.assertFalse(second.step())  # the first one's lease is still running
        at(12)  # revision 1: a goal, the score, the team statistics, in one message
        channel, [message] = publisher.sent[-1]
        self.assertEqual((channel, message["match"], message["revision"]), ("/live/match/m-live01", "m_live01", 1))
        self.assertEqual(message["state"]["home_score"], 1)
        self.assertEqual([e["seq"] for e in message["events"]], [1])
        self.assertEqual(message["events"][0]["player_id"], "p_aaaaa1")  # the core player, through core.provider_ids
        self.assertEqual(message["events"][0]["team_id"], "t_lyon01")
        self.assertEqual(sorted(s["team_id"] for s in message["stats"]), ["t_lyon01", "t_psg001"])
        at(75)  # revision 2: a goal and a card
        self.assertEqual([e["provider_event_id"] for e in publisher.sent[-1][1][0]["events"]], ["e2", "e3"])
        at(80)  # revision 3: VAR cancels e2 — the same event (seq 2), not a new one
        message = publisher.sent[-1][1][0]
        self.assertEqual((message["revision"], [(e["seq"], e["is_cancelled"]) for e in message["events"]]), (3, [(2, True)]))
        self.assertEqual(len(store.events("m_live01")), 3)
        # The ingestor stops (crash): its lease expires and the next one takes the match
        # back at its last written revision.
        now["t"] = KICKOFF + timedelta(minutes=83)
        second.adapter.played["f1"] = 4
        self.assertTrue(at(83, second))
        message = publisher.sent[-1][1][0] if second.publisher is publisher else second.publisher.sent[-1][1][0]
        self.assertEqual(message["revision"], 4)  # the whistle: a provisional result
        state = store.get_state("m_live01")
        self.assertEqual((state["status"], state["home_score"], state["away_score"], state["revision"]), ("finished", 2, 1, 4))
        self.assertTrue(state["finished_at"])
        self.assertEqual([e["seq"] for e in store.events("m_live01")], [1, 2, 3, 4, 5])
        self.assertEqual({s["team_id"]: s["total_shots"] for s in store.stats("m_live01")}, {"t_lyon01": 14, "t_psg001": 9})
        ingestor = current["ingestor"] = second
        sent = len(ingestor.publisher.sent)
        self.assertTrue(at(90))  # core has nothing yet: nothing moves, still busy
        self.assertEqual(len(ingestor.publisher.sent), sent)
        # PitchAPI's score arrives (2-0: it wins), then its events and statistics.
        x("UPDATE core.matches SET status='finished', home_score=2, away_score=0 WHERE id=10")
        at(130)
        self.assertEqual(ingestor.publisher.sent[-1][1], [{"match": "m_live01", "revision": 5, "families": ["score"]}])
        self.assertEqual(x("SELECT field, live_value, final_value FROM ops.live_discrepancies").fetchall(), [("score", "2-1", "2-0")])
        x("UPDATE core.match_coverage SET events='ok', team_stats='ok' WHERE match_id=10")
        x("""INSERT INTO core.match_events(season_id, match_id, team_id, seq, event_type, minute, player_id)
             VALUES (2025, 10, 1, 0, 'goal', 9, 7), (2025, 10, 1, 1, 'goal', 85, 7)""")
        self.assertFalse(at(200))  # core complete: nothing left to do, the ingestor may stop
        state = store.get_state("m_live01")
        self.assertEqual(state["core_families"], ["score", "events", "stats"])
        complete = KICKOFF + timedelta(minutes=200)
        self.assertEqual(state["expires_at"], int((complete + timedelta(hours=24)).timestamp()))
        self.assertTrue(all(e["expires_at"] == state["expires_at"] for e in store.events("m_live01")))
        # Three live goals (the cancelled one left out) against two in core.
        self.assertEqual(sorted(x("SELECT field FROM ops.live_discrepancies").fetchall()), [("goals",), ("score",)])
        self.assertEqual(x("SELECT provider, field, matches FROM ops.live_reliability ORDER BY field").fetchall(),
                         [("replay", "goals", 1), ("replay", "score", 1)])


if __name__ == "__main__":
    unittest.main()
