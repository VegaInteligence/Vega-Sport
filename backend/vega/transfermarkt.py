"""Transfermarkt's data in the base: a process of the worker (`--transfermarkt process`) that
reads Transfermarkt's JSON API, the routes the MIT project felipeall/transfermarkt-api (v5)
documents, with a client of its own (six GETs, the standard library: no dependency).

What it keeps, as typed rows (a response is never stored):
- the players it reads (core.provider_players) and the clubs' squads (core.provider_squads)
  and names (core.provider_clubs);
- for a player linked to one of ours: his market values (core.player_market_values, with the
  club of each valuation), transfers (core.player_transfers) and injuries
  (core.player_injuries), replaced whole at each read, and his contract with one of our clubs
  (core.player_contracts) when its start is known.

Links (core.provider_ids, how each was made in ops.provider_links):
- the snapshot of 6 July 2026 (player_fact_snapshot.py), as it stands;
- a club: the club of our players' valuations falling inside their spans at one of our teams
  (30 days either side), at least CLUB_VOTES players, at least CLUB_SHARE of the club's and of
  the team's votes, a reserve side never to a first team; two claims make a conflict for a
  person (ops.provider_link_conflicts), never a link;
- a player: inside a linked club, one of ours and one of the club's squads with the same
  birth date and the same name (or a name token of 3 letters or more), each the only one
  there; a player of ours without a birth date is not linked. A link whose provider's birth
  date differs from ours is quarantined: none of its data is shown.

Politeness: one request at a time, INTERVAL seconds apart and a jitter. A refusal (a WAF
challenge, 403, 429) pauses the reader one hour, doubling to a day; a week of refusals, or
GIVE_UP_BLOCKS in a row, stops it until a person clears ops.transfermarkt_state.gave_up_at.
It never tries to pass a challenge. The pause is kept in the base: a restart does not knock
again.

Order: the queue (ops.transfermarkt_reads), the most recent players first (priority 1 = a
player of the season in progress), then each unit when it is due again: a profile read in
batches of a hundred tells when a player's value or club changed, and only then are his
values or transfers read again before their period.
"""

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
import json
import os
import random
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .sources import normalize

BASE = "https://tmapi.transfermarkt.technology"
PROVIDER = "transfermarkt"
AGENT = "football-facts-reader/1.0"
MAX_BYTES = 8 * 1024 * 1024
INTERVAL = float(os.environ.get("V2_TM_INTERVAL") or 2.5)
JITTER = 0.5
BATCH = 100
PAUSE_FIRST, PAUSE_MAX = timedelta(hours=1), timedelta(hours=24)
GIVE_UP_AFTER, GIVE_UP_BLOCKS = timedelta(days=7), 8
SCHEMA_STOP = 20  # unreadable responses in a row: the format changed, the reader stops a day
PLAN_EVERY, LINK_EVERY = timedelta(hours=1), timedelta(hours=24)
CLUB_VOTES, CLUB_SHARE, SPAN_MARGIN = 3, 0.6, 30
MIN_TOKEN = 3
KINDS = ("profile", "club", "values", "squad", "transfers", "injuries")
# Days before a unit is read again, by priority (1 = the season in progress, 2 the one before,
# 3 the one before that, 4 and more older): a profile weekly for a player of the season, the
# values and transfers when the profile says they changed, else monthly.
PERIODS = {
    "profile": (7, 30, 90, 365), "values": (30, 90, 365, 365), "transfers": (30, 90, 365, 365),
    "injuries": (7, 30, 90, 365), "squad": (7, 365, 365, 365), "club": (180, 180, 180, 180),
}
NOT_FOUND_AGAIN = timedelta(days=90)
# Names that are no club: a player without one, retired, unknown or on a break.
NO_CLUB = {"withoutclub", "retired", "unknown", "careerbreak", "vereinslos", "karriereende", "unbekannt", "pause"}
RESERVE = re.compile(r"(?:\b(?:b|c|ii|iii)\b|\bu\s?-?(?:1[5-9]|2[0-3])\b|reserv|youth|juvenil|primavera|jong\b|academy)", re.I)
ILLNESS = re.compile(r"\b(?:ill|illness|flu|virus|covid|corona|infection|fever|cold|sick)\b", re.I)
INJURY = re.compile(r"injur|strain|fractur|broken|tear|torn|ruptur|sprain|bruis|surgery|knock|contusion|problem|pain|inflammat"
                    r"|ligament|muscle|tendon|cartilage|menisc|concussion|dislocat|hernia|achilles|hamstring|groin|calf|thigh", re.I)
TRANSFER_KINDS = {"ACTIVE_LOAN_TRANSFER": "loan", "RETURNED_FROM_PREVIOUS_LOAN": "loan_return", "INTERNAL_TRANSFER": "internal"}


class Blocked(Exception):
    """The provider refused the request: the reader pauses."""

    def __init__(self, reason, status=None, retry_after=None):
        super().__init__(reason)
        self.reason, self.status, self.retry_after = reason, status, retry_after


class Missing(Exception):
    """The provider does not know the entity (404)."""


class Failed(Exception):
    """A request or a response that failed: the unit is tried again later."""

    def __init__(self, code, status=None):
        super().__init__(code)
        self.code, self.status = code, status


# Transport ----------------------------------------------------------------


class _SameHost(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlparse(newurl).hostname != urlparse(req.full_url).hostname:
            return None
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetcher(timeout=20):
    """fetch(path, params) -> (status, headers, body): one GET, never retried here."""
    opener = build_opener(_SameHost())

    def fetch(path, params=()):
        url = BASE + path + ("?" + urlencode(list(params)) if params else "")
        try:
            with opener.open(Request(url, headers={"Accept": "application/json", "User-Agent": AGENT}), timeout=timeout) as r:
                return r.status, r.headers, r.read(MAX_BYTES + 1)
        except HTTPError as error:
            return error.code, error.headers, (error.read(MAX_BYTES + 1) if error.fp else b"")
        except (URLError, OSError, TimeoutError):
            raise Failed("TRANSPORT_ERROR") from None

    return fetch


def _header(headers, name):
    if headers is None:
        return None
    return headers.get(name) or headers.get(name.lower()) if hasattr(headers, "get") else None


def data_of(status, headers, body):
    """The `data` of a response, or the exception its status says (as the v5 client maps them)."""
    if _header(headers, "x-amzn-waf-action") or (status == 202 and not body):
        raise Blocked("WAF_CHALLENGE", status)
    if status in (403, 429):
        after = _header(headers, "Retry-After")
        raise Blocked(f"HTTP_{status}", status, int(after) if str(after or "").isdigit() else None)
    if status == 404:
        raise Missing()
    if status != 200:
        raise Failed(f"HTTP_{status}", status)
    if len(body) > MAX_BYTES:
        raise Failed("TOO_LARGE", status)
    try:
        payload = json.loads(body)
    except ValueError:
        raise Failed("SCHEMA_CHANGED", status) from None
    if not isinstance(payload, dict) or not payload.get("success") or "data" not in payload:
        raise Failed("SCHEMA_CHANGED", status)
    return payload["data"]


# Reading the responses ------------------------------------------------------


def _day(value):
    if not isinstance(value, str) or len(value) < 10:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _key(value):
    text = str(value) if value is not None and not isinstance(value, bool) else ""
    return text if re.fullmatch(r"[0-9]{1,10}", text) else None


def _money(money):
    if not isinstance(money, dict) or money.get("value") is None:
        return None
    try:
        value = int(money["value"])
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _container(data, key, kind=list):
    if not isinstance(data, dict):
        raise Failed("SCHEMA_CHANGED")
    value = data.get(key)
    if value is None:
        return kind()
    if not isinstance(value, kind):
        raise Failed("SCHEMA_CHANGED")
    return value


def parse_player(record):
    """A player record of /players: the facts kept, or None when it has no id."""
    if not isinstance(record, dict) or not _key(record.get("id")):
        return None
    life = record.get("lifeDates") or {}
    attributes = record.get("attributes") or {}
    foot = str((attributes.get("preferredFoot") or {}).get("name") or "").strip().lower()
    height = attributes.get("height")
    height = round(height * 100) if isinstance(height, (int, float)) and not isinstance(height, bool) else None
    current = next((a for a in record.get("clubAssignments") or [] if isinstance(a, dict) and a.get("type") == "current"), None)
    value = (record.get("marketValueDetails") or {}).get("current")
    return {
        "key": _key(record["id"]),
        "name": record.get("name") if isinstance(record.get("name"), str) else None,
        "birth_date": None if life.get("isDateOfBirthUnknown") else _day(life.get("dateOfBirth")),
        "position": (attributes.get("position") or {}).get("name") or None,
        "height_cm": height if height and 140 <= height <= 220 else None,
        "foot": foot if foot in ("left", "right", "both") else None,
        "contract_until": _day(attributes.get("contractUntil")),
        "club": _key((current or {}).get("clubId")),
        "joined_on": _day((current or {}).get("start")),
        "value": _money(value),
        "value_on": _day((value or {}).get("determined")) if isinstance(value, dict) else None,
    }


def parse_club(record):
    if not isinstance(record, dict) or not _key(record.get("id")):
        return None
    base = record.get("baseDetails") or {}
    return {"key": _key(record["id"]), "name": record.get("name") if isinstance(record.get("name"), str) else None,
            "country": _key(base.get("countryId")), "national": bool(base.get("isNationalTeam"))}


def parse_values(data):
    """[(day, value in euros, club key)] of a value history, one per day (the last given)."""
    out = {}
    for entry in _container(data, "history"):
        if not isinstance(entry, dict):
            continue
        money = entry.get("marketValue")
        day, value = _day((money or {}).get("determined") if isinstance(money, dict) else None), _money(money)
        if day and value:
            out[day] = (day, value, _key(entry.get("clubId")))
    return sorted(out.values())


def transfer_kind(record):
    kind = (record.get("typeDetails") or {}).get("type") or ""
    if kind == "STANDARD":
        fee = (record.get("details") or {}).get("fee") or {}
        label = str(((fee.get("compact") or {}) if isinstance(fee, dict) else {}).get("content") or "").strip().lower()
        return "free" if label == "free transfer" else "transfer"
    return TRANSFER_KINDS.get(kind)


def parse_transfers(data):
    """The transfers of a history, pending ones included (marked)."""
    if data is None:
        return []
    history = _container(data, "history", dict)
    out = []
    for record in (history.get("pending") or []) + (history.get("terminated") or []):
        if not isinstance(record, dict) or not _key(record.get("id")):
            continue
        details = record.get("details") or {}
        source, target = record.get("transferSource") or {}, record.get("transferDestination") or {}
        out.append({
            "key": _key(record["id"]), "date": _day(details.get("date")), "season": (details.get("season") or {}).get("display"),
            "from": _key(source.get("clubId")), "to": _key(target.get("clubId")), "kind": transfer_kind(record),
            "fee": _money(details.get("fee")), "value": _money(details.get("marketValue")),
            "contract_until": _day(details.get("contractUntilDate")), "pending": bool(details.get("isPending")),
        })
    return out


def injury_kind(label):
    """injury for a physical label, illness for an illness, None for anything else."""
    text = label or ""
    if ILLNESS.search(text):
        return "illness"
    return "injury" if INJURY.search(text) else None


def parse_injuries(data):
    out = []
    for entry in _container(data, "injuries"):
        if not isinstance(entry, dict):
            continue
        start, end = _day(entry.get("start")), _day(entry.get("end"))
        if start is None:
            continue
        days = (end - start).days + 1 if end else None
        if days is None and isinstance((entry.get("durationDetails") or {}).get("days"), int):
            days = entry["durationDetails"]["days"] + 1
        label = entry.get("name") if isinstance(entry.get("name"), str) else None
        season = entry.get("seasonId")
        out.append({"label": label, "kind": injury_kind(label), "start": start, "end": end, "days": days,
                    "games": entry.get("missedGamesCount") if isinstance(entry.get("missedGamesCount"), int) else None,
                    "season": season if isinstance(season, int) and 1900 <= season <= 2100 else None})
    return out


def parse_squad(data):
    out = {}
    for member in _container(data, "squad"):
        if isinstance(member, dict) and _key(member.get("playerId")):
            shirt = member.get("shirtNumber")
            out[_key(member["playerId"])] = shirt if isinstance(shirt, int) and 0 <= shirt < 1000 else None
    return sorted(out.items())


# Links ----------------------------------------------------------------------


def tokens(name):
    return {normalize(part) for part in re.split(r"[\s\-']+", name or "") if len(normalize(part)) >= MIN_TOKEN}


def is_reserve(name):
    return bool(RESERVE.search(name or ""))


def pick_clubs(votes, names, team_names, linked_clubs, linked_teams):
    """votes [(club key, team, players)] -> ({club: (team, players)}, [(club, team, reason)]).
    A club and a team are linked when each is the other's choice: at least CLUB_VOTES players
    and CLUB_SHARE of the club's votes and of the team's; a reserve side is never a first team;
    a club or a team already linked to another makes a conflict."""
    club_total, team_total = Counter(), Counter()
    for club, team, n in votes:
        club_total[club] += n
        team_total[team] += n
    links, conflicts = {}, []
    for club, team, n in sorted(votes, key=lambda v: (-v[2], v[0], v[1])):
        name = names.get(club)
        if name is None or normalize(name) in NO_CLUB or n < CLUB_VOTES:
            continue
        if n < CLUB_SHARE * club_total[club] or n < CLUB_SHARE * team_total[team]:
            continue
        if is_reserve(name) != is_reserve(team_names.get(team)):
            conflicts.append((club, team, "reserve_side"))
            continue
        if linked_clubs.get(club, team) != team or linked_teams.get(team, club) != club:
            conflicts.append((club, team, "already_linked"))
            continue
        if club in links or team in {t for t, _ in links.values()}:
            conflicts.append((club, team, "two_claims"))
            continue
        links[club] = (team, n)
    return links, conflicts


def pick_players(ours, theirs):
    """Inside one club: ours [(player, name, short name, birth date)], theirs [(key, name, birth
    date)] -> {key: (player, rule)}. The only pair of a birth date with the same name (full or
    short), else the only pair of that birth date sharing a name token; no birth date, no link."""
    def names(*values):
        return {normalize(v) for v in values if v} - {""}

    by_birth_ours, by_birth_theirs = defaultdict(list), defaultdict(list)
    for p in ours:
        if p[3] is not None:
            by_birth_ours[p[3]].append(p)
    for t in theirs:
        if t[2] is not None:
            by_birth_theirs[t[2]].append(t)
    out = {}
    for birth, candidates in by_birth_theirs.items():
        mine = by_birth_ours.get(birth, [])
        pairs = [(t, p) for t in candidates for p in mine if names(t[1]) & names(p[1], p[2])]
        if len(pairs) == 1:
            out[pairs[0][0][0]] = (pairs[0][1][0], "club_name_birth")
        elif not pairs and len(candidates) == 1 and len(mine) == 1 and tokens(candidates[0][1]) & (tokens(mine[0][1]) | tokens(mine[0][2])):
            out[candidates[0][0]] = (mine[0][0], "club_birth_name_token")
    return out


# The reader -------------------------------------------------------------------


def _utc(clock=None):
    return clock() if clock else datetime.now(timezone.utc)


class Reader:
    def __init__(self, conn, fetch=None, *, interval=INTERVAL, jitter=JITTER, sleep=time.sleep, clock=None, monotonic=time.monotonic, log=print):
        self.conn, self.fetch = conn, fetch or fetcher()
        self.interval, self.jitter, self.sleep, self.clock, self.monotonic, self.log = interval, jitter, sleep, clock, monotonic, log
        self._last = None
        self._schema_errors = 0
        self.counts = Counter()

    def now(self):
        return _utc(self.clock)

    # Requests -------------------------------------------------------------

    def get(self, path, params=()):
        if self._last is not None:
            self.sleep(max(0.0, self.interval + random.uniform(0, self.jitter) - (self.monotonic() - self._last)))
        self._last = self.monotonic()
        self.counts["requests"] += 1
        self.conn.execute("UPDATE ops.transfermarkt_state SET last_request_at = now(), requests = requests + 1 WHERE id = 1")
        status, headers, body = self.fetch(path, params)
        return data_of(status, headers, body)

    # State ------------------------------------------------------------------

    def state(self):
        return self.conn.execute(
            "SELECT paused_until, blocked_since, blocks_in_row, gave_up_at, last_request_at, planned_at FROM ops.transfermarkt_state WHERE id = 1"
        ).fetchone()

    def blocked(self, error):
        now = self.now()
        _, since, blocks, *_ = self.state()
        pause = min(PAUSE_FIRST * 2 ** blocks, PAUSE_MAX)
        if error.retry_after:
            pause = max(pause, timedelta(seconds=min(error.retry_after, PAUSE_MAX.total_seconds())))
        since = since or now
        give_up = blocks + 1 >= GIVE_UP_BLOCKS or now - since >= GIVE_UP_AFTER
        with self.conn.transaction():
            self.conn.execute("INSERT INTO ops.transfermarkt_blocks(resume_at, http_status, reason) VALUES (%s, %s, %s)",
                              (now + pause, error.status, error.reason))
            self.conn.execute(
                """UPDATE ops.transfermarkt_state SET paused_until = %s, blocked_since = %s, blocks_in_row = blocks_in_row + 1,
                     gave_up_at = CASE WHEN %s THEN %s ELSE gave_up_at END WHERE id = 1""",
                (now + pause, since, give_up, now),
            )
        self.log(f"transfermarkt blocked reason={error.reason} status={error.status} pause_h={pause.total_seconds() / 3600:.1f} gave_up={give_up}", flush=True)

    def cleared(self):
        self.conn.execute("UPDATE ops.transfermarkt_state SET blocks_in_row = 0, blocked_since = NULL WHERE id = 1 AND blocks_in_row > 0")

    # Planning ----------------------------------------------------------------

    def current_season(self):
        return self.conn.execute("SELECT max(season_id) FROM core.matches WHERE status = 'finished'").fetchone()[0]

    def plan(self, *, link=False):
        """Links from the snapshot, clubs and squads (daily, `link`), quarantines, and the units
        of every link and every club met; each insert skips what is already queued."""
        now = self.now()
        with self.conn.transaction():
            self.conn.execute("SET LOCAL lock_timeout = '5s'")
            self.seed_snapshot()
            if link:
                self.link_clubs()
                self.link_players()
            self.quarantine()
            queued = self.enqueue(now)
            self.conn.execute("UPDATE ops.transfermarkt_state SET planned_at = %s WHERE id = 1", (now,))
        self.log(f"transfermarkt planned queued={queued} link={link}", flush=True)
        return queued

    def _link(self, entity_type, key, entity, rule, evidence=0):
        """Write a link unless the key or the entity already has one (links never move)."""
        taken = self.conn.execute(
            """SELECT 1 FROM core.provider_ids WHERE entity_type = %s AND provider = %s
               AND (provider_key = %s OR (entity_id = %s AND is_current))""", (entity_type, PROVIDER, key, entity)).fetchone()
        if taken:
            return False
        self.conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES (%s, %s, %s, %s)",
                          (entity_type, PROVIDER, key, entity))
        self.conn.execute(
            """INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, evidence) VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT DO NOTHING""", (entity_type, PROVIDER, key, entity, rule, evidence))
        return True

    def seed_snapshot(self):
        rows = self.conn.execute(
            """SELECT o.source_player_id, o.player_id FROM core.player_fact_observations o
               WHERE o.source = 'transfermarkt_snapshot'
                 AND NOT EXISTS (SELECT 1 FROM core.provider_ids i WHERE i.entity_type = 'player' AND i.provider = 'transfermarkt'
                                 AND (i.provider_key = o.source_player_id OR (i.entity_id = o.player_id AND i.is_current)))"""
        ).fetchall()
        return sum(self._link("player", key, player, "snapshot") for key, player in rows)

    def link_clubs(self):
        votes = self.conn.execute(
            """WITH linked AS (
                 SELECT entity_id AS player_id FROM core.provider_ids WHERE entity_type = 'player' AND provider = 'transfermarkt' AND is_current),
               spans AS (
                 SELECT s.player_id, s.team_id, s.season_id, min(m.match_date) AS first_day, max(m.match_date) AS last_day
                 FROM core.player_match_stats s
                 JOIN linked l ON l.player_id = s.player_id
                 JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id
                 JOIN core.teams t ON t.id = s.team_id AND t.is_national IS NOT TRUE
                 WHERE s.minutes_played > 0 AND m.match_date IS NOT NULL
                 GROUP BY 1, 2, 3)
               SELECT v.provider_club, sp.team_id, count(DISTINCT v.player_id)::int
               FROM core.player_market_values v
               JOIN spans sp ON sp.player_id = v.player_id AND v.valued_at BETWEEN sp.first_day - %s::int AND sp.last_day + %s::int
               JOIN core.provider_clubs c ON c.provider = 'transfermarkt' AND c.provider_key = v.provider_club AND c.is_national IS NOT TRUE
               WHERE v.source = 'transfermarkt' AND v.provider_club IS NOT NULL
               GROUP BY 1, 2""", (SPAN_MARGIN, SPAN_MARGIN)).fetchall()
        names = dict(self.conn.execute("SELECT provider_key, name FROM core.provider_clubs WHERE provider = 'transfermarkt'").fetchall())
        teams = {team for _, team, _ in votes}
        team_names = dict(self.conn.execute("SELECT id, name FROM core.teams WHERE id = ANY(%s)", (sorted(teams),)).fetchall()) if teams else {}
        linked = self.conn.execute("SELECT provider_key, entity_id FROM core.provider_ids WHERE entity_type = 'team' AND provider = 'transfermarkt' AND is_current").fetchall()
        links, conflicts = pick_clubs(votes, names, team_names, dict(linked), {t: k for k, t in linked})
        written = sum(self._link("team", club, team, "club_votes", n) for club, (team, n) in links.items())
        for club, team, reason in conflicts:
            self.conn.execute(
                """INSERT INTO ops.provider_link_conflicts(entity_type, provider, provider_key, entity_id, reason) VALUES ('team', %s, %s, %s, %s)
                   ON CONFLICT DO NOTHING""", (PROVIDER, club, team, reason))
        return written

    def link_players(self):
        ours, theirs = defaultdict(list), defaultdict(list)
        for club, player, name, short, birth in self.conn.execute(
            """WITH clubs AS (SELECT provider_key AS club, entity_id AS team FROM core.provider_ids
                              WHERE entity_type = 'team' AND provider = 'transfermarkt' AND is_current),
                    unlinked AS (SELECT DISTINCT c.club, s.player_id FROM core.player_match_stats s JOIN clubs c ON c.team = s.team_id
                                 WHERE s.minutes_played > 0)
               SELECT u.club, p.id, p.name, p.short_name, p.birth_date FROM unlinked u JOIN core.players p ON p.id = u.player_id
               WHERE NOT EXISTS (SELECT 1 FROM core.provider_ids i WHERE i.entity_type = 'player' AND i.provider = 'transfermarkt'
                                 AND i.entity_id = p.id AND i.is_current)"""
        ).fetchall():
            ours[club].append((player, name, short, birth))
        for club, key, name, birth in self.conn.execute(
            """SELECT DISTINCT q.club_key, q.player_key, pp.name, pp.birth_date FROM core.provider_squads q
               JOIN core.provider_ids c ON c.entity_type = 'team' AND c.provider = 'transfermarkt' AND c.provider_key = q.club_key AND c.is_current
               JOIN core.provider_players pp ON pp.provider = q.provider AND pp.provider_key = q.player_key
               WHERE q.provider = 'transfermarkt'
                 AND NOT EXISTS (SELECT 1 FROM core.provider_ids i WHERE i.entity_type = 'player' AND i.provider = 'transfermarkt'
                                 AND i.provider_key = q.player_key)"""
        ).fetchall():
            theirs[club].append((key, name, birth))
        claims, found = defaultdict(set), {}
        for club in theirs:
            for key, (player, rule) in pick_players(ours.get(club, []), theirs[club]).items():
                claims[key].add(player)
                claims[("player", player)].add(key)
                found[key] = (player, rule)
        # Across clubs, a key claimed for two players, or a player for two keys, links nobody.
        return sum(self._link("player", key, player, rule, 1) for key, (player, rule) in found.items()
                   if len(claims[key]) == 1 and len(claims[("player", player)]) == 1)

    def quarantine(self):
        """A link whose provider's birth date differs from ours: doubted, shown nowhere."""
        return self.conn.execute(
            """INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, quarantined_at, quarantine_reason)
               SELECT 'player', 'transfermarkt', i.provider_key, i.entity_id, 'unknown', now(), 'birth_date_differs'
               FROM core.provider_ids i
               JOIN core.provider_players pp ON pp.provider = 'transfermarkt' AND pp.provider_key = i.provider_key
               JOIN core.players p ON p.id = i.entity_id
               WHERE i.entity_type = 'player' AND i.provider = 'transfermarkt' AND i.is_current
                 AND pp.birth_date IS NOT NULL AND p.birth_date IS NOT NULL AND pp.birth_date <> p.birth_date
               ON CONFLICT (entity_type, provider, provider_key) DO UPDATE SET quarantined_at = coalesce(ops.provider_links.quarantined_at, now()),
                 quarantine_reason = coalesce(ops.provider_links.quarantine_reason, 'birth_date_differs')
               WHERE ops.provider_links.quarantined_at IS NULL"""
        ).rowcount

    def enqueue(self, now):
        current = self.current_season()
        if current is None:
            return 0
        queued = 0
        # Every linked player, not doubted: his four units, priority by his last season played.
        queued += self.conn.execute(
            """WITH players AS (
                 SELECT i.provider_key, (SELECT max(s.season_id) FROM core.player_match_stats s WHERE s.player_id = i.entity_id AND s.minutes_played > 0) AS last
                 FROM core.provider_ids i
                 WHERE i.entity_type = 'player' AND i.provider = 'transfermarkt' AND i.is_current
                   AND NOT EXISTS (SELECT 1 FROM ops.transfermarkt_reads r WHERE r.kind = 'injuries' AND r.provider_key = i.provider_key)
                   AND NOT EXISTS (SELECT 1 FROM ops.provider_links l WHERE l.entity_type = 'player' AND l.provider = 'transfermarkt'
                                   AND l.provider_key = i.provider_key AND l.quarantined_at IS NOT NULL))
               INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at)
               SELECT k.kind, p.provider_key, least(9, greatest(1, %s - coalesce(p.last, %s - 8) + 1)), %s
               FROM players p CROSS JOIN (VALUES ('profile'), ('values'), ('transfers'), ('injuries')) k(kind)
               ON CONFLICT DO NOTHING""", (current, current, now)).rowcount
        # Every linked club: its squads of the seasons the base holds of it, and the year before
        # (a calendar-year league is the provider's year before).
        queued += self.conn.execute(
            """WITH seasons AS (SELECT DISTINCT v.team, m.season_id FROM core.matches m
                                CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) v(team))
               INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at)
               SELECT DISTINCT 'squad', i.provider_key || ':' || y.year, least(9, greatest(1, %s - y.year + 1))::smallint, %s::timestamptz
               FROM core.provider_ids i
               JOIN seasons s ON s.team = i.entity_id
               CROSS JOIN LATERAL (VALUES (s.season_id), (s.season_id - 1)) y(year)
               WHERE i.entity_type = 'team' AND i.provider = 'transfermarkt' AND i.is_current AND y.year <= %s
               ON CONFLICT DO NOTHING""", (current, now, current)).rowcount
        # Every club met (a valuation, a transfer, a squad, a player's club) without a name.
        queued += self.conn.execute(
            """INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at)
               SELECT DISTINCT 'club', k.club, 1, %s::timestamptz FROM (
                 SELECT provider_club AS club FROM core.player_market_values WHERE source = 'transfermarkt' AND provider_club IS NOT NULL
                 UNION SELECT from_provider_club FROM core.player_transfers WHERE source = 'transfermarkt' AND from_provider_club IS NOT NULL
                 UNION SELECT to_provider_club FROM core.player_transfers WHERE source = 'transfermarkt' AND to_provider_club IS NOT NULL
                 UNION SELECT club_key FROM core.provider_squads WHERE provider = 'transfermarkt'
                 UNION SELECT provider_club FROM core.provider_players WHERE provider = 'transfermarkt' AND provider_club IS NOT NULL) k
               WHERE NOT EXISTS (SELECT 1 FROM core.provider_clubs c WHERE c.provider = 'transfermarkt' AND c.provider_key = k.club)
               ON CONFLICT DO NOTHING""", (now,)).rowcount
        # Every squad member never read: his profile (to link him), at his squad's priority.
        queued += self.conn.execute(
            """INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at)
               SELECT 'profile', q.player_key, min(least(9, greatest(1, %s - q.season_year + 1)))::smallint, %s::timestamptz
               FROM core.provider_squads q
               WHERE q.provider = 'transfermarkt'
                 AND NOT EXISTS (SELECT 1 FROM core.provider_players pp WHERE pp.provider = 'transfermarkt' AND pp.provider_key = q.player_key)
               GROUP BY q.player_key
               ON CONFLICT DO NOTHING""", (current, now)).rowcount
        return queued

    # Units --------------------------------------------------------------------

    def next_units(self):
        """The next due unit, or for a profile or a club the next due hundred of them."""
        row = self.conn.execute(
            """SELECT kind, provider_key, priority FROM ops.transfermarkt_reads WHERE next_due_at <= now()
               ORDER BY priority, array_position(%s::text[], kind), next_due_at LIMIT 1""", (list(KINDS),)).fetchone()
        if row is None:
            return None, []
        kind, key, priority = row
        if kind not in ("profile", "club"):
            return kind, [(key, priority)]
        rows = self.conn.execute(
            """SELECT provider_key, priority FROM ops.transfermarkt_reads WHERE kind = %s AND next_due_at <= now()
               ORDER BY priority, next_due_at LIMIT %s""", (kind, BATCH)).fetchall()
        return kind, rows

    def done(self, kind, key, priority, written, *, status=200, error=None, again=None):
        now = self.now()
        if again is None:
            days = PERIODS[kind][min(priority, 4) - 1]
            again = timedelta(days=days)
        self.conn.execute(
            """UPDATE ops.transfermarkt_reads SET read_at = %s, next_due_at = %s, attempts = CASE WHEN %s::text IS NULL THEN 0 ELSE attempts + 1 END,
                 last_http_status = %s, error_code = %s, rows_written = %s WHERE kind = %s AND provider_key = %s""",
            (now, now + again, error, status, error, written, kind, key))

    def failed(self, kind, units, error):
        for key, _ in units:
            attempts = self.conn.execute("SELECT attempts FROM ops.transfermarkt_reads WHERE kind = %s AND provider_key = %s", (kind, key)).fetchone()
            wait = min(timedelta(hours=2 ** (attempts[0] if attempts else 0)), timedelta(days=7))
            self.conn.execute(
                """UPDATE ops.transfermarkt_reads SET next_due_at = now() + %s, attempts = attempts + 1, last_http_status = %s, error_code = %s
                   WHERE kind = %s AND provider_key = %s""", (wait, error.status, error.code, kind, key))

    def player_of(self, key):
        row = self.conn.execute(
            """SELECT i.entity_id FROM core.provider_ids i WHERE i.entity_type = 'player' AND i.provider = 'transfermarkt' AND i.provider_key = %s AND i.is_current
                 AND NOT EXISTS (SELECT 1 FROM ops.provider_links l WHERE l.entity_type = 'player' AND l.provider = 'transfermarkt'
                                 AND l.provider_key = %s AND l.quarantined_at IS NOT NULL)""", (key, key)).fetchone()
        return row[0] if row else None

    def team_of(self, club):
        if club is None:
            return None
        row = self.conn.execute("SELECT entity_id FROM core.provider_ids WHERE entity_type = 'team' AND provider = 'transfermarkt' AND provider_key = %s AND is_current", (club,)).fetchone()
        return row[0] if row else None

    def read(self, kind, units):
        """Read one unit (a batch for profiles and clubs) and write what it says, with its
        queue row, in one transaction. A refusal pauses the reader; nothing is written."""
        keys = [key for key, _ in units]
        try:
            if kind == "profile":
                data = self.get("/players", [("ids[]", k) for k in keys])
            elif kind == "club":
                data = self.get("/clubs", [("ids[]", k) for k in keys])
            elif kind == "values":
                data = self.get(f"/player/{keys[0]}/market-value-history")
            elif kind == "transfers":
                try:
                    data = self.get(f"/transfer/history/player/{keys[0]}")
                except Missing:
                    data = None
            elif kind == "injuries":
                data = self.get(f"/player/{keys[0]}/injury")
            else:
                club, year = keys[0].split(":")
                data = self.get(f"/club/{club}/squad", [("season", year)])
        except Blocked as error:
            self.blocked(error)
            return "blocked"
        except Missing:
            with self.conn.transaction():
                for key, priority in units:
                    self.done(kind, key, priority, 0, status=404, error="NOT_FOUND", again=NOT_FOUND_AGAIN)
            return "missing"
        except Failed as error:
            with self.conn.transaction():
                self.failed(kind, units, error)
            return self._schema(error)
        try:
            with self.conn.transaction():
                self.conn.execute("SET LOCAL lock_timeout = '5s'")
                written = getattr(self, f"write_{kind}")(units, data)
            self._schema_errors = 0
            self.cleared()
            self.counts[kind] += len(units)
            return "ok"
        except Failed as error:
            with self.conn.transaction():
                self.failed(kind, units, error)
            return self._schema(error)

    def _schema(self, error):
        if error.code != "SCHEMA_CHANGED":
            return "failed"
        self._schema_errors += 1
        if self._schema_errors >= SCHEMA_STOP:
            self._schema_errors = 0
            self.blocked(Blocked("SCHEMA_CHANGED", error.status))
        return "schema"

    # Writes -------------------------------------------------------------------

    def write_profile(self, units, data):
        if not isinstance(data, list):
            raise Failed("SCHEMA_CHANGED")
        today = self.now().date()
        players = {p["key"]: p for p in (parse_player(r) for r in data) if p}
        priorities = dict(units)
        written = 0
        for key, priority in units:
            p = players.get(key)
            if p is None:
                self.done("profile", key, priority, 0, status=404, error="NOT_FOUND", again=NOT_FOUND_AGAIN)
                continue
            before = self.conn.execute(
                "SELECT market_value_eur, market_value_on, provider_club, contract_until FROM core.provider_players WHERE provider = 'transfermarkt' AND provider_key = %s",
                (key,)).fetchone()
            self.conn.execute(
                """INSERT INTO core.provider_players(provider, provider_key, name, birth_date, position, height_cm, preferred_foot, contract_until,
                     provider_club, joined_on, market_value_eur, market_value_on, read_on)
                   VALUES ('transfermarkt', %(key)s, %(name)s, %(birth_date)s, %(position)s, %(height_cm)s, %(foot)s, %(contract_until)s,
                     %(club)s, %(joined_on)s, %(value)s, %(value_on)s, %(today)s)
                   ON CONFLICT (provider, provider_key) DO UPDATE SET name = EXCLUDED.name, birth_date = EXCLUDED.birth_date,
                     position = EXCLUDED.position, height_cm = EXCLUDED.height_cm, preferred_foot = EXCLUDED.preferred_foot,
                     contract_until = EXCLUDED.contract_until, provider_club = EXCLUDED.provider_club, joined_on = EXCLUDED.joined_on,
                     market_value_eur = EXCLUDED.market_value_eur, market_value_on = EXCLUDED.market_value_on, read_on = EXCLUDED.read_on""",
                {**p, "today": today})
            written += 1
            player = self.player_of(key)
            if player is not None:
                written += self.contract(player, p, today)
                # What changed since the last profile: the values or the transfers are due now.
                if before is not None and (before[0], before[1]) != (p["value"], p["value_on"]):
                    self.conn.execute("UPDATE ops.transfermarkt_reads SET next_due_at = now() WHERE kind = 'values' AND provider_key = %s", (key,))
                if before is not None and (before[2], before[3]) != (p["club"], p["contract_until"]):
                    self.conn.execute("UPDATE ops.transfermarkt_reads SET next_due_at = now() WHERE kind = 'transfers' AND provider_key = %s", (key,))
            self.done("profile", key, priorities[key], 1)
        return written

    def contract(self, player, p, today):
        """The player's contract with his club, when the club is ours and its start known; an
        older contract the provider gave him is closed by the newer one (removed)."""
        team = self.team_of(p["club"])
        if team is None or p["joined_on"] is None or p["contract_until"] is None or p["contract_until"] < p["joined_on"]:
            return 0
        self.conn.execute(
            "DELETE FROM core.player_contracts WHERE player_id = %s AND source = 'transfermarkt' AND (team_id, start_date) <> (%s, %s)",
            (player, team, p["joined_on"]))
        return self.conn.execute(
            """INSERT INTO core.player_contracts(player_id, team_id, start_date, end_date, source, as_of)
               VALUES (%s, %s, %s, %s, 'transfermarkt', %s)
               ON CONFLICT (player_id, team_id, start_date) DO UPDATE SET end_date = EXCLUDED.end_date, as_of = EXCLUDED.as_of, updated_at = now()
               WHERE core.player_contracts.source = 'transfermarkt'""", (player, team, p["joined_on"], p["contract_until"], today)).rowcount

    def write_club(self, units, data):
        if not isinstance(data, list):
            raise Failed("SCHEMA_CHANGED")
        today = self.now().date()
        clubs = {c["key"]: c for c in (parse_club(r) for r in data) if c}
        for key, priority in units:
            c = clubs.get(key)
            if c is None:
                self.done("club", key, priority, 0, status=404, error="NOT_FOUND", again=NOT_FOUND_AGAIN)
                continue
            self.conn.execute(
                """INSERT INTO core.provider_clubs(provider, provider_key, name, country_key, is_national, read_on)
                   VALUES ('transfermarkt', %s, %s, %s, %s, %s)
                   ON CONFLICT (provider, provider_key) DO UPDATE SET name = EXCLUDED.name, country_key = EXCLUDED.country_key,
                     is_national = EXCLUDED.is_national, read_on = EXCLUDED.read_on""", (key, c["name"], c["country"], c["national"], today))
            self.done("club", key, priority, 1)
        return len(clubs)

    def write_values(self, units, data):
        (key, priority), = units
        rows = parse_values(data)
        player = self.player_of(key)
        today = self.now().date()
        written = 0
        if player is not None and rows:
            days = [day for day, _, _ in rows]
            self.conn.execute("DELETE FROM core.player_market_values WHERE player_id = %s AND source = 'transfermarkt' AND NOT (valued_at = ANY(%s))",
                              (player, days))
            for day, value, club in rows:
                written += self.conn.execute(
                    """INSERT INTO core.player_market_values(player_id, valued_at, value_eur, source, as_of, team_id, provider_club)
                       VALUES (%s, %s, %s, 'transfermarkt', %s, %s, %s)
                       ON CONFLICT (player_id, valued_at, source) DO UPDATE SET value_eur = EXCLUDED.value_eur, as_of = EXCLUDED.as_of,
                         team_id = EXCLUDED.team_id, provider_club = EXCLUDED.provider_club, updated_at = now()""",
                    (player, day, value, today, self.team_of(club), club)).rowcount
        self.done("values", key, priority, written)
        return written

    def write_transfers(self, units, data):
        (key, priority), = units
        rows = parse_transfers(data)
        player = self.player_of(key)
        today = self.now().date()
        written = 0
        if player is not None:
            self.conn.execute("DELETE FROM core.player_transfers WHERE player_id = %s AND source = 'transfermarkt'", (player,))
            for t in rows:
                written += self.conn.execute(
                    """INSERT INTO core.player_transfers(player_id, transfer_date, from_team_id, to_team_id, kind, fee_eur, source, as_of, source_key,
                         season_label, from_provider_club, to_provider_club, market_value_eur, contract_until, pending)
                       VALUES (%s, %s, %s, %s, %s, %s, 'transfermarkt', %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (player, t["date"], self.team_of(t["from"]), self.team_of(t["to"]), t["kind"], t["fee"], today, t["key"], t["season"],
                     t["from"], t["to"], t["value"], t["contract_until"], t["pending"])).rowcount
        self.done("transfers", key, priority, written)
        return written

    def write_injuries(self, units, data):
        (key, priority), = units
        rows = parse_injuries(data)
        player = self.player_of(key)
        today = self.now().date()
        written = 0
        if player is not None:
            self.conn.execute("DELETE FROM core.player_injuries WHERE player_id = %s AND source = 'transfermarkt'", (player,))
            for i in rows:
                written += self.conn.execute(
                    """INSERT INTO core.player_injuries(player_id, kind, label, start_date, end_date, matches_missed, source, as_of, days, season_year)
                       VALUES (%s, %s, %s, %s, %s, %s, 'transfermarkt', %s, %s, %s)""",
                    (player, i["kind"], i["label"], i["start"], i["end"], i["games"], today, i["days"], i["season"])).rowcount
        self.done("injuries", key, priority, written)
        return written

    def write_squad(self, units, data):
        (key, priority), = units
        club, year = key.split(":")
        members = parse_squad(data)
        today = self.now().date()
        self.conn.execute("DELETE FROM core.provider_squads WHERE provider = 'transfermarkt' AND club_key = %s AND season_year = %s", (club, int(year)))
        for player, shirt in members:
            self.conn.execute(
                "INSERT INTO core.provider_squads(provider, club_key, season_year, player_key, shirt_number, read_on) VALUES ('transfermarkt', %s, %s, %s, %s, %s)",
                (club, int(year), player, shirt, today))
        self.done("squad", key, priority, len(members))
        return len(members)

    # The loop -------------------------------------------------------------------

    def step(self):
        """One thing to do: wait out a pause, plan when due, or read the next unit.
        'gave_up', 'paused', 'planned', 'idle', or the read's outcome."""
        paused_until, _, _, gave_up_at, last_request_at, planned_at = self.state()
        now = self.now()
        if gave_up_at is not None:
            return "gave_up"
        if paused_until is not None and paused_until > now:
            return "paused"
        if self._last is None and last_request_at is not None:
            # After a restart the interval still runs from the last request in the base.
            self._last = self.monotonic() - max(0.0, (now - last_request_at).total_seconds())
        if planned_at is None or now - planned_at >= PLAN_EVERY:
            linked_at = self.conn.execute(
                "SELECT max(linked_at) FROM ops.provider_links WHERE provider = 'transfermarkt' AND rule <> 'snapshot'").fetchone()[0]
            day = planned_at is None or planned_at.date() != now.date() or linked_at is None
            self.plan(link=day)
            return "planned"
        kind, units = self.next_units()
        if not units:
            return "idle"
        return self.read(kind, units)


def run(conn, *, stop, fetch=None, sleep=time.sleep, log=print):
    """The reader's process, until `stop`: a unit at a time; a pause, an idle queue or a
    stop by a person are waited out a minute at a time, the stop checked every second."""
    reader = Reader(conn, fetch, sleep=sleep, log=log)
    log(f"transfermarkt reader started interval={reader.interval}", flush=True)
    said, shown = None, 0
    while not stop():
        outcome = reader.step()
        if outcome in ("gave_up", "paused", "idle"):
            if outcome != said:
                log(f"transfermarkt waiting reason={outcome}", flush=True)
                said = outcome
            for _ in range(60):
                if stop():
                    break
                sleep(1)
            continue
        said = None
        if reader.counts["requests"] >= shown + 100:
            shown = reader.counts["requests"]
            log("transfermarkt progress " + " ".join(f"{k}={reader.counts[k]}" for k in ("requests", *KINDS)), flush=True)
    log("transfermarkt reader stopped", flush=True)
