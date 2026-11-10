"""The typed shapes of live data (doc "Live", "Tables temporaires": typed attributes, the
core ids once linked, a revision on everything).

A provider adapter turns its feed into these; the ingestor stores them in DynamoDB
(store.py), broadcasts each revision (broadcast.py) and hands the match over to core
family by family (handoff.py). Nothing here is written to core.
"""

from dataclasses import dataclass, field
from datetime import datetime

STATUSES = ("scheduled", "in_play", "half_time", "finished", "abandoned")
EVENT_TYPES = ("goal", "own_goal", "penalty_goal", "missed_penalty", "yellow_card", "red_card", "substitution", "var")
GOAL_TYPES = ("goal", "own_goal", "penalty_goal")
PERIODS = ("first_half", "second_half", "extra_time", "penalties")
SIDES = ("home", "away")
# live_team_stats (doc): what a provider may give per team for the whole match.
TEAM_STATS = ("possession_pct", "total_shots", "shots_on_target", "corners", "fouls")
# The families the site moves from live to core one by one (doc: score, events, stats).
FAMILIES = ("score", "events", "stats")


class LiveError(ValueError):
    """A live value outside its type: the update is refused, the feed goes on."""


def _number(value, top=300):
    return value is None or (isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= top)


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
    """One event of the feed. provider_event_id identifies it across corrections: a goal
    cancelled by VAR or a changed card comes back with the same id and is_cancelled or
    new values, and becomes a new revision of the same event, never a new event."""

    provider_event_id: str
    event_type: str
    minute: int | None
    side: str | None
    minute_added: int | None = None
    period: str | None = None
    player_key: str | None = None
    related_player_key: str | None = None  # the assist, or the player coming off
    player_name: str | None = None
    is_cancelled: bool = False

    def __post_init__(self):
        _check(isinstance(self.provider_event_id, str) and 0 < len(self.provider_event_id) <= 80, "event id")
        _check(self.event_type in EVENT_TYPES, "event type")
        _check(self.side is None or self.side in SIDES, "event side")
        _check(self.period is None or self.period in PERIODS, "event period")
        _check(isinstance(self.is_cancelled, bool), "event cancelled")
        _check(_number(self.minute) and _number(self.minute_added), "event minute")


@dataclass(frozen=True)
class TeamStats:
    side: str
    values: dict = field(default_factory=dict)

    def __post_init__(self):
        _check(self.side in SIDES, "stats side")
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
    home_score: int | None = None
    away_score: int | None = None
    events: tuple = ()
    stats: tuple = ()

    def __post_init__(self):
        _check(self.status in STATUSES, "status")
        _check(self.period is None or self.period in PERIODS, "period")
        for value in (self.minute, self.minute_added, self.home_score, self.away_score):
            _check(_number(value), "state number")
        _check(len({e.provider_event_id for e in self.events}) == len(self.events), "event id unique")


def _check(ok, what):
    if not ok:
        raise LiveError(what)
