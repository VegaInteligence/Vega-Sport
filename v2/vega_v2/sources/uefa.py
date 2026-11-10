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
    """The running season daily (it changes after every European week), the three before it
    monthly: the four editions main keeps (a club's ranking history on its profile)."""
    end = current_end_year(now)
    return {
        **{f"{kind}:{end}": timedelta(days=1) for kind in KINDS},
        **{f"{kind}:{end - back}": timedelta(days=30) for kind in KINDS for back in (1, 2, 3)},
    }


def source_url(kind, year, page=1):
    return BASE + "?" + urlencode({
        "coefficientRange": "OVERALL", "coefficientType": KINDS[kind], "language": "EN",
        "page": page, "pagesize": 50, "seasonYear": year,
    })


def fetch(get, kind, year):
    members, updated, page = [], None, 1
    while True:
        body = get(source_url(kind, year, page))
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
    real = lambda value: float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None
    count = lambda value: int(value) if isinstance(value, int) and not isinstance(value, bool) else None
    for entry in members:
        member, rank = entry["member"], entry["overallRanking"]
        points = rank.get("totalValue", rank.get("totalPoints"))
        rows.append({
            "id": str(member["id"]),
            "name": member["displayName"],
            # Every spelling UEFA gives, for the strict name match (main's club_links).
            "names": [n for n in (member.get(k) for k in ("displayName", "displayOfficialName", "internationalName", "displayNameShort")) if n],
            "country": member.get("countryCode") or member.get("associationCode"),
            "position": int(rank["position"]) if rank.get("position") is not None else None,
            "points": float(points) if points is not None else None,
            "earned": real(rank.get("totalPoints")),
            "still": count(rank.get("numberOfTeamsStillInPlaying")),
            "logo": member.get("logoUrl") if isinstance(member.get("logoUrl"), str) and member["logoUrl"].startswith("https://") else None,
            "seasons": [
                (count(s.get("seasonYear")), real(s.get("totalPoints")), real(s.get("nationalAssociationPoints")), count(s.get("numberOfTeamsStillInPlaying")))
                for s in entry.get("seasonRankings") or [] if count(s.get("seasonYear"))
            ],
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
    candidates = set()
    if country:
        for spelling in {normalize(n) for n in row.get("names") or [row["name"]]} - {""}:
            candidates |= _candidates(conn, country, spelling)
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
    for spelling in dict.fromkeys(row.get("names") or [row["name"]]):
        if normalize(spelling):
            conn.execute(
                """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
                   VALUES ('team', %s, %s, %s, 'source_spelling', 'uefa') ON CONFLICT DO NOTHING""",
                (team, spelling, normalize(spelling)),
            )
    return team, linked


def save(conn, kind, year, rows, updated, now):
    """Replace one edition's rows; returns (rows written, clubs not linked to a team)."""
    label = f"{year - 1}/{year}"
    current = year == current_end_year(now)
    edition = conn.execute(
        """INSERT INTO core.ranking_editions(kind, provider, label, period, published_on, is_current, source_url, source_updated_at)
           VALUES (%s, 'uefa', %s, %s, %s, %s, %s, %s)
           ON CONFLICT (kind, provider, label) DO UPDATE SET published_on = EXCLUDED.published_on,
             is_current = EXCLUDED.is_current, source_url = EXCLUDED.source_url, source_updated_at = EXCLUDED.source_updated_at, updated_at = now()
           RETURNING id""",
        (kind, label, label, (updated or "")[:10] or None, current, source_url(kind, year), updated or None),
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
        logo = None
        if row.get("logo"):
            logo = conn.execute(
                """INSERT INTO core.assets(kind, source_url) VALUES ('logo', %s)
                   ON CONFLICT (source_url) DO UPDATE SET source_url = EXCLUDED.source_url RETURNING id""",
                (row["logo"],),
            ).fetchone()[0]
        conn.execute(
            """INSERT INTO core.ranking_rows(edition_id, row_no, team_id, country_code, position, points, provider_key, entity_name,
                 earned_points, teams_still_playing, image_asset_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (edition, row_no, *target, row["position"], row["points"], row["id"], row["name"], row.get("earned"), row.get("still"), logo),
        )
        for season_year, points, association, still in row.get("seasons") or []:
            conn.execute(
                """INSERT INTO core.ranking_season_points(edition_id, row_no, season_year, points, association_points, teams_still_playing)
                   VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                (edition, row_no, season_year, points, association, still),
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
    club_countries(conn)
    return save(conn, kind, int(year), rows, updated, now)


# Competitions that are no country (main's relational-clubs.js leaves them out the same way).
NOT_A_COUNTRY = ("UEFA", "INT", "INT-2", "FIFA", "EUR", "WORLD")


def club_countries(conn):
    """A PitchAPI club the source gives no country takes the country of the last domestic
    competition it played (main reads a club's country the same way); the UEFA links need
    it. Returns the clubs given a country."""
    return conn.execute(
        """UPDATE core.teams t SET country_code = x.country, updated_at = now()
           FROM (SELECT t2.id, (SELECT c.country_code FROM core.matches m
                   JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
                   JOIN core.competitions c ON c.id = cs.competition_id
                   WHERE (m.home_team_id = t2.id OR m.away_team_id = t2.id) AND c.country_code IS NOT NULL
                     AND c.country_code <> ALL(%s) AND c.kind IS DISTINCT FROM 'international'
                   ORDER BY m.kickoff_at DESC NULLS LAST, m.id DESC LIMIT 1) AS country
                 FROM core.teams t2
                 WHERE t2.country_code IS NULL AND t2.is_national IS NOT TRUE
                   AND EXISTS (SELECT 1 FROM core.provider_ids p WHERE p.entity_type = 'team' AND p.entity_id = t2.id AND p.provider = 'pitchapi')) x
           WHERE t.id = x.id AND x.country IS NOT NULL""",
        (list(NOT_A_COUNTRY),),
    ).rowcount


def reconcile_teams(conn):
    """A UEFA-only club that a PitchAPI team now names exactly (same country, unique) is
    merged into it: its UEFA id and ranking rows move, the UEFA-only team goes."""
    club_countries(conn)
    merged = 0
    for team, name, country in conn.execute(
        """SELECT t.id, t.name, t.country_code FROM core.teams t
           WHERE EXISTS (SELECT 1 FROM core.provider_ids p WHERE p.entity_type='team' AND p.entity_id=t.id AND p.provider='uefa')
             AND NOT EXISTS (SELECT 1 FROM core.provider_ids p WHERE p.entity_type='team' AND p.entity_id=t.id AND p.provider<>'uefa')"""
    ).fetchall():
        # Every spelling the UEFA rows gave this club: its display name ("Paris") and its
        # official one ("Paris Saint-Germain").
        spellings = {normalize(name)} | {
            n for (n,) in conn.execute(
                "SELECT normalized FROM core.entity_names WHERE entity_type='team' AND entity_id=%s", (team,)
            ).fetchall()
        }
        found = set()
        for spelling in spellings - {""}:
            found |= _candidates(conn, country, spelling)
        targets = {
            t for t in found
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
