"""The live ingestor (doc "Live"): the only process that talks to the live provider.

One feed per match in progress, never one per viewer. Each round:
1. track: the provider's matches kicking off within 30 minutes (or under way) are linked
   to their core match and get a live state (expires 72 h after kick-off at most);
2. follow: each match under way is polled once; what changed (state, new events, team
   stats) is written to the live store and broadcast on /live/match/{id};
3. hand over: after the whistle, the families core already has are marked on the state
   (the site reads those from core), differences with core go to ops.live_discrepancies,
   and once core is complete the live data expires 24 h later.

    python -m vega_v2.live                    # the provider named by V2_LIVE_PROVIDER
    python -m vega_v2.live --replay feed.json # a recorded feed, through the real circuit
"""

import argparse
from datetime import datetime, timedelta, timezone
import os
import sys
import time

from . import handoff
from .adapters import ADAPTERS, ReplayAdapter
from .broadcast import AppSyncPublisher
from .link import link, player, public_id
from .model import FAMILIES, Fixture, LiveError
from .store import DynamoStore

AHEAD = timedelta(minutes=30)  # a match is tracked from 30 minutes before kick-off
MATCH_SPAN = timedelta(hours=3)  # after which a feed that never said "finished" is over
STATE_FIELDS = ("status", "minute", "minute_added", "period", "score_home", "score_away")


def _now():
    return datetime.now(timezone.utc)


def _iso(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _when(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class Ingestor:
    def __init__(self, conn, adapter, store, publisher, clock=_now, log=print):
        self.conn, self.adapter, self.store, self.publisher, self.clock, self.log = conn, adapter, store, publisher, clock, log

    def step(self):
        now = self.clock()
        self.track(now)
        for state in self.store.states():
            if state["expires_at"] <= now.timestamp():
                continue
            kickoff = _when(state["kickoff_at"])
            if state["status"] not in ("finished", "abandoned") and now < kickoff + MATCH_SPAN:
                self.follow(state, now)
            else:
                self.hand_over(state, now)

    def track(self, now):
        known = {s["provider_match"] for s in self.store.states()}
        for fixture in self.adapter.fixtures(now - MATCH_SPAN, now + AHEAD):
            if fixture.key in known:
                continue
            match_id = link(self.conn, fixture, self.adapter.provider)
            if match_id is None:
                self.log(f"live provider={self.adapter.name} fixture={fixture.key} outcome=unlinked")
                continue
            home, away = self.conn.execute("SELECT home_team_id, away_team_id FROM core.matches WHERE id=%s", (match_id,)).fetchone()
            self.store.put_state({
                "match": public_id(self.conn, "match", match_id, "m"), "core_match_id": match_id,
                "provider": self.adapter.name, "provider_match": fixture.key,
                "home_name": fixture.home, "away_name": fixture.away, "home_key": fixture.home_key, "away_key": fixture.away_key,
                "home_team": public_id(self.conn, "team", home, "t"), "away_team": public_id(self.conn, "team", away, "t"),
                "kickoff_at": _iso(fixture.kickoff_at), "status": "scheduled", "core_families": [],
                "updated_at": _iso(now), "expires_at": int(handoff.expiry(fixture.kickoff_at).timestamp()),
            })
            self.log(f"live provider={self.adapter.name} fixture={fixture.key} match_id={match_id} outcome=linked")

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
        match, expires, changes = state["match"], state["expires_at"], []
        fresh = {f: getattr(snap, f) for f in STATE_FIELDS}
        if any(state.get(f) != v for f, v in fresh.items()):
            state.update(fresh, updated_at=_iso(now))
            if snap.status == "finished" and not state.get("finished_at"):
                state["finished_at"] = _iso(now)  # the provisional result
            self.store.put_state(state)
            changes.append({"type": "state", **fresh})
        stored = {e["seq"] for e in self.store.events(match)}
        for event in snap.events:
            if event.seq in stored:
                continue
            item = {"match": match, "seq": event.seq, "kind": event.kind, "minute": event.minute, "minute_added": event.minute_added,
                    "period": event.period, "side": event.side, "player": player(self.conn, self.adapter.provider, event.player_key),
                    "player_name": event.player_name, "score_home": event.score_home, "score_away": event.score_away, "expires_at": expires}
            self.store.put_event(item)
            changes.append({"type": "event", **{k: v for k, v in item.items() if k not in ("match", "expires_at")}})
        current = {s["key"]: s for s in self.store.stats(match)}
        for stats in snap.stats:
            key = f"{stats.side}#{stats.period}"
            item = {"match": match, "key": key, "side": stats.side, "period": stats.period, **stats.values, "expires_at": expires}
            if {k: v for k, v in current.get(key, {}).items() if k != "expires_at"} != {k: v for k, v in item.items() if k != "expires_at"}:
                self.store.put_stats(item)
                changes.append({"type": "stats", "side": stats.side, "period": stats.period, **stats.values})
        if changes:
            self.publisher.publish(match, changes)

    def hand_over(self, state, now):
        match_id = state["core_match_id"]
        view = handoff.core_view(self.conn, match_id)
        families = handoff.families(view)
        if families != state.get("core_families"):
            state.update(core_families=families, updated_at=_iso(now))
            if set(families) == set(FAMILIES) and not state.get("core_complete_at"):
                state["core_complete_at"] = _iso(now)
            self.store.put_state(state)
            self.publisher.publish(state["match"], [{"type": "families", "families": families}])
            ids = {p for _, _, p in (view or {}).get("goals", []) if p}
            players = {p: public_id(self.conn, "player", p, "p") for p in ids}
            found = handoff.discrepancies(state, self.store.events(state["match"]), view, players)
            if found:
                handoff.record(self.conn, match_id, state["provider"], found, now)
        if state.get("core_complete_at"):
            expires = int(handoff.expiry(_when(state["kickoff_at"]), _when(state["core_complete_at"])).timestamp())
            if expires < state["expires_at"]:
                self.store.set_expiry(state["match"], expires)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--replay", help="a recorded feed (JSON) instead of V2_LIVE_PROVIDER")
    parser.add_argument("--interval", type=float, default=5.0, help="seconds between rounds")
    parser.add_argument("--once", action="store_true")
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
        ingestor.step()
        if args.once:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
