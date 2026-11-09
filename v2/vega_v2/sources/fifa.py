"""FIFA men's world ranking, every dated edition since 2021 (inside.fifa.com).

Same reading as dashboard/scripts/collect_rankings.py on main: the edition catalogue
is the page's __NEXT_DATA__ (allAvailableDates); an edition is ranking-overview, or
for the recent "FRS_" ids that answer empty there, the native rankingsbyschedule
endpoint. Published editions never change: only the missing ones are read, at most
MAX_EDITIONS per run. A row is linked to the national team of the same FIFA code or
the same normalized name when exactly one exists; otherwise it keeps its country.
"""

from datetime import date, timedelta
import json
import re
from urllib.parse import urlencode

from . import SourceError, normalize

PAGE = "https://inside.fifa.com/fifa-rankings/world-ranking/men"
OVERVIEW = "https://inside.fifa.com/api/ranking-overview"
SCHEDULE = "https://api.fifa.com/api/v3/fifarankings/rankings/rankingsbyschedule"
FIRST_DATE = "2021-01-01"
MAX_EDITIONS = 40


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


def edition(get, ident):
    """Rows of one edition: (fifa team id, name, FIFA code, position, previous, points)."""
    body = get(OVERVIEW + "?" + urlencode({"locale": "en", "dateId": ident, "rankingType": "football"}))
    rows = []
    for entry in body.get("rankings") or []:
        item = entry["rankingItem"]
        rows.append((str(item["idTeam"]), item["name"], item.get("countryCode"), _int(item.get("rank")),
                     _int(item.get("previousRank")), item.get("totalPoints")))
    if not rows and ident.startswith("FRS_"):
        native = get(SCHEDULE + "?" + urlencode({"rankingScheduleId": ident, "language": "en", "count": 300}))
        for r in native.get("Results") or []:
            rows.append((str(r["IdTeam"]), r["TeamName"][0]["Description"], r.get("IdCountry"), _int(r.get("Rank")),
                         _int(r.get("PrevRank")), r.get("TotalPoints")))
    if any(position is None for *_, position, _, _ in rows):
        raise SourceError("INVALID_ROW")
    return rows


def link_national_team(conn, fifa_id, name, code):
    known = conn.execute(
        "SELECT entity_id FROM core.provider_ids WHERE entity_type='team' AND provider='fifa' AND provider_key=%s", (fifa_id,)
    ).fetchone()
    if known:
        return known[0]
    key = normalize(name)
    candidates = {
        team for team, country, team_name in conn.execute(
            "SELECT id, country_code, name FROM core.teams WHERE is_national IS TRUE"
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


def save(conn, day, rows):
    edition_id = conn.execute(
        """INSERT INTO core.ranking_editions(kind, provider, label, period, published_on, is_current)
           VALUES ('fifa_men', 'fifa', %s, %s, %s, false)
           ON CONFLICT (kind, provider, label) DO UPDATE SET updated_at = now() RETURNING id""",
        (day, day, date.fromisoformat(day)),
    ).fetchone()[0]
    conn.execute("DELETE FROM core.ranking_rows WHERE edition_id=%s", (edition_id,))
    written = unmatched = 0
    seen = set()
    for row_no, (fifa_id, name, code, position, previous, points) in enumerate(rows, 1):
        team = link_national_team(conn, fifa_id, name, code)
        if team is None:
            unmatched += 1
            if not code or code in seen:
                continue
            conn.execute("INSERT INTO core.countries(code) VALUES (%s) ON CONFLICT DO NOTHING", (code,))
        elif team in seen:
            continue
        seen.add(team if team is not None else code)
        conn.execute(
            """INSERT INTO core.ranking_rows(edition_id, row_no, team_id, country_code, position, previous_position, points)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (edition_id, row_no, team, None if team is not None else code, position, previous, points),
        )
        written += 1
    conn.execute(
        """INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('ranking', %s)
           ON CONFLICT (resource_kind, resource_id) DO UPDATE SET version = ops.resource_versions.version + 1, updated_at = now()""",
        (edition_id,),
    )
    return written, unmatched


def run(conn, get, scope, now):
    if scope != "fifa_men:editions":
        raise ValueError(scope)
    dates = catalogue(get, now.date())
    stored = {label for (label,) in conn.execute(
        "SELECT label FROM core.ranking_editions WHERE kind='fifa_men' AND provider='fifa'"
    ).fetchall()}
    written = unmatched = 0
    for day in [d for d in dates if d not in stored][-MAX_EDITIONS:]:
        rows = edition(get, dates[day])
        if not rows:  # not published yet: read again on a later run
            continue
        w, u = save(conn, day, rows)
        written, unmatched = written + w, unmatched + u
    # The latest stored edition is the current one.
    conn.execute(
        """UPDATE core.ranking_editions e SET is_current = (e.label = x.label)
           FROM (SELECT max(label) AS label FROM core.ranking_editions WHERE kind='fifa_men' AND provider='fifa') x
           WHERE e.kind='fifa_men' AND e.provider='fifa'"""
    )
    return written, unmatched
