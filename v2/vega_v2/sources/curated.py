"""Names curated by Vega (dashboard/shared on main), written as core.entity_names.

Player search aliases (shared/player-aliases.js): an alias belongs to one provider
identity, never to every player with that name. An alias whose player is not known
yet is counted as unmatched and written on a later run, once PitchAPI has seen him.
"""

from datetime import timedelta

# dashboard/shared/player-aliases.js (main); a drift test compares the two.
PLAYER_ALIASES = {"p_3yEwhj": ("cr7",)}


def scopes(now):
    return {"player_aliases": timedelta(days=1)}


def run(conn, get, scope, now):
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
