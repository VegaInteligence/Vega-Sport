"""SportsAPI ranking snapshots (api.sportsapi.app), the second ranking provider of the v2
doc: FIFA men, UEFA associations and UEFA clubs, as main's collect_rankings.py reads them.
A snapshot is dated by its day of reading (SportsAPI's updatedAt is a refresh time, not an
official edition date): it is never official, and an official edition of the same day is
served first (030_neutral_reads.sql).

Rows are linked as the official sources link theirs: a national team by its FIFA code or
its normalized name, an association by the UEFA spelling of its country, a club by the
spelling of the UEFA ranking (whose rows are linked to clubs), each time only when exactly
one matches. A row that names nobody is counted unmatched and not written.

Needs a key (V2_SPORTSAPI_API_KEY): without one the adapter has nothing due.
"""

from datetime import timedelta
import os

from . import SourceError, normalize

BASE = "https://api.sportsapi.app/v2/rankings/"
KINDS = {"fifa-men": "fifa_men", "uefa-countries": "uefa_associations", "uefa-clubs": "uefa_clubs"}


def scopes(now):
    if not os.environ.get("V2_SPORTSAPI_API_KEY"):
        return {}
    return {f"rankings:{kind}": timedelta(days=1) for kind in KINDS}


def parse(body):
    """(id, name, code, position, previous, points, image) per row, as main reads them."""
    if not isinstance(body, dict) or not isinstance(body.get("data"), list):
        raise SourceError("INVALID_RESPONSE")
    rows = []
    for row in body["data"]:
        entity = row.get("team") or row.get("country") or {}
        ident = entity.get("id") or entity.get("code") or entity.get("name")
        if not ident or not entity.get("name") or not isinstance(row.get("position"), int):
            continue
        rows.append((str(ident), entity["name"], entity.get("code"), row["position"], row.get("previousPosition"), row.get("points"), entity.get("image")))
    return rows


def _known(conn, key):
    row = conn.execute("SELECT entity_id FROM core.provider_ids WHERE entity_type='team' AND provider='sportsapi' AND provider_key=%s", (key,)).fetchone()
    return row and row[0]


def _link(conn, key, candidates):
    if len(candidates) != 1:
        return None
    team = candidates.pop()
    if conn.execute("SELECT 1 FROM core.provider_ids WHERE entity_type='team' AND provider='sportsapi' AND entity_id=%s", (team,)).fetchone():
        return None
    conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','sportsapi',%s,%s)", (key, team))
    return team


def national_team(conn, key, name, code):
    known = _known(conn, key)
    if known:
        return known
    wanted = normalize(name)
    return _link(conn, key, {t for t, country, n in conn.execute("SELECT id, country_code, name FROM core.teams WHERE is_national IS TRUE").fetchall()
                             if (code and country == code) or normalize(n) == wanted})


def club(conn, key, name):
    known = _known(conn, key)
    if known:
        return known
    wanted = normalize(name)
    rows = conn.execute(
        """SELECT DISTINCT r.team_id, r.entity_name FROM core.ranking_rows r JOIN core.ranking_editions e ON e.id = r.edition_id
           WHERE e.kind = 'uefa_clubs' AND e.provider = 'uefa' AND r.team_id IS NOT NULL"""
    ).fetchall()
    return _link(conn, key, {t for t, n in rows if normalize(n) == wanted})


def association(conn, name):
    wanted = normalize(name)
    rows = conn.execute(
        """SELECT DISTINCT r.country_code, r.entity_name FROM core.ranking_rows r JOIN core.ranking_editions e ON e.id = r.edition_id
           WHERE e.kind = 'uefa_associations' AND e.provider = 'uefa' AND r.country_code IS NOT NULL"""
    ).fetchall()
    found = {c for c, n in rows if normalize(n) == wanted}
    return found.pop() if len(found) == 1 else None


def save(conn, kind, day, rows, url, updated):
    edition = conn.execute(
        """INSERT INTO core.ranking_editions(kind, provider, label, period, published_on, is_current, source_url, source_updated_at)
           VALUES (%s, 'sportsapi', %s, %s, %s, false, %s, %s)
           ON CONFLICT (kind, provider, label) DO UPDATE SET source_url = EXCLUDED.source_url,
             source_updated_at = EXCLUDED.source_updated_at, updated_at = now() RETURNING id""",
        (kind, day, day, day, url, updated),
    ).fetchone()[0]
    conn.execute("DELETE FROM core.ranking_rows WHERE edition_id = %s", (edition,))
    written = unmatched = 0
    seen = set()
    for key, name, code, position, previous, points, image in rows:
        if kind == "uefa_associations":
            target = (None, association(conn, name))
        else:
            target = (national_team(conn, key, name, code) if kind == "fifa_men" else club(conn, key, name), None)
        if target == (None, None) or target in seen:
            unmatched += target == (None, None)
            continue
        seen.add(target)
        logo = conn.execute(
            "INSERT INTO core.assets(kind, source_url) VALUES ('logo', %s) ON CONFLICT (source_url) DO UPDATE SET source_url = EXCLUDED.source_url RETURNING id",
            (image,),
        ).fetchone()[0] if image else None
        written += 1
        conn.execute(
            """INSERT INTO core.ranking_rows(edition_id, row_no, team_id, country_code, position, previous_position, points, provider_key,
                 entity_name, image_asset_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (edition, written, *target, position, previous if isinstance(previous, int) and previous >= 1 else None, points, key, name, logo),
        )
    conn.execute(
        """INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('ranking', %s)
           ON CONFLICT (resource_kind, resource_id) DO UPDATE SET version = ops.resource_versions.version + 1, updated_at = now()""",
        (edition,),
    )
    return written, unmatched


def run(conn, get, scope, now):
    name = scope.removeprefix("rankings:")
    if name not in KINDS:
        raise ValueError(scope)
    key = os.environ.get("V2_SPORTSAPI_API_KEY")
    if not key:
        raise SourceError("NOT_CONFIGURED")
    body = get(BASE + name, headers={"Authorization": "Bearer " + key})
    return save(conn, KINDS[name], now.date().isoformat(), parse(body), BASE + name, (body.get("meta") or {}).get("updatedAt"))
