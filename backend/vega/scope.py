"""The competitions Vega does not hold.

The user removed these on 18 November 2026: leagues outside the product's scope (Asia but
Saudi Arabia and Qatar, most of South America, Africa), the second divisions it does not
follow, women's football (men only for now) and some smaller European leagues. Their
sources still list them; nothing of them is written (worker.py, sources/open_matchday.py),
and what was written before goes with purge(). Taking a key off a list brings the league
back at the next collection.
"""

# PitchAPI's league keys (core.provider_ids, provider 'pitchapi').
REMOVED = {
    "l_2ApGa4": "J. League (JPN)",
    "l_3fglZv": "J3 League (JPN)",
    "l_2EKrnc": "K League 1 (KOR)",
    "l_271pqa": "K League 2 (KOR)",
    "l_1qpFVw": "Indian Super League (IND)",
    "l_3hW1NO": "Thai League 1 (THA)",
    "l_20pNSc": "Super League (CHN)",
    "l_4dzm4e": "Primera Division (BOL)",
    "l_4FPF2L": "Division Profesional (PAR)",
    "l_3uNwVX": "Liga 1 (PER)",
    "l_1TVRZW": "Primera Division (VEN)",
    "l_3qNjzC": "Liga de Primera (CHI)",
    "l_46aZMC": "Premier League (EGY)",
    "l_1Kknkl": "Premier Soccer League (RSA)",
    "l_3CB6qX": "Saudi First Division (KSA)",
    "l_1SGwQT": "Women's Premier League (KSA)",
    "l_45xKXM": "Virsliga (LVA)",
    "l_1XsMdH": "Allsvenskan (SWE)",
    "l_1rPvVD": "1. Division (DEN)",
    "l_3Tn1kG": "MLS Next Pro (USA)",
    "l_3Kf7Ni": "USL League One (USA)",
}

# open-matchday's folders. Allsvenskan is here too: with PitchAPI's league gone, its copy
# would otherwise be read again (open_matchday.held).
REMOVED_FOLDERS = {
    "CYP_1_first-division": "Cyprus League",
    "KAZ_1_premier-league": "Kazakhstan Premier League",
    "SVN_1_prva-liga": "Prva Liga (SVN)",
    "IRE_2_first-division": "League of Ireland First Division",
    "IRE_3_national-league": "League of Ireland National League",
    "SCO_2_championship": "Scottish Championship",
    "SCO_3_league-one": "Scottish League One",
    "SCO_4_league-two": "Scottish League Two",
    "WAL_2_cymru-north": "Cymru North",
    "WAL_3_cymru-south": "Cymru South",
    "SWE_1_allsvenskan": "Allsvenskan (SWE)",
}

# Historical archives (vega/archives.py), by archive family: the same leagues' past seasons.
REMOVED_ARCHIVES = {
    "engsoccerdata/scotland/2": "Scotland, second tier (Scottish Championship)",
    "engsoccerdata/scotland/3": "Scotland, third tier (Scottish League One)",
    "engsoccerdata/scotland/4": "Scotland, fourth tier (Scottish League Two)",
}


def league_key(item):
    """The PitchAPI league key of a match or league payload item, or None."""
    if not isinstance(item, dict):
        return None
    league = item.get("league", item)
    if isinstance(league, str):
        return league
    return league.get("id") if isinstance(league, dict) else None


def kept(items):
    """The payload items (matches or leagues) of a league Vega holds."""
    return [item for item in items if league_key(item) not in REMOVED]


def _referrers(conn, table):
    """The foreign keys to `table` that block a delete (no ON DELETE action): the child
    table and the column pairs. Read from the catalogue, so a table added later is covered."""
    return conn.execute(
        """SELECT con.conrelid::regclass::text,
                  ARRAY(SELECT quote_ident(a.attname) FROM unnest(con.conkey) WITH ORDINALITY k(n, i)
                        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n ORDER BY k.i),
                  ARRAY(SELECT quote_ident(a.attname) FROM unnest(con.confkey) WITH ORDINALITY k(n, i)
                        JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n ORDER BY k.i)
           FROM pg_constraint con
           WHERE con.contype = 'f' AND con.conparentid = 0 AND con.confrelid = %s::regclass
             AND con.confdeltype IN ('a', 'r') AND con.conrelid <> con.confrelid
           ORDER BY 1""",
        (table,),
    ).fetchall()


def _delete(conn, table, where, params, skip=(), depth=0):
    """Delete the rows of `table` matching `where`, the rows that block it first (but in the
    schemas `skip` names: those are cleared before, by the role that writes them)."""
    if depth > 5:
        raise RuntimeError("PURGE_TOO_DEEP")
    for child, columns, parents in _referrers(conn, table):
        if child.split(".", 1)[0] not in skip:
            _delete(conn, child, f"({', '.join(columns)}) IN (SELECT {', '.join(parents)} FROM {table} WHERE {where})", params, skip, depth + 1)
    return conn.execute(f"DELETE FROM {table} WHERE {where}", params).rowcount


def _clear(calc, table, where, params, depth=0):
    """Delete, in agg, the rows that would block deleting the rows of `table` matching `where`."""
    if depth > 5:
        raise RuntimeError("PURGE_TOO_DEEP")
    for child, columns, parents in _referrers(calc, table):
        nested = f"({', '.join(columns)}) IN (SELECT {', '.join(parents)} FROM {table} WHERE {where})"
        if child.startswith("agg."):
            _delete(calc, child, nested, params, depth=depth + 1)
        else:
            _clear(calc, child, nested, params, depth + 1)


def _scope(conn, competition):
    editions = [r[0] for r in conn.execute("SELECT id FROM core.competition_seasons WHERE competition_id = %s", (competition,))]
    matches = [r[0] for r in conn.execute("SELECT id FROM core.matches WHERE competition_season_id = ANY(%s)", (editions,))]
    return editions, matches


def _lock(conn):
    return conn.execute("SELECT pg_try_advisory_xact_lock(hashtextextended('vega_scope_purge', 0))").fetchone()[0]


def purge(conn, calc):
    """Remove from the base every competition of the lists above, one competition at a time:
    its matches (with everything that cascades from them: statistics, events, line-ups,
    watches…), rounds, editions (standings, aggregates, projections, jobs) and the competition
    (league levels, player honours, action values), with their provider ids. Teams and players
    stay: they may play elsewhere. Returns the counts removed ({} when nothing is left).

    Two connections, as the roles are (017_roles.sql): `calc` (vega_calc, writes agg) first
    clears the calculations' rows and sends the seasons' player rankings to be ranked again;
    then `conn` (vega_collect, writes core and ops, cannot read agg) removes the rest. A row
    the calculations write again in between makes the second step fail on its foreign key:
    nothing of it is written, and the next daily pass tries again."""
    folders = ["cup:open-matchday:" + folder for folder in REMOVED_FOLDERS] + ["archive:" + family for family in REMOVED_ARCHIVES]
    competitions = [
        row[0]
        for row in conn.execute(
            """SELECT DISTINCT entity_id FROM core.provider_ids WHERE entity_type = 'competition'
               AND ((provider = 'pitchapi' AND provider_key = ANY(%s)) OR (provider = 'vega' AND provider_key = ANY(%s)))
               ORDER BY 1""",
            (list(REMOVED), folders),
        )
    ]
    counts = {}
    for competition in competitions:
        with calc.transaction():
            if not _lock(calc):
                break  # another task purges now
            editions, matches = _scope(calc, competition)
            # Each season these matches were played in is ranked again (power.stale_rankings):
            # a past season's player ranking is otherwise never computed again, and its
            # players from these leagues would stay in it. The club Elo is rebuilt every run.
            calc.execute(
                """UPDATE agg.power_runs SET method_version = 'purged' WHERE kind = 'players' AND status = 'published'
                   AND season_id IN (SELECT DISTINCT season_id FROM core.matches WHERE id = ANY(%s))""",
                (matches,),
            )
            _clear(calc, "core.matches", "id = ANY(%s)", (matches,))
            _clear(calc, "core.rounds", "competition_season_id = ANY(%s)", (editions,))
            _clear(calc, "core.competition_seasons", "id = ANY(%s)", (editions,))
            _clear(calc, "core.competitions", "id = %s", (competition,))
        with conn.transaction():
            if not _lock(conn):
                break
            editions, matches = _scope(conn, competition)
            teams = [r[0] for r in conn.execute(
                "SELECT home_team_id FROM core.matches WHERE id = ANY(%s) UNION SELECT away_team_id FROM core.matches WHERE id = ANY(%s)",
                (matches, matches),
            ) if r[0] is not None]
            players = [r[0] for r in conn.execute(
                """SELECT player_id FROM core.player_match_stats WHERE match_id = ANY(%s)
                   UNION SELECT player_id FROM core.lineup_players WHERE match_id = ANY(%s)""",
                (matches, matches),
            ) if r[0] is not None]
            # Ids held without a foreign key.
            conn.execute(
                """DELETE FROM ops.fetch_jobs WHERE (entity_type = 'match' AND entity_id = ANY(%s))
                   OR (entity_type = 'competition' AND entity_id = %s)""",
                (matches, competition),
            )
            conn.execute(
                """DELETE FROM core.provider_ids WHERE (entity_type = 'match' AND entity_id = ANY(%s))
                   OR (entity_type = 'competition' AND entity_id = %s)""",
                (matches, competition),
            )
            removed = {"matches": _delete(conn, "core.matches", "id = ANY(%s)", (matches,), ("agg",))}
            _delete(conn, "core.rounds", "competition_season_id = ANY(%s)", (editions,), ("agg",))
            removed["editions"] = _delete(conn, "core.competition_seasons", "id = ANY(%s)", (editions,), ("agg",))
            removed["competitions"] = _delete(conn, "core.competitions", "id = %s", (competition,), ("agg",))
            # A team or player seen only there is no longer read every month (profiles.enqueue_due):
            # its profile stays, and a match of ours that names it again queues it again
            # (profiles.queue_first_seen).
            conn.execute(
                """DELETE FROM ops.reference_state r WHERE r.provider = 'pitchapi' AND r.entity_type = 'team' AND r.entity_id = ANY(%s)
                   AND NOT EXISTS (SELECT 1 FROM core.matches m WHERE m.home_team_id = r.entity_id)
                   AND NOT EXISTS (SELECT 1 FROM core.matches m WHERE m.away_team_id = r.entity_id)""",
                (teams,),
            )
            conn.execute(
                """DELETE FROM ops.reference_state r WHERE r.provider = 'pitchapi' AND r.entity_type = 'player' AND r.entity_id = ANY(%s)
                   AND NOT EXISTS (SELECT 1 FROM core.player_match_stats s WHERE s.player_id = r.entity_id)
                   AND NOT EXISTS (SELECT 1 FROM core.lineup_players l WHERE l.player_id = r.entity_id)""",
                (players,),
            )
        for key, value in removed.items():
            counts[key] = counts.get(key, 0) + value
    return counts
