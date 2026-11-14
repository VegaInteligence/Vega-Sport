"""Win, draw and loss during a match: the forecast carried through its minutes.

Before kick-off a match has two expected goals, λ_home and λ_away (forecast.py, from the
two strengths). At a given minute, with a given score and the red cards shown so far:

  goals still to come, each side ~ Poisson(λ × R(minute) × a red-card factor)

R(minute) is the share of a match's goals scored after that minute, read from the base's
goals by quarter-hour (and after the 90th minute); a side one player short scores DOWN
times its rate and its opponent UP times, both measured on the base's matches after a
red card. After STATE_FROM minutes a side ahead scores AHEAD = 1 − t times its rate and a
side behind BEHIND = 1 + t times (version 2): without them a side ahead after the hour
won less often than announced, and applied from the kick-off they made the first
half-hour worse. The tilt t is the one that makes the results of the base's
matches the most likely, read at STATE_MINUTES (one number: the results do not tell two
free factors apart). The final score is the present score plus those goals; the low final
scores keep the forecast's correction (Dixon and Coles), and a level score changes no
rate, so that at kick-off the three probabilities are the forecast's own.

The model knows the score, the clock and the dismissals. It knows nothing of the play
itself (pressure, chances), of substitutions or of injuries
(docs/calculs/06-accueil-et-matchs/03-pronostics-et-projections.md).
"""

from collections import defaultdict
from math import log

from .forecast import poisson, rates, tau

MODEL_VERSION = "inplay-v2"
QUARTERS = 6  # quarter-hours of the regular time
ADDED = 8.0  # minutes of added time over which the goals scored after the 90th are spread
MIN_FIT = 500  # matches with a full goal timeline, below which no model is fitted
MAX_RED = 2  # dismissals a side's factor counts
STATE_FROM = 60  # the minute from which the score changes the rates
STATE_MINUTES = (60, 75, 85)  # where a match's result is read to fit AHEAD and BEHIND
STATE_SAMPLE = 5000  # matches read for that fit
STATE_MIN_CASES = 500  # match-minutes with a side ahead, below which the two factors stay at 1
STATE_TILTS = [step / 40 for step in range(17)]  # 0 to 0.4 by 0.025: the tilts tried
STATE_REFIT = 1.1  # the base holds this many times the matches of the factors' last fit: fit them again


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


def state_factors(score_home, score_away, ahead=1.0, behind=1.0):
    """Each side's rate multiplier for the present score: (home, away). A level score
    changes neither."""
    if score_home == score_away:
        return 1.0, 1.0
    return (ahead, behind) if score_home > score_away else (behind, ahead)


def late_share(profile, minute, added=0):
    """The share of a match's goals still to come after STATE_FROM (the present minute once
    past it): the part of `remaining` the score changes the rates of."""
    return remaining(profile, minute, added) if minute >= STATE_FROM else remaining(profile, STATE_FROM, 0)


def outcome(rate_home, rate_away, share, score_home, score_away, reds_home, reds_away, model, rho=0.0, late=None):
    """(home win, draw, away win) from the present state. `share`: remaining(...);
    `model`: {"down", "up"} and, when it has them, {"ahead", "behind"}; `rho`: the
    forecast's low-score correction; `late`: late_share(...), the part of `share` the
    score changes the rates of (all of it when not given)."""
    fh, fa = factors(reds_home, reds_away, model["down"], model["up"])
    sh, sa = state_factors(score_home, score_away, model.get("ahead", 1.0), model.get("behind", 1.0))
    late = share if late is None else min(late, share)
    lh, la = rate_home * fh * (share - late + late * sh), rate_away * fa * (share - late + late * sa)
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
        late = late_share(model["profile"], minute, 0)
        points.append((minute, *outcome(rate_home, rate_away, share, state[0], state[1], state[2], state[3], model, rho, late), state[0], state[1]))
    return points


def fit_state(matches, model, rho=0.0):
    """(AHEAD, BEHIND) = (1 − t, 1 + t) for the tilt t of STATE_TILTS that makes the results
    of `matches` the most likely, read at STATE_MINUTES with the score and the dismissals
    of that minute; (1, 1) when fewer than STATE_MIN_CASES match-minutes have a side ahead."""
    cases = []
    for rate_home, rate_away, events in matches[::max(1, len(matches) // STATE_SAMPLE)]:
        final = [sum(1 for _, _, kind, side in events if kind == "goal" and side == name) for name in ("home", "away")]
        result = 0 if final[0] > final[1] else 1 if final[0] == final[1] else 2
        for minute in STATE_MINUTES:
            state = [0, 0, 0, 0]
            for at, _, kind, side in events:
                if min(int(at), 90) <= minute:
                    state[(0 if kind == "goal" else 2) + (0 if side == "home" else 1)] += 1
            if state[0] != state[1]:
                cases.append((rate_home, rate_away, remaining(model["profile"], minute, 0), *state, result))
    if len(cases) < STATE_MIN_CASES:
        return 1.0, 1.0

    def loss(ahead, behind):
        trial = {"down": model["down"], "up": model["up"], "ahead": ahead, "behind": behind}
        return -sum(log(max(outcome(rh, ra, share, a, b, c, d, trial, rho)[result], 1e-9)) for rh, ra, share, a, b, c, d, result in cases)

    tilt = min(STATE_TILTS, key=lambda t: (loss(1 - t, 1 + t), t))
    return round(1 - tilt, 4), round(1 + tilt, 4)


def fit(matches, rho=0.0, state=None):
    """The goal-time profile, the red-card factors and the two factors of the score, from
    finished matches.

    `matches`: [(rate_home, rate_away, events)] with events as in `timeline`; `rho`: the
    forecast's low-score correction; `state`: (AHEAD, BEHIND, the matches they were fitted
    on) to keep them as they are, the search for them being the long part of a fit.
    Returns {"profile", "down", "up", "ahead", "behind", "state_matches", "matches",
    "goals", "red_matches"} or None below MIN_FIT."""
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

    model = {"profile": profile, "down": ratio("down"), "up": ratio("up"), "matches": len(matches), "goals": goals, "red_matches": red_matches}
    if state is None:
        model["ahead"], model["behind"] = fit_state(matches, model, rho)
        model["state_matches"] = len(matches)
    else:
        model["ahead"], model["behind"], model["state_matches"] = state
    return model


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
    matches fitted on (0 when there is no forecast model or too few matches).

    The fit runs outside any transaction: the base ends a session that stays idle inside
    one (60 s)."""
    coefficients = conn.execute(
        "SELECT home_base, home_slope, away_base, away_slope, rho FROM agg.forecast_models ORDER BY fitted_at DESC, id DESC LIMIT 1"
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
    # The two factors of the score are kept until the base has grown enough since their fit.
    kept = conn.execute(
        "SELECT ahead, behind, state_matches FROM agg.inplay_models WHERE version = %s AND state_matches IS NOT NULL ORDER BY fitted_at DESC, id DESC LIMIT 1",
        (MODEL_VERSION,),
    ).fetchone()
    if kept is not None and len(matches) > kept[2] * STATE_REFIT:
        kept = None
    model = fit(matches, coefficients[4], kept)
    if model is None:
        return 0
    with conn.transaction():
        conn.execute("DELETE FROM agg.inplay_models")
        conn.execute(
            """INSERT INTO agg.inplay_models(version, matches, goals, red_matches, q1, q2, q3, q4, q5, q6, after_90, down, up, ahead, behind, state_matches)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (MODEL_VERSION, model["matches"], model["goals"], model["red_matches"], *model["profile"], model["down"], model["up"],
             model["ahead"], model["behind"], model["state_matches"]),
        )
    return model["matches"]
