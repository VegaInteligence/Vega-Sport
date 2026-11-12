"""Players' birth dates and heights from Wikidata, read club by club.

A name alone never links a player. A player of the base is linked to a Wikidata person
only inside a club where both sides place him: Wikidata lists the person as a member of
the club (P54) without an end date before the base's first seasons (an end date given as
unknown counts as none), and the base has the player in that club's line-ups. Inside that club the player's name must designate
one person on Wikidata and that person one player of the base, and the birth date must
give him a footballer's age at his first and last line-ups. Anything else stays
unlinked: a missing age is shown as missing, a wrong one would be shown as a fact.

Each run reads BATCH clubs, the ones never read first and the best ranked first among
them; a club is read again after PERIOD.
"""

from collections import Counter, defaultdict
from datetime import date, timedelta
import re
from urllib.parse import quote

from . import SourceError, normalize

ENDPOINT = "https://query.wikidata.org/sparql?format=json&query="
AGENT = {"User-Agent": "football-facts-reader/1.0"}
BATCH = 20
PERIOD = timedelta(days=30)
RETRY = timedelta(days=1)
MIN_NAME = 4
MIN_AGE, MAX_AGE = 15, 45
MIN_HEIGHT, MAX_HEIGHT = 150, 215
BORN_FROM = "1976-01-01"
MEMBER_UNTIL = "2020-07-01"
LANGUAGES = ("en", "fr", "es", "pt", "de", "it", "nl", "mul")
QID = re.compile(r"^Q[1-9]\d{0,11}$")
ENTITY = re.compile(r"^https?://www\.wikidata\.org/entity/(Q[1-9]\d{0,11})$")
METRE, CENTIMETRE = "Q11573", "Q174728"

QUERY = """SELECT ?p ?birth ?prec ?height ?unit (GROUP_CONCAT(DISTINCT ?name; separator="|") AS ?names) WHERE {
  ?p p:P54 ?member ; wdt:P31 wd:Q5 .
  ?member ps:P54 wd:%(club)s .
  OPTIONAL { ?member pq:P582 ?end }
  FILTER(!BOUND(?end) || !isLiteral(?end) || ?end >= "%(until)sT00:00:00Z"^^xsd:dateTime)
  OPTIONAL { ?p p:P569/psv:P569 ?b . ?b wikibase:timeValue ?birth ; wikibase:timePrecision ?prec }
  FILTER(!BOUND(?birth) || ?birth >= "%(born)sT00:00:00Z"^^xsd:dateTime)
  OPTIONAL { ?p p:P2048/psv:P2048 ?h . ?h wikibase:quantityAmount ?height ; wikibase:quantityUnit ?unit }
  { ?p rdfs:label ?name } UNION { ?p skos:altLabel ?name }
  FILTER(LANG(?name) IN (%(languages)s))
} GROUP BY ?p ?birth ?prec ?height ?unit"""


def query(club):
    if not QID.match(club or ""):
        raise ValueError(club)
    return QUERY % {"club": club, "until": MEMBER_UNTIL, "born": BORN_FROM, "languages": ", ".join(f'"{code}"' for code in LANGUAGES)}


def _value(row, key):
    cell = row.get(key)
    return cell.get("value") if isinstance(cell, dict) else None


def _height(row):
    try:
        amount = float(_value(row, "height"))
    except (TypeError, ValueError):
        return None
    unit = (_value(row, "unit") or "").rsplit("/", 1)[-1]
    centimetres = round(amount * 100) if unit == METRE else round(amount) if unit == CENTIMETRE else None
    return centimetres if centimetres is not None and MIN_HEIGHT <= centimetres <= MAX_HEIGHT else None


def people(bindings):
    """{qid: (names, birth date or None, height in cm or None)} of one club's answer.

    A birth date is kept when Wikidata gives one day and one only; a height when its
    statements agree on one value. Two different values are not averaged: none is kept.
    """
    found = {}
    for row in bindings if isinstance(bindings, list) else []:
        entity = ENTITY.match(_value(row, "p") or "")
        if not entity:
            continue
        person = found.setdefault(entity.group(1), (set(), set(), set(), set()))
        names, days, other_dates, heights = person
        for name in (_value(row, "names") or "").split("|"):
            key = normalize(name)
            if len(key) >= MIN_NAME:
                names.add(key)
        birth = _value(row, "birth")
        if birth:
            try:
                day = date.fromisoformat(birth[:10])
            except ValueError:
                day = None
            (days if day and _value(row, "prec") == "11" else other_dates).add(day)
        height = _height(row)
        if height:
            heights.add(height)
    return {
        qid: (names, next(iter(days)) if len(days) == 1 else None, next(iter(heights)) if len(heights) == 1 else None)
        for qid, (names, days, _, heights) in found.items()
    }


def pair(squad, found):
    """{player: qid}: the players whose name designates one person, who is no one else's.

    squad: {player: set of normalized names}; found: the result of `people`.
    """
    by_name = defaultdict(set)
    for qid, (names, _, _) in found.items():
        for name in names:
            by_name[name].add(qid)
    candidates = {player: set().union(*(by_name.get(name, ()) for name in names)) for player, names in squad.items()}
    claims = Counter(qid for persons in candidates.values() for qid in persons)
    return {
        player: qid
        for player, persons in candidates.items()
        if len(persons) == 1
        for qid in persons
        if claims[qid] == 1
    }


def years_between(birth, day):
    return day.year - birth.year - ((day.month, day.day) < (birth.month, birth.day))


def plausible(birth, first, last):
    """A footballer's age at his first and last line-ups in the base."""
    return bool(birth and first and last) and years_between(birth, first) >= MIN_AGE and years_between(birth, last) <= MAX_AGE


def _due(conn, now):
    # Among the clubs never read, the best placed of a current ranking first: their players
    # are the most looked at.
    return conn.execute(
        """SELECT t.id, w.provider_key FROM core.teams t
           JOIN core.provider_ids w ON w.entity_type='team' AND w.entity_id=t.id AND w.provider='wikidata' AND w.is_current
           WHERE t.is_national IS NOT TRUE AND (t.wikidata_players_at IS NULL OR t.wikidata_players_at < %s)
           ORDER BY t.wikidata_players_at NULLS FIRST,
             (SELECT min(r.position) FROM core.ranking_rows r JOIN core.ranking_editions e ON e.id=r.edition_id AND e.is_current
              WHERE r.team_id=t.id) NULLS LAST, t.id
           LIMIT %s""",
        (now - PERIOD, BATCH),
    ).fetchall()


def squad_of(conn, team):
    """{player: (names, first line-up, last line-up)} of the club's line-ups in the base."""
    rows = conn.execute(
        """SELECT p.id, p.name, min(m.match_date), max(m.match_date) FROM core.matches m
           JOIN core.lineup_players lp ON lp.season_id=m.season_id AND lp.match_id=m.id AND lp.team_id=%(team)s
           JOIN core.players p ON p.id=lp.player_id
           WHERE (m.home_team_id=%(team)s OR m.away_team_id=%(team)s) AND m.match_date IS NOT NULL
           GROUP BY p.id, p.name""",
        {"team": team},
    ).fetchall()
    squad = {}
    for player, name, first, last in rows:
        key = normalize(name)
        if len(key) >= MIN_NAME:
            squad[player] = ({key}, first, last)
    return squad


def save(conn, squad, found):
    """Link and write one club's players; returns (players written, players left without a link)."""
    linked = dict(conn.execute(
        "SELECT entity_id, provider_key FROM core.provider_ids WHERE entity_type='player' AND provider='wikidata' AND is_current AND entity_id = ANY(%s)",
        (list(squad),),
    ).fetchall())
    written = 0
    pairs = pair({player: names for player, (names, _, _) in squad.items()}, found)
    for player, qid in sorted(pairs.items()):
        _, birth, height = found[qid]
        _, first, last = squad[player]
        if linked.get(player) not in (None, qid) or not plausible(birth, first, last):
            continue
        if player not in linked:
            owner = conn.execute(
                "SELECT entity_id FROM core.provider_ids WHERE entity_type='player' AND provider='wikidata' AND provider_key=%s", (qid,)
            ).fetchone()
            if owner:  # this person is already another player of the base: not linked twice
                continue
            conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player','wikidata',%s,%s)", (qid, player))
            linked[player] = qid
        written += conn.execute(
            """UPDATE core.players SET birth_date=%(birth)s, height_cm=coalesce(%(height)s, height_cm), updated_at=now()
               WHERE id=%(player)s AND (birth_date IS DISTINCT FROM %(birth)s OR (%(height)s::smallint IS NOT NULL AND height_cm IS DISTINCT FROM %(height)s))""",
            {"birth": birth, "height": height, "player": player},
        ).rowcount
    return written, sum(player not in linked for player in squad)


def run(conn, get, now):
    written = unmatched = failed = 0
    clubs = _due(conn, now)
    for team, qid in clubs:
        try:
            answer = get(ENDPOINT + quote(query(qid)), headers=AGENT)
            bindings = answer["results"]["bindings"]
        except SourceError:
            # A club the service fails on (a time-out on a very large squad) is tried again
            # tomorrow, and does not stop the others.
            failed += 1
            conn.execute("UPDATE core.teams SET wikidata_players_at=%s WHERE id=%s", (now - PERIOD + RETRY, team))
            continue
        with conn.transaction():
            done, left = save(conn, squad_of(conn, team), people(bindings))
            conn.execute("UPDATE core.teams SET wikidata_players_at=%s WHERE id=%s", (now, team))
        written += done
        unmatched += left
    if failed and failed == len(clubs):
        raise SourceError("TRANSPORT_ERROR")
    return written, unmatched
