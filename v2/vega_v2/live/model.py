"""The typed shapes of live data (doc "Live": typed attributes, core ids once linked).

A provider adapter turns its feed into these; the ingestor stores them in DynamoDB
(store.py), broadcasts their changes (broadcast.py) and hands the match over to core
family by family (handoff.py). Nothing here is written to core.
"""

from dataclasses import dataclass, field
from datetime import datetime

STATUSES = ("scheduled", "in_play", "half_time", "finished", "abandoned")
EVENT_KINDS = ("goal", "own_goal", "penalty_goal", "missed_penalty", "yellow_card", "red_card", "substitution", "var")
PERIODS = ("first_half", "second_half", "extra_time", "penalties")
SIDES = ("home", "away")
# Team statistics a live feed may carry (live_team_stats), all integers but possession.
TEAM_STATS = ("possession_pct", "total_shots", "shots_on_target", "corners", "fouls", "yellow_cards", "red_cards", "offsides")
# The families the site moves from live to core one by one (doc: score, events, stats).
FAMILIES = ("score", "events", "stats")


class LiveError(ValueError):
    """A live value outside its type: the update is refused, the feed goes on."""


@dataclass(frozen=True)
class Fixture:
    """A provider match, before it is linked to its core match."""

    key: str
    kickoff_at: datetime
    home: str
    away: str
    home_key: str | None = None
    away_key: str | None = None


@dataclass(frozen=True)
class Event:
    seq: int
    kind: str
    minute: int | None
    side: str | None
    minute_added: int | None = None
    period: str | None = None
    player_key: str | None = None
    player_name: str | None = None
    score_home: int | None = None
    score_away: int | None = None

    def __post_init__(self):
        _check(self.kind in EVENT_KINDS, "event kind")
        _check(self.side is None or self.side in SIDES, "event side")
        _check(self.period is None or self.period in PERIODS, "event period")
        _check(isinstance(self.seq, int) and self.seq >= 0, "event seq")
        for value in (self.minute, self.minute_added, self.score_home, self.score_away):
            _check(value is None or (isinstance(value, int) and 0 <= value <= 300), "event number")


@dataclass(frozen=True)
class TeamStats:
    side: str
    period: str  # "all" or one of PERIODS
    values: dict = field(default_factory=dict)

    def __post_init__(self):
        _check(self.side in SIDES, "stats side")
        _check(self.period == "all" or self.period in PERIODS, "stats period")
        for key, value in self.values.items():
            _check(key in TEAM_STATS, "stats key")
            _check(value is None or (isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 1000), "stats value")


@dataclass(frozen=True)
class Snapshot:
    """What the provider says now about one match: the whole state, not a delta."""

    status: str
    minute: int | None = None
    minute_added: int | None = None
    period: str | None = None
    score_home: int | None = None
    score_away: int | None = None
    events: tuple = ()
    stats: tuple = ()

    def __post_init__(self):
        _check(self.status in STATUSES, "status")
        _check(self.period is None or self.period in PERIODS, "period")
        for value in (self.minute, self.minute_added, self.score_home, self.score_away):
            _check(value is None or (isinstance(value, int) and 0 <= value <= 300), "state number")
        _check(len({e.seq for e in self.events}) == len(self.events), "event seq unique")


def _check(ok, what):
    if not ok:
        raise LiveError(what)
