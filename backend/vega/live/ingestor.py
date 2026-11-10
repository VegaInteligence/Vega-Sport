"""The live ingestor (doc "Live"): the only process that talks to the live provider.

One feed per match in progress, never one per viewer. EventBridge Scheduler starts it
before the day's first kick-off (live.yaml); it stops by itself once no match is under
way or waiting for core (--until-idle). Each round:
1. lease: the ingestor holds its own lease (a second one started meanwhile exits at
   once) and one lease per match it follows: a lease that expires lets a restarted
   ingestor take the match back at its last written revision;
2. track: the provider's matches kicking off within 30 minutes (or under way) are linked
   to their core match and get a live state (expiring 72 h after kick-off at most);
3. follow: each match under way is polled once; what changed becomes the next revision
   of the match, written atomically (events and statistics, then the state) and
   broadcast as one message on /live/match/{id}. A corrected event (goal cancelled by
   VAR, card changed) is a new revision of the same event, never a new event;
4. hand over: after the whistle, the families core already has are marked on the state
   (the site reads those from core), differences with core go to ops.live_discrepancies,
   and once core is complete the live data expires 24 h later.

    python -m vega.live --until-idle             # the provider named by V2_LIVE_PROVIDER
    python -m vega.live --replay feed.json --once  # a recorded feed, through the real circuit
"""

import argparse
from datetime import datetime, timedelta, timezone
import os
import socket
import sys
import time
import uuid

from . import handoff
from .adapters import ADAPTERS, ReplayAdapter
from .broadcast import AppSyncPublisher
from .link import link, player, public_id
from .model import FAMILIES, Fixture, LiveError
from .store import INGESTOR, DynamoStore

AHEAD = timedelta(minutes=30)  # a match is tracked from 30 minutes before kick-off
MATCH_SPAN = timedelta(hours=3)  # after which a feed that never said "finished" is over
LEASE = timedelta(seconds=60)  # renewed every round; a stopped ingestor frees its matches
STATE_FIELDS = ("status", "minute", "minute_added", "period", "home_score", "away_score")
EVENT_FIELDS = ("event_type", "minute", "minute_added", "period", "team_id", "player_id", "related_player_id", "player_name", "is_cancelled")


def _now():
    return datetime.now(timezone.utc)


def _iso(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _when(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class Ingestor:
    def __init__(self, conn, adapter, store, publisher, clock=_now, log=print, owner=None):
        self.conn, self.adapter, self.store, self.publisher, self.clock, self.log = conn, adapter, store, publisher, clock, log
        self.owner = owner or f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:8]}"

    def step(self):
        """One round. Returns False when another ingestor holds the lease, else whether a
        match is still under way, upcoming or waiting for core (the --until-idle test)."""
        now = self.clock()
        if not self.store.lease(INGESTOR, self.owner, (now + LEASE).timestamp(), now.timestamp()):
            self.log(f"live owner={self.owner} outcome=another-ingestor-runs")
            return False
        busy = self.track(now)
        for state in self.store.states():
            if state["expires_at"] <= now.timestamp():
                continue
            kickoff = _when(state["kickoff_at"])
            if state["status"] not in ("finished", "abandoned") and now < kickoff + MATCH_SPAN:
                busy = True
                if self.store.lease(state["match"], self.owner, (now + LEASE).timestamp(), now.timestamp()):
                    self.follow(self.store.get_state(state["match"]), now)
            else:
                self.hand_over(state, now)
                busy = busy or not state.get("core_complete_at")
        return busy

    def track(self, now):
        known = {s["provider_match"] for s in self.store.states()}
        upcoming = False
        for fixture in self.adapter.fixtures(now - MATCH_SPAN, now + AHEAD):
            upcoming = True
            if fixture.key in known:
                continue
            match_id = link(self.conn, fixture, self.adapter.provider)
            if match_id is None:
                self.log(f"live provider={self.adapter.name} fixture={fixture.key} outcome=unlinked")
                continue
            home, away = self.conn.execute("SELECT home_team_id, away_team_id FROM core.matches WHERE id=%s", (match_id,)).fetchone()
            self.store.put_state({
                "match": public_id(self.conn, "match", match_id, "m"), "match_id": match_id,
                "provider": self.adapter.name, "provider_match": fixture.key,
                "home_name": fixture.home, "away_name": fixture.away, "home_key": fixture.home_key, "away_key": fixture.away_key,
                "home_team": public_id(self.conn, "team", home, "t"), "away_team": public_id(self.conn, "team", away, "t"),
                "kickoff_at": _iso(fixture.kickoff_at), "status": "scheduled", "revision": 0, "core_families": [],
                "updated_at": _iso(now), "expires_at": int(handoff.expiry(fixture.kickoff_at).timestamp()),
            })
            self.log(f"live provider={self.adapter.name} fixture={fixture.key} match_id={match_id} outcome=linked")
        return upcoming

    def follow(self, state, now):
        fixture = Fixture(key=state["provider_match"], kickoff_at=_when(state["kickoff_at"]), home=state["home_name"],
                          away=state["away_name"], home_key=state.get("home_key"), away_key=state.get("away_key"))
        try:
            snap = self.adapter.poll(fixture)
        except LiveError as error:
            self.log(f"live provider={self.adapter.name} fixture={fixture.key} error={error}")
            return
        if snap is None:
            return
        match, revision = state["match"], state.get("revision", 0) + 1
        teams = {"home": state.get("home_team"), "away": state.get("away_team")}
        fresh = {f: getattr(snap, f) for f in STATE_FIELDS}
        state_changed = any(state.get(f) != v for f, v in fresh.items())
        stored = {e["provider_event_id"]: e for e in self.store.events(match)}
        next_seq = max((e["seq"] for e in stored.values()), default=0) + 1
        events = []
        for event in snap.events:
            values = {"event_type": event.event_type, "minute": event.minute, "minute_added": event.minute_added, "period": event.period,
                      "team_id": teams.get(event.side), "player_id": player(self.conn, self.adapter.provider, event.player_key),
                      "related_player_id": player(self.conn, self.adapter.provider, event.related_player_key),
                      "player_name": event.player_name, "is_cancelled": event.is_cancelled}
            known = stored.get(event.provider_event_id)
            if known and all(known.get(k) == v for k, v in values.items()):
                continue
            seq = known["seq"] if known else next_seq
            if not known:
                next_seq += 1
            events.append({"match": match, "seq": seq, "provider_event_id": event.provider_event_id, "revision": revision,
                           **values, "received_at": _iso(now), "expires_at": state["expires_at"]})
        current = {s["team_id"]: s for s in self.store.stats(match)}
        stats = []
        for team_stats in snap.stats:
            team = teams.get(team_stats.side)
            if team is None:
                continue
            if any(current.get(team, {}).get(k) != v for k, v in team_stats.values.items()):
                stats.append({"match": match, "team_id": team, **team_stats.values, "revision": revision, "expires_at": state["expires_at"]})
        if not (state_changed or events or stats):
            return
        state.update(fresh, revision=revision, updated_at=_iso(now))
        if snap.status == "finished" and not state.get("finished_at"):
            state["finished_at"] = _iso(now)  # the provisional result
        self.store.write_round(state, events, stats)
        message = {"match": match, "revision": revision, "state": {**fresh, "finished_at": state.get("finished_at")}}
        if events:
            message["events"] = [{k: v for k, v in e.items() if k not in ("match", "expires_at")} for e in events]
        if stats:
            message["stats"] = [{k: v for k, v in s.items() if k not in ("match", "expires_at")} for s in stats]
        self.publisher.publish(match, [message])

    def hand_over(self, state, now):
        match_id = state["match_id"]
        view = handoff.core_view(self.conn, match_id)
        families = handoff.families(view)
        if families != state.get("core_families"):
            revision = state.get("revision", 0) + 1
            state.update(core_families=families, revision=revision, updated_at=_iso(now))
            if set(families) == set(FAMILIES) and not state.get("core_complete_at"):
                state["core_complete_at"] = _iso(now)
            self.store.write_round(state, [], [])
            self.publisher.publish(state["match"], [{"match": state["match"], "revision": revision, "families": families}])
            public = {("team", t): public_id(self.conn, "team", t, "t") for t, _, _ in (view or {}).get("goals", []) if t}
            public.update({("player", p): public_id(self.conn, "player", p, "p") for _, _, p in (view or {}).get("goals", []) if p})
            found = handoff.discrepancies(state, self.store.events(state["match"]), view, public)
            if found:
                handoff.record(self.conn, match_id, state["provider"], found, now)
        if state.get("core_complete_at"):
            expires = int(handoff.expiry(_when(state["kickoff_at"]), _when(state["core_complete_at"])).timestamp())
            if expires < state["expires_at"]:
                self.store.set_expiry(state["match"], expires)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--replay", help="a recorded feed (JSON) instead of V2_LIVE_PROVIDER")
    parser.add_argument("--interval", type=float, default=3.0, help="seconds between rounds (doc: every 2 to 5 s)")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--until-idle", action="store_true", help="stop once no match is under way, upcoming or waiting for core")
    args = parser.parse_args(argv)
    name = "replay" if args.replay else os.environ.get("V2_LIVE_PROVIDER", "")
    if not name:
        print("live provider=none: no live provider is configured (V2_LIVE_PROVIDER)", flush=True)
        return 2
    if name not in ADAPTERS:
        print(f"live provider={name} outcome=unknown", flush=True)
        return 2
    adapter = ReplayAdapter(args.replay) if args.replay else ADAPTERS[name]()
    from ..worker import connect

    conn = connect(os.environ["V2_DATABASE_URL"])
    store = DynamoStore({t: os.environ[f"V2_LIVE_{t.upper()}_TABLE"] for t in ("state", "events", "stats")})
    publisher = AppSyncPublisher(os.environ["V2_LIVE_EVENTS_HTTP"], os.environ.get("AWS_REGION", "us-east-2"))
    ingestor = Ingestor(conn, adapter, store, publisher, log=lambda line: print(line, flush=True))
    while True:
        busy = ingestor.step()
        if args.once or (args.until_idle and not busy):
            print(f"live owner={ingestor.owner} outcome=stopped", flush=True)
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
