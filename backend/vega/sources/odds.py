"""Bookmakers' odds of the coming matches (The Odds API, api.the-odds-api.com, v4): the full-
time result (1 X 2) of the licensed French bookmakers (region « fr »: Betclic, Winamax,
Unibet, PMU, NetBet) for the leagues below, once a day by default.

A call costs one credit per league (one market, one region); the free plan's 500 credits a
month cover the 14 leagues read daily (420). V2_ODDS_PERIOD_HOURS shortens the period on a
paid plan. Needs a key (V2_ODDS_API_KEY): without one the adapter has nothing due.

An event is linked to a match of its league's current editions that kicks off within six
hours of it and whose two clubs carry its two names (normalized, one inside the other), when
exactly one does; the link is kept (core.provider_ids, entity « match »). Each bookmaker's
latest prices are kept per match, with the first ones read (the opening line); an event
that names no match is counted unmatched and not written.
"""

from datetime import datetime, timedelta, timezone
import os
from urllib.parse import urlencode

from . import SourceError, normalize

BASE = "https://api.the-odds-api.com/v4/sports/"
PROVIDER = "oddsapi"
# The leagues read: the source's key -> (competition name, country code) in the base.
LEAGUES = {
    "soccer_france_ligue_one": ("Ligue 1", "FRA"),
    "soccer_france_ligue_two": ("Ligue 2", "FRA"),
    "soccer_epl": ("Premier League", "ENG"),
    "soccer_efl_champ": ("Championship", "ENG"),
    "soccer_spain_la_liga": ("LaLiga", "ESP"),
    "soccer_italy_serie_a": ("Serie A", "ITA"),
    "soccer_germany_bundesliga": ("Bundesliga", "GER"),
    "soccer_netherlands_eredivisie": ("Eredivisie", "NED"),
    "soccer_portugal_primeira_liga": ("Liga Portugal", "POR"),
    "soccer_belgium_first_div": ("First Division A", "BEL"),
    "soccer_uefa_champs_league": ("Champions League", "INT-2"),
    "soccer_usa_mls": ("MLS", "USA"),
    "soccer_brazil_campeonato": ("Serie A", "BRA"),
    "soccer_saudi_arabia_pro_league": ("Saudi Pro League", "KSA"),
}
WINDOW = timedelta(hours=6)


def scopes(now):
    if not os.environ.get("V2_ODDS_API_KEY"):
        return {}
    period = timedelta(hours=float(os.environ.get("V2_ODDS_PERIOD_HOURS") or 24))
    return {f"odds:{sport}": period for sport in LEAGUES}


def _time(value):
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def parse(body):
    """[(event, kick-off, home, away, [(bookmaker key, title, last update, home, draw, away)])]
    of a sport's events; a bookmaker without the three prices is left out."""
    if not isinstance(body, list):
        raise SourceError("INVALID_RESPONSE")
    events = []
    for event in body:
        if not isinstance(event, dict):
            continue
        ident, home, away, kickoff = event.get("id"), event.get("home_team"), event.get("away_team"), _time(event.get("commence_time"))
        if not (isinstance(ident, str) and isinstance(home, str) and isinstance(away, str) and kickoff):
            continue
        books = []
        for book in event.get("bookmakers") or []:
            market = next((m for m in book.get("markets") or [] if m.get("key") == "h2h"), None)
            prices = {o.get("name"): o.get("price") for o in (market or {}).get("outcomes") or []}
            trio = (prices.get(home), prices.get("Draw"), prices.get(away))
            if not isinstance(book.get("key"), str) or not all(isinstance(p, (int, float)) and p > 1 for p in trio):
                continue
            books.append((book["key"], str(book.get("title") or book["key"]), _time(book.get("last_update")), *map(float, trio)))
        events.append((ident, kickoff, home, away, books))
    return events


def same_club(a, b):
    """Two spellings of one club: normalized, one inside the other (« Paris Saint Germain » and
    « Paris Saint-Germain FC »)."""
    x, y = normalize(a), normalize(b)
    return bool(x and y) and (x in y or y in x)


def link(conn, league, ident, kickoff, home, away):
    """The match an event names, or None."""
    row = conn.execute("SELECT entity_id FROM core.provider_ids WHERE entity_type='match' AND provider=%s AND provider_key=%s", (PROVIDER, ident)).fetchone()
    if row:
        return row[0]
    name, country = league
    candidates = conn.execute(
        """SELECT m.id, ht.name, at.name FROM core.matches m
           JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
           JOIN core.competitions c ON c.id = cs.competition_id AND c.name = %s AND c.country_code = %s
           JOIN core.teams ht ON ht.id = m.home_team_id JOIN core.teams at ON at.id = m.away_team_id
           WHERE m.kickoff_at BETWEEN %s AND %s""",
        (name, country, kickoff - WINDOW, kickoff + WINDOW),
    ).fetchall()
    found = [m for m, h, a in candidates if same_club(h, home) and same_club(a, away)]
    if len(found) != 1:
        return None
    if conn.execute("SELECT 1 FROM core.provider_ids WHERE entity_type='match' AND provider=%s AND entity_id=%s", (PROVIDER, found[0])).fetchone():
        return None
    conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match', %s, %s, %s)", (PROVIDER, ident, found[0]))
    return found[0]


def run(conn, get, scope, now):
    sport = scope.split(":", 1)[1]
    query = urlencode({"apiKey": os.environ["V2_ODDS_API_KEY"], "regions": "fr", "markets": "h2h", "oddsFormat": "decimal", "dateFormat": "iso"})
    events = parse(get(f"{BASE}{sport}/odds/?{query}"))
    written = unmatched = 0
    for ident, kickoff, home, away, books in events:
        match = link(conn, LEAGUES[sport], ident, kickoff, home, away)
        if match is None:
            unmatched += 1
            continue
        season = conn.execute("SELECT season_id FROM core.matches WHERE id = %s", (match,)).fetchone()[0]
        for key, title, updated, h, d, a in books:
            conn.execute(
                """INSERT INTO core.match_odds(season_id, match_id, bookmaker, title, home, draw, away, first_home, first_draw, first_away, updated_at, fetched_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (season_id, match_id, bookmaker) DO UPDATE SET title = EXCLUDED.title, home = EXCLUDED.home, draw = EXCLUDED.draw,
                     away = EXCLUDED.away, updated_at = EXCLUDED.updated_at, fetched_at = EXCLUDED.fetched_at""",
                (season, match, key, title, h, d, a, h, d, a, updated, now),
            )
            written += 1
    return written, unmatched
