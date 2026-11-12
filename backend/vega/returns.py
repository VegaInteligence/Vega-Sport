"""Coming back from an absence: how a player's playing time returns, match after match.

An absence is read from the line-ups: two appearances of a player for the same club at
least MIN_DAYS apart while the club played MIN_MISSED matches or more in between (a
summer or winter break without matches is no absence, a transfer neither). For each
return, the player's usual minutes are those of his last appearances before the absence;
the curve is, by length of absence, the average minutes played in the first, second, …
match back, beside those usual minutes.

What the base shows (docs/calculs/05-joueurs/09-retour-d-absence.md): after an absence a
player's output per 90 minutes does not fall; his playing time does, and comes back over
about five matches. The curve is therefore one of minutes, not of level.
"""

from bisect import bisect_left, bisect_right
from collections import defaultdict
from datetime import timedelta

MODEL_VERSION = "returns-v1"
MIN_DAYS = 30
MIN_MISSED = 4  # club matches between the two appearances
BEFORE = 8  # appearances before the absence that give the usual minutes
MIN_BEFORE = 4
MATCHES_BACK = 8  # the curve's length
MIN_RETURNS = 30  # returns below which a point of the curve is not kept
WINDOW = timedelta(days=800)  # appearances read
RECENT = timedelta(days=90)  # a return older than this is no longer shown on a player
BUCKETS = (("30_59", 30, 60), ("60_119", 60, 120), ("120_plus", 120, 100000))


def bucket(days):
    for name, low, high in BUCKETS:
        if low <= days < high:
            return name
    return None


def returns_of(appearances, team_dates):
    """A player's returns from absence. `appearances`: [(date, team, minutes)] in order;
    `team_dates`: {team: sorted dates of its matches}. Each return:
    {"index", "days", "missed", "team", "left", "back", "usual"} with `index` the
    appearance he came back in and `usual` his mean minutes before the absence."""
    out = []
    for i in range(1, len(appearances)):
        (left, team, _), (back, team_back, _) = appearances[i - 1], appearances[i]
        days = (back - left).days
        if team != team_back or days < MIN_DAYS:
            continue
        dates = team_dates.get(team, ())
        missed = bisect_left(dates, back) - bisect_right(dates, left)
        if missed < MIN_MISSED:
            continue
        before = [minutes for _, t, minutes in appearances[max(0, i - BEFORE):i] if t == team]
        if len(before) < MIN_BEFORE:
            continue
        out.append({"index": i, "days": days, "missed": missed, "team": team, "left": left, "back": back, "usual": sum(before) / len(before)})
    return out


def curve(players, team_dates):
    """The curve by length of absence: {(bucket, match_no): (returns, minutes, usual)}, the
    mean minutes of the match_no-th match back and the mean usual minutes of the same
    players. `players`: {player: appearances}. A point of fewer than MIN_RETURNS is left out."""
    sums = defaultdict(lambda: [0, 0.0, 0.0])
    for appearances in players.values():
        found = returns_of(appearances, team_dates)
        for n, ret in enumerate(found):
            name = bucket(ret["days"])
            # The matches back stop at the next absence, or at a change of club.
            stop = found[n + 1]["index"] if n + 1 < len(found) else len(appearances)
            for k in range(MATCHES_BACK):
                j = ret["index"] + k
                if j >= stop or appearances[j][1] != ret["team"]:
                    break
                entry = sums[(name, k + 1)]
                entry[0] += 1
                entry[1] += appearances[j][2]
                entry[2] += ret["usual"]
    return {key: (count, minutes / count, usual / count) for key, (count, minutes, usual) in sums.items() if count >= MIN_RETURNS}


def current(appearances, team_dates, today):
    """The return a player is in the middle of, or None: his last absence, when he came back
    less than RECENT ago and has played MATCHES_BACK matches or fewer since."""
    found = returns_of(appearances, team_dates)
    if not found:
        return None
    last = found[-1]
    since = appearances[last["index"]:]
    if len(since) > MATCHES_BACK or today - last["back"] > RECENT or any(team != last["team"] for _, team, _ in since):
        return None
    return {**last, "bucket": bucket(last["days"]), "matches_back": len(since), "minutes_back": sum(m for _, _, m in since) / len(since)}


APPEARANCES = """
SELECT s.player_id, coalesce(m.kickoff_at::date, m.match_date), s.team_id, s.minutes_played
FROM core.player_match_stats s
JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id
WHERE s.minutes_played > 0 AND s.team_id IS NOT NULL AND coalesce(m.kickoff_at::date, m.match_date) >= %(since)s
ORDER BY s.player_id, 2, s.match_id"""
TEAM_DATES = """
SELECT t.team, t.day FROM (
  SELECT home_team_id AS team, coalesce(kickoff_at::date, match_date) AS day FROM core.matches WHERE status = 'finished'
  UNION ALL
  SELECT away_team_id, coalesce(kickoff_at::date, match_date) FROM core.matches WHERE status = 'finished') t
WHERE t.team IS NOT NULL AND t.day >= %(since)s
ORDER BY t.team, t.day"""


def refresh(conn, today):
    """Learn the curve from the appearances of the last WINDOW and note the players coming
    back now; returns (points of the curve, players coming back). Read, compute, write:
    no transaction is open while the appearances are gone through."""
    since = today - WINDOW
    players = defaultdict(list)
    for player, day, team, minutes in conn.execute(APPEARANCES, {"since": since}).fetchall():
        players[player].append((day, team, minutes))
    team_dates = defaultdict(list)
    for team, day in conn.execute(TEAM_DATES, {"since": since}).fetchall():
        team_dates[team].append(day)
    points = curve(players, team_dates)
    coming_back = [(player, state) for player, appearances in players.items() for state in [current(appearances, team_dates, today)] if state]
    with conn.transaction():
        conn.execute("DELETE FROM agg.player_returns")
        conn.execute("DELETE FROM agg.return_curves")
        for (name, match_no), (count, minutes, usual) in sorted(points.items()):
            conn.execute(
                "INSERT INTO agg.return_curves(bucket, match_no, returns, minutes, usual_minutes, version) VALUES (%s, %s, %s, %s, %s, %s)",
                (name, match_no, count, minutes, usual, MODEL_VERSION),
            )
        with conn.cursor().copy(
            """COPY agg.player_returns(player_id, team_id, absent_from, returned_on, days, matches_missed, matches_back, bucket,
                                       usual_minutes, minutes_back) FROM STDIN"""
        ) as copy:
            for player, state in coming_back:
                copy.write_row((player, state["team"], state["left"], state["back"], state["days"], state["missed"], state["matches_back"],
                                state["bucket"], state["usual"], state["minutes_back"]))
    return len(points), len(coming_back)
