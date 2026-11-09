"""UEFA five-year coefficients of clubs and associations (comp.uefa.com).

Same reading as dashboard/scripts/collect_rankings.py on main: the coefficient is
overallRanking.totalValue (association floor included); `period` is the season, the
edition label its "YYYY/YYYY+1" form. Clubs are linked to our teams only on the same
country and an exact normalized name or alias that designates one team; otherwise the
UEFA club becomes its own team, linked later by reconcile_teams (never a fuzzy match).
"""

from datetime import timedelta
from urllib.parse import urlencode

from . import SourceError, normalize

BASE = "https://comp.uefa.com/v2/coefficients"
KINDS = {"uefa_clubs": "MEN_CLUB", "uefa_associations": "MEN_ASSOCIATION"}
MAX_PAGES = 100


def current_end_year(now):
    return now.year + 1 if now.month >= 7 else now.year


def scopes(now):
    """The running season daily (it changes after every European week), the last one monthly."""
    end = current_end_year(now)
    return {
        **{f"{kind}:{end}": timedelta(days=1) for kind in KINDS},
        **{f"{kind}:{end - 1}": timedelta(days=30) for kind in KINDS},
    }


def fetch(get, kind, year):
    members, updated, page = [], None, 1
    while True:
        body = get(BASE + "?" + urlencode({
            "coefficientRange": "OVERALL", "coefficientType": KINDS[kind], "language": "EN",
            "page": page, "pagesize": 50, "seasonYear": year,
        }))
        data = body["data"]
        part = data["members"]
        members.extend(part)
        updated = data.get("lastUpdateDate") or updated
        total = int(body["meta"]["collection"]["totalElements"])
        if len(members) >= total:
            break
        if not part or page >= MAX_PAGES:
            raise SourceError("INCOMPLETE_PAGINATION")
        page += 1
    if len(members) != total:
        raise SourceError("INCOMPLETE_PAGINATION")
    rows = []
    for entry in members:
        member, rank = entry["member"], entry["overallRanking"]
        points = rank.get("totalValue", rank.get("totalPoints"))
        rows.append({
            "id": str(member["id"]),
            "name": member["displayName"],
            "country": member.get("countryCode") or member.get("associationCode"),
            "position": int(rank["position"]) if rank.get("position") is not None else None,
            "points": float(points) if points is not None else None,
        })
    return rows, updated


def _country(conn, code):
    if code:
        conn.execute("INSERT INTO core.countries(code) VALUES (%s) ON CONFLICT DO NOTHING", (code,))
    return code


def _candidates(conn, country, key):
    found = set()
    for team, name, short, alias in conn.execute(
        """SELECT t.id, t.name, t.short_name, n.name FROM core.teams t
           LEFT JOIN core.entity_names n ON n.entity_type = 'team' AND n.entity_id = t.id
           WHERE t.country_code = %s AND t.is_national IS NOT TRUE""",
        (country,),
    ):
        if key in {normalize(name), normalize(short), normalize(alias)} - {""}:
            found.add(team)
    return found


def link_team(conn, row):
    """(team id, linked to an existing team?)."""
    known = conn.execute(
        "SELECT entity_id FROM core.provider_ids WHERE entity_type='team' AND provider='uefa' AND provider_key=%s",
        (row["id"],),
    ).fetchone()
    if known:
        return known[0], True
    country = _country(conn, row["country"])
    key = normalize(row["name"])
    candidates = _candidates(conn, country, key) if country and key else set()
    # A team that already carries another UEFA id is not this club.
    candidates = {
        t for t in candidates
        if not conn.execute("SELECT 1 FROM core.provider_ids WHERE entity_type='team' AND provider='uefa' AND entity_id=%s", (t,)).fetchone()
    }
    linked = len(candidates) == 1
    if linked:
        team = candidates.pop()
    else:
        team = conn.execute(
            "INSERT INTO core.teams(name, country_code, is_national) VALUES (%s, %s, false) RETURNING id", (row["name"], country)
        ).fetchone()[0]
    conn.execute(
        "INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'uefa', %s, %s)",
        (row["id"], team),
    )
    if key:
        conn.execute(
            """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
               VALUES ('team', %s, %s, %s, 'source_spelling', 'uefa') ON CONFLICT DO NOTHING""",
            (team, row["name"], key),
        )
    return team, linked


def save(conn, kind, year, rows, updated, now):
    """Replace one edition's rows; returns (rows written, clubs not linked to a team)."""
    label = f"{year - 1}/{year}"
    current = year == current_end_year(now)
    edition = conn.execute(
        """INSERT INTO core.ranking_editions(kind, provider, label, period, published_on, is_current)
           VALUES (%s, 'uefa', %s, %s, %s, %s)
           ON CONFLICT (kind, provider, label) DO UPDATE SET published_on = EXCLUDED.published_on,
             is_current = EXCLUDED.is_current, updated_at = now()
           RETURNING id""",
        (kind, label, label, (updated or "")[:10] or None, current),
    ).fetchone()[0]
    if current:
        conn.execute(
            "UPDATE core.ranking_editions SET is_current = (id = %s) WHERE kind = %s AND provider = 'uefa'",
            (edition, kind),
        )
    conn.execute("DELETE FROM core.ranking_rows WHERE edition_id = %s", (edition,))
    written, unmatched, seen = 0, 0, set()
    for row_no, row in enumerate(rows, 1):
        if kind == "uefa_clubs":
            team, linked = link_team(conn, row)
            unmatched += not linked
            if team in seen:  # one club, one row per edition
                continue
            seen.add(team)
            target = (team, None)
        else:
            target = (None, _country(conn, row["country"]))
            if target[1] is None:
                continue
        conn.execute(
            "INSERT INTO core.ranking_rows(edition_id, row_no, team_id, country_code, position, points) VALUES (%s,%s,%s,%s,%s,%s)",
            (edition, row_no, *target, row["position"], row["points"]),
        )
        written += 1
    # The European level reads the current club coefficients: its cohorts recalculate.
    conn.execute(
        """INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('ranking', %s)
           ON CONFLICT (resource_kind, resource_id) DO UPDATE SET version = ops.resource_versions.version + 1, updated_at = now()""",
        (edition,),
    )
    return written, unmatched


def run(conn, get, scope, now):
    kind, year = scope.split(":")
    rows, updated = fetch(get, kind, int(year))
    return save(conn, kind, int(year), rows, updated, now)


def reconcile_teams(conn):
    """A UEFA-only club that a PitchAPI team now names exactly (same country, unique) is
    merged into it: its UEFA id and ranking rows move, the UEFA-only team goes."""
    merged = 0
    for team, name, country in conn.execute(
        """SELECT t.id, t.name, t.country_code FROM core.teams t
           WHERE EXISTS (SELECT 1 FROM core.provider_ids p WHERE p.entity_type='team' AND p.entity_id=t.id AND p.provider='uefa')
             AND NOT EXISTS (SELECT 1 FROM core.provider_ids p WHERE p.entity_type='team' AND p.entity_id=t.id AND p.provider<>'uefa')"""
    ).fetchall():
        targets = {
            t for t in _candidates(conn, country, normalize(name))
            if t != team and conn.execute(
                "SELECT 1 FROM core.provider_ids WHERE entity_type='team' AND provider='pitchapi' AND entity_id=%s", (t,)
            ).fetchone()
            and not conn.execute(
                "SELECT 1 FROM core.provider_ids WHERE entity_type='team' AND provider='uefa' AND entity_id=%s", (t,)
            ).fetchone()
        }
        if len(targets) != 1:
            continue
        target = targets.pop()
        conn.execute("UPDATE core.ranking_rows SET team_id=%s WHERE team_id=%s", (target, team))
        conn.execute("UPDATE core.provider_ids SET entity_id=%s WHERE entity_type='team' AND entity_id=%s", (target, team))
        conn.execute(
            """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, valid_from, valid_to, source)
               SELECT entity_type, %s, name, normalized, kind, valid_from, valid_to, source FROM core.entity_names
               WHERE entity_type='team' AND entity_id=%s ON CONFLICT DO NOTHING""",
            (target, team),
        )
        conn.execute("DELETE FROM core.entity_names WHERE entity_type='team' AND entity_id=%s", (team,))
        conn.execute("DELETE FROM core.teams WHERE id=%s", (team,))
        merged += 1
    return merged
