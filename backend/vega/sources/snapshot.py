"""A source edition replaced by a later snapshot of it (VI-27, FAILURE_MODES.md §19).

The cup sources (cups.py) and open-matchday (open_matchday.py) publish each edition whole: the
snapshot read now replaces the one read before. A snapshot can be partial (an empty or truncated
file served with a 200, a fixture list still naming a match since played) while looking valid, so:

- a match the base holds finished must still be in the snapshot, finished (`guard`): otherwise
  the edition is kept as it was and the snapshot refused, unless the match is in RETRACTIONS;
- a match whose values have not changed is not written again (`write`): no revision, no
  `updated_at`; one that changed gets `revision + 1`; a new place in the source's order alone
  moves `archive_position` only.

The removal of an open-matchday copy of a league PitchAPI holds (open_matchday.drop_copy) is a
reviewed decision of its own (VI-21) and does not pass through here.
"""

from . import SourceError

# Results a later, complete snapshot of their source really withdrew or left unplayed, written here
# once reviewed: {(provider, match provider key): "reviewer, date: reason"}. The next read of the
# edition may then remove or downgrade that match, and that match only.
RETRACTIONS = {}

# The columns of core.matches a cup source writes, read back as the writers compare them.
COLUMNS = {
    "status": "m.status::text", "match_date": "m.match_date::text", "source": "m.source::text",
    **{c: f"m.{c}" for c in (
        "competition_season_id", "season_id", "home_team_id", "away_team_id", "home_team_name", "away_team_name", "round_id",
        "group_name", "match_number", "archive_position", "is_neutral", "home_score", "away_score", "home_score_90",
        "away_score_90", "home_score_ht", "away_score_ht", "home_score_et", "away_score_et", "home_penalty_score",
        "away_penalty_score")},
}


def _read(conn, provider, where, args):
    names = list(COLUMNS)
    rows = conn.execute(
        f"""SELECT p.provider_key, m.id, m.revision, {', '.join(COLUMNS.values())}
            FROM core.matches m JOIN core.provider_ids p ON p.entity_type = 'match' AND p.provider = %s AND p.entity_id = m.id
            WHERE {where}""",
        (provider, *args),
    ).fetchall()
    return {r[0]: {"id": r[1], "revision": r[2], **dict(zip(names, r[3:]))} for r in rows}


def stored(conn, provider, edition):
    """{provider key: {"id", "revision", column: value}} of the edition's matches (none for a new edition)."""
    return {} if edition is None else _read(conn, provider, "m.competition_season_id = %s", (edition,))


def elsewhere(conn, provider, edition, keys):
    """The same, for those of `keys` the provider gave a match of another edition: the writer moves
    such a match into this edition, as it always did, rather than creating a second one."""
    return _read(conn, provider, "p.provider_key = ANY(%s) AND m.competition_season_id IS DISTINCT FROM %s", (list(keys), edition)) if keys else {}


def guard(provider, before, after, label):
    """Refuse the snapshot when it would drop or downgrade a finished match of the edition.

    `before`: stored(); `after`: {provider key: status} of the snapshot; `label`: the edition, for the detail."""
    def reviewed(key):
        return (provider, key) in RETRACTIONS

    dropped = sorted(k for k, m in before.items() if m["status"] == "finished" and k not in after and not reviewed(k))
    downgraded = sorted(k for k, m in before.items()
                        if m["status"] == "finished" and k in after and after[k] != "finished" and not reviewed(k))
    for code, keys in (("SNAPSHOT_DROPS_RESULT", dropped), ("RESULT_DOWNGRADED", downgraded)):
        if keys:
            shown = ", ".join(keys[:5]) + (f" and {len(keys) - 5} more" if len(keys) > 5 else "")
            raise SourceError(code, f"{label}: {len(keys)} finished match(es) of {len(before)} kept, as the snapshot "
                                    f"{'lacks' if code == 'SNAPSHOT_DROPS_RESULT' else 'leaves unplayed'}: {shown}")


def write(conn, provider, key, values, found, changed=False):
    """Insert, update or leave one match: "inserted", "updated", "moved" (its place alone) or None.

    `values`: {column: value} of COLUMNS; `found`: its stored() entry or None; `changed`: a change
    the columns do not show (its statistics)."""
    columns = list(values)
    if found is None:
        mid = conn.execute(f"INSERT INTO core.matches({', '.join(columns)}) VALUES ({', '.join(['%s'] * len(columns))}) RETURNING id",
                           [values[c] for c in columns]).fetchone()[0]
        conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match',%s,%s,%s)",
                     (provider, key, mid))
        return mid, "inserted"
    differs = [c for c in columns if c != "archive_position" and values[c] != found[c]]
    if differs or changed:
        conn.execute(f"UPDATE core.matches SET {', '.join(f'{c}=%s' for c in columns)}, revision=revision+1, updated_at=now() WHERE id=%s",
                     [values[c] for c in columns] + [found["id"]])
        return found["id"], "updated"
    if values.get("archive_position") != found["archive_position"]:
        conn.execute("UPDATE core.matches SET archive_position=%s WHERE id=%s", (values["archive_position"], found["id"]))
        return found["id"], "moved"
    return found["id"], None


def remove(conn, provider, before, keep):
    """Delete the edition's matches the snapshot no longer holds (guard() allowed it); returns how many."""
    gone = [m["id"] for k, m in before.items() if k not in keep]
    if gone:
        conn.execute("DELETE FROM core.matches WHERE id = ANY(%s)", (gone,))
        conn.execute("DELETE FROM core.provider_ids WHERE entity_type='match' AND provider=%s AND entity_id = ANY(%s)", (provider, gone))
    return len(gone)
