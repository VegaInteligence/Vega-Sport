"""Calculator: rebuilds agg season tables for the scopes marked in ops.dirty_scopes.

Every statement recomputes a scope from core, so a correction or a removed match is
reflected exactly. A dirty row is cleared only if its revision did not move while the
scope was being computed; a newer correction therefore always triggers another pass.
"""

from psycopg import sql

from .metric_catalog import (
    PLAYER_ADVANCED,
    PLAYER_BASE,
    PLAYER_METRICS,
    PLAYER_RATIOS,
    TEAM_ADVANCED,
    TEAM_BASE,
    TEAM_METRICS,
    TEAM_RATIOS,
    metric_columns,
    ratio_columns,
)

POINTS = {"win": 3, "draw": 1, "loss": 0}


def _cast(kind):
    return "::real" if kind == "real" else "::integer"


def _metric_aggregates(metric, alias, minutes, *, prefix=""):
    """SELECT items aggregating one metric over rows of `alias`."""
    col = f"{alias}.{metric.column}"
    filled = f"{col} IS NOT NULL"
    names = [name for name, _ in metric_columns(metric, prefix=prefix, minutes=minutes is not None)]
    kinds = dict(metric_columns(metric, prefix=prefix, minutes=minutes is not None))
    items = []
    if metric.rule == "rating":
        rated = f"{filled} AND {minutes} > 0"
        items += [
            f"sum({col}*{minutes}) FILTER (WHERE {rated})",
            f"sum({minutes}) FILTER (WHERE {rated})",
            f"count(*) FILTER (WHERE {rated})",
        ]
        if minutes is not None:
            items.append(f"sum({minutes}) FILTER (WHERE {rated})")
    else:
        if metric.rule == "weighted_mean":
            weight = f"{alias}.{metric.weight}"
            both = f"{filled} AND {weight} IS NOT NULL"
            items += [
                f"sum({col}*{weight}) FILTER (WHERE {both})",
                f"sum({weight}) FILTER (WHERE {both})",
            ]
        elif metric.rule == "max":
            items.append(f"max({col})")
        else:  # sum and match_mean keep the plain sum; a mean divides it by _n.
            items.append(f"sum({col})")
        items.append(f"count({col})")
        if minutes is not None:
            items.append(f"sum({minutes}) FILTER (WHERE {filled})")
    return [f"({expr}){_cast(kinds[name])} AS {name}" for expr, name in zip(items, names)]


def _ratio_aggregates(ratio, alias, *, prefix=""):
    present = " AND ".join(f"{alias}.{c} IS NOT NULL" for c in ratio.columns)
    num = " ".join(f"{alias}.{t}" if t.isidentifier() else t for t in _tokens(ratio.numerator))
    den = " ".join(f"{alias}.{t}" if t.isidentifier() else t for t in _tokens(ratio.denominator))
    names = [name for name, _ in ratio_columns(ratio, prefix=prefix)]
    return [
        f"(sum({num}) FILTER (WHERE {present}))::real AS {names[0]}",
        f"(sum({den}) FILTER (WHERE {present}))::real AS {names[1]}",
        f"(count(*) FILTER (WHERE {present}))::integer AS {names[2]}",
    ]


def _tokens(expression):
    out, word = [], ""
    for ch in expression:
        if ch.isalnum() or ch == "_":
            word += ch
        else:
            if word:
                out.append(word)
                word = ""
            out.append(ch)
    if word:
        out.append(word)
    return out


def _player_sql():
    base = [m for m in PLAYER_METRICS if m.table == PLAYER_BASE]
    adv = [m for m in PLAYER_METRICS if m.table == PLAYER_ADVANCED]
    b_items, a_items = [], []
    for m in base:
        b_items += _metric_aggregates(m, "s", "s.minutes_played")
    for r in PLAYER_RATIOS:
        (b_items if r.table == PLAYER_BASE else a_items).extend(_ratio_aggregates(r, "s" if r.table == PLAYER_BASE else "a"))
    for m in adv:
        a_items += _metric_aggregates(m, "a", "a.minutes_played")
    b_cols = [i.rsplit(" AS ", 1)[1] for i in b_items]
    a_cols = [i.rsplit(" AS ", 1)[1] for i in a_items]
    columns = ["appearances", "starts", "minutes", *b_cols, *a_cols]
    scope = "AND (%(all)s OR ({x}.player_id, {x}.team_id) IN (SELECT player_id, team_id FROM scope))"
    statement = f"""
WITH scope AS (
  SELECT unnest(%(players)s::integer[]) AS player_id, unnest(%(teams)s::integer[]) AS team_id
), b AS (
  SELECT s.player_id, s.team_id,
    count(*) FILTER (WHERE s.minutes_played > 0)::integer AS appearances,
    coalesce(sum(s.minutes_played), 0)::integer AS minutes,
    {", ".join(b_items)}
  FROM core.player_match_stats s
  JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id
  WHERE m.competition_season_id = %(cs)s AND s.season_id = %(sid)s {scope.format(x="s")}
  GROUP BY s.player_id, s.team_id
), a AS (
  SELECT a.player_id, a.team_id,
    count(*) FILTER (WHERE a.minutes_played > 0)::integer AS appearances,
    coalesce(sum(a.minutes_played), 0)::integer AS minutes,
    {", ".join(a_items)}
  FROM core.player_match_advanced a
  JOIN core.matches m ON m.id = a.match_id AND m.season_id = a.season_id
  WHERE m.competition_season_id = %(cs)s AND a.season_id = %(sid)s {scope.format(x="a")}
  GROUP BY a.player_id, a.team_id
), st AS (
  SELECT lp.player_id, lp.team_id, count(*) FILTER (WHERE lp.is_starter)::integer AS starts
  FROM core.lineup_players lp
  JOIN core.matches m ON m.id = lp.match_id AND m.season_id = lp.season_id
  WHERE m.competition_season_id = %(cs)s AND lp.season_id = %(sid)s {scope.format(x="lp")}
  GROUP BY lp.player_id, lp.team_id
), k AS (
  SELECT player_id, team_id FROM b UNION SELECT player_id, team_id FROM a
)
INSERT INTO agg.player_season_stats (player_id, team_id, competition_season_id, season_id, {", ".join(columns)})
SELECT k.player_id, k.team_id, %(cs)s, %(sid)s,
  coalesce(b.appearances, a.appearances, 0), coalesce(st.starts, 0), coalesce(b.minutes, a.minutes, 0),
  {", ".join(f"b.{c}" for c in b_cols)}, {", ".join(f"a.{c}" for c in a_cols)}
FROM k LEFT JOIN b USING (player_id, team_id) LEFT JOIN a USING (player_id, team_id)
LEFT JOIN st USING (player_id, team_id)
ON CONFLICT (player_id, team_id, competition_season_id) DO UPDATE SET
  {", ".join(f"{c} = EXCLUDED.{c}" for c in columns)}, updated_at = now()
"""
    stale = """
DELETE FROM agg.player_season_stats p
WHERE p.competition_season_id = %(cs)s
  AND (%(all)s OR (p.player_id, p.team_id) IN (SELECT unnest(%(players)s::integer[]), unnest(%(teams)s::integer[])))
  AND NOT EXISTS (SELECT 1 FROM core.player_match_stats s JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id
                  WHERE m.competition_season_id = p.competition_season_id AND s.season_id = p.season_id
                    AND s.player_id = p.player_id AND s.team_id = p.team_id)
  AND NOT EXISTS (SELECT 1 FROM core.player_match_advanced a JOIN core.matches m ON m.id = a.match_id AND m.season_id = a.season_id
                  WHERE m.competition_season_id = p.competition_season_id AND a.season_id = p.season_id
                    AND a.player_id = p.player_id AND a.team_id = p.team_id)
"""
    return statement, stale


def _team_sql():
    items = []
    for side, alias, adv_alias in (("for_", "o", "oa"), ("against_", "p", "pa")):
        for m in TEAM_METRICS:
            items += _metric_aggregates(m, alias if m.table == TEAM_BASE else adv_alias, None, prefix=side)
        for r in TEAM_RATIOS:
            items += _ratio_aggregates(r, alias if r.table == TEAM_BASE else adv_alias, prefix=side)
    cols = [i.rsplit(" AS ", 1)[1] for i in items]
    fixed = ["matches", "won", "drawn", "lost", "goals_for", "goals_against", "points", "clean_sheets", "xpts", "xpts_matches",
             "has_goals_for", "has_goals_against", "has_xg_for", "has_xg_against",
             "keeper_xgot_against", "keeper_goals_against", "keeper_matches", "placement_sum", "placement_matches"]
    statement = f"""
WITH side AS (
  SELECT m.id AS match_id, m.season_id, x.team_id, x.opp_id, x.gf, x.ga
  FROM core.matches m
  CROSS JOIN LATERAL (VALUES (m.home_team_id, m.away_team_id, m.home_score, m.away_score),
                             (m.away_team_id, m.home_team_id, m.away_score, m.home_score)) AS x(team_id, opp_id, gf, ga)
  WHERE m.competition_season_id = %(cs)s AND m.season_id = %(sid)s AND m.status = 'finished'
    AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND x.team_id IS NOT NULL
    AND (%(all)s OR x.team_id = ANY(%(teams)s::integer[]))
)
INSERT INTO agg.team_season_stats (team_id, competition_season_id, season_id, {", ".join(fixed)}, {", ".join(cols)})
SELECT side.team_id, %(cs)s, %(sid)s,
  count(*)::integer,
  count(*) FILTER (WHERE side.gf > side.ga)::integer,
  count(*) FILTER (WHERE side.gf = side.ga)::integer,
  count(*) FILTER (WHERE side.gf < side.ga)::integer,
  sum(side.gf)::integer, sum(side.ga)::integer,
  (3 * count(*) FILTER (WHERE side.gf > side.ga) + count(*) FILTER (WHERE side.gf = side.ga))::integer,
  count(*) FILTER (WHERE side.ga = 0)::integer,
  (sum((agg.xpts_v1(o.xg, p.xg)).xpts) FILTER (WHERE o.xg IS NOT NULL AND p.xg IS NOT NULL))::real,
  count(*) FILTER (WHERE o.xg IS NOT NULL AND p.xg IS NOT NULL)::integer,
  (sum(side.gf) FILTER (WHERE o.xg IS NOT NULL AND p.xg IS NOT NULL))::integer, (sum(side.ga) FILTER (WHERE o.xg IS NOT NULL AND p.xg IS NOT NULL))::integer,
  (sum(o.xg) FILTER (WHERE o.xg IS NOT NULL AND p.xg IS NOT NULL))::real, (sum(p.xg) FILTER (WHERE o.xg IS NOT NULL AND p.xg IS NOT NULL))::real,
  (sum(p.xgot) FILTER (WHERE o.xg IS NOT NULL AND p.xg IS NOT NULL AND p.xgot IS NOT NULL))::real,
  (sum(side.ga) FILTER (WHERE o.xg IS NOT NULL AND p.xg IS NOT NULL AND p.xgot IS NOT NULL))::integer,
  count(*) FILTER (WHERE o.xg IS NOT NULL AND p.xg IS NOT NULL AND p.xgot IS NOT NULL)::integer,
  (sum(o.xgot - o.xg) FILTER (WHERE o.xg IS NOT NULL AND p.xg IS NOT NULL AND o.xgot IS NOT NULL))::real,
  count(*) FILTER (WHERE o.xg IS NOT NULL AND p.xg IS NOT NULL AND o.xgot IS NOT NULL)::integer,
  {", ".join(items)}
FROM side
LEFT JOIN core.team_match_stats o ON o.season_id = side.season_id AND o.match_id = side.match_id AND o.team_id = side.team_id AND o.period = 'all'
LEFT JOIN core.team_match_stats p ON p.season_id = side.season_id AND p.match_id = side.match_id AND p.team_id = side.opp_id AND p.period = 'all'
LEFT JOIN core.team_match_advanced oa ON oa.season_id = side.season_id AND oa.match_id = side.match_id AND oa.team_id = side.team_id
LEFT JOIN core.team_match_advanced pa ON pa.season_id = side.season_id AND pa.match_id = side.match_id AND pa.team_id = side.opp_id
GROUP BY side.team_id
ON CONFLICT (team_id, competition_season_id) DO UPDATE SET
  {", ".join(f"{c} = EXCLUDED.{c}" for c in [*fixed, *cols])}, updated_at = now()
"""
    stale = """
DELETE FROM agg.team_season_stats t
WHERE t.competition_season_id = %(cs)s AND (%(all)s OR t.team_id = ANY(%(teams)s::integer[]))
  AND NOT EXISTS (SELECT 1 FROM core.matches m WHERE m.competition_season_id = t.competition_season_id
                  AND m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
                  AND t.team_id IN (m.home_team_id, m.away_team_id))
"""
    return statement, stale


PLAYER_SQL, PLAYER_STALE_SQL = _player_sql()
TEAM_SQL, TEAM_STALE_SQL = _team_sql()

STANDINGS_SQL = """
WITH played AS (
  SELECT CASE WHEN r.stage = 'group' THEN 'group' END AS stage, m.group_name, x.team_id, x.gf, x.ga
  FROM core.matches m
  LEFT JOIN core.rounds r ON r.id = m.round_id
  CROSS JOIN LATERAL (VALUES (m.home_team_id, m.home_score, m.away_score),
                             (m.away_team_id, m.away_score, m.home_score)) AS x(team_id, gf, ga)
  WHERE m.competition_season_id = %(cs)s AND m.status = 'finished'
    AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND x.team_id IS NOT NULL
    AND coalesce(r.stage, 'regular') IN ('regular', 'group')
), totals AS (
  SELECT stage, group_name, team_id, count(*) AS played,
    count(*) FILTER (WHERE gf > ga) AS won, count(*) FILTER (WHERE gf = ga) AS drawn,
    count(*) FILTER (WHERE gf < ga) AS lost, sum(gf) AS goals_for, sum(ga) AS goals_against,
    3 * count(*) FILTER (WHERE gf > ga) + count(*) FILTER (WHERE gf = ga) AS points
  FROM played GROUP BY stage, group_name, team_id
)
INSERT INTO agg.standings (competition_season_id, stage, group_name, team_id, position, played, won, drawn, lost, goals_for, goals_against, points)
SELECT %(cs)s, t.stage, t.group_name, t.team_id,
  row_number() OVER (PARTITION BY t.stage, t.group_name
                     ORDER BY t.points DESC, t.goals_for - t.goals_against DESC, t.goals_for DESC, tm.name, t.team_id),
  t.played, t.won, t.drawn, t.lost, t.goals_for, t.goals_against, t.points
FROM totals t JOIN core.teams tm ON tm.id = t.team_id
"""

GAME_STATE_GOALS_SQL = """
SELECT m.id, m.home_team_id, m.away_team_id, m.home_score, m.away_score,
  e.minute, e.minute_added, e.score_home, e.score_away
FROM core.matches m
JOIN core.match_coverage c ON c.season_id = m.season_id AND c.match_id = m.id AND c.events = 'ok'
LEFT JOIN core.match_events e ON e.season_id = m.season_id AND e.match_id = m.id AND e.event_type = 'goal'
  AND e.period IS DISTINCT FROM 'penalties'  -- shoot-out kicks are not goals
WHERE m.competition_season_id = %(cs)s AND m.season_id = %(sid)s AND m.status = 'finished'
  AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
  AND (%(all)s OR m.home_team_id = ANY(%(teams)s::integer[]) OR m.away_team_id = ANY(%(teams)s::integer[]))
ORDER BY m.id, e.period, e.minute, e.minute_added NULLS FIRST, e.seq
"""

STATE_COLUMNS = (
    "matches", "scored_first", "scored_first_won", "scored_first_drawn", "scored_first_lost",
    "scored_first_points", "conceded_first", "conceded_first_won", "conceded_first_drawn",
    "conceded_first_lost", "conceded_first_points", "goalless", "points_from_behind",
    "points_dropped_from_lead", "minutes_leading", "minutes_level", "minutes_trailing",
)


def _match_states(home, away, final, goals):
    """Per-team game states of one match, or None when the timeline does not reach the score."""
    if goals and (goals[-1][2], goals[-1][3]) != final:
        return None
    if not goals and final != (0, 0):
        return None
    if len(goals) != final[0] + final[1]:
        return None
    out = {}
    for team, sign in ((home, 1), (away, -1)):
        diff, last, led, trailed = 0, 0.0, False, False
        spans = {"lead": 0.0, "level": 0.0, "behind": 0.0}
        end = max([93.0] + [g[0] + 1 for g in goals])
        for minute, _, score_home, score_away in goals:
            spans["lead" if diff > 0 else "behind" if diff < 0 else "level"] += minute - last
            last = minute
            diff = sign * (score_home - score_away)
            led |= diff > 0
            trailed |= diff < 0
        spans["lead" if diff > 0 else "behind" if diff < 0 else "level"] += end - last
        gf, ga = (final[0], final[1]) if sign == 1 else (final[1], final[0])
        outcome = "win" if gf > ga else "draw" if gf == ga else "loss"
        first = None
        if goals:
            first = "for" if sign * (goals[0][2] - goals[0][3]) > 0 else "against"
        out[team] = dict(outcome=outcome, first=first, led=led, trailed=trailed, spans=spans)
    return out


def refresh_game_states(conn, cs, sid, teams=None):
    rows = conn.execute(
        GAME_STATE_GOALS_SQL, {"cs": cs, "sid": sid, "all": teams is None, "teams": list(teams or [])}
    ).fetchall()
    matches = {}
    for mid, home, away, hs, as_, minute, added, sh, sa in rows:
        entry = matches.setdefault(mid, {"home": home, "away": away, "final": (hs, as_), "goals": []})
        if minute is not None:
            entry["goals"].append((minute + (added or 0) / 100, None, sh, sa))
    totals = {}
    for entry in matches.values():
        states = _match_states(entry["home"], entry["away"], entry["final"], entry["goals"])
        if states is None:
            continue
        for team, s in states.items():
            if teams is not None and team not in teams:
                continue
            t = totals.setdefault(team, dict.fromkeys(STATE_COLUMNS, 0))
            points = POINTS[s["outcome"]]
            t["matches"] += 1
            if s["first"] is None:
                t["goalless"] += 1
            else:
                bucket = "scored_first" if s["first"] == "for" else "conceded_first"
                t[bucket] += 1
                t[bucket + "_points"] += points
                t[bucket + {"win": "_won", "draw": "_drawn", "loss": "_lost"}[s["outcome"]]] += 1
            if s["trailed"] and points:
                t["points_from_behind"] += points
            if s["led"] and points < 3:
                t["points_dropped_from_lead"] += 3 - points
            t["minutes_leading"] += round(s["spans"]["lead"])
            t["minutes_level"] += round(s["spans"]["level"])
            t["minutes_trailing"] += round(s["spans"]["behind"])
    scope_teams = list(teams) if teams is not None else None
    conn.execute(
        "DELETE FROM agg.team_game_states WHERE competition_season_id=%s AND (%s OR team_id = ANY(%s::integer[]))",
        (cs, scope_teams is None, scope_teams or []),
    )
    for team, t in sorted(totals.items()):
        conn.execute(
            sql.SQL("INSERT INTO agg.team_game_states(team_id,competition_season_id,season_id,{}) VALUES (%s,%s,%s,{})").format(
                sql.SQL(",").join(map(sql.Identifier, STATE_COLUMNS)),
                sql.SQL(",").join(sql.Placeholder() for _ in STATE_COLUMNS),
            ),
            [team, cs, sid, *[t[c] for c in STATE_COLUMNS]],
        )


def refresh_competition_season(conn, cs, *, players=None, teams=None):
    """Recompute one competition-season; players/teams None means every one of them."""
    sid = conn.execute(
        "SELECT season_id FROM core.competition_seasons WHERE id=%s", (cs,)
    ).fetchone()[0]
    pairs = sorted(players or [])
    player_args = {
        "cs": cs, "sid": sid, "all": players is None,
        "players": [p for p, _ in pairs], "teams": [t for _, t in pairs],
    }
    team_args = {"cs": cs, "sid": sid, "all": teams is None, "teams": sorted(teams or [])}
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(92002, %s)", (cs,))
        conn.execute(PLAYER_SQL, player_args)
        conn.execute(PLAYER_STALE_SQL, player_args)
        conn.execute(TEAM_SQL, team_args)
        conn.execute(TEAM_STALE_SQL, team_args)
        conn.execute("DELETE FROM agg.standings WHERE competition_season_id=%s", (cs,))
        conn.execute(STANDINGS_SQL, {"cs": cs})
        refresh_game_states(conn, cs, sid, None if teams is None else set(teams))


def process_dirty(conn, *, limit=500):
    """Drain ops.dirty_scopes; returns the number of scopes processed."""
    claimed = conn.execute(
        """SELECT id, scope_kind, player_id, team_id, competition_season_id, revision
           FROM ops.dirty_scopes WHERE scope_kind IN ('player_season','team_season','competition_season')
           ORDER BY queued_at, id LIMIT %s""",
        (limit,),
    ).fetchall()
    by_edition = {}
    for row in claimed:
        _, kind, player, team, cs, _ = row
        work = by_edition.setdefault(cs, {"players": set(), "teams": set(), "full": False, "rows": []})
        work["rows"].append(row)
        if kind == "competition_season":
            work["full"] = True
        elif kind == "player_season":
            work["players"].add((player, team))
        else:
            work["teams"].add(team)
    for cs, work in sorted(by_edition.items()):
        if work["full"]:
            refresh_competition_season(conn, cs)
        else:
            refresh_competition_season(
                conn, cs, players=work["players"], teams=work["teams"] | {t for _, t in work["players"]}
            )
        with conn.transaction():
            for ident, kind, player, team, _, revision in work["rows"]:
                # Cleared only if no newer correction arrived meanwhile.
                conn.execute(
                    "DELETE FROM ops.dirty_scopes WHERE id=%s AND revision=%s", (ident, revision)
                )
            published = {("competition_season", cs)} | {("team", t) for t in work["teams"]} | {
                ("player", p) for p, _ in work["players"]
            }
            for kind, ident in sorted(published):
                conn.execute(
                    """INSERT INTO ops.resource_versions(resource_kind,resource_id,published_at)
                       VALUES(%s,%s,now()) ON CONFLICT(resource_kind,resource_id)
                       DO UPDATE SET version=ops.resource_versions.version+1,published_at=now(),updated_at=now()""",
                    (kind, ident),
                )
    return len(claimed)
