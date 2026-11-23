"""transfermarkt-datasets (github.com/dcaribou/transfermarkt-datasets): the five big leagues' player seasons the base
archives without players, 2012/13 to 2020/21.

The archives give a league season of those years its matches and scores; PitchAPI's players start in 2021/22. This
project's files give, for every league game of the Premier League (GB1), LaLiga (ES1), the Bundesliga (L1), Serie A
(IT1) and Ligue 1 (FR1) of 2012/13 to 2020/21, each player's appearance with his club, minutes, goals, assists and
cards (measured on 23 November 2026: all of the 16,333 games but one have their appearances; 2010/11 and 2011/12 have
none, and are out of scope). The coordinator chose it on 23 November 2026; its data is frozen since July 2026.

Licence: CC0-1.0 (public domain dedication): no credit required; the base names the project anyway (SOURCE, a row of
core.source_revisions), as the other sources'.

What is read: three files (FILES), each checked against its SHA-256: a file that differs stops the reading, nothing is
written. The games file selects the games of the five codes and nine seasons; only their appearances are read and
typed, the others' are skipped unread. The rows: one per league, season, player and club (core.league_player_seasons),
the sums of his appearances, keyed by Transfermarkt's own ids. The links to the base are the Transfermarkt process's
(vega/transfermarkt.py: core.provider_ids, provider transfermarkt), made again at each run: a link made later is
picked up without reading any file. Nothing is written to core.players, core.teams or the base's statistics.
"""

import csv
import gzip
import hashlib
import io
import re
import zlib
from collections import defaultdict
from datetime import timedelta

from . import SourceError

SOURCE = "transfermarkt-datasets"
REPOSITORY = "https://github.com/dcaribou/transfermarkt-datasets"
URL = "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/{name}.csv.gz"
ATTRIBUTION = {
    "name": "transfermarkt-datasets (dcaribou)",
    "url": REPOSITORY,
    "license": "CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/legalcode)",
    "coverage": "League seasons 2012/13–2020/21 of the Premier League, LaLiga, Bundesliga, Serie A and Ligue 1: each player's "
                "matches, minutes, goals, assists and cards per club, from Transfermarkt's appearances. Modified: summed per "
                "league season, player and club; players and clubs linked to the Vega base where the Transfermarkt process linked them.",
}
# The files read, smallest first (a file that differs stops the reading before the next): SHA-256 of each as served on
# 23 November 2026, and the most the client accepts of it (the appearances file is 45,253,638 bytes).
FILES = {
    "games": "142561989017d379bcf9e72bad0b87e0996bae0e7b710ebb3def9255f464c741",
    "clubs": "aa57ab56e87faffaea1e8697439a32caf10116d8f2f2dfb3a57193c0bb1d641b",
    "appearances": "e096c2b158fc3d52c4550526c4d4850dd62f31007652f4bcae112eadb1646802",
}
CAPS = {"games": 16 * 1024 * 1024, "clubs": 1024 * 1024, "appearances": 64 * 1024 * 1024}
ORDER = ("games", "clubs", "appearances")
# Transfermarkt's league code -> the league's PitchAPI competition key in the base.
LEAGUES = {"GB1": "l_4WFCIZ", "ES1": "l_0ErfuF", "L1": "l_1Isor4", "IT1": "l_0ALvwF", "FR1": "l_3FJFUl"}
FIRST_SEASON, LAST_SEASON = 2012, 2020
SCOPE = "league_player_seasons"
COLUMNS = ("competition_id", "season_id", "player_key", "player_name", "club_key", "club_name",
           "matches", "minutes", "goals", "assists", "yellow_cards", "red_cards")
# The most one appearance can count (a match of 90 minutes and its extra time): above, the file is incoherent.
HIGH = {"minutes_played": 150, "goals": 20, "assists": 20, "yellow_cards": 3, "red_cards": 3}


def scopes(now):
    """One scope, looked at every week: it reads the files only when the base does not hold these pins, then links."""
    return {SCOPE: timedelta(days=7)}


def url(name):
    return URL.format(name=name)


def digest(pins):
    return hashlib.sha256("".join(f"{name}:{pins[name]}\n" for name in sorted(pins)).encode()).hexdigest()


def fetch(get, pins=None):
    """The files, each checked as it comes, smallest first: the first that differs stops the reading (SOURCE_CHANGED)."""
    pins = FILES if pins is None else pins
    files = {}
    for name in sorted(pins, key=lambda n: ORDER.index(n) if n in ORDER else len(ORDER)):
        body = get(url(name), as_bytes=True, max_bytes=CAPS.get(name, 8 * 1024 * 1024))
        if not isinstance(body, bytes) or hashlib.sha256(body).hexdigest() != pins[name]:
            raise SourceError("SOURCE_CHANGED")
        files[name] = body
    return files


# --- Values ------------------------------------------------------------------------------------------------------------

def _invalid():
    return SourceError("INVALID_SOURCE")


def _id(value):
    if not re.fullmatch(r"[0-9]{1,10}", value or ""):
        raise _invalid()
    return value


def _count(value, high):
    if not re.fullmatch(r"[0-9]{1,3}", value or "") or int(value) > high:
        raise _invalid()
    return int(value)


def _rows(body, required):
    """The file's rows as tuples, and the index of each required column; a file that is no gzip CSV, or lacks one of
    the columns, is INVALID_SOURCE. Streamed: the decompressed file is never held whole."""
    try:
        stream = io.TextIOWrapper(gzip.GzipFile(fileobj=io.BytesIO(body)), encoding="utf-8", newline="")
        reader = csv.reader(stream)
        header = next(reader)
        if not set(required) <= set(header):
            raise _invalid()
        index = {name: header.index(name) for name in required}
        width = len(header)
        for row in reader:
            if len(row) != width:
                raise _invalid()
            yield row, index
    except (OSError, EOFError, UnicodeDecodeError, csv.Error, StopIteration, zlib.error):
        raise _invalid() from None


def aggregate(files):
    """The rows of core.league_player_seasons (with the league's code in place of competition_id), from the files' bytes.
    A malformed value in a game or an appearance read raises INVALID_SOURCE."""
    games = {}
    for row, i in _rows(files["games"], ("game_id", "competition_id", "season", "home_club_id", "away_club_id")):
        code = row[i["competition_id"]]
        if code not in LEAGUES:
            continue
        if not re.fullmatch(r"[0-9]{4}", row[i["season"]]):
            raise _invalid()
        season = int(row[i["season"]])
        if not FIRST_SEASON <= season <= LAST_SEASON:
            continue
        game, home, away = _id(row[i["game_id"]]), _id(row[i["home_club_id"]]), _id(row[i["away_club_id"]])
        if game in games or home == away:
            raise _invalid()
        games[game] = (code, season, home, away)

    clubs = {}
    for row, i in _rows(files["clubs"], ("club_id", "name")):
        clubs[row[i["club_id"]]] = row[i["name"]].strip()

    totals = defaultdict(lambda: {"matches": 0, "minutes": 0, "goals": 0, "assists": 0, "yellow_cards": 0, "red_cards": 0,
                                  "day": "", "player_name": None})
    seen = set()
    needed = ("game_id", "player_id", "player_club_id", "date", "player_name", "competition_id", *HIGH)
    for row, i in _rows(files["appearances"], needed):
        found = games.get(row[i["game_id"]])
        if found is None:
            continue  # another competition's or season's game: not read
        code, season, home, away = found
        player, club = _id(row[i["player_id"]]), _id(row[i["player_club_id"]])
        name, day = row[i["player_name"]].strip(), row[i["date"]]
        if (row[i["competition_id"]] != code or club not in (home, away) or not name or not clubs.get(club)
                or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", day) or (row[i["game_id"]], player) in seen):
            raise _invalid()
        seen.add((row[i["game_id"]], player))
        total = totals[(code, season, player, club)]
        total["matches"] += 1
        total["minutes"] += _count(row[i["minutes_played"]], HIGH["minutes_played"])
        for column in ("goals", "assists", "yellow_cards", "red_cards"):
            total[column] += _count(row[i[column]], HIGH[column])
        if day >= total["day"]:
            total["day"], total["player_name"] = day, name  # the name of his latest appearance in the row
    return [{"code": code, "season_id": season, "player_key": player, "player_name": t["player_name"], "club_key": club,
             "club_name": clubs[club], **{c: t[c] for c in ("matches", "minutes", "goals", "assists", "yellow_cards", "red_cards")}}
            for (code, season, player, club), t in totals.items()]


# --- Writing -----------------------------------------------------------------------------------------------------------

def _competitions(conn):
    """{league code: the base's competition id}; a league the base does not hold stops the run (COMPETITION_UNKNOWN)."""
    found = dict(conn.execute(
        """SELECT provider_key, entity_id FROM core.provider_ids
           WHERE entity_type = 'competition' AND provider = 'pitchapi' AND is_current AND provider_key = ANY(%s)""",
        (list(LEAGUES.values()),)).fetchall())
    missing = sorted(code for code, key in LEAGUES.items() if key not in found)
    if missing:
        raise SourceError("COMPETITION_UNKNOWN", ", ".join(missing))
    return {code: found[key] for code, key in LEAGUES.items()}


def _replace(conn, rows, competitions):
    """The five leagues' rows of the nine seasons replaced by the ones read; the table's other rows stay."""
    conn.execute("DELETE FROM core.league_player_seasons WHERE competition_id = ANY(%s) AND season_id BETWEEN %s AND %s",
                 (list(competitions.values()), FIRST_SEASON, LAST_SEASON))
    with conn.cursor().copy(f"COPY core.league_player_seasons ({', '.join(COLUMNS)}) FROM STDIN") as copy:
        for row in rows:
            copy.write_row([competitions[row["code"]], *(row[c] for c in COLUMNS[1:])])
    return len(rows)


def _link(conn, competitions):
    """Each row's player and club as the Transfermarkt process links them now (current links only); the rows of the
    five leagues left without a player."""
    for column, kind, key in (("player_id", "player", "player_key"), ("team_id", "team", "club_key")):
        link = f"""p.entity_type = '{kind}' AND p.provider = 'transfermarkt' AND p.is_current AND p.provider_key = l.{key}"""
        conn.execute(f"""UPDATE core.league_player_seasons l SET {column} = p.entity_id FROM core.provider_ids p
                         WHERE {link} AND l.{column} IS DISTINCT FROM p.entity_id""")
        conn.execute(f"""UPDATE core.league_player_seasons l SET {column} = NULL
                         WHERE l.{column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM core.provider_ids p WHERE {link})""")
    return conn.execute(
        "SELECT count(*) FROM core.league_player_seasons WHERE player_id IS NULL AND competition_id = ANY(%s) AND season_id BETWEEN %s AND %s",
        (list(competitions.values()), FIRST_SEASON, LAST_SEASON)).fetchone()[0]


def _held(conn, pins):
    held = conn.execute("SELECT revision FROM core.source_revisions WHERE source = %s", (SOURCE,)).fetchone()
    return bool(held) and held[0] == digest(pins)[:16]


def prepare(conn, get, scope, now, *, pins=None):
    """The rows read, with no transaction open (sources.run_due), when the base does not hold these pins; else None.
    The appearances file is 45 MB: its download and its reading take longer than the 60 s the base allows a session
    idle in a transaction."""
    if scope != SCOPE:
        raise ValueError(scope)
    pins = FILES if pins is None else pins
    return None if _held(conn, pins) else aggregate(fetch(get, pins))


def run(conn, get, scope, now, *, pins=None, prepared=None):
    """(rows written, rows of the five leagues without a linked player). The files are read only when the base does
    not hold these pins (by prepare, before the transaction; here when called alone): a later run links again and
    reads nothing."""
    if scope != SCOPE:
        raise ValueError(scope)
    pins = FILES if pins is None else pins
    competitions = _competitions(conn)
    written = 0
    if not _held(conn, pins):
        rows = prepared if prepared is not None else aggregate(fetch(get, pins))
        written = _replace(conn, rows, competitions)
        full = digest(pins)
        conn.execute(
            """INSERT INTO core.source_revisions(source, name, url, license, revision, archive_sha256, coverage, retrieved_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (source) DO UPDATE SET name=EXCLUDED.name, url=EXCLUDED.url, license=EXCLUDED.license, revision=EXCLUDED.revision,
                 archive_sha256=EXCLUDED.archive_sha256, coverage=EXCLUDED.coverage, retrieved_at=EXCLUDED.retrieved_at""",
            (SOURCE, ATTRIBUTION["name"], ATTRIBUTION["url"], ATTRIBUTION["license"], full[:16], full, ATTRIBUTION["coverage"], now))
    return written, _link(conn, competitions)
