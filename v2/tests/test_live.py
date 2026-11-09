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

FEED = {
    "provider": "pitchapi",  # the replay feed carries PitchAPI's player ids
    "fixtures": [{"key": "f1", "kickoff_at": "2025-09-20T19:00:00Z", "home": "Olympique Lyonnais", "away": "Paris Saint-Germain"},
                 {"key": "f2", "kickoff_at": "2025-09-20T19:00:00Z", "home": "Nobody FC", "away": "Elsewhere"}],
    "snapshots": {"f1": [
        {"status": "scheduled"},
        {"status": "in_play", "minute": 12, "period": "first_half", "score_home": 1, "score_away": 0,
         "events": [{"seq": 1, "kind": "goal", "minute": 9, "side": "home", "player_key": "p_aaaaa1", "player_name": "A. Striker",
                     "score_home": 1, "score_away": 0}],
         "stats": [{"side": "home", "values": {"possession_pct": 55, "total_shots": 3}}, {"side": "away", "values": {"possession_pct": 45, "total_shots": 1}}]},
        {"status": "finished", "minute": 90, "minute_added": 4, "period": "second_half", "score_home": 2, "score_away": 1,
         "events": [{"seq": 1, "kind": "goal", "minute": 9, "side": "home", "player_key": "p_aaaaa1", "player_name": "A. Striker", "score_home": 1, "score_away": 0},
                    {"seq": 2, "kind": "yellow_card", "minute": 40, "side": "away", "player_name": "B. Back"},
                    {"seq": 3, "kind": "goal", "minute": 70, "side": "home", "player_key": "p_aaaaa1", "player_name": "A. Striker", "score_home": 2, "score_away": 0},
                    {"seq": 4, "kind": "goal", "minute": 88, "side": "away", "player_name": "C. Forward", "score_home": 2, "score_away": 1}],
         "stats": [{"side": "home", "values": {"possession_pct": 52, "total_shots": 14}}, {"side": "away", "values": {"possession_pct": 48, "total_shots": 9}}]},
    ]},
}


class PureTest(unittest.TestCase):
    def test_typed_values(self):
        with self.assertRaises(LiveError):
            Event(seq=1, kind="tackle", minute=3, side="home")
        with self.assertRaises(LiveError):
            TeamStats(side="home", period="all", values={"xg_chain": 1})
        with self.assertRaises(LiveError):
            snapshot({"status": "in_play", "events": [{"seq": 1, "kind": "goal", "minute": 1, "side": "home"},
                                                       {"seq": 1, "kind": "goal", "minute": 2, "side": "home"}]})

    def test_expiry_and_discrepancies(self):
        complete = KICKOFF + timedelta(hours=3)
        self.assertEqual(handoff.expiry(KICKOFF), KICKOFF + timedelta(hours=72))
        self.assertEqual(handoff.expiry(KICKOFF, complete), complete + timedelta(hours=24))
        self.assertEqual(handoff.expiry(KICKOFF, KICKOFF + timedelta(hours=60)), KICKOFF + timedelta(hours=72))
        view = {"score": (2, 0), "events": True, "stats": False, "goals": [("home", 9, 7), ("home", 70, 7)]}
        state = {"score_home": 2, "score_away": 1}
        events = [{"kind": "goal", "side": "home", "player": "p_x"}, {"kind": "yellow_card"}, {"kind": "goal", "side": "home", "player": "p_x"},
                  {"kind": "goal", "side": "away", "player": None}]
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
            stub.add_response("put_item", {}, {"TableName": "t", "Item": {"match": {"S": "m_aaaaaa"}, "key": {"S": "home#all"},
                                                                          "possession_pct": {"N": "55.5"}, "expires_at": {"N": "10"}}})
            store.put_stats({"match": "m_aaaaaa", "key": "home#all", "possession_pct": 55.5, "total_shots": None, "expires_at": 10})
            stub.add_response("get_item", {"Item": {"match": {"S": "m_aaaaaa"}, "minute": {"N": "12"}, "core_families": {"L": [{"S": "score"}]}}},
                              {"TableName": "s", "Key": {"match": {"S": "m_aaaaaa"}}, "ConsistentRead": True})
            self.assertEqual(store.get_state("m_aaaaaa"), {"match": "m_aaaaaa", "minute": 12, "core_families": ["score"]})

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

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def test_feed_then_hand_over_to_core(self):
        x = self.db.execute
        store, publisher, lines = MemoryStore(), MemoryPublisher(), []
        now = {"t": KICKOFF - timedelta(minutes=20)}
        ingestor = Ingestor(self.db, ReplayAdapter(FEED), store, publisher, clock=lambda: now["t"], log=lines.append)

        def at(minutes):
            now["t"] = KICKOFF + timedelta(minutes=minutes)
            ingestor.step()

        # 20 minutes before kick-off: linked by date and team names (the other fixture is
        # not), and polled once: still scheduled, nothing to broadcast.
        ingestor.step()
        state = store.get_state("m_live01")
        self.assertEqual((state["core_match_id"], state["status"], state["home_team"], state["away_team"]), (10, "scheduled", "t_lyon01", "t_psg001"))
        self.assertEqual(state["expires_at"], int((KICKOFF + timedelta(hours=72)).timestamp()))
        self.assertIn("live provider=replay fixture=f2 outcome=unlinked", lines)
        self.assertEqual(publisher.sent, [])
        at(12)  # a goal, the score, the team statistics
        channel, events = publisher.sent[-1]
        self.assertEqual(channel, "/live/match/m-live01")
        self.assertEqual([e["type"] for e in events], ["state", "event", "stats", "stats"])
        self.assertEqual(events[1]["player"], "p_aaaaa1")  # the core player, through core.provider_ids
        at(110)  # the whistle: a provisional result, three more events
        state = store.get_state("m_live01")
        self.assertEqual((state["status"], state["score_home"], state["score_away"]), ("finished", 2, 1))
        self.assertTrue(state["finished_at"])
        self.assertEqual([e["seq"] for e in store.events("m_live01")], [1, 2, 3, 4])
        self.assertEqual({s["key"]: s["total_shots"] for s in store.stats("m_live01")}, {"away#all": 9, "home#all": 14})
        sent = len(publisher.sent)
        at(115)  # core has nothing yet: nothing moves
        self.assertEqual(len(publisher.sent), sent)
        # PitchAPI's score arrives (2-0: it wins), then its events and statistics.
        x("UPDATE core.matches SET status='finished', home_score=2, away_score=0 WHERE id=10")
        at(130)
        self.assertEqual(publisher.sent[-1][1], [{"type": "families", "families": ["score"]}])
        self.assertEqual(x("SELECT field, live_value, final_value FROM ops.live_discrepancies").fetchall(), [("score", "2-1", "2-0")])
        x("UPDATE core.match_coverage SET events='ok', team_stats='ok' WHERE match_id=10")
        x("""INSERT INTO core.match_events(season_id, match_id, team_id, seq, event_type, minute, player_id)
             VALUES (2025, 10, 1, 0, 'goal', 9, 7), (2025, 10, 1, 1, 'goal', 70, 7)""")
        at(200)
        state = store.get_state("m_live01")
        self.assertEqual(state["core_families"], ["score", "events", "stats"])
        complete = KICKOFF + timedelta(minutes=200)
        self.assertEqual(state["expires_at"], int((complete + timedelta(hours=24)).timestamp()))
        self.assertTrue(all(e["expires_at"] == state["expires_at"] for e in store.events("m_live01")))
        self.assertEqual(sorted(x("SELECT field FROM ops.live_discrepancies").fetchall()), [("goals",), ("score",)])
        # Expired: the ingestor leaves it alone.
        sent = len(publisher.sent)
        at(200 + 25 * 60)
        self.assertEqual(len(publisher.sent), sent)
        self.assertEqual(x("SELECT provider, field, matches FROM ops.live_reliability ORDER BY field").fetchall(),
                         [("replay", "goals", 1), ("replay", "score", 1)])


if __name__ == "__main__":
    unittest.main()
