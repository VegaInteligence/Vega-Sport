"""The scorers of the national matches read from International Results (FAILURE_MODES.md §57).

goalscorers.csv of github.com/martj42/international_results (CC0), projected by main's own reader
(frontend/src/services/nations-results.js parseGoalscorers, through backend/sources/bridge.mjs) as one more scope of
the International Results adapter (cups.For("nations-results")): read in the same pass as results.csv, each file once.

A goal belongs to the held match of its key (`date|home_team|away_team`, the current provider key of
`international_results`, the teams as results.csv names them). Stored in core.international_goals (172), one row per
goal in file order; only the matches whose list changed are written again. A held match the file stops listing keeps
its goals; a match with a goal that cannot be read keeps its stored list and is recorded once in ops.parse_failures.
Display data only: nothing of the rankings, the Elo or the models reads these rows.

A scorer is linked to a core.players row only when it is unambiguous (`link`); else the name stays text.
"""

from datetime import timedelta
import re

from . import SourceError, failure_once, normalize

SCOPE = "nations-results:goalscorers"
QUERY = "competition=goalscorers"
PERIOD = timedelta(hours=2)
PROVIDER = "international_results"
# The link's window: the player played for the scorer's team within this many days of the goal.
LINK_WINDOW = 730
# The youngest age at which a link is believed: a birth date later than this before the goal is another person.
LINK_MIN_AGE_YEARS = 15
COLUMNS = ("side", "scorer", "minute", "own_goal", "penalty", "assist")
FLAGS = {"TRUE": True, "FALSE": False}


class Unreadable(ValueError):
    pass


def typed(goal, home, away):
    """One goal of the projection as a row (side, scorer, minute, own_goal, penalty, assist), or Unreadable."""
    if not isinstance(goal, dict):
        raise Unreadable("not a goal")
    team = goal.get("team")
    side = "home" if team == home else "away" if team == away else None
    if side is None:
        raise Unreadable(f"team {team!r} is neither side")
    minute = goal.get("minute")
    if minute is not None:
        if not isinstance(minute, str) or not re.fullmatch(r"\d{1,3}", minute) or not 1 <= int(minute) <= 130:
            raise Unreadable(f"minute {minute!r}")
        minute = int(minute)
    own, penalty = FLAGS.get(goal.get("ownGoal")), FLAGS.get(goal.get("penalty"))
    if own is None or penalty is None:
        raise Unreadable("own_goal or penalty is not TRUE/FALSE")
    if own and penalty:
        raise Unreadable("both an own goal and a penalty")
    texts = []
    for name in ("scorer", "assist"):
        value = goal.get(name)
        if value is not None and (not isinstance(value, str) or not 1 <= len(value.strip()) <= 200):
            raise Unreadable(f"{name} {value!r}")
        texts.append(value.strip() if value is not None else None)
    return (side, texts[0], minute, own, penalty, texts[1])


def held(conn):
    """{match key: (match id, day, home team id, away team id)} of the held International Results matches."""
    return {key: rest for key, *rest in conn.execute(
        """SELECT p.provider_key, m.id, coalesce(m.match_date, m.kickoff_at::date), m.home_team_id, m.away_team_id
           FROM core.provider_ids p JOIN core.matches m ON m.id = p.entity_id
           WHERE p.entity_type = 'match' AND p.provider = %s AND p.is_current""", (PROVIDER,)).fetchall()}


def save(conn, body, now):
    """(goals written, goals of no held match)."""
    goals = body.get("goals") if isinstance(body, dict) else None
    if not isinstance(goals, list) or not goals:
        raise SourceError("INVALID_SOURCE_RESPONSE")
    matches = held(conn)
    by_match, unmatched = {}, 0
    for goal in goals:
        key = goal.get("match") if isinstance(goal, dict) else None
        if key in matches:
            by_match.setdefault(key, []).append(goal)
        else:
            unmatched += 1
    ids = [matches[key][0] for key in by_match]
    stored = {}
    for match_id, *row in conn.execute(
            f"SELECT match_id, {', '.join(c + ('::text' if c == 'side' else '') for c in COLUMNS)} FROM core.international_goals "
            "WHERE match_id = ANY(%s) ORDER BY match_id, position", (ids,)).fetchall():
        stored.setdefault(match_id, []).append(tuple(row))
    written = 0
    for key, found in by_match.items():
        match_id = matches[key][0]
        _, home, away = key.split("|", 2)
        try:
            if len(found) > 99:
                raise Unreadable("more than 99 goals")
            rows = [typed(goal, home, away) for goal in found]
        except Unreadable as error:
            failure_once(conn, "INVALID_GOAL", f"{SCOPE}: {key}: {error}")
            continue
        if stored.get(match_id) == rows:
            continue  # the same list: nothing written
        conn.execute("DELETE FROM core.international_goals WHERE match_id = %s", (match_id,))
        with conn.cursor().copy(f"COPY core.international_goals (match_id, position, {', '.join(COLUMNS)}) FROM STDIN") as copy:
            for position, row in enumerate(rows, 1):
                copy.write_row((match_id, position, *row))
        written += len(rows)
    link(conn, matches)
    return written, unmatched


def link(conn, matches=None):
    """Set each goal's player_id where the link holds, clear it where it no longer does; the rows changed.

    The link holds when the scorer's team (the side credited, the other one for an own goal) is a team of the match,
    exactly one player of that team's line-ups (any season) has the scorer's name in comparison form (normalize), that
    player played for that team within LINK_WINDOW days of the goal, and his birth date, when known, is at least
    LINK_MIN_AGE_YEARS before it. Nothing else links: no name alone, no nationality, no fuzzy match."""
    goals = conn.execute(
        """SELECT g.match_id, g.position, g.scorer, g.player_id, coalesce(m.match_date, m.kickoff_at::date),
                  CASE WHEN (g.side = 'home') <> g.own_goal THEN m.home_team_id ELSE m.away_team_id END
           FROM core.international_goals g JOIN core.matches m ON m.id = g.match_id""").fetchall()
    teams = sorted({team for *_, team in goals if team is not None})
    population = {}
    for team, player, name, birth, first, last in conn.execute(
            """SELECT lp.team_id, lp.player_id, p.name, p.birth_date, min(coalesce(m.match_date, m.kickoff_at::date)),
                      max(coalesce(m.match_date, m.kickoff_at::date))
               FROM core.lineup_players lp JOIN core.players p ON p.id = lp.player_id JOIN core.matches m ON m.id = lp.match_id
               WHERE lp.team_id = ANY(%s) GROUP BY 1, 2, 3, 4""", (teams,)).fetchall():
        key = normalize(name)
        if key:
            population.setdefault((team, key), {})[player] = (birth, first, last)
    changed = 0
    for match_id, position, scorer, current, day, team in goals:
        wanted = None
        candidates = population.get((team, normalize(scorer))) if scorer and day else None
        if candidates and len(candidates) == 1:
            (player, (birth, first, last)), = candidates.items()
            window = timedelta(days=LINK_WINDOW)
            near = first is not None and last is not None and first - window <= day <= last + window
            old_enough = birth is None or day >= _years_after(birth, LINK_MIN_AGE_YEARS)
            if near and old_enough:
                wanted = player
        if wanted != current:
            conn.execute("UPDATE core.international_goals SET player_id = %s, updated_at = now() WHERE match_id = %s AND position = %s",
                         (wanted, match_id, position))
            changed += 1
    return changed


def _years_after(day, years):
    try:
        return day.replace(year=day.year + years)
    except ValueError:  # 29 February
        return day.replace(year=day.year + years, day=28)


def run(conn, answer, now):
    """One read of the projection's answer ({status, body}): (goals written, goals of no held match)."""
    conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (SCOPE,))
    body = (answer or {}).get("body")
    if (answer or {}).get("status") != 200 or not isinstance(body, dict):
        code = body.get("code") if isinstance(body, dict) else None
        raise SourceError(code if isinstance(code, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", code)
                          else f"HTTP_{(answer or {}).get('status') or 'ERROR'}")
    return save(conn, body, now)
