"""Id mapping (doc "Correspondance des identifiants"): before kick-off, a provider match is
linked to its core match by the date and the teams, and its players through
core.provider_ids. Without that link the live page would not know its match.

The ingestor writes as the collect role: core and provider ids are read directly (no
api.* function), and public ids are built as api.public_id builds them.
"""

from datetime import timedelta

from ..sources import normalize

KICKOFF_TOLERANCE = timedelta(hours=3)


def public_id(conn, kind, ident, prefix):
    """The id the site knows: the current PitchAPI key, else Vega's own (api.public_id)."""
    if ident is None:
        return None
    row = conn.execute(
        "SELECT provider_key FROM core.provider_ids WHERE entity_type=%s AND entity_id=%s AND provider='pitchapi' AND is_current",
        (kind, ident),
    ).fetchone()
    return row[0] if row else f"{prefix}_v{ident:07d}"


def _spellings(conn, team):
    names = set()
    for row in conn.execute(
        """SELECT t.name, t.short_name, n.name FROM core.teams t
           LEFT JOIN core.entity_names n ON n.entity_type = 'team' AND n.entity_id = t.id WHERE t.id = %s""",
        (team,),
    ).fetchall():
        names.update(normalize(v) for v in row if v)
    return names - {""}


def _by_key(conn, provider, key, kind):
    if not provider or not key:
        return None
    row = conn.execute(
        "SELECT entity_id FROM core.provider_ids WHERE entity_type=%s AND provider=%s AND provider_key=%s",
        (kind, provider, key),
    ).fetchone()
    return row[0] if row else None


def link(conn, fixture, provider=None):
    """The core match of a provider fixture, or None (no match, or more than one)."""
    candidates = conn.execute(
        # PitchAPI matches only: a cup source's copy of the same fixture is another row.
        """SELECT id, home_team_id, away_team_id FROM core.matches
           WHERE source = 'pitchapi' AND kickoff_at BETWEEN %s AND %s AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL""",
        (fixture.kickoff_at - KICKOFF_TOLERANCE, fixture.kickoff_at + KICKOFF_TOLERANCE),
    ).fetchall()
    home_id = _by_key(conn, provider, fixture.home_key, "team")
    away_id = _by_key(conn, provider, fixture.away_key, "team")
    home_name, away_name = normalize(fixture.home), normalize(fixture.away)
    found = []
    for match, home, away in candidates:
        same_home = home == home_id if home_id else home_name in _spellings(conn, home)
        same_away = away == away_id if away_id else away_name in _spellings(conn, away)
        if same_home and same_away:
            found.append(match)
    return found[0] if len(found) == 1 else None


def player(conn, provider, key):
    """The public id of a provider's player, when core knows it."""
    ident = _by_key(conn, provider, key, "player")
    return public_id(conn, "player", ident, "p") if ident else None
