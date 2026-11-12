"""Win, draw and loss during a match: the forecast carried through its minutes.

Before kick-off a match has two expected goals, λ_home and λ_away (forecast.py, from the
two strengths). At a given minute, with a given score and the red cards shown so far:

  goals still to come, each side ~ Poisson(λ × R(minute) × a red-card factor)

R(minute) is the share of a match's goals scored after that minute, read from the base's
goals by quarter-hour (and after the 90th minute); a side one player short scores DOWN
times its rate and its opponent UP times, both measured on the base's matches after a
red card. The final score is the present score plus those goals; the low final scores
keep the forecast's correction (Dixon and Coles), so that at kick-off the three
probabilities are the forecast's own.

The model knows the score, the clock and the dismissals. It knows nothing of the play
itself (pressure, chances), of substitutions or of injuries
(docs/calculs/06-accueil-et-matchs/03-pronostics-et-projections.md).
"""

from collections import defaultdict

from .forecast import poisson, rates, tau

MODEL_VERSION = "inplay-v1"
QUARTERS = 6  # quarter-hours of the regular time
ADDED = 8.0  # minutes of added time over which the goals scored after the 90th are spread
MIN_FIT = 500  # matches with a full goal timeline, below which no model is fitted
MAX_RED = 2  # dismissals a side's factor counts


def band(minute, added=0):
    """The band of a goal: 0..5 for the quarter-hours (the first half's added time in the
    third), 6 after the 90th minute."""
    if minute >= 90 and (added or minute > 90):
        return QUARTERS
    return max(0, min(QUARTERS - 1, (int(minute) - 1) // 15))


def remaining(profile, minute, added=0):
    """The share of a match's goals still to come after `minute` (+ `added` minutes).

    `profile`: seven shares adding up to 1, the six quarter-hours then the time after
    the 90th minute. Within a quarter-hour the goals are spread evenly."""
    tail = profile[QUARTERS]
    if minute >= 90:
        return tail * max(0.0, 1.0 - min(float(added or 0), ADDED) / ADDED)
    clock = max(0.0, float(minute))
    index = min(QUARTERS - 1, int(clock // 15))
    inside = profile[index] * (1.0 - (clock - 15 * index) / 15)
    return inside + sum(profile[index + 1:QUARTERS]) + tail


def factors(reds_home, reds_away, down, up):
    """Each side's rate multiplier for the dismissals shown: (home, away)."""
    home, away = min(int(reds_home or 0), MAX_RED), min(int(reds_away or 0), MAX_RED)
    return down ** home * up ** away, down ** away * up ** home


def outcome(rate_home, rate_away, share, score_home, score_away, reds_home, reds_away, model, rho=0.0):
    """(home win, draw, away win) from the present state. `share`: remaining(...);
    `model`: {"down", "up"}; `rho`: the forecast's low-score correction."""
    fh, fa = factors(reds_home, reds_away, model["down"], model["up"])
    lh, la = rate_home * share * fh, rate_away * share * fa
    if lh <= 0 and la <= 0:
        return (1.0, 0.0, 0.0) if score_home > score_away else (0.0, 1.0, 0.0) if score_home == score_away else (0.0, 0.0, 1.0)
    ph, pa = poisson(lh), poisson(la)
    home = draw = away = 0.0
    for i, a in enumerate(ph):
        for j, b in enumerate(pa):
            weight = a * b * max(0.0, tau(score_home + i, score_away + j, rate_home, rate_away, rho))
            final = score_home + i - score_away - j
            if final > 0:
                home += weight
            elif final == 0:
                draw += weight
            else:
                away += weight
    total = home + draw + away
    return (home / total, draw / total, away / total) if total > 0 else (1 / 3, 1 / 3, 1 / 3)


def timeline(rate_home, rate_away, events, model, rho=0.0, last=90):
    """The three probabilities at each minute from 0 to `last`. `events`: goals and reds in
    order, each (minute, added, kind, side) with kind "goal" or "red" and side "home" or
    "away". An event of minute m counts from minute m on. Returns
    [(minute, home, draw, away, score_home, score_away)]."""
    points, state, index = [], [0, 0, 0, 0], 0  # score home, score away, reds home, reds away
    ordered = sorted(events, key=lambda e: (min(int(e[0]), last), e[1] or 0))
    for minute in range(0, last + 1):
        while index < len(ordered) and min(int(ordered[index][0]), last) <= minute:
            _, _, kind, side = ordered[index]
            state[(0 if kind == "goal" else 2) + (0 if side == "home" else 1)] += 1
            index += 1
        share = remaining(model["profile"], minute, 0)
        points.append((minute, *outcome(rate_home, rate_away, share, state[0], state[1], state[2], state[3], model, rho), state[0], state[1]))
    return points


def fit(matches):
    """The goal-time profile and the red-card factors, from finished matches.

    `matches`: [(rate_home, rate_away, events)] with events as in `timeline`. Returns
    {"profile", "down", "up", "matches", "goals", "red_matches"} or None below MIN_FIT."""
    if len(matches) < MIN_FIT:
        return None
    counts = [0] * (QUARTERS + 1)
    for _, _, events in matches:
        for minute, added, kind, _ in events:
            if kind == "goal":
                counts[band(minute, added)] += 1
    goals = sum(counts)
    if not goals:
        return None
    profile = [count / goals for count in counts]
    # Goals scored and expected while one side is exactly one player short, and at full strength.
    seen = {"down": [0.0, 0.0], "up": [0.0, 0.0], "level": [0.0, 0.0]}
    red_matches = 0
    for rate_home, rate_away, events in matches:
        ordered = sorted(events, key=lambda e: (e[0], e[1] or 0))
        red_matches += any(kind == "red" for _, _, kind, _ in ordered)
        reds = [0, 0]
        clock = (0, 0)
        for minute, added, kind, side in ordered + [(90, ADDED, "end", "home")]:
            spent = remaining(profile, *clock) - remaining(profile, minute, added)
            gap = reds[0] - reds[1]
            if abs(gap) <= 1 and max(reds) <= 1:
                keys = ("level", "level") if gap == 0 else ("down", "up") if gap == 1 else ("up", "down")
                seen[keys[0]][1] += rate_home * spent
                seen[keys[1]][1] += rate_away * spent
                if kind == "goal":
                    seen[keys[0] if side == "home" else keys[1]][0] += 1
            if kind == "red":
                reds[0 if side == "home" else 1] += 1
            clock = (minute, added)
    base = seen["level"][0] / seen["level"][1] if seen["level"][1] else 1.0

    def ratio(key):
        scored, expected = seen[key]
        # Too few goals after a red card to measure anything: no effect assumed.
        return (scored / expected) / base if expected > 0 and scored >= 30 and base > 0 else 1.0

    return {"profile": profile, "down": ratio("down"), "up": ratio("up"), "matches": len(matches), "goals": goals, "red_matches": red_matches}


# The finished club matches the forecast is fitted on (forecast.FITTED), with the home club.
MATCHES = """
SELECT m.id, eh.elo_before, ea.elo_before, coalesce(m.is_neutral, false), m.home_score, m.away_score, m.home_team_id
FROM core.matches m
JOIN agg.team_elo eh ON eh.match_id = m.id AND eh.team_id = m.home_team_id
JOIN agg.team_elo ea ON ea.match_id = m.id AND ea.team_id = m.away_team_id
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
JOIN core.teams th ON th.id = m.home_team_id AND th.is_national IS NOT TRUE
WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL"""
EVENTS = """
SELECT e.match_id, e.minute, coalesce(e.minute_added, 0), e.event_type::text, e.team_id
FROM core.match_events e
WHERE e.event_type IN ('goal', 'red_card') AND e.minute IS NOT NULL
ORDER BY e.match_id, e.seq"""


def match_events(rows, home, home_score, away_score):
    """A match's goals and reds as `timeline` reads them, or None when the goal events do
    not give its score. `rows`: [(minute, added, type, team)]; a goal counts for the team
    its event is credited to (the running score the source writes on a goal is the score
    before it in some matches and after it in others, so it is not read)."""
    out = [(minute, added, "goal" if kind == "goal" else "red", "home" if team == home else "away") for minute, added, kind, team in rows]
    scored = sum(1 for _, _, kind, side in out if kind == "goal" and side == "home")
    conceded = sum(1 for _, _, kind, side in out if kind == "goal" and side == "away")
    return out if (scored, conceded) == (home_score, away_score) else None


def refresh(conn):
    """Fit the in-play model on every finished club match whose goal events give its score,
    with the forecast's present coefficients; one model is kept. Returns the number of
    matches fitted on (0 when there is no forecast model or too few matches)."""
    with conn.transaction():
        coefficients = conn.execute(
            "SELECT home_base, home_slope, away_base, away_slope FROM agg.forecast_models ORDER BY fitted_at DESC, id DESC LIMIT 1"
        ).fetchone()
        if coefficients is None:
            return 0
        forecast_model = {"home": (coefficients[0], coefficients[1]), "away": (coefficients[2], coefficients[3])}
        by_match = defaultdict(list)
        for match, minute, added, kind, team in conn.execute(EVENTS).fetchall():
            by_match[match].append((minute, added, kind, team))
        matches = []
        for match, elo_home, elo_away, neutral, home_score, away_score, home in conn.execute(MATCHES).fetchall():
            events = match_events(by_match.get(match, []), home, home_score, away_score)
            if events is not None:
                matches.append((*rates(forecast_model, elo_home, elo_away, neutral), events))
        model = fit(matches)
        if model is None:
            return 0
        conn.execute("DELETE FROM agg.inplay_models")
        conn.execute(
            """INSERT INTO agg.inplay_models(version, matches, goals, red_matches, q1, q2, q3, q4, q5, q6, after_90, down, up)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (MODEL_VERSION, model["matches"], model["goals"], model["red_matches"], *model["profile"], model["down"], model["up"]),
        )
    return model["matches"]
