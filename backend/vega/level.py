"""Score Vega v9, a player's level: docs/calculs/10-score-vega-v9/01-proposition.md.

The v8 ranking (power.py) says how far a player's season stands from what is expected of
his role; the level says how many Elo points his club gains with him rather than with the
ordinary player of his position. It is computed beside the v8 ranking, from the same
player-matches and in the same run (power.refresh_players; FAILURE_MODES §49), and changes
nothing in it.

  position   eight outfield positions and the goalkeeper: a v8 winger's slot is an attacking
             midfielder, a wide midfielder or a winger (judge);
  match      the five blocks of the v8 against the position's reference group (the attack is
             one group), the defence read in its context on a variance-stabilised scale
             (expectations, deviation);
  talent     per block and position, the rate over two seasons (the season before for half)
             drawn towards the position's mean by the minutes: ẑ = μ + C (C + D)⁻¹ (y − μ)
             over the positions the player has acquired (shrunk); the defence talent is kept
             within ± DEFENCE_BOUND;
  level      V_r = Σ_b price(r, b) · ẑ(b, r), centred on the position, weighted by the
             minutes at each position, plus E_STARTS · (start share − the position's mean)
             and PSI · the club's Elo above the mean, in units of 400 (levels);
  score      100 / (1 + 10^(−(level − median) / SCALE)).

The user's choices (23 and 24 November 2026): the club weighs PSI = 10; retention stays a
block; no support-striker position (one price list for the attack); the defence talent is
bounded at 2.0. λ and σ, ρ and δ, and the attack's price list are measured on a finished
year (measure) and kept with its run.

v9.1 (the user's choice of 24 November 2026 after a measure on the production base,
FAILURE_MODES §54): the keeper's λ is a setting, the same for every year (KEEPER_LAMBDA); a
keeper without goals prevented on half his minutes in goal is flagged, not measured
(KEEPER_MEASURED_SHARE); the men's full-backs are centred above their mean (POSITION_OFFSETS).
"""

from collections import defaultdict
from math import exp, log, sqrt

from . import power

LEVEL_VERSION = "score-vega-v9.1"  # a run of another version is not read, and its year is computed again (stale)
CENTRE_FORWARD, ATTACKING_MIDFIELDER, WINGER, WIDE_MIDFIELDER = "centre_forward", "attacking_midfielder", "winger", "wide_midfielder"
CENTRAL_MIDFIELDER, DEFENSIVE_MIDFIELDER, FULL_BACK, CENTRE_BACK = "central_midfielder", "defensive_midfielder", "full_back", "centre_back"
GOALKEEPER = "goalkeeper"
ATTACK = (CENTRE_FORWARD, ATTACKING_MIDFIELDER, WINGER, WIDE_MIDFIELDER)
OUTFIELD = ATTACK + (CENTRAL_MIDFIELDER, DEFENSIVE_MIDFIELDER, FULL_BACK, CENTRE_BACK)
POSITIONS = OUTFIELD + (GOALKEEPER,)
ATTACK_GROUP = "attack"  # the reference group of the four attacking positions
PRICED = (CENTRE_FORWARD, ATTACKING_MIDFIELDER, WINGER)  # the positions the attack's price list is fitted on
# The v8 role whose block weights a position announces.
ROLE = {CENTRE_FORWARD: "centre_forward", ATTACKING_MIDFIELDER: "winger", WINGER: "winger", WIDE_MIDFIELDER: "winger",
        CENTRAL_MIDFIELDER: "central_midfielder", DEFENSIVE_MIDFIELDER: "defensive_midfielder", FULL_BACK: "full_back", CENTRE_BACK: "centre_back"}
# Two positions a player moves between without changing trade: their talents are more alike.
ADJACENT = frozenset(frozenset(pair) for pair in (
    (CENTRE_FORWARD, ATTACKING_MIDFIELDER), (CENTRE_FORWARD, WINGER), (ATTACKING_MIDFIELDER, WINGER), (ATTACKING_MIDFIELDER, CENTRAL_MIDFIELDER),
    (WINGER, WIDE_MIDFIELDER), (WIDE_MIDFIELDER, CENTRAL_MIDFIELDER), (WIDE_MIDFIELDER, FULL_BACK), (WIDE_MIDFIELDER, ATTACKING_MIDFIELDER),
    (CENTRAL_MIDFIELDER, DEFENSIVE_MIDFIELDER), (DEFENSIVE_MIDFIELDER, CENTRE_BACK), (CENTRE_BACK, FULL_BACK), (FULL_BACK, WINGER)))
BLOCKS = ("finishing", "creation", "progression", "defence", "retention")
NB = len(BLOCKS)
DEFENCE = BLOCKS.index("defence")

# Settings, stored with every run (agg.level_runs.settings).
E = 9.1  # Elo points for one standard deviation of a position's composition (study: 13.8 ± 1.7 per composition sd)
E_STARTS = 13.4  # Elo points between starting never and always
GOAL = 163.0  # Elo points for one goal prevented per 90 minutes
# Minutes for which a keeper's goals prevented count for half: the measure of 2025/26 (σ 0.062 goal per 90),
# read for every year. Measured on each year it was unstable (5 395 minutes for 2024/25, which put 36 keepers
# in the first 100 players): one keeper per team, and a count that varies much between matches. A convention,
# the highest of the measures (8 179 on two years together, 10 639 per keeper) and the user's choice (§54).
KEEPER_LAMBDA = 13291.0
# A keeper is measured when goals prevented are known for this share of his minutes in goal of the year.
# Without them his value is 0: the base has them for 1 to 6 % of the keepers' minutes before 2024/25 (§54).
KEEPER_MEASURED_SHARE = 0.5
# Elo points added to a position's centred value, per universe. Men judged at two positions are valued
# 1.05 ± 0.11 higher against the full-backs than against the players of their other positions, every season
# from 2021/22: the full-backs' mean is that much too low a centre. Not measured among the women (§54).
POSITION_OFFSETS = {"men": {FULL_BACK: -1.05}}
PSI = 10.0  # Elo points for 400 points of club Elo (user's choice of 24 Nov 2026; transfers measure 8.6 ± 0.4)
PREVIOUS_WEIGHT = 0.5  # the season before, against the season
ACQUIRED_MINUTES = 450  # over the two seasons, for a position other than the main one to be judged
DEFENCE_BOUND = 2.0  # standard deviations (user's choice of 23 Nov 2026, § 12.3)
SCALE = 36.0  # Elo points of level for ten to one on the score's curve
COMPETITION_EVENTS = 50.0  # events for which a competition's own effect counts half
FULL_MATCH = 60  # minutes of a match that measures the noise and the spread
MIN_FULL_MATCHES = 8  # of a player, for him to count in that measure
MIN_PLAYERS = 30  # for a position and a block to have a measure of their own
MAX_LAMBDA = 60000.0
DEFAULT_LAMBDA, DEFAULT_SD = 3000.0, 1.0  # a position and block without a measure
BORROW_LAMBDA, BORROW_SD = 30000.0, 0.5  # the wide midfielder takes the winger's measure above this noise or under this share of its spread
MIN_PAIRS, MIN_PAIRS_OWN = 20, 40  # players of two positions for a correlation; for the adjacent and the others to have their own
DEFAULT_RHO, MAX_RHO = 0.5, 0.98

# A player's sums at a position and a club (agg.player_level_cells): the minutes judged, each
# block's minutes and sum of match values, and for a keeper the minutes with goals prevented
# known and their sum.
MINUTES, BLOCK_MINUTES, BLOCK_SUMS, KEEPER_MINUTES, KEEPER_GOALS = 0, 1, 1 + NB, 1 + 2 * NB, 2 + 2 * NB
CELL = 3 + 2 * NB


def empty_cell():
    return [0.0] * CELL


def announced(position):
    """The share of each block in an outfield position's level, as the method announces it."""
    return [power.WEIGHTS[ROLE[position]][b] for b in BLOCKS]


def adjacent(a, b):
    return frozenset((a, b)) in ADJACENT


# Mathematics -----------------------------------------------------------------


def shrunk(obs, positions, rho, mu):
    """The talents of one block at a player's positions (§ 4.2). obs: {position: (rate in
    talent standard deviations, noise variance = λ / minutes)}; the prior has mean
    mu[position], variance 1 and correlation rho(a, b) between two positions. A position
    without a match learns from the others through rho."""
    seen = [r for r in positions if r in obs]
    if not seen:
        return {r: mu[r] for r in positions}
    a = [[(1.0 + obs[x][1]) if x == y else rho(x, y) for y in seen] for x in seen]
    weights = power._solve(a, [obs[r][0] - mu[r] for r in seen])
    return {r: mu[r] + sum((1.0 if r == x else rho(r, x)) * w for x, w in zip(seen, weights)) for r in positions}


def poisson(cells, nf, iterations=40):
    """counts ~ Poisson(exposure · exp(θ₀ + θ · f)) by maximum likelihood, on cells
    {features (nf numbers): [sum of counts, sum of exposures]}: (θ, standard errors), or
    None when nothing was counted."""
    items = [((1.0,) + tuple(f), c[0], c[1]) for f, c in cells.items() if c[1] > 0]
    counted, exposed = sum(i[1] for i in items), sum(i[2] for i in items)
    if counted <= 0 or exposed <= 0:
        return None
    k = nf + 1
    theta = [log(counted / exposed)] + [0.0] * nf
    hessian = None
    for _ in range(iterations):
        gradient = [0.0] * k
        hessian = [[1e-9 if i == j else 0.0 for j in range(k)] for i in range(k)]
        for f, x, w in items:
            mean = w * exp(sum(a * b for a, b in zip(theta, f)))
            for i in range(k):
                gradient[i] += (x - mean) * f[i]
                mf = mean * f[i]
                for j in range(i, k):
                    hessian[i][j] += mf * f[j]
        for i in range(k):
            for j in range(i):
                hessian[i][j] = hessian[j][i]
        try:
            step = power._solve(hessian, gradient)
        except ZeroDivisionError:
            break
        step = [max(-2.0, min(2.0, x)) for x in step]
        theta = [a + b for a, b in zip(theta, step)]
        if max(abs(x) for x in step) < 1e-9:
            break
    try:
        inverse = power._inverse(hessian)
        errors = [sqrt(max(inverse[i][i], 0.0)) for i in range(k)]
    except ZeroDivisionError:
        errors = [float("nan")] * k
    return theta, errors


# c(e) = E[2 √(X + 3/8)] for X ~ Poisson(e): the centre of the variance-stabilised scale, tabulated.
_STEP, _TOP = 0.02, 60.0


def _centre_exact(e):
    if e <= 0:
        return 2 * sqrt(0.375)
    p, total, k = exp(-e), 0.0, 0
    last = int(e + 12 * sqrt(e) + 20)
    while k <= last:
        total += p * 2 * sqrt(k + 0.375)
        k += 1
        p *= e / k
    return total


_CENTRES = [_centre_exact(i * _STEP) for i in range(int(_TOP / _STEP) + 2)]


def stabilised_centre(e):
    if e >= _TOP:
        return 2 * sqrt(e + 0.375) - 0.25 / sqrt(e)
    x = e / _STEP
    i = int(x)
    return _CENTRES[i] + (x - i) * (_CENTRES[i + 1] - _CENTRES[i])


def deviation(x, expected, minutes, direction, s, s_stabilised):
    """One indicator's deviation in a match: (x − x̂) / s, or, with a stabilised spread, on
    the scale where a count's noise no longer grows with the count: a single great match
    weighs less than the same total spread over several (§ 12.3)."""
    if s_stabilised is None:
        return direction * (x - expected) / s
    return direction * sqrt(minutes / 90) * (2 * sqrt(max(x, 0.0) + 0.375) - stabilised_centre(expected)) / s_stabilised


def noise_and_spread(groups):
    """(λ, σ) from each player's per-90 values in his full matches, by a one-way analysis of
    variance: λ the minutes for which the noise of a mean equals the spread between
    players' talents, σ that spread per 90 minutes. None below MIN_PLAYERS players of
    MIN_FULL_MATCHES matches."""
    g = [v for v in groups if len(v) >= MIN_FULL_MATCHES]
    if len(g) < MIN_PLAYERS:
        return None
    n = sum(len(v) for v in g)
    means = [sum(v) / len(v) for v in g]
    grand = sum(sum(v) for v in g) / n
    within = sum(sum((x - m) ** 2 for x in v) for v, m in zip(g, means)) / (n - len(g))
    size = (n - sum(len(v) ** 2 for v in g) / n) / (len(g) - 1)
    between = sum(len(v) * (m - grand) ** 2 for v, m in zip(g, means)) / (len(g) - 1)
    talent = max((between - within) / size, 1e-9)
    return min(90 * within / talent, MAX_LAMBDA), sqrt(talent)


def price_list(sigma, shares, matches):
    """One price per block for the attack (§ 11.4): the Elo points of one unit of a block's
    value, the same at every attacking position. sigma: {position: [σ per block]}, shares:
    {position: [announced share per block]}, matches: {position: weight}. The shares the
    list achieves, price_b · σ_rb / Σ, come closest in logs to the announced ones, and a
    standard deviation of every block is worth E on average over the positions."""
    positions = [r for r in sigma if matches.get(r, 0) > 0]

    def loss(u):
        prices = [exp(x) for x in u]
        total = 0.0
        for r in positions:
            worth = [prices[b] * sigma[r][b] for b in range(NB)]
            whole = sum(worth)
            total += matches[r] * sum((log(worth[b] / whole) - log(shares[r][b])) ** 2 for b in range(NB))
        return total

    u, step = [0.0] * NB, 1.0
    best = loss(u)
    while step > 1e-6:
        moved = False
        for b in range(NB - 1):  # the last block's price is the unit
            for sign in (1, -1):
                v = u[:]
                v[b] += sign * step
                tried = loss(v)
                if tried < best - 1e-13:
                    u, best, moved = v, tried, True
        if not moved:
            step /= 2
    prices = [exp(x) for x in u]
    scale = E * sum(matches[r] for r in positions) / sum(matches[r] * sum(prices[b] * sigma[r][b] for b in range(NB)) for r in positions)
    return [scale * p for p in prices]


# Positions -------------------------------------------------------------------


def _winger_slot(pos):
    """The position of a v8 winger's slot: a slot is a row (its tens) and a place across."""
    if pos // 10 in (8, 9) and pos % 10 in (4, 5, 6):
        return ATTACKING_MIDFIELDER
    if pos // 10 in (6, 7) and pos % 10 in (1, 2, 8, 9):
        return WIDE_MIDFIELDER
    return WINGER


def centre_back_slot(pos):
    return bool(pos) and pos > 3 and pos // 10 == 3 and pos % 10 not in (1, 2, 8, 9)


def judge(rows, main, faced):
    """The player-matches the level judges, each given its `position`, its reference `group`
    and whether it had a `slot` in the line-up. rows carry the v8 role (power.assign_roles);
    main: {player: his main v8 role}; faced: {(match, player)} the keeper of a shot.
    Left out: an outfield player's match in goal, and the match of an outfield player who
    kept goal for a shot; a substitute the v8 files in goal for want of a line is read at
    his main role."""
    played = {}
    for r in rows:
        pos = r["position_id"]
        if r["role"] == "winger" and pos and pos > 3:
            by = played.setdefault(r["player_id"], {})
            slot = _winger_slot(pos)
            by[slot] = by.get(slot, 0.0) + r["minutes_played"]
    kept = []
    for r in rows:
        player, role, pos = r["player_id"], r["role"], r["position_id"]
        slot = bool(pos and pos > 3)
        if role == GOALKEEPER and main.get(player) not in (None, GOALKEEPER):
            if pos == 11 or r.get("goals_prevented") is not None:
                continue
            role, slot = main[player], False
        if role == "winger":
            by = played.get(player)
            role = _winger_slot(pos) if slot else max((WINGER, ATTACKING_MIDFIELDER, WIDE_MIDFIELDER), key=lambda x: by.get(x, 0.0)) if by else WINGER
        if role not in POSITIONS:
            continue
        if role != GOALKEEPER and (r["match_id"], player) in faced:
            continue
        r["position"], r["group"], r["slot"] = role, ATTACK_GROUP if role in ATTACK else role, slot
        kept.append(r)
    return kept


# Levels ----------------------------------------------------------------------


def _mixed(now, before, players=None):
    """{player: {position: [minutes of the season, minutes of the two seasons, the two
    seasons' sums with the season before at PREVIOUS_WEIGHT]}}, clubs added, for the players
    of the season."""
    out = {}
    for (player, position, _), c in now.items():
        if players is not None and player not in players:
            continue
        e = out.setdefault(player, {}).setdefault(position, [0.0, 0.0, empty_cell()])
        e[0] += c[MINUTES]
        e[1] += c[MINUTES]
        for i in range(CELL):
            e[2][i] += c[i]
    for (player, position, _), c in before.items():
        if player not in out:
            continue
        e = out[player].setdefault(position, [0.0, 0.0, empty_cell()])
        e[1] += c[MINUTES]
        for i in range(CELL):
            e[2][i] += PREVIOUS_WEIGHT * c[i]
    return out


def _acquired(mine):
    """A player's main position (most weighted minutes) and the positions he is judged at:
    the main one, then those of ACQUIRED_MINUTES over the two seasons. A keeper is a keeper."""
    base = max(sorted(mine), key=lambda r: mine[r][2][MINUTES])
    if base == GOALKEEPER:
        return base, [base]
    return base, [base] + [r for r in sorted(mine, key=lambda r: (-mine[r][2][MINUTES], r))
                           if r != base and r != GOALKEEPER and mine[r][1] >= ACQUIRED_MINUTES]


def _rate(cell, position, b, refs):
    """A block's rate at a position in talent standard deviations, and its noise λ / minutes."""
    minutes = cell[BLOCK_MINUTES + b]
    if minutes <= 0:
        return None
    return (90 * cell[BLOCK_SUMS + b] / minutes / refs["sd"].get((position, b), DEFAULT_SD),
            refs["lam"].get((position, b), DEFAULT_LAMBDA) / minutes)


def _talents(mine, base, acquired, refs):
    """{block index: {position: talent}} of an outfield player, the defence bounded."""
    out = []
    for b in range(NB):
        obs = {}
        for r in acquired:
            rate = _rate(mine[r][2], r, b, refs)
            if rate:
                obs[r] = rate
        mu = {r: 0.0 if r == base else refs["delta"].get((adjacent(base, r), b), 0.0) for r in acquired}
        z = shrunk(obs, acquired, lambda x, y, b=b: refs["rho"].get((adjacent(x, y), b), DEFAULT_RHO), mu)
        if b == DEFENCE:
            z = {r: max(-DEFENCE_BOUND, min(DEFENCE_BOUND, v)) for r, v in z.items()}
        out.append(z)
    return out


def _value(mine, refs):
    """(main position, {position: [value, share, minutes, minutes of two seasons, talents]},
    {position not judged: minutes of two seasons})."""
    base, acquired = _acquired(mine)
    left = {r: x[1] for r, x in mine.items() if r not in acquired}
    if base == GOALKEEPER:
        c = mine[base][2]
        value = GOAL * 90 * c[KEEPER_GOALS] / (c[KEEPER_MINUTES] + KEEPER_LAMBDA)
        return base, {base: [value, 1.0, mine[base][0], mine[base][1], [None] * NB]}, left
    z = _talents(mine, base, acquired, refs)
    i = 0 if sum(mine[r][0] for r in acquired) > 0 else 1  # no minute of the season at a judged position: the two seasons'
    total = sum(mine[r][i] for r in acquired)
    return base, {r: [sum(refs["prices"][r][b] * z[b][r] for b in range(NB)), mine[r][i] / total, mine[r][0], mine[r][1], [z[b][r] for b in range(NB)]]
                  for r in acquired}, left


def keeper_measured(minutes, covered):
    """Whether a keeper's year is judged on his goals prevented: they are known for
    KEEPER_MEASURED_SHARE of his minutes in goal at least, and for some."""
    return covered > 0 and covered >= KEEPER_MEASURED_SHARE * minutes


def levels(now, before, refs, people):
    """The level of every player of `people` who has a cell this season.

    now, before: {(player, position, team): cell} of the season and of the season before;
    refs: the measured references (measure); people: {player: {"share": his start share,
    "club": his club's Elo above the mean in units of 400, "universe", "reference",
    "eligible"}}. Each universe is centred and ranked apart: the positions' means, the mean
    start share of a main position and the median level are those of its reference players
    (else of its eligible players, else of all), whom the others are placed against. A
    position's centre is that mean less the universe's offset for it (POSITION_OFFSETS).
    `measured`: false for a keeper without goals prevented on enough of the season's minutes
    in goal (keeper_measured); his numbers are computed like the others'."""
    mixed = _mixed(now, before, people)
    teams = defaultdict(lambda: defaultdict(float))
    in_goal = defaultdict(lambda: [0.0, 0.0])  # the season's minutes in goal, and those with goals prevented
    for (player, position, team), c in now.items():
        if player in mixed:
            teams[player][team] += c[MINUTES]
            if position == GOALKEEPER:
                in_goal[player][0] += c[MINUTES]
                in_goal[player][1] += c[KEEPER_MINUTES]
    valued = {p: _value(mine, refs) for p, mine in mixed.items()}
    out = {}
    for universe in sorted({people[p].get("universe", "men") for p in valued}):
        members = [p for p in valued if people[p].get("universe", "men") == universe]
        reference = ([p for p in members if people[p].get("reference")] or [p for p in members if people[p].get("eligible")] or members)

        def centres(group):
            value, share = defaultdict(lambda: [0.0, 0.0]), defaultdict(lambda: [0.0, 0])
            for p in group:
                base, positions, _ = valued[p]
                for r, x in positions.items():
                    value[r][0] += x[1] * x[0]
                    value[r][1] += x[1]
                share[base][0] += people[p].get("share", 0.0)
                share[base][1] += 1
            return {r: a / b for r, (a, b) in value.items() if b > 0}, {r: a / n for r, (a, n) in share.items()}

        mean, start = centres(reference)
        if any(r not in mean for p in members for r in valued[p][1]) or any(valued[p][0] not in start for p in members):
            # A position no reference player holds: its players are centred among all.
            wide_mean, wide_start = centres(members)
            mean, start = {**wide_mean, **mean}, {**wide_start, **start}
        offsets = POSITION_OFFSETS.get(universe, {})
        mean = {r: m - offsets.get(r, 0.0) for r, m in mean.items()}
        for p in members:
            base, positions, left = valued[p]
            person = people[p]
            blocks = sum(x[1] * (x[0] - mean[r]) for r, x in positions.items())
            starts = E_STARTS * (person.get("share", 0.0) - start[base])
            club = PSI * person.get("club", 0.0)
            by_team = teams[p]
            out[p] = {"position": base, "universe": universe, "team": max(sorted(by_team, key=str), key=lambda t: by_team[t]) if by_team else None,
                      "minutes": sum(x[2] for x in positions.values()) + sum(mixed[p][r][0] for r in left),
                      "positions": {r: {"value": x[0], "share": x[1], "minutes": x[2], "minutes_two_seasons": x[3], "talents": x[4],
                                        "level": x[0] - mean[r] + starts + club} for r, x in positions.items()},
                      "unjudged": left, "unjudged_minutes": {r: mixed[p][r][0] for r in left}, "blocks": blocks, "starts": starts, "own": blocks + starts, "club": club, "level": blocks + starts + club,
                      "measured": base != GOALKEEPER or keeper_measured(*in_goal[p])}
        ordered = sorted(out[p]["level"] for p in reference)
        median = ordered[len(ordered) // 2]
        seen = defaultdict(int)
        for rank, p in enumerate(sorted(members, key=lambda p: (-out[p]["level"], p)), 1):
            r = out[p]
            r["score"] = 100 / (1 + 10 ** (-(r["level"] - median) / SCALE))
            r["rank"] = rank
            seen[r["position"]] += 1
            r["position_rank"] = seen[r["position"]]
    return out


# A season's player-matches ------------------------------------------------------


def main_roles(rows):
    """Each player's main v8 role: the one he played most minutes at."""
    minutes = defaultdict(lambda: defaultdict(float))
    for r in rows:
        minutes[r["player_id"]][r["role"]] += r["minutes_played"]
    return {p: max(sorted(by), key=lambda x: by[x]) for p, by in minutes.items()}


def situations(rows, judged, team_passes=None):
    """Give each judged outfield row its `situation`, what the defence block's expectations
    are read against: the Elo gap, the log of the opponent's passes over their mean and
    whether the team plays a back three (for a centre-back also whether he is its axial
    one), in steps of 0.05. The opponent's passes are its players' when eight of them or
    more have a count, else the team statistics' (team_passes: {(match, team): passes});
    under 50 passes the term is nil. `rows`: every row of the year, for the teams' sums."""
    passes, counted, sides, backs = defaultdict(float), defaultdict(int), defaultdict(set), defaultdict(int)
    for r in rows:
        key = (r["match_id"], r["team_id"])
        sides[r["match_id"]].add(r["team_id"])
        if r.get("accurate_passes_total") is not None:
            passes[key] += r["accurate_passes_total"]
            counted[key] += 1
        if centre_back_slot(r["position_id"]):
            backs[key] += 1
    opponent = {}
    for match, teams in sides.items():
        if len(teams) == 2:
            a, b = teams
            opponent[(match, a)], opponent[(match, b)] = b, a
    known = [v for k, v in passes.items() if v >= 50 and counted[k] >= 8]
    mean = sum(known) / len(known) if known else 400.0
    shared = {}
    for r in judged:
        if r["position"] == GOALKEEPER:
            continue
        key = (r["match_id"], r["team_id"])
        other = opponent.get(key)
        seen = 0.0
        if other is not None:
            theirs = (r["match_id"], other)
            if counted.get(theirs, 0) >= 8:
                seen = passes.get(theirs, 0.0)
            if seen < 50:
                listed = team_passes.get(theirs) if team_passes else None
                if listed and listed >= 50:
                    seen = listed
        ratio = log(seen / mean) if seen >= 50 else 0.0
        three, pos = backs.get(key, 0), r["position_id"]
        situation = (round(max(-3.0, min(3.0, r["delta"])) * 20) / 20, round(max(-1.5, min(1.5, ratio)) * 20) / 20, 1 if three >= 3 else 0)
        if r["group"] == CENTRE_BACK:
            situation += (1 if three == 3 and centre_back_slot(pos) and pos % 10 == 5 else 0,)
        r["situation"] = shared.setdefault(situation, situation)


def _volume(obs, nf):
    """A volume indicator's expectation in its situation: obs [(x, minutes / 90, situation,
    competition-season)] -> (expect(row), s, stabilised s), or None. Two rounds: the
    regression on the situations, then each competition-season's own effect, drawn towards
    1 while it has counted few events."""
    if len(obs) < power.MIN_REFERENCE:
        return None
    own, rate = {}, {}
    for _ in range(2):
        cells = {}
        for x, w, f, cs in obs:
            c = cells.get(f)
            if c is None:
                c = cells[f] = [0.0, 0.0]
            c[0] += x
            c[1] += w * own.get(cs, 1.0)
        fit = poisson(cells, nf)
        if fit is None:
            return None
        theta = fit[0]
        rate = {f: exp(theta[0] + sum(a * b for a, b in zip(theta[1:], f))) for f in cells}
        seen = {}
        for x, w, f, cs in obs:
            o = seen.get(cs)
            if o is None:
                o = seen[cs] = [0.0, 0.0]
            o[0] += x
            o[1] += w * rate[f]
        own = {cs: (o + COMPETITION_EVENTS) / (e + COMPETITION_EVENTS) for cs, (o, e) in seen.items()}
    linear = stabilised = 0.0
    for x, w, f, cs in obs:
        e = w * rate[f] * own[cs]
        linear += (x - e) ** 2
        stabilised += w * (2 * sqrt(max(x, 0.0) + 0.375) - stabilised_centre(e)) ** 2
    s, s_stabilised = sqrt(linear / len(obs)), sqrt(stabilised / len(obs))
    if s <= 1e-9 or s_stabilised <= 1e-9:
        return None
    return (lambda r, rate=rate, own=own: r["minutes_played"] / 90 * rate[r["situation"]] * own[r.get("competition_season_id")]), s, s_stabilised


def _gap(situation):
    """The Elo gap in nine classes of 100 points."""
    return max(-4, min(4, round(situation[0] / 0.25)))


def _conditional(obs, attempts):
    """A success rate's expectation: obs [(made, tried, gap class, competition-season)] ->
    (expect(row), s, None), or None. The rate with the opponent's effect, then the
    competition-season's, both drawn towards 1; never more than the attempts."""
    made, tried = sum(o[0] for o in obs), sum(o[1] for o in obs)
    if len(obs) < power.MIN_REFERENCE or tried <= 0 or made <= 0:
        return None
    p = made / tried
    seen = defaultdict(lambda: [0.0, 0.0])
    for m, t, g, _ in obs:
        o = seen[g]
        o[0] += m
        o[1] += t * p
    gap = {g: (o + COMPETITION_EVENTS) / (e + COMPETITION_EVENTS) for g, (o, e) in seen.items()}
    seen = defaultdict(lambda: [0.0, 0.0])
    for m, t, g, cs in obs:
        o = seen[cs]
        o[0] += m
        o[1] += t * p * gap[g]
    own = {cs: (o + COMPETITION_EVENTS) / (e + COMPETITION_EVENTS) for cs, (o, e) in seen.items()}
    s = sqrt(sum((m - min(t, t * p * gap[g] * own[cs])) ** 2 for m, t, g, cs in obs) / len(obs))
    if s <= 1e-9:
        return None
    return (lambda r, p=p, gap=gap, own=own: min(r[attempts], r[attempts] * p * gap[_gap(r["situation"])] * own[r.get("competition_season_id")])), s, None


_DEFENCE = power.OUTFIELD_BLOCKS["defence"]


def expectations(judged):
    """The defence indicators' expectations in context, per reference group:
    {(group, indicator's place in the block): (expect(row), s, stabilised s or None)}."""
    groups = defaultdict(list)
    for r in judged:
        if r["position"] != GOALKEEPER:
            groups[r["group"]].append(r)
    out = {}
    for group, items in groups.items():
        nf = 4 if group == CENTRE_BACK else 3
        for i, spec in enumerate(_DEFENCE):
            name = spec[0]
            if spec[1] == "volume":
                fit = _volume([(r[name], r["minutes_played"] / 90, r["situation"], r.get("competition_season_id")) for r in items if r[name] is not None], nf)
            else:
                attempts = spec[3]
                fit = _conditional([(r[name], r[attempts], _gap(r["situation"]), r.get("competition_season_id"))
                                    for r in items if r[name] is not None and r[attempts] is not None], attempts)
            if fit:
                out[(group, i)] = fit
    return out


def match_blocks(r, refs, fits):
    """The five block values of an outfield player-match against its reference group (None:
    not measured in this match). The defence reads each indicator in its context where one
    was fitted (expectations), else as the v8 does; the other blocks are the v8's."""
    group, out = r["group"], []
    for block in BLOCKS:
        total, n = 0.0, 0
        for i, spec in enumerate(power.OUTFIELD_BLOCKS[block]):
            ref, x = refs.get((group, spec[0])), r[spec[0]]
            if ref is None or x is None or (spec[1] == "conditional" and r[spec[3]] is None):
                continue
            fit = fits.get((group, i)) if block == "defence" else None
            if fit is None:
                total += spec[2] * (x - ref[0](r)) / ref[1]
            else:
                total += deviation(x, fit[0](r), r["minutes_played"], spec[2], fit[1], fit[2])
            n += 1
        out.append(total / n if n else None)
    return out


def start_shares(rows):
    """{player: the share of his club's matches he started}: over the club matches whose
    line-up lists eleven starters, for a club with five such matches or more; the highest
    of his clubs."""
    lineups = defaultdict(list)
    for r in rows:
        if r.get("is_starter") and not r.get("national"):
            lineups[(r["match_id"], r["team_id"])].append(r["player_id"])
    listed, started = defaultdict(int), defaultdict(lambda: defaultdict(int))
    for (_, team), players in lineups.items():
        if len(players) == 11:
            listed[team] += 1
            for p in players:
                started[team][p] += 1
    out = {}
    for team, by in started.items():
        if listed[team] >= 5:
            for p, n in by.items():
                out[p] = max(out.get(p, 0.0), n / listed[team])
    return out


def recentre(cells, means=None):
    """Take an attacking position's mean per 90 out of its cells' block sums: the four
    positions share one reference group, so each is put back on its own zero. `means`:
    {(position, block): mean per minute} to take out instead of the cells' own (the award's
    cells take out the level's, FAILURE_MODES §60). -> the means taken out."""
    taken = {}
    for position in ATTACK:
        mine = [c for (_, at, _), c in cells.items() if at == position]
        for b in range(NB):
            if means is None:
                minutes = sum(c[BLOCK_MINUTES + b] for c in mine)
                if minutes <= 0:
                    continue
                per_minute = sum(c[BLOCK_SUMS + b] for c in mine) / minutes
            elif (position, b) in means:
                per_minute = means[(position, b)]
            else:
                continue
            taken[(position, b)] = per_minute
            for c in mine:
                c[BLOCK_SUMS + b] -= per_minute * c[BLOCK_MINUTES + b]
    return taken


def read(rows, *, centre, faced=frozenset(), team_passes=None, samples=True, stakes=None):
    """A season's player-matches as the level reads them. rows: the ranking's, with their v8
    role and their Elo gap `delta` (power.refresh_players); centre: the clubs' mean Elo
    (power.level_centres); faced: {(match, player)} the keeper of a shot; `samples`: also
    keep each player's per-90 values in his full matches, for measure().
    -> {"cells": {(player, position, club): cell} of the club matches, "club": {player: his
    clubs' Elo above the centre in units of 400, by minutes}, "shares": start_shares,
    "samples": {(position, block): {player: [values]}}}.
    The national teams' matches set the references with the others and enter no cell.
    With `stakes` ({match: I_m}, 1 without one) the reading also holds "award_cells", the
    Ballon d'Or race's (FAILURE_MODES §60): the same cells, each match's block values (a
    keeper's goals prevented) times its stakes, its minutes unweighted, and the national
    teams' matches under their national team; the attack is recentred on the level's means.
    "cells" and everything else are what they are without it."""
    judged = judge(rows, main_roles(rows), faced)
    situations(rows, judged, team_passes)
    outfield = [r for r in judged if r["position"] != GOALKEEPER]
    refs = power.group_references(outfield, "group")
    fits = expectations(outfield)
    cells, club = {}, defaultdict(lambda: [0.0, 0.0])
    values = defaultdict(lambda: defaultdict(list))
    for r in rows:
        if not r.get("national") and r["own_elo"] is not None:
            entry = club[r["player_id"]]
            entry[0] += r["minutes_played"] * (r["own_elo"] - centre) / 400
            entry[1] += r["minutes_played"]
    award = {} if stakes is not None else None
    for r in judged:
        national = bool(r.get("national"))
        if national and award is None:
            continue
        player, position, minutes = r["player_id"], r["position"], r["minutes_played"]
        key = (player, position, r["team_id"])
        weight = stakes.get(r["match_id"], 1.0) if award is not None else 1.0
        if position == GOALKEEPER:
            prevented = r.get("goals_prevented")
            for target, w in (((cells, 1.0),) if not national else ()) + (((award, weight),) if award is not None else ()):
                c = target.get(key)
                if c is None:
                    c = target[key] = empty_cell()
                c[MINUTES] += minutes
                if prevented is not None:
                    c[KEEPER_MINUTES] += minutes
                    c[KEEPER_GOALS] += prevented if w == 1.0 else w * prevented
            continue
        scores = match_blocks(r, refs, fits)
        if all(x is None for x in scores):
            continue
        if not national:
            c = cells.get(key)
            if c is None:
                c = cells[key] = empty_cell()
            c[MINUTES] += minutes
            for b, x in enumerate(scores):
                if x is not None:
                    c[BLOCK_MINUTES + b] += minutes
                    c[BLOCK_SUMS + b] += x
                    if samples and minutes >= FULL_MATCH:
                        values[(position, b)][player].append(x * 90 / minutes)
        if award is not None:
            c = award.get(key)
            if c is None:
                c = award[key] = empty_cell()
            c[MINUTES] += minutes
            for b, x in enumerate(scores):
                if x is not None:
                    c[BLOCK_MINUTES + b] += minutes
                    c[BLOCK_SUMS + b] += x if weight == 1.0 else weight * x
    means = recentre(cells)
    reading = {"cells": cells, "club": {p: total / minutes for p, (total, minutes) in club.items() if minutes > 0}, "shares": start_shares(rows),
               "samples": values}
    if award is not None:
        recentre(award, means)
        reading["award_cells"] = award
    return reading


# References measured on a finished year -------------------------------------------


def correlations(now, before, refs, people):
    """ρ and δ between two positions of one player, per block, for adjacent positions and
    for the others: among the reference players judged at two positions or more, the
    covariance of the rates at the main position and at another (in talent standard
    deviations, weighted by how well both are known) and the mean rate at the other. Below
    MIN_PAIRS_OWN pairs, the adjacent and the others share one measure; below MIN_PAIRS,
    DEFAULT_RHO and 0."""
    pairs = defaultdict(list)
    for player, mine in _mixed(now, before, people).items():
        if not people[player].get("reference"):
            continue
        base, acquired = _acquired(mine)
        if base == GOALKEEPER or len(acquired) < 2:
            continue
        for b in range(NB):
            first = _rate(mine[base][2], base, b, refs)
            if not first:
                continue
            for r in acquired[1:]:
                other = _rate(mine[r][2], r, b, refs)
                if other:
                    pairs[(adjacent(base, r), b)].append((1 / ((1 + first[1]) * (1 + other[1])), first[0], other[0]))
    measured = {}
    for b in range(NB):
        pairs[(None, b)] = pairs[(True, b)] + pairs[(False, b)]
    for key, items in pairs.items():
        if len(items) < MIN_PAIRS:
            continue
        weight = sum(i[0] for i in items)
        m0, m1 = (sum(i[0] * i[k] for i in items) / weight for k in (1, 2))
        covariance = sum(i[0] * (i[1] - m0) * (i[2] - m1) for i in items) / weight
        measured[key] = (max(0.0, min(MAX_RHO, covariance)), m1, len(items))
    rho, delta = {}, {}
    for b in range(NB):
        for near in (True, False):
            own = measured.get((near, b))
            if own is None or own[2] < MIN_PAIRS_OWN:
                own = measured.get((None, b), (DEFAULT_RHO, 0.0, 0))
            rho[(near, b)], delta[(near, b)] = own[0], own[1]
    return rho, delta


def measure(reading, before, people):
    """The references of a year, from its own player-matches (read, with samples): λ and σ
    per position and block, the prices, ρ and δ. `full_matches`: the full
    matches of each position, the weights of the attack's price list."""
    lam, sd = {}, {}
    for key, by_player in reading["samples"].items():
        fit = noise_and_spread(list(by_player.values()))
        if fit:
            lam[key], sd[key] = fit
    for b in range(NB):
        wide, winger = (WIDE_MIDFIELDER, b), (WINGER, b)
        if wide not in lam or lam[wide] >= BORROW_LAMBDA or sd[wide] < BORROW_SD * sd.get(winger, DEFAULT_SD):
            lam[wide], sd[wide] = lam.get(winger, DEFAULT_LAMBDA), sd.get(winger, DEFAULT_SD)
    for position in OUTFIELD:
        for b in range(NB):
            lam.setdefault((position, b), DEFAULT_LAMBDA)
            sd.setdefault((position, b), DEFAULT_SD)
    full = {position: max((sum(len(v) for v in reading["samples"].get((position, b), {}).values()) for b in range(NB)), default=0) for position in OUTFIELD}
    prices = {position: [E * w for w in announced(position)] for position in OUTFIELD}
    if any(full[position] for position in PRICED):
        sigma = {position: [sd[(position, b)] for b in range(NB)] for position in ATTACK}
        listed = price_list({position: sigma[position] for position in PRICED}, {position: announced(position) for position in PRICED}, full)
        for position in ATTACK:
            prices[position] = [listed[b] * sigma[position][b] for b in range(NB)]
    refs = {"lam": lam, "sd": sd, "prices": prices, "full_matches": full}
    refs["rho"], refs["delta"] = correlations(reading["cells"], before, refs, people)
    return refs


def pack(refs):
    """The references as they are kept (agg.level_runs.measured)."""
    return {"lam": {p: [refs["lam"][(p, b)] for b in range(NB)] for p in OUTFIELD}, "sd": {p: [refs["sd"][(p, b)] for b in range(NB)] for p in OUTFIELD},
            "prices": {p: list(refs["prices"][p]) for p in OUTFIELD},
            "rho": {name: [refs["rho"][(near, b)] for b in range(NB)] for name, near in (("adjacent", True), ("other", False))},
            "delta": {name: [refs["delta"][(near, b)] for b in range(NB)] for name, near in (("adjacent", True), ("other", False))},
            "full_matches": refs.get("full_matches", {}), "blocks": list(BLOCKS)}


def unpack(kept):
    """The kept references as levels() reads them; None when they are another method's."""
    if not kept or kept.get("blocks") != list(BLOCKS) or set(kept.get("lam", ())) != set(OUTFIELD):
        return None
    return {"lam": {(p, b): float(v) for p, values in kept["lam"].items() for b, v in enumerate(values)},
            "sd": {(p, b): float(v) for p, values in kept["sd"].items() for b, v in enumerate(values)},
            "prices": {p: [float(v) for v in values] for p, values in kept["prices"].items()},
            "rho": {(near, b): float(v) for name, near in (("adjacent", True), ("other", False)) for b, v in enumerate(kept["rho"][name])},
            "delta": {(near, b): float(v) for name, near in (("adjacent", True), ("other", False)) for b, v in enumerate(kept["delta"][name])},
            "full_matches": kept.get("full_matches", {})}


def people_of(reading, scored):
    """levels()'s players of a reading: those with a club cell, each with his start share,
    his club, his universe and the v8 ranking's minutes bar and measured league."""
    players = {p for p, _, _ in reading["cells"]}
    return {p: {"share": reading["shares"].get(p, 0.0), "club": reading["club"].get(p, 0.0), "universe": r["universe"],
                "reference": bool(r["eligible"] and r["linked"]), "eligible": bool(r["eligible"]), "linked": bool(r["linked"])}
            for p, r in scored.items() if p in players}


def season(reading, before, kept, scored):
    """A season's levels from its reading, the season before's cells, the references kept by
    a finished year (None: measure them on this one) and the v8 ranking's rows (their
    universe, and who is above the minutes bar in a measured league).
    -> ({player: level}, references)."""
    people = people_of(reading, scored)
    before = {key: c for key, c in before.items() if key[0] in people}
    refs = kept or measure(reading, before, people)
    out = levels(reading["cells"], before, refs, people)
    for p, r in out.items():
        r["eligible"], r["linked"] = people[p]["eligible"], people[p]["linked"]
        r["start_share"], r["club_level"] = people[p]["share"], people[p]["club"]
    return out, refs


# Database -------------------------------------------------------------------

SETTINGS = {"psi": PSI, "e": E, "e_starts": E_STARTS, "goal": GOAL, "keeper_lambda": KEEPER_LAMBDA, "keeper_measured_share": KEEPER_MEASURED_SHARE,
            "position_offsets": {universe: dict(offsets) for universe, offsets in POSITION_OFFSETS.items()},
            "defence_bound": DEFENCE_BOUND, "scale": SCALE, "previous_weight": PREVIOUS_WEIGHT,
            "acquired_minutes": ACQUIRED_MINUTES, "competition_events": COMPETITION_EVENTS, "full_match": FULL_MATCH, "min_full_matches": MIN_FULL_MATCHES,
            "min_players": MIN_PLAYERS, "default_lambda": DEFAULT_LAMBDA, "default_sd": DEFAULT_SD}
_CELL_COLUMNS = ("minutes", *(b + "_minutes" for b in BLOCKS), *(b + "_sum" for b in BLOCKS), "keeper_minutes", "goals_prevented")
assert len(_CELL_COLUMNS) == CELL


def read_inputs(conn, season_id, reference_season):
    """What the level reads beside the ranking's player-matches, inside the ranking's read:
    the keeper of each shot, the teams' passes, the season before's cells and, when another
    finished year is the reference, the references it kept."""
    seasons = [season_id, season_id + 1]
    faced = {(match, keeper) for match, keeper in conn.execute(
        "SELECT DISTINCT match_id, keeper_id FROM core.shots WHERE season_id = ANY(%s) AND keeper_id IS NOT NULL", (seasons,)).fetchall()}
    team_passes = {(match, team): float(passes) for match, team, passes in conn.execute(
        "SELECT match_id, team_id, passes FROM core.team_match_stats WHERE season_id = ANY(%s) AND period = 'all' AND passes IS NOT NULL", (seasons,)).fetchall()}
    before = {}
    for player, position, team, *cell in conn.execute(
            f"""SELECT c.player_id, c.position, c.team_id, {', '.join('c.' + name for name in _CELL_COLUMNS)} FROM agg.player_level_cells c
                JOIN agg.level_runs r ON r.id = c.run_id AND r.status = 'published' AND r.version = %s WHERE c.season_id = %s""",
            (LEVEL_VERSION, season_id - 1)).fetchall():
        before[(player, position, team)] = [float(v) for v in cell]
    kept = None
    if reference_season is not None and reference_season != season_id:
        row = conn.execute(
            """SELECT measured FROM agg.level_runs WHERE season_id = %s AND status = 'published' AND version = %s
                 AND reference_season = season_id AND players > 0""", (reference_season, LEVEL_VERSION)).fetchone()
        kept = unpack(row[0]) if row else None
    return {"faced": faced, "team_passes": team_passes, "before": before, "kept": kept}


def write(conn, season_id, started, out, cells, refs, reference_season):
    """Replace the season's levels, inside the ranking's write transaction. out: season()'s
    levels ({}: a year without a level); refs: the references used (None: none);
    reference_season: the finished year they were measured on, None for the year's own
    rows while it is in progress."""
    from psycopg.types.json import Jsonb

    run = conn.execute(
        """INSERT INTO agg.level_runs(season_id, version, started_at, players, reference_season, settings, measured)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
        (season_id, LEVEL_VERSION, started, len(out), reference_season if out else None, Jsonb(SETTINGS), Jsonb(pack(refs)) if out and refs else None),
    ).fetchone()[0]
    for table in ("agg.player_level_positions", "agg.player_level", "agg.player_level_cells"):
        conn.execute(f"DELETE FROM {table} WHERE season_id = %s", (season_id,))
    with conn.cursor().copy(f"COPY agg.player_level_cells(season_id, player_id, position, team_id, {', '.join(_CELL_COLUMNS)}, run_id) FROM STDIN") as copy:
        for (player, position, team), c in cells.items():
            copy.write_row((season_id, player, position, team, *c, run))
    with conn.cursor().copy(
        """COPY agg.player_level(season_id, player_id, position, team_id, universe, eligible, linked, minutes, level, own, blocks, starts, club,
             start_share, club_level, score, rank, position_rank, run_id, measured) FROM STDIN"""
    ) as copy:
        for player, r in out.items():
            copy.write_row((season_id, player, r["position"], r["team"], r["universe"], r["eligible"], r["linked"], r["minutes"], r["level"], r["own"],
                            r["blocks"], r["starts"], r["club"], r["start_share"], r["club_level"], r["score"], r["rank"], r["position_rank"], run,
                            r["measured"]))
    with conn.cursor().copy(
        f"""COPY agg.player_level_positions(season_id, player_id, position, acquired, minutes, minutes_two_seasons, share, value, level,
              {', '.join(BLOCKS)}, run_id) FROM STDIN"""
    ) as copy:
        for player, r in out.items():
            for position, x in r["positions"].items():
                copy.write_row((season_id, player, position, True, x["minutes"], x["minutes_two_seasons"], x["share"], x["value"], x["level"], *x["talents"], run))
            for position, both in r["unjudged"].items():
                copy.write_row((season_id, player, position, False, r["unjudged_minutes"][position], both, None, None, None, *[None] * NB, run))
    conn.execute("UPDATE agg.level_runs SET status = 'superseded' WHERE season_id = %s AND status = 'published'", (season_id,))
    conn.execute("UPDATE agg.level_runs SET status = 'published', finished_at = clock_timestamp() WHERE id = %s", (run,))
    return run


def stale(conn):
    """The award years whose published ranking has players and whose level is missing, of
    another version, computed with other settings than SETTINGS, or older than the level of
    the year before (it reads half of that year's sums, and its references while it is in
    progress), oldest first: a year's level is computed after the year before's."""
    from psycopg.types.json import Jsonb

    return [s for (s,) in conn.execute(
        """SELECT p.season_id FROM agg.power_runs p
           LEFT JOIN agg.level_runs own ON own.season_id = p.season_id AND own.status = 'published' AND own.version = %(version)s
           LEFT JOIN agg.level_runs prev ON prev.season_id = p.season_id - 1 AND prev.status = 'published' AND prev.players > 0
           WHERE p.kind = 'players' AND p.status = 'published' AND p.players > 0
             AND (own.id IS NULL OR own.started_at < prev.started_at OR own.settings IS DISTINCT FROM %(settings)s)
           ORDER BY 1""", {"version": LEVEL_VERSION, "settings": Jsonb(SETTINGS)}).fetchall()]
