"""A source edition replaced by a later snapshot of it (VI-27, FAILURE_MODES.md §19).

The cup sources (cups.py) and open-matchday (open_matchday.py) publish each edition whole: the
snapshot read now replaces the one read before. A snapshot can be partial (an empty or truncated
file served with a 200, a fixture list still naming a match since played) while looking valid, so:

- a match the base holds finished must still be in the snapshot, finished (`guard`): otherwise
  the edition is kept as it was and the snapshot refused, unless the match is in RETRACTIONS; in
  the World Cup's archive, a match OpenFootball only numbers later is the same parent under its new
  key (`rekey`, cups._numbered);
- a match whose values have not changed is not written again (`write`): no revision, no
  `updated_at`; one that changed gets `revision + 1`; a new place in the source's order alone
  moves `archive_position` only;
- a writer can only change or remove the row it observed. If another transaction changed it,
  the snapshot transaction must roll back. A later read can use the new state for its guard;
- a withdrawn fixture goes when nothing else holds it but an ordinary forecast, which the forecast
  pass writes again; held by anything else (another source, odds, events, another authority's
  statistics or parent fields), it is refused, or with `held` kept as stored while the rest of the
  snapshot is written (FAILURE_MODES.md §35).

The removal of an open-matchday copy of a league PitchAPI holds (open_matchday.drop_copy) is a
reviewed decision of its own (VI-21) and does not pass through here.
"""

from psycopg.errors import LockNotAvailable

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
        f"""SELECT p.provider_key, p.is_current, m.id, m.revision, m.xmin::text,
             (SELECT jsonb_agg(jsonb_build_array(k.provider,k.provider_key,k.is_current))
              FROM core.provider_ids k WHERE k.entity_type='match' AND k.entity_id=m.id),
             {', '.join(COLUMNS.values())}
            FROM core.matches m JOIN core.provider_ids p ON p.entity_type = 'match' AND p.provider = %s AND p.entity_id = m.id
            WHERE {where}""",
        (provider, *args),
    ).fetchall()
    return {key: {"id": match, "revision": revision, "row_version": version, "is_current": current, "keys": keys,
                  **dict(zip(names, columns))}
            for key, current, match, revision, version, keys, *columns in rows}


def stored(conn, provider, edition):
    """{current provider key: {"id", "revision", column: value}} of the edition's matches."""
    return {} if edition is None else _read(conn, provider, "m.competition_season_id = %s AND p.is_current", (edition,))


def elsewhere(conn, provider, edition, keys):
    """Resolve current keys of another edition and refuse incoming keys retired in any edition."""
    if not keys:
        return {}
    matches = _read(conn, provider, "p.provider_key = ANY(%s) AND (NOT p.is_current OR m.competition_season_id IS DISTINCT FROM %s)",
                    (list(keys), edition))
    retired = sorted(key for key, match in matches.items() if not match["is_current"])
    if retired:
        raise SourceError("INACTIVE_MATCH_KEY", f"{provider}: retired match keys in the snapshot: {', '.join(retired[:5])}")
    return matches


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


def _claim(conn, provider, expected):
    """Lock the affected parents, then check their current keys in a fresh statement."""
    ids = sorted(expected)
    parents = {match: (version, source) for match, version, source in conn.execute(
        """SELECT id,xmin::text,source::text FROM core.matches WHERE id=ANY(%s)
           ORDER BY id FOR UPDATE""", (ids,))}
    try:
        keys = conn.execute(
            """SELECT entity_id,provider::text,provider_key,is_current FROM core.provider_ids
                WHERE entity_type='match' AND entity_id=ANY(%s)
                ORDER BY entity_id,provider,provider_key FOR UPDATE NOWAIT""", (ids,)).fetchall()
    except LockNotAvailable as error:
        # A concurrent key UPDATE already past its row lock can be waiting on our parent.
        # Refuse this snapshot and let the key writer finish, rather than waiting on it.
        raise SourceError("SNAPSHOT_CHANGED", f"{provider}: match keys are being changed") from error
    ownership = {}
    for match, owner, key, active in keys:
        ownership.setdefault(match, set()).add((owner, key, active))
    for match, (old, key) in expected.items():
        parent = parents.get(match)
        if parent is None or parent[0] != old["row_version"] or ownership.get(match) != set(map(tuple, old["keys"])):
            raise SourceError("SNAPSHOT_CHANGED", f"{provider}: {key} or its keys changed after the snapshot read")
        if parent[1] != provider or any(owner != provider for owner, _, _ in old["keys"]):
            raise SourceError("SHARED_MATCH", f"{provider}: {key} is held by another source")


# An ordinary forecast: the forecast pass writes a season's forecasts again for the matches still to play
# (forecast.py), so it never holds a withdrawal, and the collection never writes agg (FAILURE_MODES.md §35).
LAPSING = ("agg.match_forecasts.match_id",)
# A match's own fields that no snapshot writes (COLUMNS): another authority's facts on the parent.
PARENT_FIELDS = ("kickoff_at", "venue_id", "referee_id", "attendance")


def _guard_dependents(conn, provider, ids, stat_columns):
    """{match id: what holds it} of the withdrawn matches (locked by _claim) that must stay: another authority's
    statistics, a parent field no snapshot writes, or anything else naming the match but an ordinary forecast."""
    held = {}
    owned = ["core.provider_ids.entity_id", *LAPSING]
    if stat_columns:
        # The match lock excludes late FK inserts. Existing statistic rows can be
        # enriched without taking that lock, so lock them before checking their fields.
        try:
            stats = conn.execute(
                """SELECT s.match_id,jsonb_strip_nulls(to_jsonb(s)) -
                          (ARRAY['season_id','match_id','team_id','period','updated_at']::text[] ||
                           CASE WHEN s.period='all' THEN %s::text[] ELSE ARRAY['corners']::text[] END)
                   FROM core.team_match_stats s WHERE s.match_id=ANY(%s)
                   ORDER BY season_id,match_id,team_id,period FOR UPDATE NOWAIT""", (stat_columns, ids)).fetchall()
        except LockNotAvailable as error:
            raise SourceError("SNAPSHOT_CHANGED", f"{provider}: match statistics are being enriched") from error
        for match, fields in stats:
            if fields:
                held.setdefault(match, "other team statistics: " + ", ".join(sorted(fields)))
        owned.append("core.team_match_stats.match_id")
    for match, *values in conn.execute(
            f"SELECT id, {', '.join(PARENT_FIELDS)} FROM core.matches WHERE id = ANY(%s) ORDER BY id", (ids,)).fetchall():
        fields = [name for name, value in zip(PARENT_FIELDS, values) if value is not None]
        if fields:
            held.setdefault(match, ", ".join(f"core.matches.{name}" for name in fields))
    for start in range(0, len(ids), 5000):
        batch = ids[start:start + 5000]
        for match, dependency in conn.execute(
            """SELECT d.match_id,d.dependency FROM ops.archive_match_dependents(%s::integer[]) d
                 WHERE d.dependency <> ALL(%s)
               UNION ALL SELECT e.match_id,'core.match_events' FROM core.match_events e WHERE e.match_id=ANY(%s)
               ORDER BY 1, 2""", (batch, owned, batch)).fetchall():
            held.setdefault(match, dependency)
    return held


def rekey(conn, provider, found, old, new):
    """Give a stored match the key its source now writes for it: its one current key `old`, renamed `new` in place.
    The parent, its id and every row naming it stay. Claimed as a change: SNAPSHOT_CHANGED when the parent or its
    keys changed since the read. Returns its stored() entry under `new`."""
    _claim(conn, provider, {found["id"]: (found, old)})
    renamed = conn.execute(
        """UPDATE core.provider_ids SET provider_key=%s, updated_at=now()
           WHERE entity_type='match' AND provider=%s AND provider_key=%s AND entity_id=%s AND is_current""",
        (new, provider, old, found["id"])).rowcount
    if renamed != 1:
        raise SourceError("SNAPSHOT_CHANGED", f"{provider}: {old} changed after the snapshot read")
    return dict(found, keys=[[provider, new, True]])


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
        assignments = ", ".join(f"{c}=%s" for c in columns) + ", revision=revision+1, updated_at=now()"
        args, outcome = [values[c] for c in columns], "updated"
    elif "archive_position" in values and values["archive_position"] != found["archive_position"]:
        assignments = "archive_position=%s"
        args, outcome = [values["archive_position"]], "moved"
    else:
        return found["id"], None
    # The physical version includes changes of archive_position and corrections that
    # do not bump the public revision. The parent and key locks survive until commit.
    _claim(conn, provider, {found["id"]: (found, key)})
    conn.execute(f"UPDATE core.matches SET {assignments} WHERE id=%s", (*args, found["id"]))
    return found["id"], outcome


def remove(conn, provider, before, keep, stat_columns=None, held=None):
    """Delete matches whose current keys the snapshot withdrew, including their former aliases. A match something
    else holds refuses the snapshot (SourceError MATCH_HAS_DEPENDENTS or SHARED_MATCH); with `held` (a dict), it stays
    as stored instead and is added to it, {key: (code, detail)}, while the others go (FAILURE_MODES.md §35)."""
    gone = {m["id"]: (m, key) for key, m in before.items() if key not in keep}
    if held is not None:
        for match, (m, key) in sorted(gone.items()):
            if m["source"] != provider or any(owner != provider for owner, _, _ in m["keys"]):
                held[key] = ("SHARED_MATCH", f"{provider}: {key} (match {match}) is held by another source")
                del gone[match]
    if gone:
        _claim(conn, provider, gone)
        holding = _guard_dependents(conn, provider, sorted(gone), stat_columns)
        if holding and held is None:
            match = min(holding)
            raise SourceError("MATCH_HAS_DEPENDENTS", f"{provider}: match {match} is held by {holding[match]}")
        for match, what in sorted(holding.items()):
            held[gone[match][1]] = ("MATCH_HAS_DEPENDENTS", f"{provider}: {gone[match][1]} (match {match}) is held by {what}")
            del gone[match]
    if gone:
        conn.execute("DELETE FROM core.provider_ids WHERE entity_type='match' AND provider=%s AND entity_id = ANY(%s)",
                     (provider, list(gone)))
        conn.execute("DELETE FROM core.matches WHERE id=ANY(%s)", (list(gone),))
    return len(gone)
