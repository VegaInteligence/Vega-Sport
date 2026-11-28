"""The window and each source row's outcome (backend/panna/FAILURE_MODES.md, section 2). No database, no network.

A fixture's edition (competition, season label) says whether it is in the window; its day says whether it is due at
the run's as-of. An event takes its fixture's outcome; an event key without a fixture is decided by its own edition.
"""

from dataclasses import dataclass
import datetime
import re

from vega import seasons

from . import registry

SPLIT = re.compile(r"([12]\d{3})-([12]\d{3})")
YEAR = re.compile(r"([12]\d{3})(?: .+)?")
DAY = re.compile(r"(\d{4}-\d{2}-\d{2})(?:Z|[T ][0-9:.]+(?:Z|[+-]00:?00)?)?")


@dataclass(frozen=True)
class Edition:
    state: str  # in, out, unresolved, dated
    reason: str
    season: int | None = None  # the Vega season id (its starting year)


def vega_start(label, league_name=None):
    return seasons.season_id(seasons.sporting_season(label, league_name=league_name))


def edition(competition, label):
    """Whether the edition (competition, season label) is in the window, by its label alone."""
    competition = competition or ""
    label = (label or "").strip()
    if competition in registry.DATED or (competition not in registry.TOURNAMENT and competition not in registry.CALENDAR
                                         and registry.DATED_NAME.search(competition)):
        return Edition("dated", "BY_DAY")
    found = SPLIT.fullmatch(label)
    if found:
        first, second = int(found.group(1)), int(found.group(2))
        if second != first + 1:
            return Edition("unresolved", "LABEL_UNREADABLE")
        return inside(first, "SPLIT_LABEL")
    found = YEAR.fullmatch(label)
    if not found:
        return Edition("unresolved", "LABEL_UNREADABLE")
    year = found.group(1)
    if competition in registry.TOURNAMENT:
        return inside(vega_start(year, registry.TOURNAMENT[competition]), "TOURNAMENT")
    if competition in registry.CALENDAR:
        return inside(vega_start(year), "CALENDAR")
    calendar, tournament = int(year), int(year) - 1
    if (calendar >= registry.FIRST_SEASON) != (tournament >= registry.FIRST_SEASON):
        return Edition("unresolved", "LABEL_AMBIGUOUS")
    return inside(calendar, "UNDECLARED_YEAR")


def inside(start, reason):
    if start is None:
        return Edition("unresolved", "LABEL_UNREADABLE")
    return Edition("in" if start >= registry.FIRST_SEASON else "out", reason, start)


def parse_day(value):
    found = DAY.fullmatch((value or "").strip())
    if not found:
        return None
    try:
        return datetime.date.fromisoformat(found.group(1))
    except ValueError:
        return None


@dataclass
class Decision:
    state: str  # in, out, unresolved, pending
    reason: str
    day: datetime.date | None
    season: int | None

    def outcome(self, as_of, orphan=False, first_seen=None):
        if self.state == "out":
            return "historical"
        if self.state == "unresolved":
            return "unresolved"
        if self.state == "pending":
            if first_seen is not None and (as_of - first_seen).days >= registry.PENDING_DAYS:
                return "unresolved"
            return "pending"
        if orphan:
            return "eligible_orphan"
        if self.day is not None and self.day > as_of:
            return "deferred"
        return "eligible"


def decide_fixtures(rows):
    """{key: Decision} for fixture rows (dicts with match_id, match_date, competition, season), by their editions and
    days, with the universal guard: an in-window edition holding a fixture dated before the window is unresolved."""
    editions = {}
    decided = {}
    for r in rows:
        ed = (r["competition"], r["season"])
        if ed not in editions:
            editions[ed] = edition(*ed)
    early = {ed for ed in editions if editions[ed].state == "in"}
    early = {(r["competition"], r["season"]) for r in rows
             if (r["competition"], r["season"]) in early and (d := parse_day(r["match_date"])) is not None
             and d < registry.FIRST_DAY}
    for r in rows:
        ed = (r["competition"], r["season"])
        e = editions[ed]
        day = parse_day(r["match_date"])
        if day is None:
            decision = Decision("unresolved", "NO_DAY", None, e.season)
        elif e.state == "dated":
            decision = Decision("in" if day >= registry.FIRST_DAY else "out", "BY_DAY", day, None)
        elif ed in early:
            decision = Decision("unresolved", "EDITION_DATE_CONFLICT", day, e.season)
        else:
            decision = Decision(e.state, e.reason, day, e.season)
        key = r["match_id"]
        if key in decided and (decided[key].state, decided[key].day) != (decision.state, decision.day):
            decision = Decision("unresolved", "DUPLICATE_KEY_CONFLICT", None, None)
        decided[key] = decision
    return decided


def decide_orphan(editions):
    """The decision for an event key whose fixture is unknown, from the editions its rows name."""
    if len(editions) != 1:
        return Decision("pending", "MIXED_EDITIONS", None, None)
    e = edition(*next(iter(editions)))
    if e.state == "in":
        return Decision("in", "ORPHAN_" + e.reason, None, e.season)
    if e.state == "out":
        return Decision("out", "ORPHAN_" + e.reason, None, e.season)
    return Decision("pending", "ORPHAN_NO_SIGNAL" if e.state == "dated" else "ORPHAN_" + e.reason, None, e.season)


def audit(rows):
    """The editions labelled out of the window but played from 2021-01-01, with their fixture counts (evidence that
    the label, not the day, decided them)."""
    counts = {}
    for r in rows:
        e = edition(r["competition"], r["season"])
        day = parse_day(r["match_date"])
        if e.state == "out" and day is not None and day >= registry.FIRST_DAY:
            key = (r["competition"], r["season"], e.season)
            counts[key] = counts.get(key, 0) + 1
    return [{"competition": c, "season": s, "vega_season": v, "fixtures": n} for (c, s, v), n in sorted(counts.items())]
