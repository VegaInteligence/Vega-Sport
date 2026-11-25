"""A match graded as soon as its player statistics arrive (FAILURE_MODES § 68; hugo, 25 Nov 2026: « met cela en match »).

The season's players run (power.refresh_players) grades every match of its award year, at most an hour after a finished
match changed (worker.RECOMPUTE_AFTER), and its read can come before a match's statistics: on 25 Nov 2026 the run started
11 s before Sabah FK – Barcelone's and published without them. This step, at each planning round of the collection,
grades such a match with the references of its year's last published run: the run's own read restricted to the match,
the run's own functions, so the run's grade when the references and the Elo are the same. The run corrects it at its
next pass; first_z keeps the step's grade.

Nothing else of the ranking is written: no agg.player_power_matches, no ranking, no level, no exclusion.
"""

from datetime import timedelta

from . import power

WINDOW = timedelta(days=3)  # matches kicked off this long ago at most
LIMIT = 40  # matches a pass, the oldest rows first
KEEP = timedelta(days=7)  # the arrival rows of matches kicked off longer ago are deleted
LOCK_WAIT = "5s"  # a run writing the same year: the pass fails and the next one tries again, the collection never waits

# The matches to grade: finished, of a PitchAPI edition, kicked off in the window, player statistics collected, whose
# rows changed after their award year's last published run started (it did not read them), that run having kept its
# contribution references; and not graded by the step since their rows changed, unless a run was published after.
DUE = """
WITH runs AS (
  SELECT DISTINCT ON (season_id) season_id AS award_season, id AS run_id, started_at, finished_at FROM agg.power_runs
  WHERE kind = 'players' AND status = 'published' ORDER BY season_id, started_at DESC)
SELECT m.season_id, m.id, y.award_season, r.run_id, r.started_at, max(s.updated_at) AS stats_at
FROM core.matches m
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
JOIN core.match_coverage mc ON mc.season_id = m.season_id AND mc.match_id = m.id AND mc.player_stats = 'ok'
CROSS JOIN LATERAL (SELECT extract(year FROM m.match_date - interval '7 months')::smallint AS award_season) y
JOIN runs r ON r.award_season = y.award_season
JOIN core.player_match_stats s ON s.season_id = m.season_id AND s.match_id = m.id
LEFT JOIN agg.match_grade_arrivals a ON a.season_id = m.season_id AND a.match_id = m.id
WHERE m.status = 'finished' AND m.kickoff_at > %(now)s - %(window)s AND m.kickoff_at <= %(now)s
  AND m.season_id IN (y.award_season, y.award_season + 1)
  AND EXISTS (SELECT 1 FROM agg.player_contribution_refs k WHERE k.award_season = y.award_season AND k.run_id = r.run_id)
GROUP BY m.season_id, m.id, y.award_season, r.run_id, r.started_at, r.finished_at, a.match_id, a.stats_at, a.graded_at
HAVING max(s.updated_at) > r.started_at
   AND (a.match_id IS NULL OR a.stats_at < max(s.updated_at) OR a.graded_at < r.finished_at)
ORDER BY max(s.updated_at), m.id
LIMIT %(limit)s"""

# The ZERO_IN_EDITION statistics an edition's rows of the award year show above zero: restore_zeros' rule on the rows
# the run reads (its in-match rows).
EDITION_ZEROS = f"""
SELECT q.competition_season_id, {', '.join(f'bool_or(q.{name} > 0)' for name in power.ZERO_IN_EDITION)}
FROM ({power.PLAYER_MATCHES} AND m.competition_season_id = ANY(%s)) q
WHERE q.in_match GROUP BY 1"""

# The players' rows of the award year, each with its team's highest slot in its match: what assign_roles reads to give
# a player without a slot his most played slot role. The same rows as the run's read (PLAYER_MATCHES' filters).
YEAR_SLOTS = """
SELECT q.match_id, q.player_id, q.team_id, q.minutes_played, q.position_id, q.formation, q.top FROM (
  SELECT s.match_id, s.player_id, s.team_id, s.minutes_played::float8 AS minutes_played, coalesce(lp.position_id, s.position_id) AS position_id,
    l.formation, max(coalesce(lp.position_id, s.position_id)) FILTER (WHERE coalesce(lp.position_id, s.position_id) <> 0)
      OVER (PARTITION BY s.season_id, s.match_id, s.team_id) AS top
  FROM core.player_match_stats s
  JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id AND m.status = 'finished'
  JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
  JOIN core.teams t ON t.id = s.team_id
  LEFT JOIN core.lineup_players lp ON lp.season_id = s.season_id AND lp.match_id = s.match_id AND lp.player_id = s.player_id
  LEFT JOIN core.lineups l ON l.season_id = s.season_id AND l.match_id = s.match_id AND l.team_id = s.team_id
  WHERE s.season_id = ANY(%(seasons)s) AND s.minutes_played > 0 AND m.match_date >= %(start)s AND m.match_date < %(end)s
    AND s.team_id IN (m.home_team_id, m.away_team_id)
    AND (s.season_id, s.match_id) IN (SELECT x.season_id, x.match_id FROM core.player_match_stats x
                                      WHERE x.season_id = ANY(%(seasons)s) AND x.player_id = ANY(%(players)s))) q
WHERE q.player_id = ANY(%(players)s)"""

# Each team's rating after its last match before the kick-off: the next Elo pass's elo_before of the match when nothing
# before it changed.
LAST_ELO = """
SELECT DISTINCT ON (e.team_id) e.team_id, e.elo_after FROM agg.team_elo e
WHERE e.team_id = ANY(%s) AND e.kickoff_at < %s ORDER BY e.team_id, e.kickoff_at DESC"""


def _references(conn, award, run, started):
    """The run's contribution references and the grade references it graded against, with their year; None when the
    year is not graded this way (a partial year, a year graded against its own rows, references not kept)."""
    if power.partial_year(conn, award):
        return None
    ref_season = power.grade_reference_year(award, started.date())
    grade_refs = None if ref_season is None else power.read_grade_references(conn, ref_season)
    contribution = power.read_contribution_refs(conn, award, run)
    if grade_refs is None or not contribution:
        return None
    return contribution, grade_refs, ref_season


def _rows(conn, award, match):
    start, end = power.award_year(award)
    cur = conn.execute(power.PLAYER_MATCHES + " AND s.match_id = %s", ([award, award + 1], start, end, match))
    names = [d.name for d in cur.description]
    return [{k: (power._num(v) if k not in power._KEPT else v) for k, v in zip(names, row)} for row in cur.fetchall()]


def _elo(conn, match, rows):
    """The match's ratings when the Elo has not read it yet (no agg.team_elo row): each team's last."""
    if any(r["own_elo"] is not None or r["opponent_elo"] is not None for r in rows):
        return
    home, away, kickoff = conn.execute("SELECT home_team_id, away_team_id, kickoff_at FROM core.matches WHERE id = %s", (match,)).fetchone()
    if kickoff is None:
        return
    last = {team: float(elo) for team, elo in conn.execute(LAST_ELO, ([home, away], kickoff)).fetchall()}
    for r in rows:
        other = away if r["team_id"] == home else home
        r["own_elo"], r["opponent_elo"] = last.get(r["team_id"]), last.get(other)


def _edition_zeros(conn, award, editions, cache):
    missing = sorted(e for e in editions if (award, e) not in cache)
    if missing:
        start, end = power.award_year(award)
        for e in missing:
            cache[(award, e)] = set()
        for edition, *seen in conn.execute(EDITION_ZEROS, ([award, award + 1], start, end, missing)).fetchall():
            cache[(award, edition)] = {name for name, yes in zip(power.ZERO_IN_EDITION, seen) if yes}
    return {e: cache[(award, e)] for e in editions}


def _year_minutes(conn, award, rows):
    """The slot minutes of the year of the match's players who have no slot in it (assign_roles' fallback)."""
    _, slot_role = power.slot_minutes(rows)
    players = sorted({r["player_id"] for r in rows if slot_role[(r["match_id"], r["player_id"])] is None})
    if not players:
        return {}
    start, end = power.award_year(award)
    cur = conn.execute(YEAR_SLOTS, {"seasons": [award, award + 1], "start": start, "end": end, "players": players})
    names = [d.name for d in cur.description]
    minutes, _ = power.slot_minutes([dict(zip(names, row)) for row in cur.fetchall()])
    return minutes


def grade_match(conn, award, match, references, cache=None):
    """The match's grades with the run's references: [(edition, match, player, team, role, minutes, z)]."""
    contribution, grade_refs, _ = references
    rows = [r for r in _rows(conn, award, match) if r["in_match"]]
    _elo(conn, match, rows)
    for r in rows:
        r["delta"] = 0.0 if r["own_elo"] is None or r["opponent_elo"] is None else (r["opponent_elo"] - r["own_elo"]) / 400
    power.restore_zeros(rows, _edition_zeros(conn, award, {r["competition_season_id"] for r in rows}, {} if cache is None else cache))
    rows = power.assign_roles(rows, _year_minutes(conn, award, rows))
    grades = []
    for r in rows:
        _, c = power.match_contribution(r, contribution)
        z = power.match_index(r["role"], r.get("competition_id"), c, grade_refs)
        if z is not None:
            grades.append((r["edition"], r["match_id"], r["player_id"], r["team_id"], r["role"], int(r["minutes_played"]), z))
    return grades


def refresh(conn, now, *, window=WINDOW, limit=LIMIT):
    """One pass: the due matches graded and written in one transaction. {"matches": graded, "players": grades}."""
    with conn.transaction():
        conn.execute(f"SET LOCAL lock_timeout = '{LOCK_WAIT}'")
        conn.execute("""DELETE FROM agg.match_grade_arrivals a USING core.matches m
                        WHERE m.id = a.match_id AND m.season_id = a.season_id AND m.kickoff_at < %s""", (now - KEEP,))
        due = conn.execute(DUE, {"now": now, "window": window, "limit": limit}).fetchall()
        if not due:
            return {"matches": 0, "players": 0}
        years, cache, grades, arrivals, matches = {}, {}, [], [], 0
        for season, match, award, run, started, stats_at in due:
            if (award, run) not in years:
                years[(award, run)] = _references(conn, award, run, started)
            references = years[(award, run)]
            graded = [] if references is None else grade_match(conn, award, match, references, cache)
            if references is not None:
                matches += 1
                grades += [(*g, award, references[2], run) for g in graded]
            arrivals.append((season, match, stats_at, run, len(graded)))
        moved = set()
        if grades:
            conn.execute("""CREATE TEMP TABLE arrival_grades_now (season_id smallint, match_id integer, player_id integer, team_id integer,
                              role text, minutes smallint, z real, award_season smallint, ref_season smallint, run_id integer) ON COMMIT DROP""")
            with conn.cursor().copy("""COPY arrival_grades_now(season_id, match_id, player_id, team_id, role, minutes, z, award_season, ref_season, run_id)
                                       FROM STDIN""") as copy:
                for row in grades:
                    copy.write_row(row)
            moved = {(s, m) for s, m in conn.execute(
                """INSERT INTO agg.player_match_grades AS g (season_id, match_id, player_id, award_season, team_id, role, minutes, z, first_z, ref_season, run_id)
                   SELECT n.season_id, n.match_id, n.player_id, n.award_season, n.team_id, n.role, n.minutes, n.z, n.z, n.ref_season, n.run_id
                   FROM arrival_grades_now n
                   """ + power.GRADE_UPSERT + " RETURNING g.season_id, g.match_id").fetchall()}
            # The season sums of the match's players in its edition, by the run's formula (write_match_grades).
            keys = conn.execute("""SELECT DISTINCT n.season_id, m.competition_season_id, n.player_id FROM arrival_grades_now n
                                   JOIN core.matches m ON m.id = n.match_id AND m.season_id = n.season_id""").fetchall()
            conn.execute("""DELETE FROM agg.player_grade_editions e USING (SELECT DISTINCT n.season_id, m.competition_season_id, n.player_id
                              FROM arrival_grades_now n JOIN core.matches m ON m.id = n.match_id AND m.season_id = n.season_id) k
                            WHERE e.season_id = k.season_id AND e.competition_season_id = k.competition_season_id AND e.player_id = k.player_id""")
            conn.execute(
                """INSERT INTO agg.player_grade_editions(season_id, competition_season_id, player_id, grade_count, grade_minutes, zm_sum)
                   SELECT g.season_id, m.competition_season_id, g.player_id, count(*), sum(g.minutes), sum(g.minutes * g.z::float8)
                   FROM agg.player_match_grades g JOIN core.matches m ON m.id = g.match_id AND m.season_id = g.season_id
                   WHERE (g.season_id, m.competition_season_id, g.player_id) IN (SELECT * FROM unnest(%s::smallint[], %s::integer[], %s::integer[]))
                     AND g.minutes >= %s
                   GROUP BY g.season_id, m.competition_season_id, g.player_id""",
                ([k[0] for k in keys], [k[1] for k in keys], [k[2] for k in keys], power.GRADE_SEASON_MINUTES))
        conn.cursor().executemany(
            """INSERT INTO agg.match_grade_arrivals(season_id, match_id, stats_at, graded_at, run_id, players) VALUES (%s, %s, %s, now(), %s, %s)
               ON CONFLICT (season_id, match_id) DO UPDATE SET stats_at = EXCLUDED.stats_at, graded_at = now(), run_id = EXCLUDED.run_id,
                 players = EXCLUDED.players""", arrivals)
        # The summary's ETag reads the publication: the match's version moves it at the next one. A player's, a club's
        # or a season's read is validated by its editions' versions alone (actorVersion, scopeVersion): the edition's
        # moves them now. In the collection's order (store._flush_versions: kind, then id).
        editions = {r[0] for r in conn.execute(
            """SELECT DISTINCT m.competition_season_id FROM core.matches m
               WHERE (m.season_id, m.id) IN (SELECT * FROM unnest(%s::smallint[], %s::integer[]))""",
            ([s for s, _ in moved], [m for _, m in moved])).fetchall()} if moved else set()
        versions = sorted({("competition_season", e) for e in editions} | {("match", m) for _, m in moved})
        for kind, ident in versions:
            conn.execute("""INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES (%s, %s)
                            ON CONFLICT (resource_kind, resource_id) DO UPDATE SET version = ops.resource_versions.version + 1, updated_at = now()""",
                         (kind, ident))
        return {"matches": matches, "players": len(grades)}
