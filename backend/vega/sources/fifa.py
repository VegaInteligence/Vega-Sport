"""FIFA men's world ranking, every dated edition since 2021 (inside.fifa.com).

Same reading as the previous pipeline's collect_rankings.py on main: the edition catalogue
is the page's __NEXT_DATA__ (allAvailableDates); an edition is ranking-overview, or
for the recent "FRS_" ids that answer empty there, the native rankingsbyschedule
endpoint. Published editions do not change: the missing ones are read, at most
MAX_EDITIONS per run, and the latest stored one, while it is the catalogue's latest, is read
again every REREAD: an edition read short is completed, an identical one writes nothing, a
shorter one is refused and traced (FAILURE_MODES.md §44, 40o). A row is linked to the national team of the same FIFA code or
the same normalized name when exactly one exists; otherwise it keeps its country.
"""

from datetime import date, timedelta
import json
import re
import struct
from urllib.parse import urlencode

from . import SourceError, failure_once, normalize

PAGE = "https://inside.fifa.com/fifa-rankings/world-ranking/men"
OVERVIEW = "https://inside.fifa.com/api/ranking-overview"
SCHEDULE = "https://api.fifa.com/api/v3/fifarankings/rankings/rankingsbyschedule"
FIRST_DATE = "2021-01-01"
MAX_EDITIONS = 40
REREAD = timedelta(days=7)


def scopes(now):
    return {"fifa_men:editions": timedelta(days=1)}


def catalogue(get, today):
    html = get(PAGE, as_text=True)
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not match:
        raise SourceError("CATALOGUE_NOT_FOUND")
    try:
        dates = json.loads(match.group(1))["props"]["pageProps"]["pageData"]["ranking"]["allAvailableDates"]
    except (KeyError, TypeError, ValueError):
        raise SourceError("CATALOGUE_NOT_FOUND") from None
    out = {}
    for entry in dates:
        day, ident = str(entry.get("date") or ""), str(entry.get("id") or "")
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) and ident and FIRST_DATE <= day <= today.isoformat():
            out[day] = ident
    return dict(sorted(out.items()))


def _int(value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 1 else None


def _rank(value):
    """A row's rank: none for an unranked team (a suspended association), as main keeps it;
    any other value must be a rank."""
    if value is None or value == "":
        return None
    number = _int(value)
    if number is None:
        raise SourceError("INVALID_ROW")
    return number


FLAG = "https://api.fifa.com/api/v3/picture/flags-sq-2/"


def edition(get, ident):
    """(rows, source url) of one edition; a row is (fifa team id, name, FIFA code, position,
    previous, points, confederation, flag url), as main's collect_rankings.py reads them."""
    url = OVERVIEW + "?" + urlencode({"locale": "en", "dateId": ident, "rankingType": "football"})
    body = get(url)
    rows = []
    for entry in body.get("rankings") or []:
        item = entry["rankingItem"]
        flag = (item.get("flag") or {}).get("src")
        rows.append((str(item["idTeam"]), item["name"], item.get("countryCode"), _rank(item.get("rank")),
                     _int(item.get("previousRank")), item.get("totalPoints"), (entry.get("tag") or {}).get("id"),
                     flag if isinstance(flag, str) and flag.startswith("https://") else None))
    if not rows and ident.startswith("FRS_"):
        url = SCHEDULE + "?" + urlencode({"rankingScheduleId": ident, "language": "en", "count": 300})
        native = get(url)
        for r in native.get("Results") or []:
            code = r.get("IdCountry")
            rows.append((str(r["IdTeam"]), r["TeamName"][0]["Description"], code, _rank(r.get("Rank")),
                         _int(r.get("PrevRank")), r.get("TotalPoints"), r.get("ConfederationName"),
                         FLAG + code if isinstance(code, str) and code.isalnum() else None))
    return rows, url


def link_national_team(conn, fifa_id, name, code):
    known = conn.execute(
        "SELECT entity_id FROM core.provider_ids WHERE entity_type='team' AND provider='fifa' AND provider_key=%s", (fifa_id,)
    ).fetchone()
    if known:
        return known[0]
    key = normalize(name)
    candidates = {
        team for team, country, team_name in conn.execute(
            "SELECT id, country_code, name FROM core.teams WHERE is_national IS TRUE AND merged_into IS NULL"
        ).fetchall()
        if (code and country == code) or (key and normalize(team_name) == key)
    }
    if len(candidates) != 1:
        return None
    team = candidates.pop()
    if conn.execute("SELECT 1 FROM core.provider_ids WHERE entity_type='team' AND provider='fifa' AND entity_id=%s", (team,)).fetchone():
        return None
    conn.execute(
        "INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'fifa', %s, %s)",
        (fifa_id, team),
    )
    return team


def _real(value):
    """A value as core.ranking_rows.points (real) gives it back."""
    return None if value is None else struct.unpack("f", struct.pack("f", float(value)))[0]


ROW_COLUMNS = "row_no, team_id, country_code, position, previous_position, points, provider_key, entity_name, confederation, image_asset_id"


def save(conn, day, rows, url=None, checked=None):
    """Write one edition when its rows differ from the stored ones (replaced whole, its version raised once); an
    identical read writes no row and raises no version. Returns (rows written, rows not linked to a team)."""
    found = conn.execute("SELECT id FROM core.ranking_editions WHERE kind='fifa_men' AND provider='fifa' AND label=%s", (day,)).fetchone()
    if found:
        edition_id = found[0]
        conn.execute(
            """UPDATE core.ranking_editions SET source_url=%s, checked_at=coalesce(%s, checked_at), updated_at=now()
               WHERE id=%s AND (source_url, checked_at) IS DISTINCT FROM (%s, coalesce(%s, checked_at))""",
            (url, checked, edition_id, url, checked),
        )
    else:
        edition_id = conn.execute(
            """INSERT INTO core.ranking_editions(kind, provider, label, period, published_on, is_current, source_url, source_updated_at, checked_at)
               VALUES ('fifa_men', 'fifa', %s, %s, %s, false, %s, %s, %s) RETURNING id""",
            (day, day, date.fromisoformat(day), url, day, checked),
        ).fetchone()[0]
    planned, unmatched, seen = [], 0, set()
    for row_no, (fifa_id, name, code, position, previous, points, confederation, flag) in enumerate(rows, 1):
        team = link_national_team(conn, fifa_id, name, code)
        if team is None:
            unmatched += 1
            if not code or code in seen:
                continue
            conn.execute("INSERT INTO core.countries(code) VALUES (%s) ON CONFLICT DO NOTHING", (code,))
        elif team in seen:
            continue
        seen.add(team if team is not None else code)
        image = conn.execute(
            """INSERT INTO core.assets(kind, source_url) VALUES ('logo', %s)
               ON CONFLICT (source_url) DO UPDATE SET source_url = EXCLUDED.source_url RETURNING id""",
            (flag,),
        ).fetchone()[0] if flag else None
        planned.append((row_no, team, None if team is not None else code, position, previous, points, fifa_id, name, confederation, image))
    stored = conn.execute(f"SELECT {ROW_COLUMNS} FROM core.ranking_rows WHERE edition_id=%s ORDER BY row_no", (edition_id,)).fetchall()
    if [tuple(r) for r in stored] == [(*r[:5], _real(r[5]), *r[6:]) for r in planned]:
        return 0, unmatched
    conn.execute("DELETE FROM core.ranking_rows WHERE edition_id=%s", (edition_id,))
    for row in planned:
        conn.execute(f"INSERT INTO core.ranking_rows(edition_id, {ROW_COLUMNS}) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", (edition_id, *row))
    conn.execute(
        """INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('ranking', %s)
           ON CONFLICT (resource_kind, resource_id) DO UPDATE SET version = ops.resource_versions.version + 1, updated_at = now()""",
        (edition_id,),
    )
    return len(planned), unmatched


def run(conn, get, scope, now):
    if scope != "fifa_men:editions":
        raise ValueError(scope)
    dates = catalogue(get, now.date())
    stored = {label: (edition_id, checked) for label, edition_id, checked in conn.execute(
        "SELECT label, id, checked_at FROM core.ranking_editions WHERE kind='fifa_men' AND provider='fifa'"
    ).fetchall()}
    due = [d for d in dates if d not in stored][-MAX_EDITIONS:]
    latest = max(stored) if stored else None
    if latest is not None and dates and max(dates) == latest and (stored[latest][1] is None or stored[latest][1] <= now - REREAD):
        due.append(latest)
    written = unmatched = 0
    for day in due:
        rows, url = edition(get, dates[day])
        if not rows:  # not published yet: read again on a later run
            continue
        if day in stored:
            held = conn.execute("SELECT count(*) FROM core.ranking_rows WHERE edition_id=%s", (stored[day][0],)).fetchone()[0]
            if len(rows) < held:
                # A re-read shorter than the stored edition is not written: the stored rows stay, the refusal is traced
                # once, and the edition is read again a week later.
                failure_once(conn, "EDITION_SHORTER", f"fifa_men:{day}: {len(rows)} rows read, {held} stored")
                conn.execute("UPDATE core.ranking_editions SET checked_at=%s WHERE id=%s", (now, stored[day][0]))
                continue
        w, u = save(conn, day, rows, url, checked=now)
        written, unmatched = written + w, unmatched + u
    # The latest stored edition is the current one.
    conn.execute(
        """UPDATE core.ranking_editions e SET is_current = (e.label = x.label)
           FROM (SELECT max(label) AS label FROM core.ranking_editions WHERE kind='fifa_men' AND provider='fifa') x
           WHERE e.kind='fifa_men' AND e.provider='fifa' AND e.is_current IS DISTINCT FROM (e.label = x.label)"""
    )
    return written, unmatched
