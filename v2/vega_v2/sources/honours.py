"""Player honours from Wikipedia, by main's own collector (dashboard/scripts/player_honours.py,
imported as it is): a player is joined to Wikidata only when his name and an observed team
identify exactly one footballer, then his article's Honours section is read.

As on main: the most-played players of the two latest seasons first, Lionel Messi always
(his page shows the curated list), about a hundred players a day, each at most weekly; a
player whose name gives no unique identity is not rewritten, an error never erases.
"""

from datetime import timedelta
import os
from pathlib import Path
import re
import sys

BATCH = 4  # per hourly run: about a hundred a day
PERIOD = timedelta(days=7)
MESSI = "p_1mZO3B"
SCRIPTS = Path(os.environ.get("VEGA_ARCHIVE_SCRIPTS", Path(__file__).resolve().parents[3] / "dashboard/scripts"))
QID = re.compile(r"^https://www\.wikidata\.org/wiki/(Q[1-9]\d{0,11})$")


def _collector():
    if str(SCRIPTS) not in sys.path:
        sys.path.insert(0, str(SCRIPTS))
    import player_honours

    return player_honours


def collect(name, observations):
    return _collector().collect_player(name, observations)


def scopes(now):
    return {"players": timedelta(hours=1)}


def candidates(conn, now, limit):
    """(player id, name, observations) of the players due, Messi first."""
    # The worker writes as the collect role: no api.* function here, provider ids directly.
    messi = conn.execute(
        "SELECT entity_id FROM core.provider_ids WHERE entity_type='player' AND provider='pitchapi' AND provider_key=%s AND is_current", (MESSI,)
    ).fetchone()
    messi = messi[0] if messi else None
    rows = conn.execute(
        """WITH seasons AS (SELECT id FROM core.seasons WHERE id <= extract(year FROM %s::timestamptz) ORDER BY id DESC LIMIT 2),
           played AS (
             SELECT s.player_id, sum(s.minutes_played) AS minutes FROM core.player_match_stats s
             WHERE s.season_id IN (SELECT id FROM seasons) AND s.minutes_played > 0 GROUP BY s.player_id
           )
           SELECT p.id, p.name FROM core.players p
           LEFT JOIN played x ON x.player_id = p.id
           WHERE (x.player_id IS NOT NULL OR p.id IS NOT DISTINCT FROM %s)
             AND (p.honours_checked_at IS NULL OR p.honours_checked_at < %s
                  OR (p.id IS NOT DISTINCT FROM %s AND p.honours_checked_at < %s))
           ORDER BY (p.id IS NOT DISTINCT FROM %s) DESC, x.minutes DESC NULLS LAST, p.id LIMIT %s""",
        (now, messi, now - PERIOD, messi, now - timedelta(days=1), messi, limit),
    ).fetchall()
    out = []
    for player, name in rows:
        observations = [
            {"team": team, "date": str(day)}
            for team, day in conn.execute(
                """SELECT t.name, max(m.match_date) FROM core.player_match_stats s
                   JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id
                   JOIN core.teams t ON t.id = s.team_id
                   WHERE s.player_id = %s AND s.minutes_played > 0 AND m.match_date IS NOT NULL GROUP BY t.name""",
                (player,),
            ).fetchall()
        ]
        out.append((player, name, observations))
    return out


def save(conn, player, body, now):
    qid = QID.match(str(body.get("identitySourceUrl") or ""))
    if not qid:
        return False
    owner = conn.execute(
        "SELECT entity_id FROM core.provider_ids WHERE entity_type='player' AND provider='wikidata' AND provider_key=%s", (qid.group(1),)
    ).fetchone()
    if owner and owner[0] != player:  # this footballer is another player already
        return False
    if not owner:
        conn.execute("UPDATE core.provider_ids SET is_current=false WHERE entity_type='player' AND entity_id=%s AND provider='wikidata'", (player,))
        conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player','wikidata',%s,%s)", (qid.group(1), player))
    conn.execute("DELETE FROM core.player_honour_titles WHERE player_id=%s", (player,))
    seq = 0
    for row in body.get("honours") or []:
        if row.get("category") not in ("team", "individual") or not row.get("name") or not row.get("seasons"):
            continue
        conn.execute(
            "INSERT INTO core.player_honour_titles(player_id, seq, category, name, team, seasons) VALUES (%s,%s,%s,%s,%s,%s)",
            (player, seq, row["category"], row["name"], row.get("team") if row["category"] == "team" else None, list(row["seasons"])),
        )
        seq += 1
    conn.execute(
        """UPDATE core.players SET honours_source_url=%s, honours_revision=%s, honours_fetched_at=%s, honours_checked_at=%s, updated_at=now()
           WHERE id=%s""",
        (body.get("sourceUrl"), body.get("revision"), body.get("fetchedAt") or now, now, player),
    )
    return True


def run(conn, get, scope, now):
    if scope != "players":
        raise ValueError(scope)
    written = unresolved = 0
    for player, name, observations in candidates(conn, now, BATCH):
        try:
            body = collect(name, observations)
        except Exception:  # the collector's network or parsing error: retried on a later run
            body = None
        with conn.transaction():
            if body and save(conn, player, body, now):
                written += 1
            else:
                unresolved += 1
                conn.execute("UPDATE core.players SET honours_checked_at=%s WHERE id=%s", (now, player))
    return written, unresolved
