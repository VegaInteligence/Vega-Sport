"""The Fjelstul World Cup Database (github.com/jfjelstul/worldcup): what the base lacks of the World Cups it archives.

The archives give a World Cup match its day, its teams and its score (OpenFootball). This database gives, for the
tournaments of 1930 to 2022, the stadium, the referee, the managers and the scorers of every match and, from 1970, its
line-ups, cards and substitutions; the squads; the awards. The user chose it on 18 November 2026.

Licence: CC-BY-SA 4.0. Wherever these rows are shown, the author and the licence are named, with what the base
changes: the values are typed, and a match is paired with the base's own. The credit is a row of
core.source_revisions (SOURCE), as the other sources'; no route serves it yet (the archives' index lists the result
archives' sources only): the route that will serve these rows serves it with them.

What is read: seventeen files of data-csv/ at one commit (COMMIT), each checked against its SHA-256 (FILES): the
repository can change, the base reads the same bytes or nothing. The other ten files repeat these or what the base
computes itself (standings, stages, appointments). Typed rows only, in core.worldcup_*, keyed by the database's own
identifiers; its players, managers and referees are not the base's (core.players is untouched): a name alone links
nobody. The one link is a match's: core.worldcup_matches.match_id, the base's archived match of the same edition, day
and teams (pair).
"""

import csv
import hashlib
import io
import re
from datetime import date, time, timedelta

from . import SourceError

COMMIT = "35a8667f518b07469182ae16d35574dd0e7a00fb"
REPOSITORY = "https://github.com/jfjelstul/worldcup"
RAW = "https://raw.githubusercontent.com/jfjelstul/worldcup/{commit}/data-csv/{name}.csv"
# The credit the licence asks for (core.source_revisions): the author and the copyright notice in the name, the
# licence with its link, the repository, the commit read, and what the base changes.
SOURCE = "fjelstul-worldcup"
ATTRIBUTION = {
    "name": "The Fjelstul World Cup Database, © 2023 Joshua C. Fjelstul, Ph.D.",
    "url": REPOSITORY,
    "license": "CC-BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/legalcode)",
    "coverage": "World Cups 1930–2022: stadiums, referees, managers and scorers; line-ups, cards and substitutions from 1970; "
                "squads and awards. Modified: values typed, each match paired with the match of the same day and teams in the Vega base.",
}
# The files read, each as the commit holds it (SHA-256 of its bytes).
FILES = {
    "tournaments": "906b122d80aae5302486bafa9dfd925378503a2a11de6f5db39d6c4879040ce0",
    "teams": "a2d5ef96fade3bee9ffd22a28cda6378c6b9fb67f8e99514aa58ec0854d26a66",
    "stadiums": "88b1bddb12cdf5abfe640937959dff41877f096f8b32b09c2f3a2614ec22e91c",
    "players": "97d61d04b522c9b6471753e92eb3100978d8159ca8c7a7bfd1b2f1921e92e884",
    "managers": "94e4db4acc0570e821e7180ed11adf002d65b56b63e3edd041e210d94753a985",
    "referees": "f9884485637116ed734852f0c1b4fd858398bbb6485c6e1f3f3187111b26948d",
    "matches": "037f718764758e7dda3a2918276f85fa8389af1d50999d2a480c8a6a49408875",
    "squads": "dafd483504fe26a63ae211e2539462fbbd86c53d5e079fc0a8cf48e8273659bb",
    "player_appearances": "edab41b99556cf7494387a5c7d74824c4c69a4474c32d1d4fbf8bab4e61ad483",
    "manager_appearances": "33f39d48fd60479138da38d3d90d82dc0d86795830cfc54a053a4d831063193a",
    "referee_appearances": "c3f213a6d8a1db38b93f22bc98f7b04fcde694670c544a6117ca35e13cc8c206",
    "goals": "4fbe990b7f42bb8af00d1587af09359ecfdb4ee4101bb44fda0eb336fc1e5be3",
    "bookings": "e1c010ce790fc7729392dc51ceafcb75775b4cc2e3ba39b186efbe6ab19f8969",
    "substitutions": "dd98a991dceaeb966771db3e6f7b28413a76f16be3a1f0c2a99b8c258a3a8e56",
    "penalty_kicks": "cbc58511b92b84b30baf674b20ede84f2bae3813b5d367e5c049e8108f222d9a",
    "awards": "80ff600291b87c519eacf79aecfa7a16ca7222a693b67ba604843ce3b719ca21",
    "award_winners": "84deded971dabc8bc30dab6dbcdabc7f08c646f6e5db22b85d2a71cdad437955",
}
SCOPE = "worldcup"
# The base's archived World Cup editions (cups.EDITIONS): « open-cups:world-cup-history:1974 ».
ARCHIVE = "open-cups:world-cup-history:"
# The teams the two sources spell differently (measured on 18 November 2026: with these four pairs every one of the
# 964 men's matches of 1930 to 2022 pairs with exactly one archived match, and their scores agree).
SPELLINGS = (("United States", "USA"), ("Republic of Ireland", "Ireland"), ("Ivory Coast", "Côte d'Ivoire"),
             ("Bosnia and Herzegovina", "Bosnia-Herzegovina"))
# The tables written, in the order their rows can be inserted (a row's references first).
TABLES = ("tournaments", "teams", "stadiums", "people", "matches", "squads", "appearances", "goals", "bookings",
          "substitutions", "shootout_kicks", "awards")


def scopes(now):
    """One scope, looked at every week: it reads the files only when the base does not hold COMMIT."""
    return {SCOPE: timedelta(days=7)}


def verify(files, pins=None):
    """The digest of the files read, each being the pinned one; a missing or different file stops the reading."""
    pins = FILES if pins is None else pins
    found = {}
    for name, pin in pins.items():
        text = files.get(name)
        if not isinstance(text, str) or hashlib.sha256(text.encode("utf-8")).hexdigest() != pin:
            raise SourceError("SOURCE_CHANGED")
        found[name] = pin
    return hashlib.sha256("".join(f"{name}:{found[name]}\n" for name in sorted(found)).encode()).hexdigest()


# --- Values ------------------------------------------------------------------------------------------------------------

_ABSENT = ("", "not available", "not applicable")
_KEYS = {"tournament": r"WC-\d{4}", "team": r"T-\d{2,3}", "stadium": r"S-\d{3}", "match": r"M-\d{4}-\d{2,3}", "player": r"P-\d{5}",
         "manager": r"M-\d{3}", "referee": r"R-\d{3}", "goal": r"G-\d{4,5}", "booking": r"B-\d{4,5}", "substitution": r"S-\d{4,5}",
         "kick": r"PK-\d{3,4}", "award": r"A-\d{1,2}"}


def _invalid():
    return SourceError("INVALID_SOURCE")


def _text(value):
    value = (value or "").strip()
    return None if value in _ABSENT else value


def _key(kind, value):
    if not re.fullmatch(_KEYS[kind], value or ""):
        raise _invalid()
    return value


def _int(value, *, low=0, high=10**6):
    if not re.fullmatch(r"\d{1,7}", value or "") or not low <= int(value) <= high:
        raise _invalid()
    return int(value)


def _flag(value):
    if value not in ("0", "1"):
        raise _invalid()
    return value == "1"


def _day(value, *, required=True):
    if _text(value) is None and not required:
        return None
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise _invalid() from None


def _clock(value):
    found = re.fullmatch(r"(\d{2}):(\d{2})", value or "")
    if not found or int(found[1]) > 23 or int(found[2]) > 59:
        raise _invalid()
    return time(int(found[1]), int(found[2]))


def _shirt(value):
    number = _int(value, high=99)
    return number or None  # 0 is the files' « unknown »


def _rows(files, name):
    try:
        return list(csv.DictReader(io.StringIO(files[name])))
    except (KeyError, csv.Error):
        raise _invalid() from None


def _unique(rows, column):
    if len({row[column] for row in rows}) != len(rows):
        raise _invalid()
    return rows


def typed(files):
    """{table: rows} from the files' text: every value typed, every reference resolved, or INVALID_SOURCE. A table's
    rows are dicts keyed by the columns of core.worldcup_<table>."""
    try:
        return _typed(files)
    except KeyError:  # a column the files no longer have
        raise _invalid() from None


def _typed(files):
    out = {}
    out["tournaments"] = _unique([{
        "tournament_key": _key("tournament", r["tournament_id"]), "name": _text(r["tournament_name"]), "year": _int(r["year"], low=1930, high=2100),
        "women": "Women" in r["tournament_name"], "start_date": _day(r["start_date"]), "end_date": _day(r["end_date"]),
        "host_country": _text(r["host_country"]), "winner": _text(r["winner"]), "teams": _int(r["count_teams"], low=2, high=64),
    } for r in _rows(files, "tournaments")], "tournament_key")
    out["teams"] = _unique([{"team_key": _key("team", r["team_id"]), "name": _text(r["team_name"]), "code": _text(r["team_code"]),
                             "confederation": _text(r["confederation_code"])} for r in _rows(files, "teams")], "team_key")
    out["stadiums"] = _unique([{
        "stadium_key": _key("stadium", r["stadium_id"]), "name": _text(r["stadium_name"]), "city": _text(r["city_name"]), "country": _text(r["country_name"]),
        "capacity": _int(r["stadium_capacity"]) if _text(r["stadium_capacity"]) else None, "wikipedia_url": _text(r["stadium_wikipedia_link"]),
    } for r in _rows(files, "stadiums")], "stadium_key")
    person = lambda key, role, r, **more: {
        "person_key": key, "role": role, "family_name": _text(r["family_name"]), "given_name": _text(r["given_name"]), "birth_date": None, "country": None,
        "female": _flag(r["female"]), "goalkeeper": None, "defender": None, "midfielder": None, "forward": None, "wikipedia_url": None, **more}
    out["people"] = _unique([
        *[person(_key("player", r["player_id"]), "player", r, birth_date=_day(r["birth_date"], required=False), goalkeeper=_flag(r["goal_keeper"]),
                 defender=_flag(r["defender"]), midfielder=_flag(r["midfielder"]), forward=_flag(r["forward"]), wikipedia_url=_text(r["player_wikipedia_link"]))
          for r in _rows(files, "players")],
        *[person(_key("manager", r["manager_id"]), "manager", r, country=_text(r["country_name"]), wikipedia_url=_text(r["manager_wikipedia_link"])) for r in _rows(files, "managers")],
        *[person(_key("referee", r["referee_id"]), "referee", r, country=_text(r["country_name"]), wikipedia_url=_text(r["referee_wikipedia_link"])) for r in _rows(files, "referees")],
    ], "person_key")
    if any(row["family_name"] is None for row in out["people"]) or any(row["name"] is None for table in ("tournaments", "teams", "stadiums") for row in out[table]):
        raise _invalid()
    tournaments = {row["tournament_key"] for row in out["tournaments"]}
    teams = {row["team_key"] for row in out["teams"]}
    stadiums = {row["stadium_key"] for row in out["stadiums"]}
    people = {row["person_key"]: row["role"] for row in out["people"]}

    def known(value, among, kind):
        if _key(kind, value) not in among:
            raise _invalid()
        return value

    def who(value, role):
        if people.get(_key(role, value)) != role:
            raise _invalid()
        return value

    out["matches"] = []
    for r in _rows(files, "matches"):
        shootout = _flag(r["penalty_shootout"])
        out["matches"].append({
            "match_key": _key("match", r["match_id"]), "tournament_key": known(r["tournament_id"], tournaments, "tournament"), "stage": _text(r["stage_name"]),
            "group_name": _text(r["group_name"]), "replayed": _flag(r["replayed"]), "replay": _flag(r["replay"]), "match_date": _day(r["match_date"]),
            "match_time": _clock(r["match_time"]), "stadium_key": known(r["stadium_id"], stadiums, "stadium"),
            "home_team_key": known(r["home_team_id"], teams, "team"), "away_team_key": known(r["away_team_id"], teams, "team"),
            "home_score": _int(r["home_team_score"], high=99), "away_score": _int(r["away_team_score"], high=99), "extra_time": _flag(r["extra_time"]), "shootout": shootout,
            "home_penalties": _int(r["home_team_score_penalties"], high=99) if shootout else None,
            "away_penalties": _int(r["away_team_score_penalties"], high=99) if shootout else None,
        })
    _unique(out["matches"], "match_key")
    if any(row["stage"] is None or row["home_team_key"] == row["away_team_key"] for row in out["matches"]):
        raise _invalid()
    matches = {row["match_key"] for row in out["matches"]}

    out["squads"] = [{"tournament_key": known(r["tournament_id"], tournaments, "tournament"), "team_key": known(r["team_id"], teams, "team"),
                      "player_key": who(r["player_id"], "player"), "shirt_number": _shirt(r["shirt_number"]), "position": _text(r["position_code"])}
                     for r in _rows(files, "squads")]
    if len({(r["tournament_key"], r["team_key"], r["player_key"]) for r in out["squads"]}) != len(out["squads"]):
        raise _invalid()
    out["appearances"] = [
        *[{"match_key": known(r["match_id"], matches, "match"), "person_key": who(r["player_id"], "player"), "role": "player", "team_key": known(r["team_id"], teams, "team"),
           "shirt_number": _shirt(r["shirt_number"]), "position": _text(r["position_code"]), "starter": _flag(r["starter"])} for r in _rows(files, "player_appearances")],
        *[{"match_key": known(r["match_id"], matches, "match"), "person_key": who(r["manager_id"], "manager"), "role": "manager", "team_key": known(r["team_id"], teams, "team"),
           "shirt_number": None, "position": None, "starter": None} for r in _rows(files, "manager_appearances")],
        *[{"match_key": known(r["match_id"], matches, "match"), "person_key": who(r["referee_id"], "referee"), "role": "referee", "team_key": None,
           "shirt_number": None, "position": None, "starter": None} for r in _rows(files, "referee_appearances")],
    ]
    if len({(r["match_key"], r["person_key"]) for r in out["appearances"]}) != len(out["appearances"]):
        raise _invalid()

    def moment(r):
        return {"minute": _int(r["minute_regulation"], high=130), "stoppage": _int(r["minute_stoppage"], high=60), "period": _text(r["match_period"])}

    def event(r, kind, column):
        return {f"{kind}_key": _key(kind, r[column]), "match_key": known(r["match_id"], matches, "match"), "team_key": known(r["team_id"], teams, "team"),
                "player_key": who(r["player_id"], "player")}

    out["goals"] = _unique([{**event(r, "goal", "goal_id"), "player_team_key": known(r["player_team_id"], teams, "team"), **moment(r),
                             "own_goal": _flag(r["own_goal"]), "penalty": _flag(r["penalty"])} for r in _rows(files, "goals")], "goal_key")
    out["bookings"] = _unique([{**event(r, "booking", "booking_id"), **moment(r), "yellow": _flag(r["yellow_card"]), "red": _flag(r["red_card"]),
                                "second_yellow": _flag(r["second_yellow_card"]), "sending_off": _flag(r["sending_off"])} for r in _rows(files, "bookings")], "booking_key")
    out["substitutions"] = []
    for r in _rows(files, "substitutions"):
        off, on = _flag(r["going_off"]), _flag(r["coming_on"])
        if off == on:
            raise _invalid()
        out["substitutions"].append({**event(r, "substitution", "substitution_id"), **moment(r), "going_off": off})
    _unique(out["substitutions"], "substitution_key")
    # A shoot-out's kicks are in the order they were taken: their place in the file, per match.
    taken = {}
    out["shootout_kicks"] = []
    for r in _rows(files, "penalty_kicks"):
        row = {**event(r, "kick", "penalty_kick_id"), "converted": _flag(r["converted"])}
        taken[row["match_key"]] = row["position"] = taken.get(row["match_key"], 0) + 1
        out["shootout_kicks"].append(row)
    _unique(out["shootout_kicks"], "kick_key")
    awards = {_key("award", r["award_id"]): _text(r["award_name"]) for r in _rows(files, "awards")}
    out["awards"] = []
    for r in _rows(files, "award_winners"):
        if awards.get(r["award_id"]) is None:
            raise _invalid()
        out["awards"].append({"tournament_key": known(r["tournament_id"], tournaments, "tournament"), "award": awards[r["award_id"]],
                              "player_key": who(r["player_id"], "player"), "team_key": known(r["team_id"], teams, "team"), "shared": _flag(r["shared"])})
    if len({(r["tournament_key"], r["award"], r["player_key"]) for r in out["awards"]}) != len(out["awards"]):
        raise _invalid()
    return out


# --- The link to the base's matches --------------------------------------------------------------------------------------

def _spelling(name):
    """A team's name as one key for both sources."""
    for pair in SPELLINGS:
        if name in pair:
            return pair[0]
    return name


def pair(source, base):
    """{match key: the base's match}: the archived match of the same edition, on the same day, between the same two
    teams in either order, when there is exactly one. `source`: (match key, edition year, women, day, home, away);
    `base`: (match id, edition, day, home, away) of the archived World Cup editions. A women's match pairs with
    nothing (the base holds no women's World Cup); a day apart is another match (a tie and its replay)."""
    found = {}
    for match_id, edition, day, home, away in base:
        found.setdefault((str(edition), day, frozenset((_spelling(home), _spelling(away)))), []).append(match_id)
    out = {}
    for key, year, women, day, home, away in source:
        candidates = [] if women else found.get((str(year), day, frozenset((_spelling(home), _spelling(away)))), [])
        if len(candidates) == 1:
            out[key] = candidates[0]
    return out


# --- Writing ---------------------------------------------------------------------------------------------------------------

def _replace(conn, tables):
    """Every table's rows replaced by the ones read (children deleted first, parents inserted first)."""
    for table in reversed(TABLES):
        conn.execute(f"DELETE FROM core.worldcup_{table}")
    written = 0
    for table in TABLES:
        rows = tables[table]
        if not rows:
            continue
        columns = list(rows[0])
        with conn.cursor().copy(f"COPY core.worldcup_{table} ({', '.join(columns)}) FROM STDIN") as copy:
            for row in rows:
                copy.write_row([row[column] for column in columns])
        written += len(rows)
    return written


def _link(conn):
    """Pair the men's matches not paired yet (the archive may have been read after this source, or a match of it
    replaced); the number left without a pair."""
    source = conn.execute(
        """SELECT m.match_key, t.year, t.women, m.match_date, h.name, a.name
           FROM core.worldcup_matches m JOIN core.worldcup_tournaments t USING (tournament_key)
           JOIN core.worldcup_teams h ON h.team_key = m.home_team_key JOIN core.worldcup_teams a ON a.team_key = m.away_team_key
           WHERE m.match_id IS NULL AND NOT t.women""").fetchall()
    if not source:
        return 0
    base = conn.execute(
        """SELECT m.id, cs.native_label, m.match_date, m.home_team_name, m.away_team_name
           FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
           WHERE cs.cup_key LIKE %s AND m.match_date IS NOT NULL AND m.home_team_name IS NOT NULL AND m.away_team_name IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM core.worldcup_matches w WHERE w.match_id = m.id)""", (ARCHIVE + "%",)).fetchall()
    pairs = pair(source, base)
    for key, match_id in pairs.items():
        conn.execute("UPDATE core.worldcup_matches SET match_id = %s WHERE match_key = %s", (match_id, key))
    return len(source) - len(pairs)


def run(conn, get, scope, now, *, pins=None, commit=None):
    """(rows written, men's matches without a pair in the base). The files are read only when the base does not hold
    this commit: a later run pairs what is left to pair and reads nothing."""
    if scope != SCOPE:
        raise ValueError(scope)
    pins, commit = FILES if pins is None else pins, commit or COMMIT
    held = conn.execute("SELECT revision FROM core.source_revisions WHERE source = %s", (SOURCE,)).fetchone()
    written = 0
    if not held or held[0] != commit:
        files = {name: get(RAW.format(commit=commit, name=name), as_text=True) for name in pins}
        digest = verify(files, pins)
        written = _replace(conn, typed(files))
        conn.execute(
            """INSERT INTO core.source_revisions(source, name, url, license, revision, archive_sha256, coverage, retrieved_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (source) DO UPDATE SET name=EXCLUDED.name, url=EXCLUDED.url, license=EXCLUDED.license, revision=EXCLUDED.revision,
                 archive_sha256=EXCLUDED.archive_sha256, coverage=EXCLUDED.coverage, retrieved_at=EXCLUDED.retrieved_at""",
            (SOURCE, ATTRIBUTION["name"], ATTRIBUTION["url"], ATTRIBUTION["license"], commit, digest, ATTRIBUTION["coverage"], now))
    return written, _link(conn)
