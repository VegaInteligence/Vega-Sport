"""Names curated by Vega (dashboard/shared on main), written as core.entity_names.

Player search aliases (shared/player-aliases.js): an alias belongs to one provider
identity, never to every player with that name. An alias whose player is not known
yet is counted as unmatched and written on a later run, once PitchAPI has seen him.
"""

from datetime import timedelta

# dashboard/shared/player-aliases.js (main); a drift test compares the two.
PLAYER_ALIASES = {"p_3yEwhj": ("cr7",)}
# Reviewed UEFA spellings of clubs (club_links() of dashboard/scripts/collect_rankings.py
# on main): a club named as the key is also known by the value. A drift test compares them.
CLUB_ALIASES = {
    "Newcastle United": "Newcastle United FC", "Nottingham Forest": "Nottingham Forest FC",
    "Slovan Bratislava": "ŠK Slovan Bratislava", "PSG": "Paris Saint-Germain", "Inter": "Internazionale Milano",
    "Inter Milan": "Internazionale Milano", "Manchester City": "Manchester City FC", "Manchester United": "Manchester United FC",
    "Tottenham": "Tottenham Hotspur", "Bayern München": "Bayern München", "Bayern Munich": "Bayern München",
    "Barcelona": "FC Barcelona", "Atletico Madrid": "Atlético de Madrid", "Atlético Madrid": "Atlético de Madrid",
    "Sporting CP": "Sporting Clube de Portugal", "FC Porto": "FC Porto", "FC København": "FC København", "FCSB": "FCSB",
    "Bodø/Glimt": "Bodø/Glimt",
}


def scopes(now):
    return {"player_aliases": timedelta(days=1), "club_aliases": timedelta(days=1), "stadium_plans": timedelta(days=1)}


def stadium_plans(conn):
    """Stadium plans of frontend/src/services/stadium-plans.js (main), on the venues of the
    same Wikidata id; a stadium not known yet is counted unmatched and written later."""
    from . import wikidata

    written = unmatched = 0
    for qid, plans in (wikidata.bridge("plans") or {}).items():
        venue = wikidata._entity(conn, "venue", qid)
        if venue is None:
            unmatched += 1
            continue
        conn.execute("DELETE FROM core.venue_plans WHERE venue_id=%s", (venue,))
        for seq, plan in enumerate(plans):
            image = None
            if plan.get("imageUrl"):
                image = conn.execute(
                    """INSERT INTO core.assets(kind, source_url) VALUES ('venue_plan', %s)
                       ON CONFLICT (source_url) DO UPDATE SET source_url=EXCLUDED.source_url RETURNING id""",
                    (plan["imageUrl"],),
                ).fetchone()[0]
            conn.execute(
                """INSERT INTO core.venue_plans(venue_id, seq, title, url, image_asset_id, source, detail, format, is_embedded, allow_geolocation)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (venue, seq, plan["title"], plan.get("url"), image, plan.get("source"), plan.get("detail"), plan.get("format"),
                 bool(plan.get("embedded")), bool(plan.get("allowGeolocation"))),
            )
            written += 1
    return written, unmatched


def club_aliases(conn):
    """The reviewed spelling of each club named as a key (several clubs may share a name:
    each gets it; the UEFA link still needs the same country and a unique match)."""
    from . import normalize

    written = 0
    for name, alias in CLUB_ALIASES.items():
        for (team,) in conn.execute("SELECT id FROM core.teams WHERE name = %s AND is_national IS NOT TRUE", (name,)).fetchall():
            written += conn.execute(
                """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
                   VALUES ('team', %s, %s, %s, 'alias', 'vega') ON CONFLICT DO NOTHING""",
                (team, alias, normalize(alias)),
            ).rowcount
    return written, 0


def run(conn, get, scope, now):
    if scope == "club_aliases":
        return club_aliases(conn)
    if scope == "stadium_plans":
        return stadium_plans(conn)
    if scope != "player_aliases":
        raise ValueError(scope)
    written = unmatched = 0
    known = set()
    for key, aliases in PLAYER_ALIASES.items():
        row = conn.execute(
            "SELECT entity_id FROM core.provider_ids WHERE entity_type='player' AND provider='pitchapi' AND provider_key=%s AND is_current",
            (key,),
        ).fetchone()
        if row is None:
            unmatched += 1
            continue
        for alias in aliases:
            known.add((row[0], alias))
            written += conn.execute(
                """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
                   VALUES ('player', %s, %s, %s, 'alias', 'vega')
                   ON CONFLICT (entity_type, entity_id, normalized) DO NOTHING""",
                (row[0], alias, alias.lower()),
            ).rowcount
    # An alias removed from the list goes away; names of other sources are not touched.
    for entity_id, normalized in conn.execute(
        "SELECT entity_id, normalized FROM core.entity_names WHERE entity_type='player' AND kind='alias' AND source='vega'"
    ).fetchall():
        if (entity_id, normalized) not in known:
            conn.execute(
                "DELETE FROM core.entity_names WHERE entity_type='player' AND entity_id=%s AND normalized=%s AND source='vega'",
                (entity_id, normalized),
            )
            written += 1
    return written, unmatched
