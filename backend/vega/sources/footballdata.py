"""football-data.co.uk's season files: what the base lacks of the league seasons it archives (2000/01 to 2020/21).

The archives give a league match of those seasons its day, its teams and its score (OpenFootball, footballcsv,
engsoccerdata). These files give, for the top division of the seven leagues the site follows first and their second
(third and fourth in England), the half-time score and, where the file has them, the match statistics (shots, shots
on target, woodwork, corners, fouls, offsides, cards; from 2000/01 in England, Spain, Germany, Italy and France, from
2017/18 in Portugal and the Netherlands), the referee (England) and bookmakers' 1X2 prices (Bet365, Pinnacle and
their closing prices, the market's average and maximum). The user chose this source on 19 November 2026, told that
the site asks for private use, not automated or commercial use; its credit and its terms are a row of
core.source_revisions (SOURCE).

What is read: one file per division and season (FILES, in data/football-data-files.json), each checked against its
SHA-256: a file that differs, or is missing, stops the reading, nothing is written. 2021/22 and later are PitchAPI's.
Typed rows only, in core.footballdata_matches, keyed by the file and the row; a club name is the file's own, never a
team of the base. The one link is a match's: footballdata_matches.match_id, the archived match of the same country
and season between the teams the row's names stand for (pair). Nothing is written to core.matches or to the base's
statistics.
"""

import csv
import hashlib
import io
import json
import re
from collections import Counter, defaultdict
from datetime import date, time, timedelta
from pathlib import Path

from . import SourceError

SOURCE = "football-data-co-uk"
SITE = "https://www.football-data.co.uk"
# The host the files are served from: www. redirects there, and the source client follows no redirect off its host.
URL = "https://football-data.co.uk/mmz4281/{code}/{division}.csv"
ATTRIBUTION = {
    "name": "Football-Data",
    "url": SITE,
    "license": "No licence named. The site's terms: free data, « intended for private individuals only, NOT commercial or data "
               "training products using automated bots/scrapers/AI », « for the purposes of league match prediction only ».",
    "coverage": "League seasons 2000/01–2020/21, top division of England, Spain, Germany, Italy, France, Portugal and the "
                "Netherlands and the second (England: second to fourth): half-time scores, match statistics where given, "
                "referees (England), 1X2 prices. Modified: values typed, each match paired with the archived match of the Vega base.",
}
# A division: its country as the archives name it (competition_seasons.archive_country) and its level.
DIVISIONS = {
    "E0": ("Angleterre", 1), "E1": ("Angleterre", 2), "E2": ("Angleterre", 3), "E3": ("Angleterre", 4),
    "SP1": ("Espagne", 1), "SP2": ("Espagne", 2), "D1": ("Allemagne", 1), "D2": ("Allemagne", 2),
    "I1": ("Italie", 1), "I2": ("Italie", 2), "F1": ("France", 1), "F2": ("France", 2),
    "P1": ("Portugal", 1), "N1": ("Pays-Bas", 1),
}
FIRST_SEASON, LAST_SEASON = 2000, 2020
# The files read, each as served on 19 November 2026 (SHA-256 of its bytes): {"E0/1011": digest}.
FILES = json.loads((Path(__file__).resolve().parent / "data" / "football-data-files.json").read_text())
SCOPE = "history"
# A name stands for a team found on its side among the same-score archived matches of a day apart in at least
# MIN_VOTES of its rows and MIN_SHARE of them (measured on the real files, 19 November 2026: see docs/FOOTBALL_DATA.md).
MIN_VOTES = 3
MIN_SHARE = 0.5
# A row and its archived match are at most this many days apart (a postponed match the archive dates otherwise).
WINDOW = 3


def scopes(now):
    """One scope, looked at every week: it reads the files only when the base does not hold them, then pairs."""
    return {SCOPE: timedelta(days=7)}


def url(key):
    division, code = key.split("/")
    return URL.format(code=code, division=division)


def _season(code):
    """'1011' -> 2010."""
    return 2000 + int(code[:2]) if int(code[:2]) < 90 else 1900 + int(code[:2])


def verify(files, pins=None):
    """The digest of the files read, each being the pinned one; a missing or different file stops the reading."""
    pins = FILES if pins is None else pins
    for key, pin in pins.items():
        body = files.get(key)
        if not isinstance(body, bytes) or hashlib.sha256(body).hexdigest() != pin:
            raise SourceError("SOURCE_CHANGED")
    return _digest(pins)


# --- Values ----------------------------------------------------------------------------------------------------------

def _invalid():
    return SourceError("INVALID_SOURCE")


def _text(body):
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        text = body.decode("latin-1")
    return text.removeprefix("﻿")


def _goals(value):
    """A score the file gives, else None; a score that is no number makes the file incoherent."""
    value = (value or "").strip()
    if value == "":
        return None
    if not re.fullmatch(r"\d{1,2}", value) or int(value) > 20:
        raise _invalid()
    return int(value)


def _count(value, high):
    """A statistic the file gives, else None. One it mistypes (« NA », 145 fouls, 9 red cards: 4 of the 294 files) is
    absent: the row stands on its score."""
    value = (value or "").strip()
    return int(value) if re.fullmatch(r"\d{1,6}", value) and int(value) <= high else None


def _price(value):
    try:
        number = float((value or "").strip())
    except ValueError:
        return None
    return number if 1 < number < 1000 else None


def _prices(row, *names):
    """The first of the columns' (home, draw, away) prices the row gives whole, else three Nones."""
    for prefix in names:
        found = [_price(row.get(prefix + side)) for side in ("H", "D", "A")]
        if all(found):
            return found
    return [None, None, None]


def _day(value, season):
    found = re.fullmatch(r"(\d{2})/(\d{2})/(\d{2}|\d{4})", (value or "").strip())
    if not found:
        raise _invalid()
    year = int(found[3]) + (2000 if len(found[3]) == 2 else 0)
    try:
        day = date(year, int(found[2]), int(found[1]))
    except ValueError:
        raise _invalid() from None
    if not date(season, 7, 1) <= day <= date(season + 1, 8, 31):
        raise _invalid()
    return day


def _clock(value):
    found = re.fullmatch(r"(\d{2}):(\d{2})", (value or "").strip())
    if not found:
        return None
    if int(found[1]) > 23 or int(found[2]) > 59:
        raise _invalid()
    return time(int(found[1]), int(found[2]))


# Per side: our column -> the file's home and away columns.
STATS = {"shots": ("HS", "AS", 80), "shots_on_target": ("HST", "AST", 60), "woodwork": ("HHW", "AHW", 20), "corners": ("HC", "AC", 40),
         "fouls": ("HF", "AF", 60), "free_kicks_conceded": ("HFKC", "AFKC", 60), "offsides": ("HO", "AO", 40),
         "yellow_cards": ("HY", "AY", 15), "red_cards": ("HR", "AR", 5), "booking_points": ("HBP", "ABP", 200)}
# Our odds -> the file's column prefixes, the first a row gives whole wins (Oddsportal's market since 2019/20, Betbrain's before).
ODDS = {"b365": ("B365",), "b365_closing": ("B365C",), "pinnacle": ("PS",), "pinnacle_closing": ("PSC",),
        "market_average": ("Avg", "BbAv"), "market_maximum": ("Max", "BbMx")}
COLUMNS = ("file_key", "row_number", "division", "season_id", "match_date", "kickoff_time", "home_name", "away_name",
           "home_goals", "away_goals", "ht_home_goals", "ht_away_goals", "referee", "attendance",
           *(f"{side}_{stat}" for stat in STATS for side in ("home", "away")),
           *(f"{odd}_{side}" for odd in ODDS for side in ("home", "draw", "away")))


def typed(files):
    """The rows of every file, typed; an incoherent file raises INVALID_SOURCE."""
    out = []
    for key in sorted(files):
        division, code = key.split("/")
        if division not in DIVISIONS:
            raise _invalid()
        season = _season(code)
        lines = list(csv.reader(io.StringIO(_text(files[key]))))
        if not lines:
            raise _invalid()
        header = [name.strip() for name in lines[0]]
        while header and header[-1] == "":
            header.pop()
        if header[:2] != ["Div", "Date"]:
            raise _invalid()
        seen = set()
        for number, values in enumerate(lines[1:], 2):
            if not any(value.strip() for value in values):
                continue
            row = dict(zip(header, values))  # the values past the header are not read
            home, away = (row.get("HomeTeam") or row.get("HT") or "").strip(), (row.get("AwayTeam") or row.get("AT") or "").strip()
            if row.get("Div", "").strip() != division or not home or not away or home == away:
                raise _invalid()
            day = _day(row.get("Date"), season)
            if (home, away) in seen:
                raise _invalid()
            seen.add((home, away))
            goals = [_goals(row.get(c)) for c in ("FTHG", "FTAG", "HTHG", "HTAG")]
            if goals[0] is None or goals[1] is None:
                raise _invalid()
            if goals[2] is None or goals[3] is None or goals[2] > goals[0] or goals[3] > goals[1]:
                goals[2] = goals[3] = None  # one half alone, or a half-time score above the final one, is no score
            item = {"file_key": key, "row_number": number, "division": division, "season_id": season, "match_date": day,
                    "kickoff_time": _clock(row.get("Time")), "home_name": home, "away_name": away,
                    "home_goals": goals[0], "away_goals": goals[1], "ht_home_goals": goals[2], "ht_away_goals": goals[3],
                    "referee": (row.get("Referee") or "").strip() or None, "attendance": _count(row.get("Attendance"), 200000)}
            for stat, (h, a, high) in STATS.items():
                item[f"home_{stat}"], item[f"away_{stat}"] = _count(row.get(h), high), _count(row.get(a), high)
            for odd, prefixes in ODDS.items():
                item[f"{odd}_home"], item[f"{odd}_draw"], item[f"{odd}_away"] = _prices(row, *prefixes)
            out.append(item)
    return out


# --- The link to the base's matches ----------------------------------------------------------------------------------

def pair(source, base):
    """{row key: the base's match id}. `source`: (row key, season, country, day, home name, away name, home goals,
    away goals); `base`: (match id, season, country, day, home team, away team, home goals, away goals), the
    archived matches of those countries and seasons.

    Per country and season, a name stands for the team found on its side among the archived matches of the same
    score, a day apart at most, in the most of its rows: at least MIN_VOTES rows and MIN_SHARE of them, and more
    than any other team; a team is one name's, the one with the most votes. A row then pairs with the one archived
    match between its two teams, home and away as written, within WINDOW days; two such matches, or one paired with
    two rows: no pair."""
    groups = defaultdict(lambda: ([], []))
    for row in source:
        groups[(row[1], row[2])][0].append(row)
    for match in base:
        if (match[1], match[2]) in groups:
            groups[(match[1], match[2])][1].append(match)
    out = {}
    for rows, matches in groups.values():
        by_score = defaultdict(list)
        by_teams = defaultdict(list)
        for match in matches:
            by_score[(match[6], match[7])].append(match)
            by_teams[(match[4], match[5])].append(match)
        # A name's votes: in how many of its rows each team is on its side among the matches of the same score a day
        # apart at most. Its own team is in nearly all of them; another, on a Saturday of four divisions and the cups
        # with the same score, in a few.
        votes, played = defaultdict(Counter), Counter()
        for key, _, _, day, home, away, hg, ag in rows:
            near = [m for m in by_score[(hg, ag)] if abs((m[3] - day).days) <= 1]
            played[home] += 1
            played[away] += 1
            for name, side in ((home, 4), (away, 5)):
                for team in {m[side] for m in near}:
                    votes[name][team] += 1
        named = {}
        for name, counted in votes.items():
            ranked = sorted(counted.values(), reverse=True)
            team, n = max(counted.items(), key=lambda item: item[1])
            # Two teams with as many votes: the name stands for neither.
            if n >= MIN_VOTES and n >= MIN_SHARE * played[name] and (len(ranked) == 1 or ranked[1] < n):
                named[name] = (team, n)
        best = {}
        for name, (team, n) in named.items():
            if team not in best or best[team][1] < n:
                best[team] = (name, n)
            elif best[team][1] == n:
                best[team] = (None, n)  # two names as strong: the team is neither's
        team_of = {name: team for name, (team, n) in named.items() if best[team][0] == name}
        found, used = {}, Counter()
        for key, _, _, day, home, away, *_ in rows:
            if home in team_of and away in team_of:
                near = [m for m in by_teams[(team_of[home], team_of[away])] if abs((m[3] - day).days) <= WINDOW]
                if len(near) == 1:
                    found[key] = near[0][0]
                    used[near[0][0]] += 1
        out.update({key: match for key, match in found.items() if used[match] == 1})
    return out


# --- Writing ---------------------------------------------------------------------------------------------------------

def _replace(conn, rows):
    conn.execute("DELETE FROM core.footballdata_matches")
    with conn.cursor().copy(f"COPY core.footballdata_matches ({', '.join(COLUMNS)}) FROM STDIN") as copy:
        for row in rows:
            copy.write_row([row[column] for column in COLUMNS])
    return len(rows)


def _link(conn):
    """Pair every row again (a name's team is read from all its season's rows); the rows left without a pair."""
    countries = {code: country for code, (country, _) in DIVISIONS.items()}
    source = [(f"{key}:{number}", season, countries[division], day, home, away, hg, ag) for key, number, division, season, day, home, away, hg, ag in conn.execute(
        """SELECT file_key, row_number, division, season_id, match_date, home_name, away_name, home_goals, away_goals
           FROM core.footballdata_matches""").fetchall()]
    if not source:
        return 0
    base = conn.execute(
        """SELECT m.id, m.season_id, cs.archive_country, m.match_date, m.home_team_id, m.away_team_id, m.home_score, m.away_score
           FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.season_id = m.season_id
           WHERE m.archive_key IS NOT NULL AND m.season_id BETWEEN %s AND %s AND cs.archive_country = ANY(%s)
             AND m.match_date IS NOT NULL AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
             AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL""",
        (FIRST_SEASON, LAST_SEASON, sorted(set(countries.values())))).fetchall()
    pairs = pair(source, base)
    stored = {f"{key}:{number}": match for key, number, match in conn.execute(
        "SELECT file_key, row_number, match_id FROM core.footballdata_matches WHERE match_id IS NOT NULL").fetchall()}
    changed = [key for key in set(stored) | set(pairs) if stored.get(key) != pairs.get(key)]
    if changed:
        # Clear first: a match moves from one row to another without meeting itself (match_id is unique).
        conn.execute("""UPDATE core.footballdata_matches SET match_id = NULL
                        WHERE file_key || ':' || row_number = ANY(%s) AND match_id IS NOT NULL""", ([k for k in changed if k in stored],))
        with conn.cursor() as cursor:
            cursor.executemany("UPDATE core.footballdata_matches SET match_id = %s WHERE file_key = %s AND row_number = %s",
                               [(pairs[k], *_split(k)) for k in changed if k in pairs])
    return len(source) - len(pairs)


def _split(key):
    file_key, number = key.rsplit(":", 1)
    return file_key, int(number)


def _digest(pins):
    return hashlib.sha256("".join(f"{key}:{pins[key]}\n" for key in sorted(pins)).encode()).hexdigest()


def _fetch(get, pins):
    """The files, each checked as it comes: the first that differs stops the reading (SOURCE_CHANGED)."""
    files = {}
    for key in sorted(pins):
        body = get(url(key), as_bytes=True)
        if not isinstance(body, bytes) or hashlib.sha256(body).hexdigest() != pins[key]:
            raise SourceError("SOURCE_CHANGED")
        files[key] = body
    return files


def prepare(conn, get, scope, now, *, pins=None):
    """The files, read with no transaction open (sources.run_due), when the base does not hold these pins; else None.
    At the client's interval the 294 files take 150 s or more, and the base ends a session idle in a transaction
    for 60 s."""
    if scope != SCOPE:
        raise ValueError(scope)
    pins = FILES if pins is None else pins
    held = conn.execute("SELECT revision FROM core.source_revisions WHERE source = %s", (SOURCE,)).fetchone()
    return None if held and held[0] == _digest(pins)[:16] else _fetch(get, pins)


def run(conn, get, scope, now, *, pins=None, prepared=None):
    """(rows written, rows without an archived match). The files are read only when the base does not hold these
    pins (by prepare, before the transaction; here when called alone): a later run pairs again and reads nothing."""
    if scope != SCOPE:
        raise ValueError(scope)
    pins = FILES if pins is None else pins
    digest = _digest(pins)
    held = conn.execute("SELECT revision FROM core.source_revisions WHERE source = %s", (SOURCE,)).fetchone()
    written = 0
    if not held or held[0] != digest[:16]:
        files = prepared if prepared is not None else _fetch(get, pins)
        verify(files, pins)
        written = _replace(conn, typed(files))
        conn.execute(
            """INSERT INTO core.source_revisions(source, name, url, license, revision, archive_sha256, coverage, retrieved_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (source) DO UPDATE SET name=EXCLUDED.name, url=EXCLUDED.url, license=EXCLUDED.license, revision=EXCLUDED.revision,
                 archive_sha256=EXCLUDED.archive_sha256, coverage=EXCLUDED.coverage, retrieved_at=EXCLUDED.retrieved_at""",
            (SOURCE, ATTRIBUTION["name"], ATTRIBUTION["url"], ATTRIBUTION["license"], digest[:16], digest, ATTRIBUTION["coverage"], now))
    return written, _link(conn)
