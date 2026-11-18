"""Official league tables of SportScore (sportscore.com widget), as main's
/api/standings source (frontend/src/services/sportscore-standings.js).

SportScore gives the current table of a competition, without a season, and names without ids.
A response replaces the current edition's official table only when it is a whole table of that
edition (docs/calculs/09-audit-2026-11/FAILURE_MODES_SPORTSCORE.md §2): every row valid, every name
designating one team of the edition, no club repeated, no position shared between clubs of
different points, the edition's own results consistent with it (every club with a counted result
there, and organiser corroboration if every club is ahead of the matches kicked off), every club
and every table of the accepted observation still there with what was known of it (a single table
may split exhaustively, and explicit retirement is reviewed in RETIRED_TABLES), every table's
clubs too (a group keeps its clubs; a ranking across groups may change members but never shrinks,
unless a row is reviewed out in RETIRED_ROWS), and no club's played count going down unless the
results attest it. Anything else is refused with its code: the scope fails (sources.run_due), the accepted
table keeps its rows and its date, and the scope is tried again at the content or transport cadence. A name of a club
of the previous or next edition is wrong-season evidence (WRONG_EDITION); a name nothing
designates is missing evidence (UNMATCHED_TEAMS). No row is ever given to a team by elimination.
The first table also needs the league roster or positive evidence of the native group phase.
The writer reads and replaces SportScore's rows without a stage only (OWN).

Each accepted row keeps its basis: the club's results Vega counted when it was observed
(core.table_results, migration 138). api.standings serves SportScore's table, and no other
provider's, until the current results supersede it and a current, adequately covered
Vega table is ready (migration 150). A valid repeat advances the observation time when
the table still qualifies, including a fresh organiser proof for a short Swedish calendar.
"""

from collections import Counter, defaultdict
from datetime import timedelta
import json
import re
import unicodedata
from functools import partial
from urllib.parse import urlencode

from ..models import _is_league
from . import SourceError, lock_scope, normalize

URL = "https://sportscore.com/api/widget/standings/"
PERIOD = timedelta(hours=2)
ATOMIC_RUN_STATUS = True

# dashboard/frontend/src/services/sportscore-standings.js (main); a drift test compares them.
LEAGUES = {
    "l_0275VP": "french-ligue-2",
    "l_0aEfof": "united-arab-emirates-adnoc-pro-league",
    "l_0ahLw8": "english-football-league-one",
    "l_0ALvwF": "italian-serie-a",
    "l_0bfbkO": "uefa-champions-league",
    "l_0eg6C9": "united-states-major-league-soccer",
    "l_0ErfuF": "spanish-la-liga",
    "l_0F4I4F": "czech-chance-liga",
    "l_0jy5yE": "italian-serie-b",
    "l_0kSJLz": "romanian-super-liga",
    "l_0Lpz1f": "saudi-professional-league",
    "l_0S1uaf": "turkish-super-league",
    "l_0uqFK8": "norwegian-eliteserien",
    "l_16Sq13": "israel-premier-league",
    "l_1BFfna": "turkish-first-league",
    "l_1D8Xrl": "brazilian-serie-a",
    "l_1dmt9H": "ligapro-serie-a",
    "l_1eJSA7": "ireland-premier-division",
    "l_1Isor4": "bundesliga",
    "l_1LMdEO": "scottish-premiership",
    "l_1pQOHK": "belgian-challenger-pro-league",
    "l_1TTHxD": "iceland-besta-deild-karla",
    "l_1W6idJ": "english-football-league-two",
    "l_1XLtP0": "fifa-world-cup",
    "l_1xXulJ": "categoria-primera-a",
    "l_214sqK": "pko-bank-polski-ekstraklasa",
    "l_2L6d1F": "belgian-pro-league",
    "l_2Mh0jT": "russian-premier-league",
    "l_2tFk9k": "croatian-football-league",
    "l_2WZ2tt": "uefa-europa-conference-league",
    "l_2xBPKk": "serbian-mozzart-bet-superliga",
    "l_38d9HA": "uefa-europa-league",
    "l_3Ci5Cg": "finnish-veikkausliiga",
    "l_3FJFUl": "french-ligue-1",
    "l_3hvsne": "german-bundesliga-2",
    "l_3kyHLd": "spanish-segunda-division",
    "l_3qUkB8": "brazilian-serie-b",
    "l_3UiOcj": "canadian-premier-league",
    "l_3v84VE": "mexico-liga-mx",
    "l_3wr44B": "qatar-stars-league",
    "l_3xwVF2": "greek-super-league",
    "l_3yVUAO": "usl-championship",
    "l_3zsMpo": "austrian-bundesliga",
    "l_45VZuL": "argentine-division-1",
    "l_47077Y": "german-3liga",
    "l_49KZaB": "netherlands-eerste-divisie",
    "l_49Zmno": "danish-superliga",
    "l_4auCPk": "switzerland-challenge-league",
    "l_4d6Bwl": "switzerland-super-league",
    "l_4DWyTT": "english-football-league-championship",
    "l_4H43wr": "netherlands-eredivisie",
    "l_4MPd7x": "australia-a-league",
    "l_4MU9Yh": "slovak-nike-liga",
    "l_4QexZg": "portuguese-primera-liga",
    "l_4V6jPs": "brazilian-campeonato-paulista-a1",
    "l_4WFCIZ": "english-premier-league",
}

# Tables of an accepted observation that a later response may leave out (§2.1, rule 13b), written
# here once reviewed: {(LEAGUES key, season label, table name): "reviewer, date: reason"}. Without an
# entry, a table that disappears while the edition's other tables remain refuses the response, even
# when its clubs all appear elsewhere (the World Cup's ranking of third-placed teams). The pattern of
# snapshot.RETRACTIONS.
RETIRED_TABLES = {}
# Rows a later response may leave out of a table that stays (§2.1, rule 13c), once reviewed:
# {(LEAGUES key, season label, table name, the club's public id): "reviewer, date: reason"}. An
# entry lets that club leave that table of that edition, and nothing else. A refusal's detail names
# the key to review.
RETIRED_ROWS = {}
# A widget answer larger than this is not a league table (it was cut silently before).
MAX_TABLES, MAX_ROWS = 30, 100
# Stored column -> widget key. A row without its rank, matches or points is no standings row;
# the other numbers may be unknown, until they have been known once (MISSING_FIELD).
FIELDS = {"position": "pos", "played": "p", "won": "w", "drawn": "d", "lost": "l",
          "goals_for": "gf", "goals_against": "ga", "points": "pts"}
REQUIRED = ("position", "played", "points")
COLUMNS = ("group_name", "team_id", *FIELDS)
# The writer's own rows of an edition: SportScore's, without a stage (it writes none). Rows of
# another provider or of a stage are neither read, replaced nor dated here (§2.2).
OWN = "competition_season_id = %s AND source = 'sportscore' AND stage IS NULL"
# The counts of a row, never negative; in core.table_results' order, the basis: what Vega counted
# of a club when its row was observed.
RESULTS = ("played", "won", "drawn", "lost", "goals_for", "goals_against")
OUTCOMES = ("won", "drawn", "lost")
NO_RESULT = (0,) * len(RESULTS)
# Not every club can be this far ahead of the matches the edition has kicked off for it: last
# season's final table seen at the next season's start is about thirty ahead, and four leaves
# room for fixtures our calendar lacks (§2.1, rule 11).
SLACK = 4
# The Allsvenskan site uses this season-specific table. Its recent form identifies the
# competition and edition. Read it only when the Swedish primary calendar is too short.
ALLSVENSKAN = "l_1XsMdH"
ALLSVENSKAN_URL = "https://gql.sportomedia.se/graphql"
ALLSVENSKAN_QUERY = """query VerifySeason($year: Int!) {
  standingsForLeague(configLeagueName: "allsvenskan", configSeasonStartYear: $year, type: "total") {
    standings { teamName teamId stats { name value } form { configLeagueName configSeasonStartYear } }
  }
}"""
ALLSVENSKAN_FIELDS = ("gp", "w", "t", "l", "gf", "ga")
# The organiser calls IF Brommapojkarna "BP". Bind that abbreviation to its organiser ID.
ALLSVENSKAN_BP = 25591
PROOF_TTL = PERIOD + timedelta(minutes=5)
_allsvenskan_proof = None
# Captured native schedules of the 2026/27 league phases. Other editions need their own evidence.
UEFA_LEAGUE_PHASES = {"l_0bfbkO": 8, "l_38d9HA": 8, "l_2WZ2tt": 6}
UEFA_LEAGUE_SEASON = "2026/2027"
CONTENT_REFUSALS = frozenset({
    "UNEXPECTED_RESPONSE", "INVALID_ROW", "EMPTY_TABLE", "DUPLICATE_GROUP", "DUPLICATE_POSITION",
    "DUPLICATE_ROW", "WRONG_EDITION", "UNMATCHED_TEAMS", "UNVERIFIED_EDITION", "INCOMPLETE_TABLE",
    "UNVERIFIED_TABLE", "MISSING_FIELD", "PLAYED_DECREASED",
})
# The matches of rounds Vega's table counts that the edition has kicked off by an instant, per club.
KICKED_OFF = """SELECT x.team_id, count(*) FROM core.matches m LEFT JOIN core.rounds r ON r.id = m.round_id
  CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) AS x(team_id)
  WHERE m.competition_season_id = %s AND m.kickoff_at <= %s AND m.status <> 'canceled' AND x.team_id IS NOT NULL
    AND coalesce(r.stage, 'regular') IN ('regular', 'group')
  GROUP BY x.team_id"""
# A row stored before 138 has no basis: it is behind once a counted match finished after it.
# api.standings applies the same rule to such rows.
FINISHED_SINCE = """SELECT EXISTS (
  SELECT 1 FROM core.matches m LEFT JOIN core.rounds r ON r.id = m.round_id
  WHERE m.competition_season_id = %s AND m.first_finished_at > %s AND m.status = 'finished'
    AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND coalesce(r.stage, 'regular') IN ('regular', 'group'))"""


def scopes(now):
    return {f"standings:{key}": PERIOD for key in LEAGUES}


def retry_after(code, period, transient):
    return period if code in CONTENT_REFUSALS else min(period, transient)


def _number(row, key, where):
    """A widget number: None when absent, an int when it is one (an integral float too)."""
    value = row.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or (isinstance(value, float) and not value.is_integer()):
        raise SourceError("INVALID_ROW", f"{where}: {key}={value!r}")
    return int(value)


def parse(payload, slug):
    """[(group name or None, [row dict])] of a widget response, its empty tables left out;
    SourceError when it is not one: every row named, ranked, with its matches and points."""
    if not isinstance(payload, dict) or payload.get("sport") != "football" or payload.get("competition_slug") != slug \
            or not isinstance(payload.get("tables"), list):
        raise SourceError("UNEXPECTED_RESPONSE")
    if len(payload["tables"]) > MAX_TABLES:
        raise SourceError("INVALID_ROW", f"{len(payload['tables'])} tables")
    tables = []
    for number, table in enumerate(payload["tables"], 1):
        raw = table.get("rows") if isinstance(table, dict) else None
        if not isinstance(table, dict) or not isinstance(raw if raw is not None else [], list):
            raise SourceError("INVALID_ROW", f"table {number} is not a table")
        if len(raw or []) > MAX_ROWS:
            raise SourceError("INVALID_ROW", f"table {number}: {len(raw)} rows")
        rows = []
        for place, row in enumerate(raw or [], 1):
            where = f"table {number} row {place}"
            if not isinstance(row, dict) or not isinstance(row.get("team"), str) or not normalize(row["team"]):
                raise SourceError("INVALID_ROW", f"{where}: no team")
            parsed = {"name": row["team"].strip(), **{field: _number(row, key, where) for field, key in FIELDS.items()}}
            unknown = [FIELDS[f] for f in REQUIRED if parsed[f] is None]
            if unknown or parsed["position"] < 1 or any(parsed[f] is not None and parsed[f] < 0 for f in RESULTS):
                raise SourceError("INVALID_ROW", f"{where} ({parsed['name']}): " + (f"no {', '.join(unknown)}" if unknown else "negative value"))
            rows.append(parsed)
        if rows:
            group = table.get("group").strip() if isinstance(table.get("group"), str) else ""
            tables.append((group or None, rows))
    return tables


def check(tables):
    """The response's own coherence, before any name is read (§2.1); SourceError otherwise."""
    if not tables:
        raise SourceError("EMPTY_TABLE", "no row")
    groups = [group for group, _ in tables]
    if len(tables) > 1 and len(set(groups)) != len(groups):
        raise SourceError("DUPLICATE_GROUP", "two tables named " + repr(next(g for g in groups if groups.count(g) > 1)))
    for group, rows in tables:
        label = group or "the table"
        seen, ranks = set(), {}
        for row in rows:
            outcomes = [row[field] for field in OUTCOMES if row[field] is not None]
            total = sum(outcomes)
            if total > row["played"] or (len(outcomes) == len(OUTCOMES) and total != row["played"]):
                raise SourceError("INVALID_ROW", f"{label}: {row['name']}: {total} reported results for {row['played']} matches")
            key = normalize(row["name"])
            if key in seen:
                raise SourceError("DUPLICATE_ROW", f"{row['name']} twice in {label}")
            seen.add(key)
            ranks.setdefault(row["position"], []).append(row)
        # Clubs sharing a rank have equal points: the one invariant of every ranking; no
        # tie-break order (difference, goals, head to head) is assumed.
        for position, tied in ranks.items():
            if len({r["points"] for r in tied}) > 1:
                raise SourceError("DUPLICATE_POSITION",
                                  f"position {position} of {label}: {', '.join(r['name'] for r in tied)}, with different points")
        # Tables of a split may continue one numbering (7-12): a single table holds all its ranks.
        if len(tables) == 1 and max(ranks) > len(rows):
            raise SourceError("INCOMPLETE_TABLE", f"position {max(ranks)} in a table of {len(rows)} rows")


# Pairs confirmed by the clubs or organisers, bound to the current PitchAPI identity
# and its canonical name. "B" and "U23" do not imply equivalence for other clubs.
REVIEWED_SPELLINGS = {
    # https://www.kaagent.be/nl/nieuws/07-08-2025/jong-kaa-gent-begint-aan-competitie
    # https://sportscore.com/football/team/gent-b/k82rekh3o61repz/
    ("t_1ekXAt", "gentu23"): ("Gent B",),
    # https://www.krcgenk.be/nl/nieuws/5167/maandag-eerste-training-jong-genk
    ("t_48QCy0", "genku23"): ("Jong Genk",),
    # https://rccelta.es/app/uploads/2024/10/RCCelta_CCAA_T23-24_definitiva.pdf
    ("t_4YXkkv", "celtafortuna"): ("Celta Vigo B",),
    # https://liga1.pe/bienvenidos-alianza-udh-y-juan-pablo-ii/
    ("t_1XzLP9", "juanpabloiicollege"): ("Juan Pablo II",),
}
BRANDED_RESERVES = {"celtafortuna": "reserve-b"}
AGE_GROUP = re.compile(r"\b(?:u(?:nder)?|sub)[ -]*(\d{1,2})s?\b")
SIDE_SUFFIXES = {"b": "reserve-b", "ii": "reserve-b", "c": "reserve-c", "iii": "reserve-c", "iv": "reserve-d",
                 "reserves": "reserve-b", "reserve": "reserve-b", "reserva": "reserve-b", "amateure": "reserve-b",
                 "youth": "youth", "academy": "academy", "juvenil": "youth", "primavera": "primavera"}
CLUB_SUFFIXES = frozenset({"fc", "cf", "sc", "ac", "afc", "fk", "sk", "sv"})
WOMEN_MARKER = r"\b(?:women(?:'?s)?|ladies|feminin[aeo]?s?|femenin[ao]s?|femminil[ei]|frauen|fem|dames)\b|\(\s*[wf]\s*\)|\[\s*[wf]\s*\]"
MEN_MARKER = r"\b(?:men(?:'?s)?|herren|masculin[aeo]?s?|hommes)\b|\(\s*m\s*\)|\[\s*m\s*\]"
SEX_MARKERS = re.compile(f"(?P<women>{WOMEN_MARKER})|(?P<men>{MEN_MARKER})")
AMBIGUOUS_WFC = re.compile(r"\bw\.?f\.?c\b", re.IGNORECASE)


def _ascii(name):
    return unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()


def _gender_text(name):
    words = re.sub(r"(?<=[a-z])(?=(?:Women|Men|Ladies)\b)", " ", name or "")
    return _ascii(re.sub(r"\bmänner\b", " men ", words, flags=re.IGNORECASE))


def _gender(name):
    markers = {token.lastgroup for token in SEX_MARKERS.finditer(_gender_text(name))}
    if markers:
        return markers.pop() if len(markers) == 1 else "ambiguous"


def _squad(name):
    # Classify affirmative squad markers. An initial letter or a club's founding year is
    # part of its name, while a separate final B/II or an age group identifies a side.
    separate = re.sub(r"(?<=[a-z])(?=(?:III?|U-?\d+|[BC])\b)", " ", name)
    plain = SEX_MARKERS.sub(" ", _gender_text(separate))
    branded = BRANDED_RESERVES.get(normalize(name))
    if branded:
        return branded
    age = AGE_GROUP.search(plain)
    if age:
        return "u" + age[1]
    plain = re.sub(r"\b(?:[a-z]\.)+[a-z]\.?", lambda form: form[0].replace(".", ""), plain)
    words = re.findall(r"[a-z0-9]+", plain)
    while len(words) > 1 and words[-1] in CLUB_SUFFIXES:
        words.pop()
    if len(words) > 1:
        if words[0] == "jong":
            return "reserve-b"
        return SIDE_SUFFIXES.get(words[-1])


def _spellings(conn, query, args, gender):
    names, spelled, squads, rejected = {}, {}, {}, set()
    for team, canonical, short, alias, provider_key in conn.execute(query, args).fetchall():
        if _gender(canonical) not in (None, gender):
            rejected.update(normalize(s) for s in (canonical, short, alias) if s)
            continue
        squad = squads.setdefault(team, _squad(canonical))
        reviewed = REVIEWED_SPELLINGS.get((provider_key, normalize(canonical)), ())
        reviewed_keys = {normalize(name) for name in reviewed}
        official = {normalize(canonical), normalize(short)} | reviewed_keys
        for spelling in (canonical, short, alias, *reviewed):
            if not spelling:
                continue
            key = normalize(spelling)
            # WFC may be a club's initials or a women's section. In a men's edition an
            # occurrence must already be evidenced by the canonical name or a reviewed spelling.
            ambiguous = gender == "men" and AMBIGUOUS_WFC.search(spelling) and key not in official
            if not ambiguous and _gender(spelling) in (None, gender) and (_squad(spelling) == squad or key in reviewed_keys):
                names.setdefault(team, set()).add(key)
                spelled.setdefault(team, set()).add(spelling)
            else:
                rejected.add(key)
    return names, spelled, squads, rejected


def _edition_teams(conn, edition, gender="men"):
    return _spellings(conn, """SELECT t.id, t.name, t.short_name, n.name, p.provider_key
           FROM core.team_seasons ts JOIN core.teams t ON t.id = ts.team_id
           LEFT JOIN core.entity_names n ON n.entity_type = 'team' AND n.entity_id = t.id
           LEFT JOIN core.provider_ids p ON p.entity_type='team' AND p.provider='pitchapi' AND p.entity_id=t.id AND p.is_current
           WHERE ts.competition_season_id = %s""", (edition,), gender)


def _neighbour_teams(conn, edition, gender):
    """The teams of the competition's previous and next editions that this edition does not hold:
    a row naming one of them is another season's table."""
    names, _, _, _ = _spellings(conn, """SELECT t.id, t.name, t.short_name, n.name, p.provider_key
           FROM core.competition_seasons e
           JOIN core.competition_seasons o ON o.competition_id = e.competition_id AND o.season_id IN (e.season_id - 1, e.season_id + 1)
           JOIN core.team_seasons ts ON ts.competition_season_id = o.id
           JOIN core.teams t ON t.id = ts.team_id
           LEFT JOIN core.entity_names n ON n.entity_type = 'team' AND n.entity_id = t.id
           LEFT JOIN core.provider_ids p ON p.entity_type='team' AND p.provider='pitchapi' AND p.entity_id=t.id AND p.is_current
           WHERE e.id = %s AND NOT EXISTS (SELECT 1 FROM core.team_seasons x WHERE x.competition_season_id = e.id AND x.team_id = t.id)""",
                          (edition,), gender)
    return names


# Words of a club's official name that say what it is, not which one ("Stade Rennais FC").
FORM_WORDS = {"fc", "cf", "sc", "ac", "as", "af", "afc", "ssc", "ss", "us", "rc", "aj", "ogc", "sco", "sk", "fk", "nk", "bk", "if",
              "sv", "vfb", "vfl", "tsg", "bsc", "cd", "ud", "sd", "rcd", "club", "athletic", "stade", "sporting", "calcio", "de", "del",
              "la", "le", "les", "the", "of", "and", "1", "04", "05", "29", "1899", "1900", "1901", "1907", "1909", "1910", "1913"}


def _tokens(name):
    plain = AGE_GROUP.sub(" ", SEX_MARKERS.sub(" ", _gender_text(name)))
    return {t for t in re.split(r"[^a-z0-9]+", plain) if t and t not in FORM_WORDS and t not in SIDE_SUFFIXES and t != "jong"}


def _closeness(source_tokens, team_tokens):
    """Length of the longest common start of a source word and a team word (4 letters at least)."""
    best = 0
    for s in source_tokens:
        for t in team_tokens:
            n = 0
            while n < min(len(s), len(t)) and s[n] == t[n]:
                n += 1
            if n >= 4 and n > best:
                best = n
    return best


def _exact(wanted, teams):
    """{name: team} of the names one team's known spellings hold (normalized), and no other's."""
    found = {}
    for name in wanted:
        hits = [team for team, keys in teams.items() if normalize(name) in keys]
        if len(hits) == 1:
            found[name] = hits[0]
    return found


def _closest(rows, spelled, squads=None):
    """Distinctive words, over the rows and teams still unpaired: a row takes the team it is
    closest to only when that team is not as close to another row, and no other team ties."""
    words = {name: _tokens(name) for name in rows}
    team_words = {team: [_tokens(name) for name in names] for team, names in spelled.items()}
    source_squads = {name: _squad(name) for name in rows} if squads is not None else {}
    scores = {(name, team): max((_closeness(tokens, variant) for variant in variants), default=0)
              for name, tokens in words.items() for team, variants in team_words.items()
              if squads is None or source_squads[name] == squads[team]}
    found = {}
    while True:
        left = [n for n in rows if n not in found]
        free = [t for t in spelled if t not in found.values()]
        paired = False
        for n in left:
            ranked = sorted(((scores.get((n, t), 0), t) for t in free), reverse=True)
            if not ranked or ranked[0][0] == 0 or (len(ranked) > 1 and ranked[1][0] == ranked[0][0]):
                continue
            team = ranked[0][1]
            if any(scores.get((other, team), 0) >= ranked[0][0] for other in left if other != n):
                continue
            found[n] = team
            paired = True
            break
        if not paired:
            return found


def pair(wanted, teams, spelled):
    """{row name: team id} when every name designates one team, else None; and the names left.
    teams {id: normalized spellings}, spelled {id: spellings}: a known spelling, else the
    distinctive words. A name left over is never given to the team left over."""
    found = _exact(wanted, teams)
    found.update(_closest(set(wanted) - set(found), {t: s for t, s in spelled.items() if t not in found.values()}))
    if len(set(found.values())) != len(found):
        return None, len(wanted)
    missing = len(wanted) - len(found)
    return (found if not missing else None), missing


def link(conn, edition, tables, gender="men"):
    """{row name: team id} of a response, every name designating one team of the edition;
    SourceError WRONG_EDITION, UNMATCHED_TEAMS or DUPLICATE_ROW otherwise."""
    wanted = {row["name"] for _, rows in tables for row in rows}
    wrong = sorted(name for name in wanted if _gender(name) not in (None, gender))
    if wrong:
        raise SourceError("UNMATCHED_TEAMS", f"edition {edition} ({gender}): incompatible team names: {', '.join(wrong)}")
    teams, spelled, squads, rejected = _edition_teams(conn, edition, gender)
    found = _exact(wanted, teams)
    others = _neighbour_teams(conn, edition, gender)
    foreign = sorted(name for name in wanted - set(found) if any(normalize(name) in keys for keys in others.values()))
    if foreign:
        raise SourceError("WRONG_EDITION", f"edition {edition}: {', '.join(foreign)}: clubs of the previous or next edition only")
    # A known but contradictory spelling, or an exact homonym, cannot become a match by prefix.
    known = rejected.union(*teams.values())
    unmatched = {name for name in wanted - set(found) if normalize(name) not in known
                 and (gender != "men" or not AMBIGUOUS_WFC.search(name))}
    found.update(_closest(unmatched, {t: s for t, s in spelled.items() if t not in found.values()}, squads))
    unmatched = sorted(wanted - set(found))
    if unmatched:
        raise SourceError("UNMATCHED_TEAMS", f"edition {edition}: not linked: {', '.join(unmatched)}")
    for group, rows in tables:
        designated = [found[row["name"]] for row in rows]
        if len(set(designated)) != len(designated):
            twice = next(row["name"] for row in rows if designated.count(found[row["name"]]) > 1)
            raise SourceError("DUPLICATE_ROW", f"edition {edition}: {twice} and another row of {group or 'the table'} are one team")
    return found


def _team_names(conn, teams):
    return dict(conn.execute("SELECT id, name FROM core.teams WHERE id = ANY(%s)", (sorted(teams),)).fetchall())


def _allsvenskan_rows(payload, year):
    """A full season-labelled organiser table, in the fields needed for corroboration."""
    if payload.get("errors"):
        raise ValueError("GraphQL reported an error")
    rows = payload["data"]["standingsForLeague"]["standings"]
    if not isinstance(rows, list) or not 0 < len(rows) <= MAX_ROWS:
        raise ValueError("missing or oversized organiser table")
    teams, totals = set(), {}
    for row in rows:
        name, team, form = row["teamName"], row["teamId"], row["form"]
        if (team, name) == (ALLSVENSKAN_BP, "BP"):
            name = "Brommapojkarna"
        if not isinstance(name, str) or not normalize(name) or name in totals or type(team) is not int or team in teams:
            raise ValueError("missing or repeated organiser identity")
        if not isinstance(form, list) or not form or any(
            (match["configLeagueName"], match["configSeasonStartYear"]) != ("allsvenskan", year) for match in form
        ):
            raise ValueError("organiser match form does not prove the requested season")
        stats = {item["name"]: item["value"] for item in row["stats"]}
        parts = [stats[field] for field in ALLSVENSKAN_FIELDS]
        if len(stats) != len(row["stats"]) or not all(isinstance(p, str) and p.isdecimal() for p in parts):
            raise ValueError("invalid organiser sporting fields")
        teams.add(team)
        totals[name] = tuple(int(p) for p in parts)
    return totals


def _prove_allsvenskan(conn, get, edition, year, fresh, now, *, require_fresh=False):
    """Corroborate the edition and all sporting totals. Return whether this run fetched the proof."""
    global _allsvenskan_proof
    target = {team: tuple(row[field] for field in RESULTS) for (group, team), row in fresh.items() if group is None}
    if len(target) != len(fresh):
        raise SourceError("UNVERIFIED_EDITION", f"edition {edition}: no organiser proof for grouped tables")

    def matches(totals):
        if len(totals) != len(target):
            return False
        teams = link(conn, edition, [(None, [{"name": name} for name in totals])])
        return {teams[name]: numbers for name, numbers in totals.items()} == target

    cached = _allsvenskan_proof
    if not require_fresh and cached and cached[:2] == (edition, year) and cached[2] <= now < cached[2] + PROOF_TTL:
        # A new result cannot reuse the previous organiser table, even inside the TTL.
        try:
            if matches(cached[3]):
                return False
        except SourceError:
            pass
    query = urlencode({"query": ALLSVENSKAN_QUERY, "variables": json.dumps({"year": year})})
    try:
        payload = get(f"{ALLSVENSKAN_URL}?{query}")
    except SourceError as error:
        raise SourceError("ORGANISER_UNAVAILABLE", f"edition {edition}: Allsvenskan {year}: {error.code}") from None
    try:
        if not isinstance(payload, dict):
            raise ValueError("invalid organiser response")
        totals = _allsvenskan_rows(payload, year)
        if not matches(totals):
            raise ValueError("organiser and widget sporting rows differ")
    except (SourceError, KeyError, TypeError, ValueError) as error:
        detail = error.code if isinstance(error, SourceError) else str(error) if isinstance(error, ValueError) else "invalid organiser response"
        raise SourceError("UNVERIFIED_EDITION", f"edition {edition}: Allsvenskan {year}: {detail}") from None
    _allsvenskan_proof = (edition, year, now, totals)
    return True


def qualify(conn, edition, fresh, counted, now, verify):
    """The edition's own results against the response (§2.1, rules 11-12); SourceError otherwise.
    fresh is {(group, team): row}, counted {team: core.table_results' results}."""
    played = {}
    for (_, team), row in fresh.items():
        played[team] = max(played.get(team, 0), row["played"])
    kicked = dict(conn.execute(KICKED_OFF, (edition, now)).fetchall())
    ahead = {team: p for team, p in played.items() if p > kicked.get(team, 0) + SLACK}
    fetched_proof = False
    if len(ahead) == len(played):
        if verify is not None:
            fetched_proof = verify()
        else:
            names = _team_names(conn, ahead)
            raise SourceError("WRONG_EDITION", f"edition {edition}: every club ahead of the matches kicked off: "
                              + ", ".join(f"{names[t]} {p} played, {kicked.get(t, 0)} kicked off" for t, p in sorted(ahead.items())))
    absent = sorted(team for team, results in counted.items() if results[0] > 0 and team not in played)
    if absent:
        names = _team_names(conn, absent)
        raise SourceError("INCOMPLETE_TABLE", f"edition {edition}: clubs of Vega's table missing: "
                          + ", ".join(f"{names[t]} ({counted[t][0]} counted)" for t in absent))
    return fetched_proof


def _clubs_by_table(rows):
    """{table name: {team ids}} of {(group, team): row}."""
    out = {}
    for group, team in rows:
        out.setdefault(group, set()).add(team)
    return out


def _group_key(name):
    return normalize(re.sub(r"^(?:group|groupe)\s+", "", (name or "").strip(), flags=re.IGNORECASE))


def _first_observation(conn, key, edition, season, native_label, kind, name, country, tables, linked, members):
    """Admit only a full roster of a supported, independently evidenced first phase."""
    proposed = {_group_key(label): {linked[row["name"]] for row in rows} for label, rows in tables}
    present = set().union(*proposed.values())
    if len(proposed) != len(tables):
        raise SourceError("UNVERIFIED_TABLE", f"edition {edition}: ambiguous group names")

    phases = defaultdict(set)
    groups = defaultdict(set)
    scheduled = Counter()
    for stage, group, team in conn.execute(
        """SELECT coalesce(r.stage, 'regular'), nullif(btrim(m.group_name), ''), x.team_id
           FROM core.matches m LEFT JOIN core.rounds r ON r.id = m.round_id
           CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) x(team_id)
           WHERE m.competition_season_id = %s AND m.status <> 'canceled' AND x.team_id IS NOT NULL""", (edition,)
    ):
        phases[stage].add(team)
        if stage in ("regular", "group"):
            scheduled[team] += 1
            if group is not None:
                groups[_group_key(group)].add(team)

    # A registered club is exempt only when independent phase data places it solely in qualifying.
    qualifying_only = phases["qualifying"] - set().union(*(clubs for stage, clubs in phases.items() if stage != "qualifying"))
    expected = members - qualifying_only
    if groups:
        known = set().union(*groups.values())
        if sum(map(len, groups.values())) != len(known) or known != expected or known != set(scheduled):
            raise SourceError("UNVERIFIED_TABLE", f"edition {edition}: incomplete or overlapping native groups")
        claimed = set()
        for label, clubs in sorted(groups.items()):
            matches = [label] if label in proposed else [p for p, roster in proposed.items() if p not in groups and roster == clubs]
            if len(matches) != 1 or proposed[matches[0]] != clubs:
                raise SourceError("INCOMPLETE_TABLE", f"edition {edition}: group {label!r} does not cover its native roster")
            claimed.add(matches[0])
        # An additional ranking may only reuse clubs already assigned to the evidenced phase.
        if present != known or any(sum(bool(roster & group) for group in groups.values()) < 2
                                   for label, roster in proposed.items() if label not in claimed):
            raise SourceError("UNVERIFIED_TABLE", f"edition {edition}: another table has no supported native phase")
        return

    uefa_phase = (
        country == "INT-2" and key in UEFA_LEAGUE_PHASES and season == native_label == UEFA_LEAGUE_SEASON
        and len(scheduled) == 36 and set(scheduled.values()) == {UEFA_LEAGUE_PHASES[key]} and not phases["group"]
    )
    domestic_league = _is_league(kind, name, country) and not phases["group"]
    if len(proposed) != 1 or not (domestic_league or uefa_phase):
        raise SourceError("UNVERIFIED_TABLE", f"edition {edition}: the table's phase or format is unverified")
    absent = expected - present
    if absent:
        names = _team_names(conn, absent)
        raise SourceError("INCOMPLETE_TABLE", f"edition {edition}: clubs of the native roster missing: "
                          + ", ".join(names[team] for team in sorted(absent)))
    no_fixtures = not any(phases.values())
    all_zero = all(row[field] in (None, 0) for _, rows in tables for row in rows for field in (*RESULTS, "points"))
    if present != expected or (set(scheduled) != expected and not (no_fixtures and all_zero)):
        raise SourceError("UNVERIFIED_TABLE", f"edition {edition}: the scheduled phase does not attest the proposed roster")


def _public_ids(conn, teams):
    """The clubs' public ids (api.public_id's rule), the keys of RETIRED_ROWS."""
    found = dict(conn.execute("""SELECT entity_id, provider_key FROM core.provider_ids
                                 WHERE entity_type = 'team' AND provider = 'pitchapi' AND is_current AND entity_id = ANY(%s)""",
                              (sorted(teams),)).fetchall())
    return {team: found.get(team, f"t_v{team:07d}") for team in teams}


def compare(conn, edition, retired, fresh, stored, members, names, counted):
    """The accepted table's knowledge the response keeps (§2.1, rules 13-15); SourceError otherwise.
    retired is the edition's (LEAGUES key, season label); fresh and stored are {(group, team): row}
    (a stored row with its basis), members the edition's teams, names {team: a row name}, counted
    {team: core.table_results' results}."""
    accepted, now = _clubs_by_table(stored), _clubs_by_table(fresh)
    keys = _public_ids(conn, {team for _, team in stored})

    def may_leave(table, team):
        """A club that may leave a table: no longer a team of the edition, or its row reviewed out."""
        return team not in members or (*retired, table, keys[team]) in RETIRED_ROWS

    def listed(teams, table=None):
        shown = _team_names(conn, teams)
        return ", ".join(f"{shown[t]} ({keys[t]})" if table is None else f"{shown[t]} (RETIRED_ROWS key {(*retired, table, keys[t])!r})"
                         for t in sorted(teams))

    # Rule 13: every club of the accepted observation is still somewhere.
    present = {team for _, team in fresh}
    dropped = {team for _, team in stored if team not in present
               and not all(may_leave(table, team) for table, clubs in accepted.items() if team in clubs)}
    if dropped:
        raise SourceError("INCOMPLETE_TABLE", f"edition {edition}: clubs of the accepted table missing: {listed(dropped)}")
    # Rule 13b: every accepted table stays, under its name or as the one new table with its clubs.
    kept = {}
    for table, clubs in accepted.items():
        if table in now:
            kept[table] = table
        else:
            same = [t for t, c in now.items() if t not in accepted and c == clubs]
            if len(same) == 1:
                kept[table] = same[0]
    # A single table may split without losing a club or changing its sporting history. Disjoint
    # names or changed memberships alone cannot retire existing groups or a cross-group table.
    if not kept and set(accepted) == {None} and len(now) > 1:
        clubs = accepted[None]
        if (set().union(*now.values()) == clubs and sum(map(len, now.values())) == len(clubs)
                and all(all(stored[(None, team)][field] in (None, row[field]) for field in RESULTS)
                        for (_, team), row in fresh.items())):
            return _compare_rows(edition, fresh, stored, names, counted)
    lost = sorted((t for t in accepted if t not in kept and (*retired, t) not in RETIRED_TABLES), key=lambda g: g or "")
    if lost:
        raise SourceError("INCOMPLETE_TABLE", f"edition {edition}: tables of the accepted observation missing: " + ", ".join(
            f"{t or 'the table'} ({len(accepted[t])} rows, RETIRED_TABLES key {(*retired, t)!r})" for t in lost))
    # Rule 13c: within a table that stays. A partition table (it owns a club no other accepted table
    # holds: a league table, a group) keeps each of its clubs. A cross table (only clubs another
    # accepted table holds: a ranking across groups) may change members as the competition advances,
    # each club that leaves replaced by one that joins: it never shrinks.
    for table, target in kept.items():
        clubs = accepted[table]
        left = {team for team in clubs - now[target] if not may_leave(table, team)}
        if not left:
            continue
        cross = all(any(team in other for t, other in accepted.items() if t != table) for team in clubs)
        joined = now[target] - clubs
        if not cross or len(left) > len(joined):
            raise SourceError("INCOMPLETE_TABLE", f"edition {edition}: table {table or 'the table'} "
                              f"({'cross' if cross else 'partition'}, {len(clubs)} rows accepted, {len(now[target])} now): "
                              f"{listed(left, table)} left, {len(joined)} joined")
    _compare_rows(edition, fresh, stored, names, counted)


def _compare_rows(edition, fresh, stored, names, counted):
    """Rules 14-15: each club's row keeps what was known of it, and its played count, unless attested."""
    by_team = {}
    for (group, team), row in stored.items():
        by_team.setdefault(team, row)
    for (group, team), row in fresh.items():
        before = stored.get((group, team)) or by_team.get(team)
        if before is None:
            continue
        lost = [FIELDS[f] for f in FIELDS if before[f] is not None and row[f] is None]
        if lost:
            raise SourceError("MISSING_FIELD", f"edition {edition}: {names[team]}: {', '.join(lost)} no longer given")
        if (group, team) in stored and row["played"] < before["played"]:
            # A lower count stands when the edition's results attest it: the club's counted matches
            # now (a correction), or at most those since the observation (a phase counted from it).
            counted_now = counted.get(team, NO_RESULT)[0]
            since = counted_now - before["basis"][0] if before["basis"] is not None else None
            if row["played"] != counted_now and (since is None or row["played"] > since):
                raise SourceError("PLAYED_DECREASED", f"edition {edition}: {names[team]}: played {before['played']} -> {row['played']}, "
                                  f"{counted_now} counted" + (f", {since} since the observation" if since is not None else ""))


def _publish(conn, edition):
    conn.execute(
        """INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('competition_season', %s)
           ON CONFLICT (resource_kind, resource_id) DO UPDATE SET version = ops.resource_versions.version + 1, updated_at = now()""",
        (edition,),
    )


def repeat(conn, edition, stored, observed, counted, now, verify=None, fetched_proof=False):
    """The same table seen again (§2.2): nothing written unless the observation time may move."""
    def renew(teams):
        conn.execute(f"UPDATE core.standings_official SET as_of = %s WHERE {OWN}", (now, edition))
        for team in sorted(teams):
            conn.execute(f"UPDATE core.standings_official SET basis = %s::smallint[] WHERE {OWN} AND team_id = %s",
                         (list(counted.get(team, NO_RESULT)), edition, team))
        if teams:
            _publish(conn, edition)  # api.standings may serve the official table again

    if any(row["basis"] is None for row in stored.values()):
        # Rows written before 138 have no basis. A later result requires positive proof.
        moved = {team for _, team in stored}
        caught_up = observed is None or not conn.execute(FINISHED_SINCE, (edition, observed)).fetchone()[0]
    else:
        moved = {team for (_, team), row in stored.items() if row["basis"] != counted.get(team, NO_RESULT)}
        caught_up = all(
            any(all(row[f] is None or row[f] == v for f, v in zip(RESULTS, counted.get(team, NO_RESULT)))
                for (_, t), row in stored.items() if t == team)
            for team in moved)
    if not caught_up:
        shortfall = {row["played"] - counted.get(team, NO_RESULT)[0] for (_, team), row in stored.items()}
        if verify is None or min(shortfall) < 0 or max(shortfall) == 0:
            return
        if not fetched_proof:
            verify(require_fresh=True)
    renew(moved)


def _current_edition(conn, key):
    return conn.execute(
        """SELECT cs.id, se.label, cs.native_label, se.id, c.kind::text, c.name, c.country_code
           FROM core.provider_ids p JOIN core.competition_seasons cs ON cs.competition_id = p.entity_id
           JOIN core.seasons se ON se.id = cs.season_id
           JOIN core.competitions c ON c.id = cs.competition_id
           WHERE p.entity_type = 'competition' AND p.provider = 'pitchapi' AND p.provider_key = %s AND p.is_current AND cs.is_current""",
        (key,),
    ).fetchone()


def run(conn, get, scope, now):
    key = scope.split(":", 1)[1]
    slug = LEAGUES[key]
    current = _current_edition(conn, key)
    if current is None:  # not collected (yet): no call
        return 0, 0
    edition, season, native_label, year, kind, name, country = current
    tables = parse(get(URL + "?" + urlencode({"sport": "football", "slug": slug})), slug)
    check(tables)
    teams = link(conn, edition, tables, _gender(name) or "men")
    keep_groups = len(tables) > 1  # one table is stored without its name, as before
    fresh = {(group if keep_groups else None, teams[row["name"]]): row for group, rows in tables for row in rows}
    counted = {team: tuple(results) for team, results in conn.execute(
        "SELECT team_id, results FROM core.table_results(%s)", (edition,)).fetchall()}
    verify = None
    if key == ALLSVENSKAN and native_label == str(year):
        verify = partial(_prove_allsvenskan, conn, get, edition, year, fresh, now)
    fetched_proof = qualify(conn, edition, fresh, counted, now, verify)
    # The upstream request is outside the publication lock. READ COMMITTED then sees the
    # latest publication, including the first insert into an otherwise empty edition.
    lock_scope(conn, "sportscore", scope)
    last_run = conn.execute("""SELECT greatest(last_attempt_at,last_success_at) FROM ops.source_runs
                              WHERE source='sportscore' AND scope=%s""", (scope,)).fetchone()
    if last_run and last_run[0] is not None and last_run[0] >= now:
        raise SourceError("STALE_OBSERVATION", f"edition {edition}: scope already attempted at {last_run[0]}")
    if _current_edition(conn, key) != current:
        raise SourceError("EDITION_CHANGED", f"edition {edition}: the competition changed during the request")
    stored = {}
    observed = None
    for group, team, *values, basis, as_of in conn.execute(
        f"SELECT {', '.join(COLUMNS)}, basis, as_of FROM core.standings_official WHERE {OWN}", (edition,)
    ).fetchall():
        if as_of is not None and as_of > now:
            raise SourceError("STALE_OBSERVATION", f"edition {edition}: table already observed at {as_of}")
        stored[(group, team)] = dict(zip(FIELDS, values), basis=tuple(basis) if basis is not None else None)
        observed = as_of if observed is None or (as_of is not None and as_of < observed) else observed
    members = {team for (team,) in conn.execute("SELECT team_id FROM core.team_seasons WHERE competition_season_id = %s", (edition,))}
    if not stored:
        _first_observation(conn, key, edition, season, native_label, kind, name, country, tables, teams, members)
    compare(conn, edition, (key, season), fresh, stored, members, {team: row["name"] for (_, team), row in fresh.items()}, counted)
    if {k: {f: r[f] for f in FIELDS} for k, r in fresh.items()} == {k: {f: r[f] for f in FIELDS} for k, r in stored.items()}:
        repeat(conn, edition, stored, observed, counted, now, verify, fetched_proof)
        return 0, 0
    conn.execute(f"DELETE FROM core.standings_official WHERE {OWN}", (edition,))
    for (group, team), row in sorted(fresh.items(), key=lambda item: (item[0][0] or "", item[1]["position"], item[0][1])):
        conn.execute(
            f"""INSERT INTO core.standings_official(competition_season_id, stage, {', '.join(COLUMNS)}, basis, source, as_of)
                VALUES (%s, NULL, %s, %s, {', '.join(['%s'] * len(FIELDS))}, %s::smallint[], 'sportscore', %s)""",
            (edition, group, team, *(row[f] for f in FIELDS), list(counted.get(team, NO_RESULT)), now),
        )
    for group, rows in tables:
        for row in rows:
            conn.execute(
                """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
                   VALUES ('team', %s, %s, %s, 'source_spelling', 'sportscore') ON CONFLICT DO NOTHING""",
                (teams[row["name"]], row["name"], normalize(row["name"]) or row["name"].lower()),
            )
    _publish(conn, edition)
    return len(fresh), 0
