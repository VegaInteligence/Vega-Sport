"""Club, stadium and coach facts from Wikidata and Wikimedia Commons, read by main's own
readers through v2/sources/bridge.mjs and written as typed facts (027_wikidata.sql).

- clubs: the clubs of current editions, by their UEFA id (main's rule: "match through
  the published UEFA identity, never through a club name"), else their Wikidata id,
  else main's name-and-country resolution; founded year, home stadium, current coach and
  his Commons portrait;
- stadiums: capacity (and when it was observed), coordinates, opening and creation dates;
- portraits: the coaches seen in line-ups without a portrait, in batches, as main does.

Each scope reads at most BATCH entities per run, the oldest first, and runs hourly: the
whole set is refreshed every few days without a burst of requests.
"""

from datetime import timedelta
import json
import os
from pathlib import Path
import re
import subprocess

from . import SourceError

BATCH = 20
CLUB_PERIOD = timedelta(days=7)
STADIUM_PERIOD = timedelta(days=30)
PORTRAIT_PERIOD = timedelta(days=30)
LOOKUP_VERSION = 3  # coach-portrait-source.mjs on main
BRIDGE = Path(os.environ.get("VEGA_SOURCE_BRIDGE", Path(__file__).resolve().parents[3] / "v2/sources/bridge.mjs"))
QID = re.compile(r"^https?://www\.wikidata\.org/entity/(Q[1-9]\d{0,11})$")
PARTIAL = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")


def node_bridge(command, *args):
    done = subprocess.run(["node", str(BRIDGE), command, *args], capture_output=True, text=True, timeout=120)
    if done.returncode != 0:
        raise SourceError("BRIDGE_FAILED")
    try:
        return json.loads(done.stdout)
    except ValueError:
        raise SourceError("INVALID_JSON") from None


bridge = node_bridge  # tests replace it


def scopes(now):
    hour = timedelta(hours=1)
    return {"clubs": hour, "stadiums": hour, "portraits": hour}


def _asset(conn, kind, photo):
    return conn.execute(
        """INSERT INTO core.assets(kind, source_url, author, license, source_page_url) VALUES (%s,%s,%s,%s,%s)
           ON CONFLICT (source_url) DO UPDATE SET author=EXCLUDED.author, license=EXCLUDED.license,
             source_page_url=EXCLUDED.source_page_url, updated_at=now() RETURNING id""",
        (kind, photo["url"], photo.get("author") or None, photo.get("license") or None, photo.get("sourceUrl")),
    ).fetchone()[0]


def _entity(conn, entity_type, qid):
    row = conn.execute(
        "SELECT entity_id FROM core.provider_ids WHERE entity_type=%s AND provider='wikidata' AND provider_key=%s", (entity_type, qid)
    ).fetchone()
    return row and row[0]


def _coach(conn, name, photo):
    # Names are not identities (homonyms): the coach of that name already known, else a new one.
    row = conn.execute("SELECT id FROM core.coaches WHERE name=%s ORDER BY id LIMIT 1", (name,)).fetchone()
    coach = row[0] if row else conn.execute("INSERT INTO core.coaches(name) VALUES (%s) RETURNING id", (name,)).fetchone()[0]
    if photo and photo.get("url"):
        conn.execute("UPDATE core.coaches SET photo_asset_id=%s, updated_at=now() WHERE id=%s", (_asset(conn, "photo", photo), coach))
    return coach


def save_club(conn, team, club, now):
    """Write one club's facts; returns True when the club is linked to Wikidata."""
    qid = QID.match(str((club or {}).get("sourceUrl") or ""))
    if not qid:
        conn.execute("UPDATE core.teams SET wikidata_fetched_at=%s WHERE id=%s", (now, team))
        return False
    qid = qid.group(1)
    owner = _entity(conn, "team", qid)
    if owner not in (None, team):  # this Wikidata club is already another team: not linked twice
        conn.execute("UPDATE core.teams SET wikidata_fetched_at=%s WHERE id=%s", (now, team))
        return False
    if owner is None:
        conn.execute("UPDATE core.provider_ids SET is_current=false WHERE entity_type='team' AND entity_id=%s AND provider='wikidata'", (team,))
        conn.execute(
            "INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','wikidata',%s,%s)", (qid, team)
        )
    founded = club.get("founded")
    venue = None
    if club.get("stadiumId") and club.get("stadium"):
        venue = _entity(conn, "venue", club["stadiumId"])
        if venue is None:
            venue = conn.execute("INSERT INTO core.venues(name) VALUES (%s) RETURNING id", (club["stadium"],)).fetchone()[0]
            conn.execute(
                "INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('venue','wikidata',%s,%s)",
                (club["stadiumId"], venue),
            )
        else:
            conn.execute("UPDATE core.venues SET name=%s, updated_at=now() WHERE id=%s", (club["stadium"], venue))
        conn.execute("DELETE FROM core.entity_names WHERE entity_type='venue' AND entity_id=%s AND kind='alias' AND source='wikidata'", (venue,))
        if club.get("stadiumAlias"):
            conn.execute(
                """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
                   VALUES ('venue', %s, %s, %s, 'alias', 'wikidata') ON CONFLICT DO NOTHING""",
                (venue, club["stadiumAlias"], club["stadiumAlias"].lower()),
            )
    conn.execute(
        "UPDATE core.teams SET founded_year=%s, home_venue_id=coalesce(%s, home_venue_id), wikidata_fetched_at=%s, updated_at=now() WHERE id=%s",
        (int(founded) if isinstance(founded, str) and founded.isdigit() else None, venue, club.get("fetchedAt") or now, team),
    )
    coach = club.get("coach")
    current = _coach(conn, coach["name"], coach.get("photo")) if coach and coach.get("name") else None
    today = now.date()
    # One open Wikidata tenure: the current coach. A change closes the previous one today.
    conn.execute(
        """UPDATE core.team_coach_tenures SET end_date=%s, updated_at=now()
           WHERE team_id=%s AND source='wikidata' AND end_date IS NULL AND coach_id IS DISTINCT FROM %s AND start_date<=%s""",
        (today, team, current, today),
    )
    if current and not conn.execute(
        "SELECT 1 FROM core.team_coach_tenures WHERE team_id=%s AND coach_id=%s AND source='wikidata' AND end_date IS NULL", (team, current)
    ).fetchone():
        conn.execute(
            """INSERT INTO core.team_coach_tenures(team_id, coach_id, start_date, date_precision, source)
               VALUES (%s,%s,%s,'day','wikidata') ON CONFLICT DO NOTHING""",
            (team, current, today),
        )
    return True


def save_stadium(conn, venue, stadium, now):
    if not stadium:
        conn.execute("UPDATE core.venues SET wikidata_fetched_at=%s WHERE id=%s", (now, venue))
        return False
    partial = lambda value: value if isinstance(value, str) and PARTIAL.match(value) else None
    observed, opened, created = partial(stadium.get("capacityAsOf")), partial(stadium.get("opened")), partial(stadium.get("created"))
    point = stadium.get("coordinates") or {}
    capacity = stadium.get("capacity")
    conn.execute(
        """UPDATE core.venues SET capacity=%s, capacity_observed=%s, capacity_as_of=%s, latitude=%s, longitude=%s,
             opened=%s, created=%s, opened_year=%s, wikidata_fetched_at=%s, updated_at=now() WHERE id=%s""",
        (capacity if isinstance(capacity, int) and capacity > 0 else None, observed, observed if observed and len(observed) == 10 else None,
         point.get("lat"), point.get("lon"), opened, created, int(opened[:4]) if opened else None, stadium.get("fetchedAt") or now, venue),
    )
    return True


def _clubs(conn, now):
    rows = conn.execute(
        """SELECT t.id, t.name, t.country_code, u.provider_key, w.provider_key FROM core.teams t
           LEFT JOIN core.provider_ids u ON u.entity_type='team' AND u.entity_id=t.id AND u.provider='uefa' AND u.is_current
           LEFT JOIN core.provider_ids w ON w.entity_type='team' AND w.entity_id=t.id AND w.provider='wikidata' AND w.is_current
           WHERE t.is_national IS NOT TRUE
             AND EXISTS (SELECT 1 FROM core.provider_ids p WHERE p.entity_type='team' AND p.entity_id=t.id AND p.provider='pitchapi')
             AND EXISTS (SELECT 1 FROM core.team_seasons ts JOIN core.competition_seasons cs ON cs.id=ts.competition_season_id
                         WHERE ts.team_id=t.id AND cs.is_current)
             AND (u.provider_key IS NOT NULL OR w.provider_key IS NOT NULL OR t.country_code ~ '^[A-Z]{3}$')
             AND (t.wikidata_fetched_at IS NULL OR t.wikidata_fetched_at < %s)
           ORDER BY t.wikidata_fetched_at NULLS FIRST, t.id LIMIT %s""",
        (now - CLUB_PERIOD, BATCH),
    ).fetchall()
    written = unmatched = 0
    for team, name, country, uefa, qid in rows:
        ref = uefa or qid or bridge("identity", name, country)
        club = bridge("club", ref) if ref else None
        with conn.transaction():
            linked = save_club(conn, team, club, now)
        written += linked
        unmatched += not linked
    return written, unmatched


def _stadiums(conn, now):
    rows = conn.execute(
        """SELECT v.id, w.provider_key FROM core.venues v
           JOIN core.provider_ids w ON w.entity_type='venue' AND w.entity_id=v.id AND w.provider='wikidata' AND w.is_current
           WHERE v.wikidata_fetched_at IS NULL OR v.wikidata_fetched_at < %s
           ORDER BY v.wikidata_fetched_at NULLS FIRST, v.id LIMIT %s""",
        (now - STADIUM_PERIOD, BATCH),
    ).fetchall()
    written = unmatched = 0
    for venue, qid in rows:
        stadium = bridge("stadium", qid)
        with conn.transaction():
            found = save_stadium(conn, venue, stadium, now)
        written += found
        unmatched += not found
    return written, unmatched


def _portraits(conn, now):
    rows = conn.execute(
        """SELECT c.id, c.name FROM core.coaches c
           WHERE c.photo_asset_id IS NULL AND length(c.name) BETWEEN 3 AND 100
             AND EXISTS (SELECT 1 FROM core.lineups l WHERE l.coach_id=c.id)
             AND (c.portrait_checked_at IS NULL OR c.portrait_lookup_version IS DISTINCT FROM %s OR c.portrait_checked_at < %s)
           ORDER BY c.portrait_checked_at NULLS FIRST, c.id LIMIT %s""",
        (LOOKUP_VERSION, now - PORTRAIT_PERIOD, BATCH),
    ).fetchall()
    if not rows:
        return 0, 0
    found = bridge("portraits", json.dumps([name for _, name in rows], ensure_ascii=False)) or {}
    written = 0
    with conn.transaction():
        for coach, name in rows:
            photo = found.get(name)
            if photo and photo.get("url"):
                conn.execute("UPDATE core.coaches SET photo_asset_id=%s WHERE id=%s", (_asset(conn, "photo", photo), coach))
                written += 1
            conn.execute(
                "UPDATE core.coaches SET portrait_checked_at=%s, portrait_lookup_version=%s, updated_at=now() WHERE id=%s",
                (now, LOOKUP_VERSION, coach),
            )
    return written, len(rows) - written


def run(conn, get, scope, now):
    handler = {"clubs": _clubs, "stadiums": _stadiums, "portraits": _portraits}.get(scope)
    if handler is None:
        raise ValueError(scope)
    return handler(conn, now)
