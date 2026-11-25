"""Match forecasts and season projections, from the clubs' Elo (power.py).

A match is forecast from the two strengths before it:
  Δ = (Elo_home + h − Elo_away) / 400      (h: the Elo's home advantage, 0 on neutral ground)
  goals_home ~ Poisson(exp(a_home + b_home Δ)),  goals_away ~ Poisson(exp(a_away − b_away Δ))
the four coefficients fitted by maximum likelihood on the finished matches (power.fit_poisson),
with the low-score correction of Dixon and Coles (1997): the probabilities of 0-0, 1-0, 0-1
and 1-1 are multiplied by τ(ρ), ρ fitted on the same matches, because two independent
Poisson laws give too few draws. Win, draw and loss are the sums over the score grid.

A season is projected by replaying its remaining league matches SIMULATIONS times with
those laws and ranking each replay by points, goal difference and goals scored: the share
of replays a club finishes at each position. A club's strength is not known exactly, and
will move before the season ends: each replay shifts every strength by a draw of a normal
law of STRENGTH_SPREAD points × √(share of the club's matches still to play). Held at
their present value, the strengths made a leader in November a champion at 99.9 %.

Version 3 (25 November 2026, docs/calculs/09-audit-2026-11/FAILURE_MODES.md §62) changes
the replays, not the forecast of a match:
- each regular match of a league counts once (league_ledger): a result, a match to play,
  a copy the source superseded, or a canceled match. A postponed match is still to play;
- a replayed match is drawn from its forecast's law, the low-score correction included
  (draw_score), where two independent Poisson laws gave too few draws;
- each club and each fixture draws from a generator of its own: a projection moves with
  what changed, not with every draw after it;
- a league one of whose clubs still to play has no strength is not projected.

Version 2 adds a club's recent form to its strength for the matches about to be played:
  Δ' = Δ + F_xG × (x_home − x_away) + F_luck × (l_home − l_away)
x is a club's mean xG difference over its last FORM_MATCHES matches, l the mean of its
goal difference less that xG difference (what its results owe to something else than its
chances). The two coefficients are fitted on the finished matches with the four above
held as they are. The Elo follows goals: a club whose chances are better than its
results is stronger than its Elo says, and the reverse. The form is read for the matches
kicking off within FORM_HORIZON; a season's projection keeps the strengths alone, as it
was backtested. Rest days were measured too and change nothing.

Nothing here knows a bookmaker's odds: the model is judged on matches it has not seen
(docs/calculs/06-accueil-et-matchs/03-pronostics-et-projections.md).

refresh(conn, season) writes, for a season in progress: the model fitted on every finished
club match (agg.forecast_models), the forecast of each match still to play
(agg.match_forecasts) and the projection of each domestic league (agg.season_projections,
agg.season_projection_places). The worker runs it with the season's daily models, after
the Elo.
"""

from collections import defaultdict, deque
from datetime import date, timedelta
from math import exp, log, sqrt
import random

from .power import ELO_HOME, fit_poisson

MODEL_VERSION = "forecast-v3"
FORM_MATCHES = 10  # a club's last matches its form is read on
FORM_MIN = 5  # of them with an xG for both sides, below which a club has no form
FORM_HORIZON = timedelta(days=14)  # a match further ahead is forecast from the strengths alone
MAX_GOALS = 10  # the score grid: 0..MAX_GOALS for each side
MIN_FIT = 500  # finished matches below which no model is fitted
SIMULATIONS = 1000
STRENGTH_SPREAD = 90.0  # Elo points over a whole season, backtested (docs/calculs/06-accueil-et-matchs/03-pronostics-et-projections.md)
RHO_GRID = [x / 100 for x in range(-20, 21)]


def delta(elo_home, elo_away, neutral=False, home=ELO_HOME):
    return (elo_home + (0.0 if neutral else home) - elo_away) / 400


def poisson(lam, top=MAX_GOALS):
    """P(0..top) of a Poisson law, the last cell taking the tail."""
    out, p = [], exp(-lam)
    for k in range(top):
        out.append(p)
        p *= lam / (k + 1)
    out.append(max(0.0, 1.0 - sum(out)))
    return out


def tau(i, j, lh, la, rho):
    """Dixon and Coles' correction of the four lowest scores."""
    if i == 0 and j == 0:
        return 1 - lh * la * rho
    if i == 0 and j == 1:
        return 1 + lh * rho
    if i == 1 and j == 0:
        return 1 + la * rho
    if i == 1 and j == 1:
        return 1 - rho
    return 1.0


def rates(model, elo_home, elo_away, neutral=False):
    """The expected goals of each side."""
    d = delta(elo_home, elo_away, neutral)
    return exp(model["home"][0] + model["home"][1] * d), exp(model["away"][0] - model["away"][1] * d)


def score_grid(lh, la, rho=0.0):
    """P(home scores i, away scores j), corrected and renormalised."""
    ph, pa = poisson(lh), poisson(la)
    grid = [[ph[i] * pa[j] * max(0.0, tau(i, j, lh, la, rho)) for j in range(MAX_GOALS + 1)] for i in range(MAX_GOALS + 1)]
    total = sum(map(sum, grid))
    return [[v / total for v in row] for row in grid]


def outcome(grid):
    """(home win, draw, away win) of a score grid."""
    win = sum(grid[i][j] for i in range(len(grid)) for j in range(i))
    draw = sum(grid[i][i] for i in range(len(grid)))
    return win, draw, max(0.0, 1.0 - win - draw)


def likely_score(grid):
    best = max(((grid[i][j], i, j) for i in range(len(grid)) for j in range(len(grid))), key=lambda x: x[0])
    return best[1], best[2]


def fit(matches):
    """The model of `matches`: [(elo_home, elo_away, neutral, home goals, away goals)], or
    None below MIN_FIT. ρ is the grid value that makes the observed scores most likely."""
    if len(matches) < MIN_FIT:
        return None
    home = fit_poisson([(hs, 1.0, delta(eh, ea, n)) for eh, ea, n, hs, _ in matches])
    away = fit_poisson([(as_, 1.0, -delta(eh, ea, n)) for eh, ea, n, _, as_ in matches])
    model = {"home": home, "away": away, "rho": 0.0, "matches": len(matches)}
    low = [(lh, la, hs, as_) for (eh, ea, n, hs, as_) in matches if hs <= 1 and as_ <= 1 for lh, la in [rates(model, eh, ea, n)]]

    def likelihood(rho):
        total = 0.0
        for lh, la, hs, as_ in low:
            t = tau(hs, as_, lh, la, rho)
            if t <= 0:
                return float("-inf")
            total += log(t)
        return total

    model["rho"] = max(RHO_GRID, key=likelihood)
    return model


def form_of(history):
    """A club's form from its last matches, [(xG difference, goal difference)]: (the mean
    xG difference, the mean of the goal difference less it), or None below FORM_MIN."""
    if len(history) < FORM_MIN:
        return None
    count = len(history)
    return sum(x for x, _ in history) / count, sum(g - x for x, g in history) / count


def with_forms(rows):
    """The form each side entered each match with, and each club's form after them all.

    rows: [(home, away, home goals, away goals, home xG, away xG)] in kick-off order (an
    xG may be None: the match then enters nobody's form). Returns ([(home form, away
    form)] in the rows' order, a side without a form being None, {club: form})."""
    recent = defaultdict(lambda: deque(maxlen=FORM_MATCHES))
    before = []
    for home, away, home_goals, away_goals, home_xg, away_xg in rows:
        before.append((form_of(recent[home]), form_of(recent[away])))
        if home_xg is not None and away_xg is not None:
            recent[home].append((home_xg - away_xg, home_goals - away_goals))
            recent[away].append((away_xg - home_xg, away_goals - home_goals))
    return before, {club: form for club, history in recent.items() for form in [form_of(history)] if form}


def _peak(function, low=-1.0, high=1.0, tolerance=1e-5):
    """Where a function of one number with one peak is the highest (golden-section search)."""
    ratio = (sqrt(5) - 1) / 2
    a, b = low, high
    c, d = b - ratio * (b - a), a + ratio * (b - a)
    fc, fd = function(c), function(d)
    while b - a > tolerance:
        if fc > fd:
            b, d, fd = d, c, fc
            c = b - ratio * (b - a)
            fc = function(c)
        else:
            a, c, fc = c, d, fd
            d = a + ratio * (b - a)
            fd = function(d)
    return (a + b) / 2


def fit_form(cases, model, sweeps=4):
    """(F_xG, F_luck): what the gap between two clubs' forms adds to Δ, by maximum likelihood
    on `cases`, [(Δ, x_home − x_away, l_home − l_away, home goals, away goals)], the model's
    four coefficients held as they are. (0, 0) below MIN_FIT cases."""
    if len(cases) < MIN_FIT:
        return 0.0, 0.0
    (ah, bh), (aa, ba) = model["home"], model["away"]

    def likelihood(weights):
        total = 0.0
        for delta_, xg, luck, home_goals, away_goals in cases:
            x = delta_ + weights[0] * xg + weights[1] * luck
            zh, za = ah + bh * x, aa - ba * x
            total += home_goals * zh - exp(zh) + away_goals * za - exp(za)
        return total

    weights = [0.0, 0.0]
    for _ in range(sweeps):
        for index in (0, 1):
            weights[index] = _peak(lambda value: likelihood(weights[:index] + [value] + weights[index + 1:]))
    return weights[0], weights[1]


def form_shift(weights, form):
    """The Elo points a club's form adds to its strength; 0 without a form."""
    return 400 * (weights[0] * form[0] + weights[1] * form[1]) if form else 0.0


def forecast(model, elo_home, elo_away, neutral=False):
    """{home, draw, away, home_goals, away_goals, score} of one match."""
    lh, la = rates(model, elo_home, elo_away, neutral)
    grid = score_grid(lh, la, model["rho"])
    win, draw, loss = outcome(grid)
    return {"home": win, "draw": draw, "away": loss, "home_goals": lh, "away_goals": la, "score": likely_score(grid)}


def _goals(rng, lam):
    """A Poisson draw (Knuth), for the small rates of a football score."""
    limit, k, p = exp(-lam), 0, rng.random()
    while p > limit:
        k += 1
        p *= rng.random()
    return k


def _count(x, k, p, c, lam):
    """The goals at cumulative weight `x` of a Poisson law of mean `lam` whose terms up to `k` (the last one `p`)
    weigh `c` together: one of the terms that follow, the tail going to MAX_GOALS as in poisson()."""
    while k < MAX_GOALS - 1:
        k += 1
        p *= lam / k
        c += p
        if x < c:
            return k
    return MAX_GOALS


def draw_score(u, v, lh, la, rho=0.0):
    """A score of score_grid(lh, la, rho), read at two probabilities: the home goals at `u` in the grid's home
    marginal, the away goals at `v` in its law given them. The forecast's law cell for cell: the four lowest
    scores corrected (tau; a correction below zero held at zero), goals stopped at MAX_GOALS."""
    t00 = t01 = t10 = t11 = 1.0
    if rho:  # tau() of 0-0, 0-1, 1-0 and 1-1
        t00, t01, t10, t11 = 1.0 - lh * la * rho, 1.0 + lh * rho, 1.0 + la * rho, 1.0 - rho
        if t00 < 0.0 or t01 < 0.0 or t10 < 0.0 or t11 < 0.0:
            return _draw_held(u, v, lh, la, max(0.0, t00), max(0.0, t01), max(0.0, t10), max(0.0, t11))
    # No correction held at zero: in the rows of 0 and 1 home goal, what one score loses the other gains, so each
    # row of the grid weighs what its Poisson term does. The home goals are a Poisson count; the correction only
    # moves the away goals given 0 or 1.
    p = exp(-lh)
    if u < p:
        home, s0, s1 = 0, t00, t01
    else:
        c = p + p * lh
        home, s0, s1 = (1, t10, t11) if u < c else (_count(u, 1, p * lh, c, lh), 1.0, 1.0)
    p = exp(-la)
    c = p * s0
    if v < c:
        return home, 0
    p *= la
    c += p * s1
    if v < c:
        return home, 1
    return home, _count(v, 1, p, c, la)


def _draw_held(u, v, lh, la, t00, t01, t10, t11):
    """draw_score where a correction is held at zero: the grid no longer weighs 1 before it is renormalised, and
    the rows of 0 and 1 home goal no longer weigh their Poisson terms."""
    h0 = exp(-lh)
    h1 = h0 * lh
    a0 = exp(-la)
    a1 = a0 * la
    r0 = 1.0 + a0 * (t00 - 1.0) + a1 * (t01 - 1.0)
    r1 = 1.0 + a0 * (t10 - 1.0) + a1 * (t11 - 1.0)
    w0, w1 = h0 * r0, h1 * r1
    x = u * (1.0 + (w0 - h0) + (w1 - h1))
    if x < w0:
        home, row, s0, s1 = 0, r0, t00, t01
    elif x < w0 + w1:
        home, row, s0, s1 = 1, r1, t10, t11
    else:
        home, row, s0, s1 = _count(x, 1, h1, w0 + w1, lh), 1.0, 1.0, 1.0
    y = v * row
    c = a0 * s0
    if y < c:
        return home, 0
    c += a1 * s1
    if y < c:
        return home, 1
    return home, _count(y, 1, a1, c, la)


def fixture_keys(fixtures):
    """A key of its own for each fixture of a list: [(home, away, later)], `later` the number of fixtures after it
    with the same home and away clubs. The last meeting of two clubs keeps its key once an earlier one is played."""
    later, keys = defaultdict(int), []
    for home, away in reversed(fixtures):
        keys.append((home, away, later[(home, away)]))
        later[(home, away)] += 1
    return keys[::-1]


def _stream(seed, *key):
    """A generator of its own for one club or one fixture of a projection: what it draws does not depend on what
    else is replayed, so a change elsewhere leaves its draws as they were."""
    return random.Random("/".join(map(str, (seed, *key))))


def _league(table, fixtures, strengths, spread):
    """A league ready to replay: (teams, games, base, reach, elo), the clubs by their place in `teams`. games:
    [(home, away)]; base: (points, goals for, goals against, played) so far; reach: how far a club's strength may
    move, `spread` × √(share of its season still to play). A fixture of a club without a strength cannot be
    replayed: ValueError."""
    teams = sorted(set(table) | {t for f in fixtures for t in f})
    missing = sorted({t for f in fixtures for t in f if t not in strengths})
    if missing:
        raise ValueError(f"no strength for {missing}: their matches left cannot be replayed")
    index = {team: i for i, team in enumerate(teams)}
    games = [(index[h], index[a]) for h, a in fixtures]
    left = [0] * len(teams)
    for h, a in games:
        left[h] += 1
        left[a] += 1
    base = [(tuple(table.get(team, ())) + (0, 0, 0, 0))[:4] for team in teams]
    reach = [spread * (left[i] / (left[i] + base[i][3])) ** 0.5 if left[i] + base[i][3] else 0.0 for i in range(len(teams))]
    return teams, games, base, reach, [strengths.get(team, 0.0) for team in teams]


def _replays(teams, games, base, reach, elo, model, simulations, seed):
    """A league's matches left replayed `simulations` times: yields (the strengths of the replay, the clubs in
    their final order, their points), the clubs by their place in `teams`. Each club draws its strength shift and
    its tie-break from its own generator, each fixture its score from its own (fixture_keys)."""
    (ah, bh), (aa, ba) = model["home"], model["away"]
    rho = model["rho"]
    n = len(teams)
    clubs = [_stream(seed, "club", team) for team in teams]
    shift, tie = [club.gauss for club in clubs], [club.random for club in clubs]
    keys = fixture_keys([(teams[h], teams[a]) for h, a in games])
    plays = [(h, a, _stream(seed, "match", *key).random) for (h, a), key in zip(games, keys)]
    start = [[b[k] for b in base] for k in range(3)]
    for _ in range(simulations):
        now = [elo[i] + (shift[i](0.0, reach[i]) if reach[i] else 0.0) for i in range(n)]
        points, scored, conceded = start[0][:], start[1][:], start[2][:]
        for h, a, draw in plays:
            d = (now[h] + ELO_HOME - now[a]) / 400
            hs, as_ = draw_score(draw(), draw(), exp(ah + bh * d), exp(aa - ba * d), rho)
            scored[h] += hs
            conceded[h] += as_
            scored[a] += as_
            conceded[a] += hs
            if hs > as_:
                points[h] += 3
            elif hs < as_:
                points[a] += 3
            else:
                points[h] += 1
                points[a] += 1
        # Ties beyond goals scored are split at random, as a replay cannot know the rest.
        split = [draw() for draw in tie]
        yield now, sorted(range(n), key=lambda i: (-points[i], -(scored[i] - conceded[i]), -scored[i], split[i])), points


def simulate(table, fixtures, model, strengths, *, simulations=SIMULATIONS, spread=STRENGTH_SPREAD, seed=0):
    """Project a league. `table`: {team: (points, goals for, goals against, played)} so far;
    `fixtures`: [(home, away)] still to play; `strengths`: {team: Elo}. Returns
    {team: {"positions": [share of replays at 1st, 2nd, …], "points": mean final points}}.
    ValueError when a club of a fixture has no strength."""
    teams, games, base, reach, elo = _league(table, fixtures, strengths, spread)
    counts = [[0] * len(teams) for _ in teams]
    points_sum = [0.0] * len(teams)
    for _, order, points in _replays(teams, games, base, reach, elo, model, simulations, seed):
        for position, i in enumerate(order):
            counts[i][position] += 1
            points_sum[i] += points[i]
    return {team: {"positions": [c / simulations for c in counts[i]], "points": points_sum[i] / simulations} for i, team in enumerate(teams)}


# A UEFA cup's knockout rounds, by the names the sources give them (the qualifying rounds
# before the league phase are none of them).
KNOCKOUT_STAGES = ("playoff", "r16", "qf", "sf", "final")
_KNOCKOUT_NAMES = (
    ("playoff", ("1/16", "play-off", "playoff", "knockout round")),
    ("r16", ("1/8", "round of 16", "eighth")),
    ("qf", ("1/4", "quarter")),
    ("sf", ("1/2", "semi")),
    ("final", ("final",)),
)
# Extra time is a third of a match (the user's choice, 16 November 2026); a shoot-out is
# won by either side half the time.
EXTRA_TIME = 1 / 3
# The play-off pairs of the league phase (positions, 0-based): 9/10 v 23/24, 11/12 v
# 21/22, 13/14 v 19/20, 15/16 v 17/18; the seeded pair plays its second leg at home.
PLAYOFF_PAIRS = (((8, 9), (22, 23)), ((10, 11), (20, 21)), ((12, 13), (18, 19)), ((14, 15), (16, 17)))
# The round of 16: 1/2 meet the winners of the 15/16 v 17/18 pairs, 3/4 those of 13/14 v
# 19/20, 5/6 those of 11/12 v 21/22, 7/8 those of 9/10 v 23/24 (the pair's index above).
R16_SEEDS = (((0, 1), 3), ((2, 3), 2), ((4, 5), 1), ((6, 7), 0))
# The bracket after the round of 16, by the league position of each tie's seeded club:
# 1st and 2nd in opposite halves.
BRACKET = (0, 7, 3, 4, 1, 6, 2, 5)


def knockout_stage(name):
    """The knockout round a round's name is: playoff, r16, qf, sf, final, or None."""
    low = str(name or "").strip().lower()
    if not low or "qualif" in low:
        return None
    for stage, words in _KNOCKOUT_NAMES:
        if any(low == w or (len(w) >= 4 and w in low) for w in words):
            if stage == "final" and ("semi" in low or "quarter" in low):
                continue
            return stage
    return None


def _knockout_play(rng, model):
    """The three ways a knockout tie is played, on strengths `now` (indexable by club): a match
    (goals of each side; `share` of a match, a third for extra time), a tie of legs (the legs
    played count as they are, the others are replayed, the seeded side at home second; level
    after the last leg: extra time, then penalties at 50/50 unless a played leg gives them),
    and a final (one match on neutral ground). Extra time and penalties: the user's choice,
    16 November 2026. A whole match is drawn from its forecast's law (draw_score); extra time
    from two independent Poisson laws, the low-score correction being fitted on ninety minutes."""
    (ah, bh), (aa, ba) = model["home"], model["away"]
    rho = model["rho"]

    def match(home, away, now, neutral=False, share=1.0):
        d = (now[home] + (0.0 if neutral else ELO_HOME) - now[away]) / 400
        return draw_score(rng.random(), rng.random(), share * exp(ah + bh * d), share * exp(aa - ba * d), rho if share == 1.0 else 0.0)

    def tie(a, b, legs, now, seeded=None):
        """The winner of a two-legged tie between a and b: the legs played count as they
        are; the others are replayed, the seeded side at home second."""
        if not legs:
            first, second = (a, b) if seeded == b else (b, a) if seeded == a else (a, b)
            legs = [(first, second, None, None, None, None), (second, first, None, None, None, None)]
        total = {a: 0, b: 0}
        pens = None
        last = len(legs) - 1
        for k, (home, away, hs, as_, hp, ap) in enumerate(legs):
            if hs is None or as_ is None:
                hs, as_ = match(home, away, now)
                if k == last and total[home] + hs == total[away] + as_:
                    eh, ea = match(home, away, now, share=EXTRA_TIME)
                    hs, as_ = hs + eh, as_ + ea
            elif hp is not None and ap is not None:
                pens = home if hp > ap else away
            total[home] += hs
            total[away] += as_
        if total[a] != total[b]:
            return a if total[a] > total[b] else b
        return pens if pens is not None else (a if rng.random() < 0.5 else b)

    def final(a, b, legs, now):
        if legs:
            return tie(a, b, legs[:1], now)
        ga, gb = match(a, b, now, neutral=True)
        if ga == gb:
            ea, eb = match(a, b, now, neutral=True, share=EXTRA_TIME)
            ga, gb = ga + ea, gb + eb
        if ga != gb:
            return a if ga > gb else b
        return a if rng.random() < 0.5 else b

    return match, tie, final


def simulate_cup(table, fixtures, model, strengths, knockout, *, simulations=SIMULATIONS, spread=STRENGTH_SPREAD, seed=0):
    """Project a UEFA cup of the league-phase format: its league phase as simulate() does,
    then its bracket. `knockout`: {stage: [{"teams": (a, b), "legs": [(home, away, home
    goals, away goals, home penalties, away penalties)]}]} of the ties drawn or played; a
    leg without a score is still to play; a stage not given is drawn in each replay by the
    competition's rules. A tie already decided stays as it is. Returns {team: {"positions",
    "points", "stages": {top8, playoff, out, r16, qf, sf, final, win}}}. The league phase draws
    as a league does (each club and fixture its own generator); the bracket's draws come from one
    generator. ValueError when a club of a fixture has no strength."""
    teams, games, base, reach, elo = _league(table, fixtures, strengths, spread)
    index = {team: i for i, team in enumerate(teams)}
    n = len(teams)
    rng = random.Random(seed)  # the bracket's draws
    counts = [[0] * n for _ in range(n)]
    points_sum = [0.0] * n
    reached = {key: [0] * n for key in ("top8", "playoff", "out", "r16", "qf", "sf", "final", "win")}
    drawn = {stage: [(tuple(index[t] for t in tie["teams"]), [(index[l[0]], index[l[1]], *l[2:]) for l in tie["legs"]])
                     for tie in knockout.get(stage, ()) if all(t in index for t in tie["teams"])]
             for stage in KNOCKOUT_STAGES}

    match, tie, final = _knockout_play(rng, model)

    for now, order, points in _replays(teams, games, base, reach, elo, model, simulations, seed):
        place = {team: k for k, team in enumerate(order)}
        for position, i in enumerate(order):
            counts[i][position] += 1
            points_sum[i] += points[i]
            reached["top8" if position < 8 else "playoff" if position < 24 else "out"][i] += 1
        if n < 24:
            continue
        # Play-offs: the ties drawn as they are; within each pair of the rules, the clubs no
        # drawn tie holds are drawn against each other, the seeded one at home second.
        winners, held = {}, set()
        for (a, b), legs in drawn["playoff"]:
            seeded = min((a, b), key=place.get)
            k = next((k for k, (top, _) in enumerate(PLAYOFF_PAIRS) if place[seeded] in top), None)
            winners.setdefault(k, []).append(tie(a, b, legs, now, seeded=seeded))
            held.update((a, b))
        for k, (top, bottom) in enumerate(PLAYOFF_PAIRS):
            seeds = [order[p] for p in top if order[p] not in held]
            others = [order[p] for p in bottom if order[p] not in held]
            rng.shuffle(others)
            winners.setdefault(k, []).extend(tie(o, t, [], now, seeded=t) for t, o in zip(seeds, others))
        # Round of 16: the ties drawn, else the seeds of the rules against the play-off winners.
        if drawn["r16"]:
            r16 = [((a, b), legs) for (a, b), legs in drawn["r16"]]
        else:
            r16 = []
            for top, k in R16_SEEDS:
                opponents = list(winners.get(k, []))
                rng.shuffle(opponents)
                for m, seed_place in enumerate(top):
                    if m < len(opponents):
                        r16.append(((opponents[m], order[seed_place]), []))
        for (a, b), _ in r16:
            reached["r16"][a] += 1
            reached["r16"][b] += 1
        # Each round: its ties drawn, else the bracket by the league place of each tie's seeded club.
        current = [(pair, legs) for pair, legs in r16]
        for stage, key in (("qf", "qf"), ("sf", "sf"), ("final", "final")):
            if stage == "qf" and not drawn["qf"]:
                ranked = sorted(current, key=lambda t: min(place[t[0][0]], place[t[0][1]]))
                current = [ranked[i] for i in sorted(range(len(ranked)), key=lambda i: BRACKET.index(i) if i < len(BRACKET) else i)]
            survivors = [tie(a, b, legs, now, seeded=min((a, b), key=place.get)) for (a, b), legs in current]
            if drawn[stage]:
                current = [((a, b), legs) for (a, b), legs in drawn[stage]]
            else:
                current = [((survivors[i], survivors[i + 1]), []) for i in range(0, len(survivors) - 1, 2)]
            for (a, b), _ in current:
                reached[key][a] += 1
                reached[key][b] += 1
        if len(current) == 1:
            (a, b), legs = current[0]
            reached["win"][final(a, b, legs, now)] += 1
    return {
        team: {
            "positions": [c / simulations for c in counts[i]],
            "points": points_sum[i] / simulations,
            "stages": {key: values[i] / simulations for key, values in reached.items()},
        }
        for team, i in index.items()
    }


# Domestic knockout cups (VI-19, VI-21, 17 November 2026). For each cup of the sources, by its key: the
# most clubs a round may hold once no club is still to enter (the FA Cup's top clubs enter its third
# round, 64 clubs; the Coppa Italia's seeds its round of 16), and whether its semi-finals have two legs.
# The German cup is read from OpenLigaDB, which gives its rounds and shoot-outs; open-matchday's copy of
# it is not projected.
KNOCKOUT_CUPS = {
    "openligadb:germany-cup": (64, False),
    "open-matchday:ENG_CUP_efl-cup": (32, True),
    "open-matchday:ENG_CUP_fa-cup": (64, False),
    "open-matchday:AUT_CUP_ofb-cup": (64, False),
    "open-matchday:SUI_CUP_swiss-cup": (32, False),
    "open-matchday:POR_CUP_taca-de-portugal": (64, True),
    "open-matchday:ITA_CUP_coppa-italia": (16, True),
    "open-matchday:ESP_CUP_copa-del-rey": (32, True),
    "open-matchday:NED_CUP_knvb-beker": (32, False),
    "open-matchday:SCO_CUP_league-cup": (16, False),
    "open-matchday:SCO_CUP_scottish-cup": (32, False),
}
# A finished match this close before a round's first fixture (days) says the round has begun.
ROUND_GAP = 7
# The stage a round's size names, from the round of 64 to the winner.
KNOCKOUT_SIZES = {64: "r64", 32: "r32", 16: "r16", 8: "qf", 4: "sf", 2: "final", 1: "win"}
# The cups' matches of a season: (edition, cup key, home, away, status, home goals, away goals, home
# penalties, away penalties, day).
CUP_MATCHES = """
SELECT m.competition_season_id, cs.cup_key, m.home_team_id, m.away_team_id, m.status::text, m.home_score, m.away_score,
  m.home_penalty_score, m.away_penalty_score, coalesce(m.match_date, m.kickoff_at::date)
FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.cup_key IS NOT NULL
WHERE m.season_id = %s AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
  AND (cs.cup_key LIKE 'open-matchday:%%' OR cs.cup_key LIKE 'openligadb:%%')"""


def knockout_cup(cup_key):
    """(cup, most clubs once all are in, two-legged semi-finals) of a projected cup's edition key, else None."""
    parts = str(cup_key or "").split(":")
    if len(parts) != 3:
        return None
    cup = f"{parts[0]}:{parts[1]}"
    rule = KNOCKOUT_CUPS.get(cup)
    return (cup, *rule) if rule else None


def knockout_round(rows):
    """{edition: ties} of the editions whose next round is drawn and not begun: the ties of the
    fixtures still to play (each club once, their number a power of two), with the legs already
    played of a two-legged tie. An edition with a tie of the round played (a finished match of
    other clubs ROUND_GAP days or less before its first fixture) waits for the next draw."""
    editions = defaultdict(list)
    for r in rows:
        editions[r[0]].append(r)
    out = {}
    for edition, items in editions.items():
        pending = [r for r in items if r[4] == "not_started"]
        if not pending:
            continue
        pairs = {frozenset((r[2], r[3])) for r in pending}
        days = [r[9] for r in pending if r[9] is not None]
        first = min(days) if days else None
        ties = {}
        begun = False
        for r in sorted(items, key=lambda r: (r[9] is None, r[9] or 0)):
            pair = frozenset((r[2], r[3]))
            played = r[4] == "finished" and r[5] is not None and r[6] is not None
            if pair not in pairs:
                if played and first is not None and r[9] is not None and (first - r[9]).days <= ROUND_GAP:
                    begun = True
                continue
            if r[4] not in ("finished", "not_started"):
                continue
            tie = ties.setdefault(pair, {"teams": (r[2], r[3]), "legs": []})
            tie["legs"].append((r[2], r[3], r[5], r[6], r[7], r[8]) if played else (r[2], r[3], None, None, None, None))
        n = len(ties)
        clubs = [t for tie in ties.values() for t in tie["teams"]]
        if begun or not n or n & (n - 1) or len(set(clubs)) != 2 * n:
            continue
        out[edition] = list(ties.values())
    return out


def simulate_knockout(ties, model, strengths, *, simulations=SIMULATIONS, reach=0.0, seed=0, two_legged_semis=False):
    """Replay a knockout cup from the round `ties` holds to its final: each tie as it is drawn (its
    played legs fixed), then each round drawn at random, one match the home side drawn first,
    the semi-finals of two legs when `two_legged_semis`, the final on neutral ground. A club's
    strength moves by a normal draw of standard deviation `reach`. Returns {club: {stage: share}},
    from the round in play (KNOCKOUT_SIZES) to the winner."""
    rng = random.Random(seed)
    match, tie, final = _knockout_play(rng, model)
    clubs = [t for item in ties for t in item["teams"]]
    stages = [KNOCKOUT_SIZES[size] for size in sorted(KNOCKOUT_SIZES, reverse=True) if size <= len(clubs)]
    reached = {club: {stage: 0 for stage in stages} for club in clubs}
    for _ in range(simulations):
        now = {club: strengths[club] + (rng.gauss(0.0, reach) if reach else 0.0) for club in clubs}
        for club in clubs:
            reached[club][stages[0]] += 1
        current = [(item["teams"], item["legs"]) for item in ties]
        while current:
            if len(current) == 1:
                (a, b), legs = current[0]
                played = any(leg[2] is not None for leg in legs)
                winner = tie(a, b, legs, now) if played else final(a, b, [], now)
                reached[winner]["win"] += 1
                break
            winners = [tie(a, b, legs, now) if legs else tie(a, b, [(a, b, None, None, None, None)], now) for (a, b), legs in current]
            stage = KNOCKOUT_SIZES[len(winners)]
            for club in winners:
                reached[club][stage] += 1
            rng.shuffle(winners)
            pairs = [(winners[i], winners[i + 1]) for i in range(0, len(winners), 2)]
            if len(winners) == 4 and two_legged_semis:
                current = [((a, b), [(a, b, None, None, None, None), (b, a, None, None, None, None)]) for a, b in pairs]
            elif len(winners) == 2:
                current = [(pairs[0], [])]
            else:
                current = [((a, b), [(a, b, None, None, None, None)]) for a, b in pairs]
    return {club: {stage: count / simulations for stage, count in shares.items()} for club, shares in reached.items()}


def knockout_projections(rows, model, strengths, today, *, simulations=SIMULATIONS):
    """{edition: {club: {stage: share}}} of the cups of CUP_MATCHES' rows that can be projected: a cup of
    KNOCKOUT_CUPS whose next round is drawn and not begun (knockout_round), holds no more clubs than the
    round its last clubs enter, every club rated. A strength may move until the season's end (30 June):
    STRENGTH_SPREAD × √(share of the year left), as a league's."""
    keys = {r[0]: r[1] for r in rows}
    end = date(today.year + (today.month > 6), 6, 30)
    reach = STRENGTH_SPREAD * sqrt(min(1.0, max(0.0, (end - today).days / 365)))
    out = {}
    for edition, ties in knockout_round(rows).items():
        rule = knockout_cup(keys.get(edition))
        clubs = [t for tie in ties for t in tie["teams"]]
        if rule is None or len(clubs) > rule[1] or any(club not in strengths for club in clubs):
            continue
        out[edition] = simulate_knockout(ties, model, strengths, simulations=simulations, reach=reach, seed=edition, two_legged_semis=rule[2])
    return out


# The Nations League (VI-19, 17 November 2026): its editions of a season, League A (OpenLigaDB, groups « 1 » to
# « 4 ») and Leagues B to D (International Results, groups « B1 » to « D2 »). Rows: (edition, cup key, group, home,
# away, status, home goals, away goals, day).
NATIONS_MATCHES = """
SELECT m.competition_season_id, cs.cup_key, m.group_name, m.home_team_id, m.away_team_id, m.status::text, m.home_score, m.away_score,
  coalesce(m.match_date, m.kickoff_at::date), h.name, a.name
FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
JOIN core.teams h ON h.id = m.home_team_id JOIN core.teams a ON a.id = m.away_team_id
WHERE m.season_id = %s AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
  AND (m.group_name IS NOT NULL OR cs.cup_key LIKE 'openligadb:nations-league:%%')
  AND (cs.cup_key LIKE 'openligadb:nations-league:%%' OR cs.cup_key LIKE 'nations-results:nations-league:%%')"""
NATIONS_LEAGUE_A = "openligadb:nations-league:"


def nations_groups(rows):
    """{edition: {group: {"members", "results": [(home, away, home goals, away goals)], "fixtures": [(home, away)]}}}.
    A group plays home and away: a leg neither played nor given as a fixture (International Results gives
    none) is a match left."""
    out = defaultdict(lambda: defaultdict(lambda: {"members": set(), "results": [], "fixtures": []}))
    for edition, _, group, home, away, status, hs, as_, *_ in sorted(rows, key=lambda r: (r[0], str(r[2]), r[8] or 0)):
        if group is None:
            continue  # a knockout tie (nations_draws)
        g = out[edition][group]
        g["members"].update((home, away))
        if status == "finished" and hs is not None and as_ is not None:
            g["results"].append((home, away, hs, as_))
        elif status == "not_started":
            g["fixtures"].append((home, away))
    for groups in out.values():
        for g in groups.values():
            done = {(h, a) for h, a, *_ in g["results"]} | set(g["fixtures"])
            g["fixtures"] += [(h, a) for h in sorted(g["members"]) for a in sorted(g["members"]) if h != a and (h, a) not in done]
    return {edition: dict(groups) for edition, groups in out.items()}


def group_table(teams, games):
    """{team: [points, goal difference, goals, away goals, wins, away wins]} of `games` between `teams`."""
    t = {team: [0, 0, 0, 0, 0, 0] for team in teams}
    for h, a, hs, as_ in games:
        if h in t and a in t:
            t[h][1] += hs - as_; t[a][1] += as_ - hs; t[h][2] += hs; t[a][2] += as_; t[a][3] += as_
            if hs > as_:
                t[h][0] += 3; t[h][4] += 1
            elif hs < as_:
                t[a][0] += 3; t[a][4] += 1; t[a][5] += 1
            else:
                t[h][0] += 1; t[a][0] += 1
    return t


def uefa_order(members, results, rng, rank=None):
    """A group's order as UEFA ranks it, and as the site does (nations-standings.js): points; among teams level, the
    points, goal difference and goals of their own matches, again among those still level; then overall goal
    difference, goals, away goals, wins, away wins; then the disciplinary points (the sources give no cards: left
    out); then the access list (`rank`: {team: position}, the 2024–25 final ranking); a tie left after all is drawn."""
    table = group_table
    overall = table(members, results)
    rank = rank or {}

    def split(teams, key):
        parts = defaultdict(list)
        for team in teams:
            parts[key(team)].append(team)
        return [parts[k] for k in sorted(parts, reverse=True)]

    def level(teams):
        if len(teams) < 2:
            return list(teams)
        own = table(teams, [g for g in results if g[0] in teams and g[1] in teams])
        parts = split(teams, lambda t: tuple(own[t][:3]))
        if len(parts) > 1:
            return [team for part in parts for team in level(part)]
        parts = split(teams, lambda t: (overall[t][1], overall[t][2], overall[t][3], overall[t][4], overall[t][5]))
        return [team for part in parts for team in sorted(part, key=lambda t: (rank.get(t, len(ACCESS_LIST) + 1), rng.random()))]

    return [team for part in split(members, lambda t: overall[t][0]) for team in level(part)]


def simulate_nations(groups, model, strengths, *, knockout, simulations=SIMULATIONS, reach=0.0, seed=0):
    """Replay a Nations League's groups (their matches left), then, for League A (`knockout`), its quarter-finals
    (each group winner against another group's runner-up drawn at random, two legs, the winner at home second) and
    its Final Four (one match on neutral ground). Returns {team: {stage: share}}: first to fourth of its group, then
    qf, sf, final and win for League A."""
    rng = random.Random(seed)
    match, tie, final = _knockout_play(rng, model)
    teams = sorted({t for g in groups.values() for t in g["members"]})
    keys = ["first", "second", "third", "fourth"] + (["qf", "sf", "final", "win"] if knockout else [])
    reached = {t: dict.fromkeys(keys, 0) for t in teams}
    places = ["first", "second", "third", "fourth"]
    for _ in range(simulations):
        now = {t: strengths[t] + (rng.gauss(0.0, reach) if reach else 0.0) for t in teams}
        winners, runners = [], []
        for name in sorted(groups):
            g = groups[name]
            results = g["results"] + [(h, a, *match(h, a, now)) for h, a in g["fixtures"]]
            order = uefa_order(g["members"], results, rng)
            for k, team in enumerate(order[:4]):
                reached[team][places[k]] += 1
            winners.append((name, order[0]))
            runners.append((name, order[1]))
        if not knockout or len(winners) != 4:
            continue
        for _, team in winners + runners:
            reached[team]["qf"] += 1
        while True:
            drawn = runners[:]
            rng.shuffle(drawn)
            if all(w[0] != r[0] for w, r in zip(winners, drawn)):
                break
        four = [tie(w, r, [(r, w, None, None, None, None), (w, r, None, None, None, None)], now) for (_, w), (_, r) in zip(winners, drawn)]
        for team in four:
            reached[team]["sf"] += 1
        rng.shuffle(four)
        finalists = [final(four[0], four[1], [], now), final(four[2], four[3], [], now)]
        for team in finalists:
            reached[team]["final"] += 1
        reached[final(*finalists, [], now)]["win"] += 1
    return {t: {k: v / simulations for k, v in r.items()} for t, r in reached.items()}


# The 2026–27 access list (UEFA, from the 2024–25 final ranking), by FIFA code: the last tie-breaking criterion.
ACCESS_LIST = tuple("""POR ESP FRA GER ITA NED DEN CRO SRB BEL ENG NOR WAL CZE GRE TUR SCO HUN POL ISR SUI BIH AUT UKR SVN GEO IRL ROU
SWE MKD NIR KOS ISL ALB MNE KAZ FIN SVK BUL ARM BLR FRO CYP EST LVA LUX MDA SMR AZE LTU MLT GIB LIE AND""".split())
# The names the Nations League's sources give a nation (English, French), by FIFA code.
_NATION_NAMES = {
    "POR": "Portugal", "ESP": "Spain|Espagne", "FRA": "France", "GER": "Germany|Allemagne", "ITA": "Italy|Italie",
    "NED": "Netherlands|Pays-Bas|Holland", "DEN": "Denmark|Danemark", "CRO": "Croatia|Croatie", "SRB": "Serbia|Serbie",
    "BEL": "Belgium|Belgique", "ENG": "England|Angleterre", "NOR": "Norway|Norvège", "WAL": "Wales|Pays de Galles",
    "CZE": "Czechia|Czech Republic|Tchéquie|République tchèque", "GRE": "Greece|Grèce", "TUR": "Turkey|Türkiye|Turkiye|Turquie",
    "SCO": "Scotland|Écosse", "HUN": "Hungary|Hongrie", "POL": "Poland|Pologne", "ISR": "Israel|Israël", "SUI": "Switzerland|Suisse",
    "BIH": "Bosnia and Herzegovina|Bosnia-Herzegovina|Bosnie-Herzégovine", "AUT": "Austria|Autriche", "UKR": "Ukraine",
    "SVN": "Slovenia|Slovénie", "GEO": "Georgia|Géorgie", "IRL": "Republic of Ireland|Ireland|Irlande", "ROU": "Romania|Roumanie",
    "SWE": "Sweden|Suède", "MKD": "North Macedonia|Macédoine du Nord", "NIR": "Northern Ireland|Irlande du Nord", "KOS": "Kosovo",
    "ISL": "Iceland|Islande", "ALB": "Albania|Albanie", "MNE": "Montenegro|Monténégro", "KAZ": "Kazakhstan", "FIN": "Finland|Finlande",
    "SVK": "Slovakia|Slovaquie", "BUL": "Bulgaria|Bulgarie", "ARM": "Armenia|Arménie", "BLR": "Belarus|Biélorussie",
    "FRO": "Faroe Islands|Îles Féroé|Iles Feroe", "CYP": "Cyprus|Chypre", "EST": "Estonia|Estonie", "LVA": "Latvia|Lettonie",
    "LUX": "Luxembourg", "MDA": "Moldova|Moldavie", "SMR": "San Marino|Saint-Marin", "AZE": "Azerbaijan|Azerbaïdjan",
    "LTU": "Lithuania|Lituanie", "MLT": "Malta|Malte", "GIB": "Gibraltar", "LIE": "Liechtenstein", "AND": "Andorra|Andorre",
}


def _plain(name):
    import unicodedata

    return "".join(c for c in unicodedata.normalize("NFKD", str(name or "")) if not unicodedata.combining(c)).lower().replace("-", " ").strip()


_NATION_CODES = {_plain(n): code for code, names in _NATION_NAMES.items() for n in names.split("|")}


def nation_code(name):
    """A UEFA nation's FIFA code from the name a source gives it, else None."""
    return _NATION_CODES.get(_plain(name))


def nations_leagues(rows):
    """The Nations League's four leagues from NATIONS_MATCHES' rows of a season, every edition together: {league: {"groups":
    {group: …}}} (League A's groups are « 1 » to « 4 », the others « B1 »…), League A carrying "draws": {pair: legs},
    the ties drawn so far (quarter-finals, play-offs: a match without a group), each leg (home, away, home goals, away
    goals, None, None), the ones not played with no score."""
    out = defaultdict(lambda: {"groups": {}})
    for edition, groups in nations_groups(rows).items():
        for name, g in groups.items():
            league = "A" if str(name).isdigit() else str(name)[0]
            out[league]["groups"][name] = g
    draws = defaultdict(list)
    for r in sorted((r for r in rows if r[2] is None), key=lambda r: (r[8] is None, r[8] or 0)):
        _, _, _, home, away, status, hs, as_ = r[:8]
        played = status == "finished" and hs is not None and as_ is not None
        if played or status == "not_started":
            draws[frozenset((home, away))].append((home, away, hs if played else None, as_ if played else None, None, None))
    out["A"]["draws"] = dict(draws)
    return dict(out)


def simulate_nations_season(leagues, model, strengths, *, rank=None, simulations=SIMULATIONS, reach=0.0, seed=0):
    """The 2026–27 Nations League replayed, its four leagues together (a transitional season: three leagues of 18
    nations from 2028–29). Each group to its end (uefa_order); League A's quarter-finals (a winner against another
    group's runner-up, two legs, the winner at home second) and Final Four (neutral ground); then:
    - League A: the two best third-placed stay (stay); its two worst third-placed and two best fourth-placed play the
      A/B play-offs (barrage) against League B's runners-up; its two worst fourth-placed go down (relegated). Third-
      and fourth-placed are ranked across groups by points, goal difference, goals, away goals, wins, away wins, then
      the access list (no head-to-head, no cards in the sources);
    - League B: winners go up (promoted), third-placed stay, fourth-placed play the B/C play-offs against League C's
      runners-up;
    - League C: winners go up, third- and fourth-placed stay;
    - League D: all go up.
    Play-offs drawn at random (UEFA names no seeding) unless already drawn (leagues["A"]["draws"]), two legs, the higher
    league's side at home second. Returns {team: {stage: share}}: first to fourth; qf, sf, final, win (League A);
    stay, barrage, relegated, promoted; next_a, next_b, next_c, the league it plays in 2028–29."""
    rng = random.Random(seed)
    match, tie, final = _knockout_play(rng, model)
    rank = rank or {}
    draws = leagues.get("A", {}).get("draws", {})
    teams = sorted({t for lg in leagues.values() for g in lg["groups"].values() for t in g["members"]})
    keys = ["first", "second", "third", "fourth", "stay", "barrage", "relegated", "promoted", "next_a", "next_b", "next_c"]
    reached = {t: dict.fromkeys(keys + (["qf", "sf", "final", "win"] if any(t in g["members"] for g in leagues["A"]["groups"].values()) else []), 0)
               for t in teams}
    places = ["first", "second", "third", "fourth"]

    def legs_of(a, b, home_second):
        """The tie's legs: the draw's when drawn (its missing leg added), else two legs, `home_second` at home second."""
        known = list(draws.get(frozenset((a, b)), []))
        if len(known) == 1:
            h, w = known[0][:2]
            known.append((w, h, None, None, None, None))
        return known or [(a if home_second == b else b, home_second, None, None, None, None), (home_second, b if home_second == a else a, None, None, None, None)]

    def pair(side, other, avoid=lambda x, y: False):
        """side[i] against other[j]: the ties already drawn, the rest drawn at random (no two of `avoid`)."""
        rest_a, rest_b, out = list(side), list(other), []
        for x in list(rest_a):
            for y in list(rest_b):
                if frozenset((x, y)) in draws:
                    out.append((x, y)); rest_a.remove(x); rest_b.remove(y)
                    break
        for _ in range(100):
            rng.shuffle(rest_b)
            if not any(avoid(x, y) for x, y in zip(rest_a, rest_b)):
                break
        return out + list(zip(rest_a, rest_b))

    def ranked(entries):
        """(group, team, table row) across groups, best first: no head-to-head, then the access list."""
        return [t for _, t, _ in sorted(entries, key=lambda e: (-e[2][0], -e[2][1], -e[2][2], -e[2][3], -e[2][4], -e[2][5],
                                                                rank.get(e[1], len(ACCESS_LIST) + 1), rng.random()))]

    for _ in range(simulations):
        now = {t: strengths[t] + (rng.gauss(0.0, reach) if reach else 0.0) for t in teams}
        orders, tables = {}, {}
        for league, lg in leagues.items():
            for name in sorted(lg["groups"]):
                g = lg["groups"][name]
                results = g["results"] + [(h, a, *match(h, a, now)) for h, a in g["fixtures"]]
                order = uefa_order(g["members"], results, rng, rank)
                orders[(league, name)] = order
                tables[(league, name)] = group_table(g["members"], results)
                for k, team in enumerate(order[:4]):
                    reached[team][places[k]] += 1
        at = lambda league, k: [(name, orders[(league, name)][k], tables[(league, name)][orders[(league, name)][k]])
                                for (lg, name) in sorted(orders) if lg == league and len(orders[(league, name)]) > k]
        nxt = {}
        # League A: quarter-finals and Final Four.
        winners, runners = at("A", 0), at("A", 1)
        group = {t: name for name, t, _ in winners + runners}
        quarter = pair([t for _, t, _ in winners], [t for _, t, _ in runners], lambda x, y: group[x] == group[y])
        for x, y in quarter:
            reached[x]["qf"] += 1; reached[y]["qf"] += 1
            nxt[x] = nxt[y] = "next_a"
        four = [tie(x, y, legs_of(x, y, x), now) for x, y in quarter]
        for t in four:
            reached[t]["sf"] += 1
        rng.shuffle(four)
        finalists = [final(four[0], four[1], [], now), final(four[2], four[3], [], now)] if len(four) == 4 else []
        for t in finalists:
            reached[t]["final"] += 1
        if finalists:
            reached[final(*finalists, [], now)]["win"] += 1
        thirds, fourths = ranked(at("A", 2)), ranked(at("A", 3))
        for t in thirds[:2]:
            reached[t]["stay"] += 1; nxt[t] = "next_a"
        for t in fourths[2:]:
            reached[t]["relegated"] += 1; nxt[t] = "next_b"
        a_side = thirds[2:] + fourths[:2]
        # League B, C, D.
        for name, t, _ in at("B", 0):
            reached[t]["promoted"] += 1; nxt[t] = "next_a"
        for name, t, _ in at("B", 2):
            reached[t]["stay"] += 1; nxt[t] = "next_b"
        for name, t, _ in at("C", 0):
            reached[t]["promoted"] += 1; nxt[t] = "next_b"
        for k in (2, 3):
            for name, t, _ in at("C", k):
                reached[t]["stay"] += 1; nxt[t] = "next_c"
        for league in ("D",):
            for k in range(4):
                for name, t, _ in at(league, k):
                    reached[t]["promoted"] += 1; nxt[t] = "next_c"
        # The play-offs: A/B (League A's side at home second), B/C (League B's).
        for upper, lower, up, down in ((a_side, [t for _, t, _ in at("B", 1)], "next_a", "next_b"),
                                       ([t for _, t, _ in at("B", 3)], [t for _, t, _ in at("C", 1)], "next_b", "next_c")):
            for t in upper + lower:
                reached[t]["barrage"] += 1
            for x, y in pair(upper, lower):
                w = tie(x, y, legs_of(x, y, x), now)
                nxt[w], nxt[y if w == x else x] = up, down
        for t, k in nxt.items():
            reached[t][k] += 1
    return {t: {k: v / simulations for k, v in r.items()} for t, r in reached.items()}


def nations_projections(rows, model, strengths, today, *, simulations=SIMULATIONS):
    """{edition: (table, {team: {"positions", "points", "stages"}})} of the Nations League's editions of
    NATIONS_MATCHES' rows: League A with its knockout, Leagues B to D their groups; table: {team: (points, goals for,
    goals against, played)} so far. An edition with a nation the Elo does not rate is left out."""
    keys = {r[0]: r[1] for r in rows}
    end = date(today.year + (today.month > 6), 6, 30)
    reach = STRENGTH_SPREAD * sqrt(min(1.0, max(0.0, (end - today).days / 365)))
    # Each nation's place in the access list, by the names the rows give (columns 9 and 10, when there).
    rank = {}
    for r in rows:
        for team, name in ((r[3], r[9]), (r[4], r[10])) if len(r) > 10 else ():
            code = nation_code(name)
            if code in ACCESS_LIST:
                rank[team] = ACCESS_LIST.index(code) + 1
    editions = nations_groups(rows)
    rated = {edition for edition, groups in editions.items() if all(t in strengths for g in groups.values() for t in g["members"])}
    # The transitional season (2026–27) once Leagues A, B and C are all in the base and rated: the play-offs link them.
    leagues = nations_leagues([r for r in rows if r[0] in rated])
    season = (simulate_nations_season(leagues, model, strengths, rank=rank, simulations=simulations, reach=reach, seed=min(rated))
              if rated == set(editions) and {"A", "B", "C"} <= set(leagues) else None)
    out = {}
    for edition, groups in editions.items():
        teams = {t for g in groups.values() for t in g["members"]}
        if edition not in rated:
            continue
        table = {t: [0, 0, 0, 0] for t in teams}
        for g in groups.values():
            for h, a, hs, as_ in g["results"]:
                for team, gf, ga in ((h, hs, as_), (a, as_, hs)):
                    table[team][0] += 3 if gf > ga else 1 if gf == ga else 0
                    table[team][1] += gf
                    table[team][2] += ga
                    table[team][3] += 1
        odds = season or simulate_nations(groups, model, strengths, knockout=str(keys[edition]).startswith(NATIONS_LEAGUE_A),
                                          simulations=simulations, reach=reach, seed=edition)
        out[edition] = ({t: tuple(v) for t, v in table.items()},
                        {t: {"positions": [], "points": float(table[t][0]), "stages": odds[t]} for t in teams})
    return out


def evaluate(model, matches):
    """How the model does on `matches` it has not seen: mean log loss and Brier score of the
    three outcomes, and the calibration of the home win by tenths of probability."""
    loss = brier = 0.0
    buckets = defaultdict(lambda: [0, 0.0, 0])
    for eh, ea, n, hs, as_ in matches:
        f = forecast(model, eh, ea, n)
        probs = (f["home"], f["draw"], f["away"])
        actual = 0 if hs > as_ else 1 if hs == as_ else 2
        loss -= log(max(probs[actual], 1e-12))
        brier += sum((p - (1.0 if k == actual else 0.0)) ** 2 for k, p in enumerate(probs))
        b = buckets[min(9, int(probs[0] * 10))]
        b[0] += 1
        b[1] += probs[0]
        b[2] += actual == 0
    n = max(1, len(matches))
    return {"matches": len(matches), "log_loss": loss / n, "brier": brier / n,
            "calibration": {k: (v[0], v[1] / v[0], v[2] / v[0]) for k, v in sorted(buckets.items())}}


# Database -----------------------------------------------------------------

# The finished club matches of the PitchAPI editions, in kick-off order, with both strengths
# before them, the score after ninety minutes where the match went further, the two clubs
# and each side's xG where the match has them.
FITTED = """
SELECT eh.elo_before, ea.elo_before, coalesce(m.is_neutral, false),
  coalesce(m.home_score_90, m.home_score), coalesce(m.away_score_90, m.away_score),
  m.home_team_id, m.away_team_id, sh.xg::float8, sa.xg::float8
FROM core.matches m
JOIN agg.team_elo eh ON eh.match_id = m.id AND eh.team_id = m.home_team_id
JOIN agg.team_elo ea ON ea.match_id = m.id AND ea.team_id = m.away_team_id
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
JOIN core.teams th ON th.id = m.home_team_id AND th.is_national IS NOT TRUE
LEFT JOIN core.team_match_stats sh ON sh.season_id = m.season_id AND sh.match_id = m.id AND sh.team_id = m.home_team_id AND sh.period = 'all'
LEFT JOIN core.team_match_stats sa ON sa.season_id = m.season_id AND sa.match_id = m.id AND sa.team_id = m.away_team_id AND sa.period = 'all'
WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
ORDER BY coalesce(m.kickoff_at, m.match_date::timestamp AT TIME ZONE 'UTC') NULLS FIRST, m.id"""
# The season's matches of the PitchAPI editions: (match, edition, home, away, neutral,
# status, home score, away score, regular round?, domestic league?, kick-off).
# Every competition's matches of a season (the user, 17 November 2026: « chaque compétition doit avoir ses
# prédictions »): each match still to play between two rated teams is forecast, whatever its source. A league,
# replayed to its end, is a PitchAPI domestic competition or one of open-matchday's leagues (a folder that is no
# cup); the cups' rounds are projected apart (knockout_projections, nations_projections), never as a league.
SEASON = """
SELECT m.id, m.competition_season_id, m.home_team_id, m.away_team_id, coalesce(m.is_neutral, false), m.status::text,
  m.home_score, m.away_score, coalesce(r.stage::text, 'regular') = 'regular',
  CASE WHEN cs.cup_key IS NULL THEN c.country_code IS NOT NULL AND left(c.country_code, 3) <> 'INT'
       ELSE cs.cup_key LIKE 'open-matchday:%%' AND split_part(cs.cup_key, ':', 2) NOT LIKE '%%\\_CUP\\_%%' END,
  coalesce(m.kickoff_at, m.match_date::timestamp AT TIME ZONE 'UTC'), cs.cup_key IS NOT NULL
FROM core.matches m
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL
JOIN core.competitions c ON c.id = cs.competition_id
LEFT JOIN core.rounds r ON r.id = m.round_id
WHERE m.season_id = %s AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL"""
# A cup source's match still « to play » this long after its day: the source stopped updating (OpenFootball's
# Libertadores 2026 at its August play-offs), no match to forecast.
STALE_AFTER = timedelta(days=3)
MIN_LEAGUE = 8  # clubs: a table of fewer is no league to project
# The UEFA cups played in the league-phase format since 2024/2025 (PitchAPI keys): their league
# phase is projected like a league, then their bracket (simulate_cup).
LEAGUE_PHASE_CUPS = ("l_0bfbkO", "l_38d9HA", "l_2WZ2tt")  # Champions League, Europa League, Conference League
LEAGUE_PHASE_FROM = 2024  # the first season of the format
LEAGUE_PHASE_MATCHES = 8  # league-phase matches of each club
PHASES = """
SELECT cs.id FROM core.competition_seasons cs
JOIN core.provider_ids p ON p.entity_type = 'competition' AND p.entity_id = cs.competition_id AND p.provider = 'pitchapi'
WHERE cs.season_id = %s AND cs.season_id >= %s AND cs.cup_key IS NULL AND cs.archive_key IS NULL AND p.provider_key = ANY(%s)"""
# The knockout matches of those editions, in order: (edition, round, home, away, finished?, home
# goals, away goals, home penalties, away penalties).
KNOCKOUT = """
SELECT m.competition_season_id, r.name, m.home_team_id, m.away_team_id, m.status = 'finished',
  m.home_score, m.away_score, m.home_penalty_score, m.away_penalty_score
FROM core.matches m JOIN core.rounds r ON r.id = m.round_id
WHERE m.competition_season_id = ANY(%s) AND r.stage IS DISTINCT FROM 'regular'
  AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
ORDER BY coalesce(m.kickoff_at, m.match_date::timestamp AT TIME ZONE 'UTC') NULLS LAST, m.id"""


def knockout_state(rows):
    """{edition: {stage: [{"teams", "legs"}]}} of KNOCKOUT's rows: one tie per pair of clubs
    and stage, its legs in order (a leg not finished has no score)."""
    out = {}
    for edition, name, home, away, finished, hs, as_, hp, ap in rows:
        stage = knockout_stage(name)
        if stage is None:
            continue
        ties = out.setdefault(edition, {}).setdefault(stage, {})
        tie = ties.setdefault(frozenset((home, away)), {"teams": (home, away), "legs": []})
        tie["legs"].append((home, away, hs, as_, hp, ap) if finished and hs is not None and as_ is not None else (home, away, None, None, None, None))
    return {edition: {stage: list(ties.values()) for stage, ties in stages.items()} for edition, stages in out.items()}


def cup_over(knockout):
    """Whether a cup's final is played."""
    return any(leg[2] is not None for tie in knockout.get("final", ()) for leg in tie["legs"])


def league_state(rows, held=frozenset(), phases=frozenset()):
    """Per edition, from SEASON's rows: {edition: (table, fixtures)} of its regular rounds,
    for the domestic leagues with a match still to play, and the league phases of the UEFA
    cups (`phases`: their editions). table: {team: (points, goals for, goals against,
    played)}; fixtures: [(home, away)]. A finished match in `held` (its round is still open,
    rounds.py) counts as still to play: a league's projection moves once a whole matchweek
    is over. Each match counts once (_league_matches): a postponed match is still to play,
    an awarded one counts with its score, a canceled one and a superseded copy do not."""
    return {edition: state[:2] for edition, state in _leagues(rows, held, phases).items()}


def league_ledger(rows, held=frozenset(), phases=frozenset()):
    """How each regular match of the editions league_state gives counts: {edition: {"played", "to_play",
    "superseded", "canceled", "outside"}}. Each match is one of them, so the five add up to the edition's regular
    matches: none is lost, none counts twice (FAILURE_MODES §62)."""
    return {edition: state[2] for edition, state in _leagues(rows, held, phases).items()}


LEDGER = ("played", "to_play", "superseded", "canceled", "outside")
SETTLED = ("finished", "awarded")  # a result, once the base holds its score


def _league_matches(rows, held, phases):
    """Each regular match of a domestic league or of a league phase, once, in the rows' order: [[edition, how it
    counts, home, away, home goals, away goals, kick-off, its place in the rows]].
    - "played": finished or awarded with its score, outside an open round (`held`);
    - "to_play": not started, or a result of an open round;
    - "canceled": never a result, never to play;
    - any other row is unsettled (postponed, suspended, in play, a result whose score the base lacks): still to
      play, unless the edition lists the same home and away clubs otherwise, the source having kept the old row of
      a match it wrote again ("superseded"). Where two clubs meet twice on the same ground, a postponed meeting is
      so left out as soon as the other is listed: no rule tells them apart without the edition's format."""
    out, unsettled, listed = [], [], defaultdict(set)
    for order, (match, edition, home, away, _, status, hs, as_, regular, domestic, *rest) in enumerate(rows):
        if not (regular and (domestic or edition in phases)):
            continue
        result = status in SETTLED and hs is not None and as_ is not None
        how = "canceled" if status == "canceled" else "played" if result and match not in held else "to_play" if result or status == "not_started" else None
        item = [edition, how, home, away, hs, as_, rest[0] if rest else None, order]
        if how is None:
            unsettled.append(item)
        elif how != "canceled":
            listed[edition].add((home, away))
        out.append(item)
    for item in unsettled:
        edition, _, home, away = item[:4]
        item[1] = "superseded" if (home, away) in listed[edition] else "to_play"
        listed[edition].add((home, away))
    return out


def _leagues(rows, held=frozenset(), phases=frozenset()):
    """{edition: (table, fixtures, ledger)}: league_state and league_ledger together."""
    tables, fixtures = defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0])), defaultdict(list)
    coming = defaultdict(list)
    ledgers = defaultdict(lambda: dict.fromkeys(LEDGER, 0))
    for edition, how, home, away, hs, as_, kickoff, order in _league_matches(rows, held, phases):
        if how == "played":
            for team, gf, ga in ((home, hs, as_), (away, as_, hs)):
                entry = tables[edition][team]
                entry[0] += 3 if gf > ga else 1 if gf == ga else 0
                entry[1] += gf
                entry[2] += ga
                entry[3] += 1
        elif how == "to_play":
            coming[edition].append((kickoff is None, kickoff or 0, order, home, away))
            continue
        ledgers[edition][how] += 1
    for edition, games in coming.items():
        # A league phase holds LEAGUE_PHASE_MATCHES matches a club: a knockout match listed
        # before its round is set reads as regular, and is not replayed as one of the phase.
        count = {team: entry[3] for team, entry in tables[edition].items()}
        for *_, home, away in sorted(games) if edition in phases else games:
            if edition in phases:
                if max(count.get(home, 0), count.get(away, 0)) >= LEAGUE_PHASE_MATCHES:
                    ledgers[edition]["outside"] += 1
                    continue
                count[home] = count.get(home, 0) + 1
                count[away] = count.get(away, 0) + 1
            fixtures[edition].append((home, away))
            ledgers[edition]["to_play"] += 1
            tables[edition][home], tables[edition][away]  # a club that has not played yet is in the table
    # A league phase stays after its last round: its bracket is still to play.
    editions = set(fixtures) | (set(phases) & set(tables))
    return {edition: ({team: tuple(v) for team, v in tables[edition].items()}, fixtures.get(edition, []), dict(ledgers[edition]))
            for edition in editions if len(tables[edition]) >= MIN_LEAGUE}


def with_merges(strengths, merge):
    """`strengths` with each copy of a club (`merge`: {team: the club it is}, identity.pairs) at its club's strength,
    until the daily identity pass merges it; a team with its own strength keeps it."""
    out = dict(strengths)
    for team, club in merge.items():
        if team not in out and club in strengths:
            out[team] = strengths[club]
    return out


def refresh(conn, season):
    """The forecasts and projections of a season in progress (after power.refresh_elo);
    returns (matches forecast, leagues projected). A season with nothing left to play
    keeps none."""
    with conn.transaction():
        observed = conn.execute(FITTED).fetchall()
        rows = conn.execute(SEASON, (season,)).fetchall()
        strengths = dict(conn.execute("SELECT DISTINCT ON (team_id) team_id, elo FROM agg.team_power ORDER BY team_id, season_id DESC").fetchall())
        now = conn.execute("SELECT now()").fetchone()[0]
    # A cup source's copy of a club plays at its club's strength before the identity pass merges it.
    from .sources import identity

    strengths = with_merges(strengths, {team: club for team, club, *_ in identity.pairs(conn)[0]})
    model = fit([row[:5] for row in observed])
    weights, cases, present = (0.0, 0.0), [], {}
    if model:
        # Each club's form before each match, then what the gap between two forms adds to the forecast.
        before, present = with_forms([row[5:7] + row[3:5] + row[7:9] for row in observed])
        cases = [(delta(row[0], row[1], row[2]), home[0] - away[0], home[1] - away[1], row[3], row[4])
                 for row, (home, away) in zip(observed, before) if home and away]
        weights = fit_form(cases, model)
    upcoming = [r for r in rows if r[5] == "not_started" and r[2] in strengths and r[3] in strengths
                and not (r[11] and r[10] is not None and r[10] < now - STALE_AFTER)]
    forecasts = []
    for r in upcoming if model else []:
        # The form counts for the matches about to be played; further ahead, the strengths alone.
        near = r[10] is not None and r[10] <= now + FORM_HORIZON
        shifts = [form_shift(weights, present.get(team)) if near else 0.0 for team in (r[2], r[3])]
        forecasts.append((r[0], forecast(model, strengths[r[2]] + shifts[0], strengths[r[3]] + shifts[1], r[4]), strengths[r[2]], strengths[r[3]], shifts))
    # A league's matches of a round still open wait for the round's close (rounds.py).
    from .rounds import open_league_matches

    held = open_league_matches(conn, season)
    with conn.transaction():
        phases = {r[0] for r in conn.execute(PHASES, (season, LEAGUE_PHASE_FROM, list(LEAGUE_PHASE_CUPS))).fetchall()}
        brackets = knockout_state(conn.execute(KNOCKOUT, (sorted(phases),)).fetchall()) if phases else {}
        cup_rows = conn.execute(CUP_MATCHES, (season,)).fetchall()
        nations_rows = conn.execute(NATIONS_MATCHES, (season,)).fetchall()
    leagues = {}
    for edition, (table, games) in sorted(league_state(rows, held, phases).items()) if model else []:
        if edition in phases:
            # A cup over, or with a club the Elo does not rate (its ties would be replayed at a
            # strength of 0), has no projection.
            if cup_over(brackets.get(edition, {})) or any(team not in strengths for team in table):
                continue
            leagues[edition] = (table, simulate_cup(table, games, model, strengths, brackets.get(edition, {}), seed=edition))
        elif all(team in strengths for game in games for team in game):
            # A league one of whose clubs still to play has no strength has no projection either: its
            # matches cannot be replayed, and a season short of them is no projection.
            leagues[edition] = (table, simulate(table, games, model, strengths, seed=edition))
    # The domestic knockout cups whose next round is drawn (VI-19, 124): their rounds, from the one in play.
    for edition, odds in (knockout_projections(cup_rows, model, strengths, now.date()) if model else {}).items():
        leagues[edition] = ({}, {team: {"positions": [], "points": 0.0, "stages": shares} for team, shares in odds.items()})
    # The Nations League (VI-19, 125): each group's places, then League A's knockout.
    for edition, projection in (nations_projections(nations_rows, model, strengths, now.date()) if model else {}).items():
        leagues[edition] = projection
    with conn.transaction():
        conn.execute("DELETE FROM agg.match_forecasts WHERE season_id = %s", (season,))
        conn.execute("DELETE FROM agg.season_projections WHERE season_id = %s", (season,))
        if not model:
            return 0, 0
        run = conn.execute(
            """INSERT INTO agg.forecast_models(version, matches, home_base, home_slope, away_base, away_slope, rho, strength_spread, simulations,
                 form_xg, form_luck, form_matches)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (MODEL_VERSION, model["matches"], *model["home"], *model["away"], model["rho"], STRENGTH_SPREAD, SIMULATIONS, weights[0], weights[1], len(cases)),
        ).fetchone()[0]
        with conn.cursor().copy(
            """COPY agg.match_forecasts(match_id, season_id, home_win, draw, away_win, home_goals, away_goals, likely_home, likely_away,
                 home_elo, away_elo, home_form, away_form, model_id) FROM STDIN"""
        ) as copy:
            for match, f, eh, ea, shifts in forecasts:
                copy.write_row((match, season, f["home"], f["draw"], f["away"], f["home_goals"], f["away_goals"], *f["score"], eh, ea, shifts[0], shifts[1], run))
        for edition, (table, projection) in leagues.items():
            for team, p in projection.items():
                points, _, _, played = table.get(team, (0, 0, 0, 0))
                conn.execute(
                    """INSERT INTO agg.season_projections(competition_season_id, team_id, season_id, played, points, projected_points, model_id)
                       VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                    (edition, team, season, played, points, p["points"], run),
                )
                with conn.cursor().copy("COPY agg.season_projection_places(competition_season_id, team_id, place, probability) FROM STDIN") as copy:
                    for place, share in enumerate(p["positions"], 1):
                        if share > 0:
                            copy.write_row((edition, team, place, share))
                # A cup of the league-phase format: each stage's share too.
                if p.get("stages"):
                    with conn.cursor().copy("COPY agg.cup_stage_odds(competition_season_id, team_id, stage, probability) FROM STDIN") as copy:
                        for stage, share in p["stages"].items():
                            if share > 0:
                                copy.write_row((edition, team, stage, min(1.0, share)))
        # The models no forecast names any more go with what they forecast.
        conn.execute(
            """DELETE FROM agg.forecast_models f WHERE NOT EXISTS (SELECT 1 FROM agg.match_forecasts m WHERE m.model_id = f.id)
                 AND NOT EXISTS (SELECT 1 FROM agg.season_projections s WHERE s.model_id = f.id)"""
        )
    return len(forecasts), len(leagues)
