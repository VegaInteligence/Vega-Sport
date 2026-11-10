"""One adapter per live provider (doc: "l'ingestor a un adaptateur par fournisseur live ;
le reste du circuit ne change pas si on en change").

No live provider is chosen yet (doc, open question; PitchAPI does no live), so the only
adapter is the replay one: it plays a recorded feed, for the tests and for a dry run of
the whole circuit (DynamoDB, AppSync, the read route, the site). A real provider adds a
class here with the same three members and its name in ADAPTERS.
"""

from datetime import datetime
import json
from pathlib import Path

from .model import Event, Fixture, Snapshot, TeamStats


class LiveAdapter:
    """name: the provider in ops.live_discrepancies. provider: the core.provider whose ids
    its players and teams carry (core.provider_ids), or None when it has its own."""

    name = "base"
    provider = None

    def fixtures(self, start, end):
        """The provider's matches kicking off between start and end ([Fixture])."""
        raise NotImplementedError

    def poll(self, fixture):
        """The match as the provider sees it now (Snapshot). A streaming provider keeps
        the latest state of its stream and returns it here: one connection per match."""
        raise NotImplementedError


def _when(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def snapshot(data):
    """A Snapshot from its JSON form (the replay files, and any adapter that wants it)."""
    return Snapshot(
        status=data["status"], minute=data.get("minute"), minute_added=data.get("minute_added"), period=data.get("period"),
        home_score=data.get("home_score"), away_score=data.get("away_score"),
        events=tuple(Event(**e) for e in data.get("events", [])),
        stats=tuple(TeamStats(side=s["side"], values=s.get("values", {})) for s in data.get("stats", [])),
    )


class ReplayAdapter(LiveAdapter):
    """Plays a recorded feed: {"fixtures": [...], "snapshots": {key: [snapshot, ...]}}.
    Each poll returns the next snapshot of the match, then keeps the last one."""

    name = "replay"

    def __init__(self, script, provider=None):
        if isinstance(script, (str, Path)):
            script = json.loads(Path(script).read_text())
        self.provider = provider or script.get("provider")
        self.items = [
            Fixture(key=f["key"], kickoff_at=_when(f["kickoff_at"]), home=f["home"], away=f["away"],
                    home_key=f.get("home_key"), away_key=f.get("away_key"))
            for f in script["fixtures"]
        ]
        self.frames = {key: [snapshot(s) for s in frames] for key, frames in script["snapshots"].items()}
        self.played = {}

    def fixtures(self, start, end):
        return [f for f in self.items if start <= f.kickoff_at <= end]

    def poll(self, fixture):
        frames = self.frames.get(fixture.key) or []
        if not frames:
            return None
        i = self.played.get(fixture.key, 0)
        self.played[fixture.key] = min(i + 1, len(frames) - 1)
        return frames[min(i, len(frames) - 1)]


ADAPTERS = {"replay": ReplayAdapter}
