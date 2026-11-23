"""The leagues' matchweeks (15 November 2026): when a round is over, its Team of the Round
and the league's Player of the Season race, and the league-wide predictions that wait for it.

A round is a league edition's `core.rounds` row. A league whose played matches carry no
round (MLS) is cut into weeks, from Tuesday 12:00 UTC to the next Tuesday: the American
weekend and the European Monday end before the cut, the European Tuesday starts after it.
Future matches without a round are not played yet and block nothing.

A round closes (ROUND RULES, docs/calculs/06-accueil-et-matchs/05-journees.md):
- a match is on time when it kicks off no later than the round's median kick-off + 4 days;
  a match moved later never blocks its round;
- every on-time match is over (finished, awarded, canceled), excused (postponed,
  suspended), or still not started / in play 72 hours after its kick-off (a status the source
  never updated);
- 6 hours have passed since the end of its last on-time match (kick-off + 2 hours), for the
  statistics' late corrections, and the year's player ranking ran after that end, so the
  grades include the round;
- in any case, 7 days after the median kick-off: nothing waits forever.

At its closure a round gets its Team of the Round and a snapshot of the league's Player of
the Season race, both frozen afterwards. A postponed match played later stays in its round
for the data (the round is marked amended); the cumulative race and the projections take it
in at the next closure. The Team of the Round is never rewritten.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone

ON_TIME = timedelta(days=4)
MATCH_LENGTH = timedelta(hours=2)
GRACE = timedelta(hours=6)
STALE = timedelta(hours=72)
HARD_CAP = timedelta(days=7)
OVER = {"finished", "awarded", "canceled"}
EXCUSED = {"postponed", "suspended"}
# A synthetic week starts on Tuesday 12:00 UTC.
WEEK_START = (1, 12)  # weekday (Monday 0), hour
# The Team of the Round: players with this many minutes in the round (else RETRY_MINUTES).
TEAM_MINUTES = 60
RETRY_MINUTES = 45
# A round's team is published when this share of its played matches is graded.
GRADED_SHARE = 0.8
# Player of the Season: shrunk mean z, Σ m·z / (Σ m + PRIOR_MINUTES), over matches of
# SEASON_MATCH_MINUTES or more; eligible with RACE_SHARE of his club's possible league
# minutes and RACE_MATCHES matches. The whole race is kept (VI-44): the card shows its
# first ten, the competition's « Joueurs » view all of it.
PRIOR_MINUTES = 450
SEASON_MATCH_MINUTES = 20
RACE_SHARE = 0.5
RACE_MATCHES = 3

# Formations, by their roles (slot, accepted roles). The order breaks ties.
SLOT_ROLES = {
    "GK": ("goalkeeper",),
    "CB": ("centre_back",),
    "FB": ("full_back",),
    "WB": ("full_back", "winger"),
    "DM": ("defensive_midfielder", "central_midfielder"),
    "CM": ("central_midfielder", "defensive_midfielder"),
    "AM": ("central_midfielder", "winger"),
    "W": ("winger",),
    "CF": ("centre_forward",),
}
# Each formation's slots, back to front and left to right within a line ("/" between lines).
FORMATIONS = {
    "4-3-3": "GK / FB CB CB FB / CM DM CM / W CF W",
    "4-2-3-1": "GK / FB CB CB FB / DM DM / W AM W / CF",
    "4-4-2": "GK / FB CB CB FB / W CM CM W / CF CF",
    "3-4-3": "GK / CB CB CB / WB CM CM WB / W CF W",
    "3-5-2": "GK / CB CB CB / WB CM DM CM WB / CF CF",
}


def formation_slots(formation):
    """[(slot index, line, slot)] of a formation, lines numbered from the goal (0)."""
    out = []
    for line, part in enumerate(FORMATIONS[formation].split("/")):
        for slot in part.split():
            out.append((len(out), line, slot))
    return out


def week_key(kickoff):
    """The synthetic week of a kick-off: its start, a Tuesday 12:00 UTC."""
    weekday, hour = WEEK_START
    start = kickoff.astimezone(timezone.utc).replace(hour=hour, minute=0, second=0, microsecond=0)
    start -= timedelta(days=(start.weekday() - weekday) % 7)
    if start > kickoff:
        start -= timedelta(days=7)
    return start


def round_state(matches, now, ranked_at=None):
    """A round's state from its matches [(status, kick-off)]: (status, played, excused,
    last end) with status 'closed' or 'open', or None for a round nothing was played in.
    `ranked_at`: when the year's player ranking last started (None: unknown, never ready)."""
    kicks = sorted(k for _, k in matches if k is not None)
    if not kicks:
        return None
    median = kicks[(len(kicks) - 1) // 2]
    on_time = [(s, k) for s, k in matches if k is None or k <= median + ON_TIME]
    played = [k for s, k in on_time if s == "finished" and k is not None]
    if not played:
        return None
    excused = sum(1 for s, _ in on_time if s in EXCUSED)
    done = all(s in OVER or s in EXCUSED or (s in ("not_started", "in_play") and k is not None and k < now - STALE) for s, k in on_time)
    end = max(played) + MATCH_LENGTH
    ready = done and now >= end + GRACE and ranked_at is not None and ranked_at >= end
    return ("closed" if ready or now >= median + HARD_CAP else "open", len(played), excused, end)


def assign(costs):
    """The exact assignment of the rows to distinct columns minimising the total cost
    (Hungarian method; rows ≤ columns). costs: [[float]]. [column of each row]."""
    n, m = len(costs), len(costs[0])
    inf = float("inf")
    u, v, p, way = [0.0] * (n + 1), [0.0] * (m + 1), [0] * (m + 1), [0] * (m + 1)
    for i in range(1, n + 1):
        p[0], j0 = i, 0
        minv, used = [inf] * (m + 1), [False] * (m + 1)
        while True:
            used[j0] = True
            i0, delta, j1 = p[j0], inf, 0
            for j in range(1, m + 1):
                if not used[j]:
                    cur = costs[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j], way[j] = cur, j0
                    if minv[j] < delta:
                        delta, j1 = minv[j], j
            for j in range(m + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while j0:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
    out = [0] * n
    for j in range(1, m + 1):
        if p[j]:
            out[p[j] - 1] = j - 1
    return out


def team_of_round(candidates, minutes=TEAM_MINUTES):
    """The best eleven of a round: candidates [(player, role, minutes, z, …)] (one per
    player). For each formation, the exact assignment maximising Σ z over its slots, a slot
    taking only the roles it accepts; the formation with the best total (the order of
    FORMATIONS breaks ties). (formation, total, [(slot index, line, slot, candidate)]), or
    None when no formation can be filled."""
    pool = [c for c in candidates if c[2] >= minutes]
    # Only a role's best eleven can be picked: the search stays small.
    by_role = defaultdict(list)
    for c in pool:
        by_role[c[1]].append(c)
    pool = [c for role in by_role.values() for c in sorted(role, key=lambda c: (-c[3], c[0]))[:11]]
    best = None
    for formation in FORMATIONS:
        slots = formation_slots(formation)
        if len(pool) < len(slots):
            continue
        big = 1e6
        costs = [[-c[3] if c[1] in SLOT_ROLES[slot] else big for c in pool] for _, _, slot in slots]
        picked = assign(costs)
        if any(costs[i][j] >= big for i, j in enumerate(picked)):
            continue
        total = sum(pool[j][3] for j in picked)
        if best is None or total > best[1] + 1e-9:
            best = (formation, total, [(i, line, slot, pool[picked[i]]) for i, line, slot in slots])
    if best is None and minutes > RETRY_MINUTES:
        return team_of_round(candidates, RETRY_MINUTES)
    return best


def season_race(rows, club_matches):
    """The league's Player of the Season race: rows [(player, team, minutes, z)] of its
    matches in closed rounds; club_matches {team: league matches played}. Each player's
    shrunk mean z over his matches of SEASON_MATCH_MINUTES or more, Σ m·z / (Σ m + 450),
    eligible with RACE_SHARE of his club's possible minutes and RACE_MATCHES matches; best
    first. [(player, team, z*, matches, minutes)]."""
    acc = defaultdict(lambda: [0.0, 0, 0, defaultdict(int)])
    for player, team, minutes, z in rows:
        a = acc[player]
        a[3][team] += minutes
        if minutes >= SEASON_MATCH_MINUTES and z is not None:
            a[0] += minutes * z
            a[1] += minutes
            a[2] += 1
    out = []
    for player, (zm, minutes, matches, teams) in acc.items():
        team = max(sorted(teams, key=str), key=lambda t: teams[t])
        possible = club_matches.get(team, 0) * 90
        if matches < RACE_MATCHES or not possible or minutes < RACE_SHARE * possible:
            continue
        out.append((player, team, zm / (minutes + PRIOR_MINUTES), matches, minutes))
    out.sort(key=lambda r: (-r[2], -r[4], r[0]))
    return out


# The league editions of a season and their matches: (edition, match, round id, round name,
# status, kick-off). Leagues are the rows of agg.league_levels; the regular rounds only.
MATCHES = """
SELECT m.competition_season_id, m.id, m.round_id, r.name, m.status::text,
  coalesce(m.kickoff_at, m.match_date::timestamp AT TIME ZONE 'UTC')
FROM core.matches m
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
JOIN agg.league_levels l ON l.competition_id = cs.competition_id
LEFT JOIN core.rounds r ON r.id = m.round_id
WHERE m.season_id = %s AND coalesce(r.stage::text, 'regular') = 'regular'"""


def season_rounds(rows):
    """{edition: {round key: (round id, label, [(match, status, kick-off)])}} from MATCHES'
    rows. An edition whose played matches carry no round is cut into weeks; in another, a
    match without a round (not scheduled in one yet) is left out."""
    by_edition = defaultdict(list)
    for edition, match, round_id, name, status, kickoff in rows:
        by_edition[edition].append((match, round_id, name, status, kickoff))
    out = {}
    for edition, matches in by_edition.items():
        weekly = not any(r for _, r, _, s, _ in matches if s == "finished")
        rounds = {}
        for match, round_id, name, status, kickoff in matches:
            if weekly:
                if kickoff is None:
                    continue
                start = week_key(kickoff)
                key, label, rid = "w" + start.date().isoformat(), "Semaine du " + start.date().isoformat(), None
            elif round_id is None:
                continue
            else:
                key, label, rid = "r%d" % round_id, name, round_id
            rounds.setdefault(key, (rid, label, []))[2].append((match, status, kickoff))
        out[edition] = rounds
    return out


def ranked_at(conn, season):
    """When the year's player ranking last started, by award year."""
    return {s: t for s, t in conn.execute(
        "SELECT season_id, max(started_at) FROM agg.power_runs WHERE kind = 'players' AND status = 'published' AND season_id IN (%s, %s) GROUP BY 1",
        (season - 1, season)).fetchall()}


def award_season_of(when):
    return when.year if when.month >= 8 else when.year - 1


GRADES = """
SELECT g.match_id, g.player_id, g.team_id, g.role, g.minutes, g.z
FROM agg.player_match_grades g WHERE g.season_id = %s AND g.match_id = ANY(%s)"""


def refresh(conn, season, now=None):
    """Close the league rounds of an edition season that are over, publishing their Team of
    the Round and Player of the Season race; mark amended a closed round whose late match
    was played. Returns the editions with a round newly closed."""
    now = now or datetime.now(timezone.utc)
    rounds = season_rounds(conn.execute(MATCHES, (season,)).fetchall())
    runs = ranked_at(conn, season)
    known = {(e, k): (s, p) for e, k, s, p in conn.execute(
        "SELECT competition_season_id, round_key, status, played FROM agg.league_rounds WHERE season_id = %s", (season,)).fetchall()}
    closed_now = set()
    for edition, by_key in rounds.items():
        # In time order: a round's race snapshot reads the rounds closed before it.
        ordered = sorted(by_key.items(), key=lambda item: (min((k for _, _, k in item[1][2] if k), default=now), item[0]))
        for key, (round_id, label, matches) in ordered:
            last_end = max((k for _, s, k in matches if s == "finished" and k), default=None)
            ran = runs.get(award_season_of(last_end)) if last_end else None
            state = round_state([(s, k) for _, s, k in matches], now, ran)
            if state is None:
                continue
            status, played, excused, end = state
            kicks = [k for _, _, k in matches if k]
            before = known.get((edition, key))
            with conn.transaction():
                if before is None or before[0] == "open":
                    conn.execute(
                        """INSERT INTO agg.league_rounds AS r (competition_season_id, round_key, season_id, round_id, label, window_start, window_end,
                             matches, played, excused, last_match_at, status, closed_at, revision)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, CASE WHEN %s = 'closed' THEN now() END, 1)
                           ON CONFLICT (competition_season_id, round_key) DO UPDATE SET matches = EXCLUDED.matches, played = EXCLUDED.played,
                             excused = EXCLUDED.excused, last_match_at = EXCLUDED.last_match_at, status = EXCLUDED.status, closed_at = EXCLUDED.closed_at,
                             label = EXCLUDED.label, window_start = EXCLUDED.window_start, window_end = EXCLUDED.window_end, updated_at = now()""",
                        (edition, key, season, round_id, label, min(kicks), max(kicks), len(matches), played, excused, end - MATCH_LENGTH, status, status),
                    )
                    # The round's matches, before its team and race read them.
                    conn.execute(
                        """INSERT INTO agg.league_round_matches(competition_season_id, round_key, match_id)
                           SELECT %s, %s, unnest(%s::int[]) ON CONFLICT DO NOTHING""",
                        (edition, key, [m for m, _, _ in matches]),
                    )
                    if status == "closed":
                        publish(conn, season, edition, key, [m for m, s, _ in matches if s == "finished"])
                        closed_now.add(edition)
                elif played > before[1]:
                    conn.execute(
                        """INSERT INTO agg.league_round_matches(competition_season_id, round_key, match_id)
                           SELECT %s, %s, unnest(%s::int[]) ON CONFLICT DO NOTHING""",
                        (edition, key, [m for m, _, _ in matches]),
                    )

                    # A late match of a closed round was played: the data takes it, the team stays.
                    conn.execute(
                        """UPDATE agg.league_rounds SET played = %s, status = 'amended', revision = revision + 1, last_match_at = greatest(last_match_at, %s),
                             updated_at = now() WHERE competition_season_id = %s AND round_key = %s""",
                        (played, end - MATCH_LENGTH, edition, key),
                    )
    return closed_now


def publish(conn, season, edition, key, played):
    """A newly closed round's Team of the Round (when GRADED_SHARE of its played matches are
    graded) and the league's Player of the Season race over its closed rounds."""
    grades = conn.execute(GRADES, (season, played)).fetchall()
    graded = {g[0] for g in grades}
    if played and len(graded) >= GRADED_SHARE * len(played):
        per_player = {}
        for match, player, team, role, minutes, z in grades:
            entry = per_player.setdefault(player, [player, role, 0, 0.0, team, match])
            entry[3] = (entry[3] * entry[2] + z * minutes) / (entry[2] + minutes) if entry[2] + minutes else 0.0
            entry[2] += minutes
        best = team_of_round([tuple(e) for e in per_player.values()])
        if best:
            formation, _, slots = best
            with conn.cursor().copy(
                "COPY agg.round_teams(competition_season_id, round_key, slot, line, slot_role, formation, player_id, team_id, match_id, season_id, role, minutes, z) FROM STDIN"
            ) as copy:
                for index, line, slot, (player, role, minutes, z, team, match) in slots:
                    copy.write_row((edition, key, index, line, slot, formation, player, team, match, season, role, minutes, z))
    race = race_after(conn, edition, key, season)
    with conn.cursor().copy(
        "COPY agg.round_season_race(competition_season_id, round_key, rank, player_id, team_id, z, matches, minutes) FROM STDIN"
    ) as copy:
        for rank, (player, team, z, matches, minutes) in enumerate(race, 1):
            copy.write_row((edition, key, rank, player, team, z, matches, minutes))


def race_after(conn, edition, key, season):
    """The edition's whole Player of the Season race after round `key`: every eligible
    player, best first (season_race)."""
    # The race over the edition's closed rounds, this one included.
    rows = conn.execute(
        """SELECT g.player_id, g.team_id, g.minutes, g.z FROM agg.player_match_grades g
           JOIN agg.league_round_matches rm ON rm.match_id = g.match_id
           JOIN agg.league_rounds r ON r.competition_season_id = rm.competition_season_id AND r.round_key = rm.round_key
           WHERE g.season_id = %s AND rm.competition_season_id = %s AND (r.status <> 'open' OR r.round_key = %s)
             AND r.window_start <= (SELECT window_start FROM agg.league_rounds WHERE competition_season_id = %s AND round_key = %s)""",
        (season, edition, key, edition, key),
    ).fetchall()
    club_matches = defaultdict(int)
    for (team, n) in conn.execute(
        """SELECT t, count(*) FROM (
             SELECT m.home_team_id t FROM core.matches m WHERE m.season_id = %(s)s AND m.status = 'finished' AND m.id = ANY(%(ids)s)
             UNION ALL SELECT m.away_team_id FROM core.matches m WHERE m.season_id = %(s)s AND m.status = 'finished' AND m.id = ANY(%(ids)s)) x GROUP BY 1""",
        {"s": season, "ids": list(closed_matches(conn, edition, key))},
    ).fetchall():
        club_matches[team] = n
    return season_race(rows, club_matches)


def closed_matches(conn, edition, key):
    """The matches of an edition's closed (or amended) rounds up to round `key`, and of it."""
    return {m for (m,) in conn.execute(
        """SELECT rm.match_id FROM agg.league_round_matches rm JOIN agg.league_rounds r
             ON r.competition_season_id = rm.competition_season_id AND r.round_key = rm.round_key
           WHERE rm.competition_season_id = %s AND (r.status <> 'open' OR r.round_key = %s)
             AND r.window_start <= (SELECT window_start FROM agg.league_rounds WHERE competition_season_id = %s AND round_key = %s)""",
        (edition, key, edition, key)).fetchall()}


def open_league_matches(conn, season):
    """The finished league matches of an edition season whose round is still open: the
    league-wide predictions leave them out until it closes."""
    return {m for (m,) in conn.execute(
        """SELECT rm.match_id FROM agg.league_round_matches rm JOIN agg.league_rounds r
             ON r.competition_season_id = rm.competition_season_id AND r.round_key = rm.round_key
           WHERE r.season_id = %s AND r.status = 'open'""",
        (season,)).fetchall()}
