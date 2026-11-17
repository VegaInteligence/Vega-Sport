"""Vega's own expected goals: the chance of a goal from where and how a shot is taken.

A logistic model on what the base knows of every shot: the distance to the goal's centre,
the angle the goal fills from there, the body part and the situation. It knows nothing of
the defenders or of the keeper's position, which the provider's model does: it is a
second reading and a fallback, not a replacement (docs/calculs/02-metriques-attendues).

The model is fitted on bins of shots (the same situation, body part, metre of distance
and twentieth of a radian of angle), which the base counts in one statement; every shot
is then scored in SQL with the fitted coefficients. A penalty is worth the share of the
base's penalties that were scored.

The fit is constrained (version 2, VI-23 B9, calculation audit of 16 November 2026, finding
16a; docs/calculs/09-audit-2026-11/FAILURE_MODES.md §10): the chance of a goal cannot grow
with the distance, at any angle and for any body part, nor fall when the goal fills a wider
angle (CONSTRAINTS). Version 1's free fit could, and its documented coefficients gave 0.97 %
at 50 metres and 19.4 % at 100. The constraints are a property of the model, not a measured
gain: nothing here says the constrained model predicts better, only that it cannot rise again
far from goal. Python and SQL read the same logit, bounded at ±30 before the sigmoid.
"""

from math import exp, inf, isfinite, log

MODEL_VERSION = "xg-v2"
MIN_FIT = 20000  # shots; below, no model is fitted
REFIT_GROWTH = 1.25  # the base holds this many times the shots of the last fit: fit again
PITCH_LENGTH, PITCH_WIDTH, GOAL_WIDTH = 105.0, 68.0, 7.32
SITUATIONS = ("from_corner", "set_piece", "fast_break", "free_kick", "throw_in_set_piece", "individual_play")
# The model's terms, in the order of agg.xg_models' columns.
TERMS = ("intercept", "angle", "distance", "distance_sq", "angle_distance", "header", "other_body",
         "from_corner", "set_piece", "fast_break", "free_kick", "throw_in", "individual_play", "header_distance")
# The bounds of the constrained terms (the others are free). The logit's slope in the distance at
# a fixed angle is distance + distance_sq·d/50 + angle_distance·angle/10 + header_distance/10 for a
# header: never positive. Its slope in the angle is angle + angle_distance·d/10: never negative.
# Both hold whatever the shot only with angle_distance at 0.
CONSTRAINTS = {
    "angle": (0.0, inf),
    "distance": (-inf, 0.0),
    "distance_sq": (-inf, 0.0),
    "angle_distance": (0.0, 0.0),
    "header_distance": (-inf, 0.0),
}

# A shot the model reads: taken on the pitch, with an outcome, not an own goal.
_SHOTS = """
FROM core.shots s
WHERE s.is_own_goal IS NOT TRUE AND s.outcome IS NOT NULL
  AND s.x BETWEEN 0 AND {length} AND s.y BETWEEN 0 AND {width}
""".format(length=PITCH_LENGTH, width=PITCH_WIDTH)
# Distance to the goal's centre and the angle the goal fills, from the shot's place.
_GEOMETRY = """
  sqrt(power({length} - s.x, 2) + power({half} - s.y, 2)) AS d,
  greatest(0, atan2({goal} * greatest({length} - s.x, 0.01),
                    power({length} - s.x, 2) + power({half} - s.y, 2) - {post})) AS th
""".format(length=PITCH_LENGTH, half=PITCH_WIDTH / 2, goal=GOAL_WIDTH, post=(GOAL_WIDTH / 2) ** 2)

BINS = f"""
SELECT z.situation, z.body, avg(z.d)::float8, avg(z.th)::float8, count(*)::integer, (count(*) FILTER (WHERE z.goal))::integer
FROM (SELECT coalesce(s.situation::text, 'regular_play') AS situation, coalesce(s.body_part::text, 'right_foot') AS body,
        s.outcome = 'goal' AS goal, {_GEOMETRY} {_SHOTS} AND s.situation IS DISTINCT FROM 'penalty') z
GROUP BY z.situation, z.body, round(z.d::numeric), round((z.th * 20)::numeric)
"""
PENALTIES = f"SELECT count(*)::integer, (count(*) FILTER (WHERE s.outcome = 'goal'))::integer {_SHOTS} AND s.situation = 'penalty'"

# Every shot of the chosen seasons, scored with the model's coefficients.
SCORE = f"""
INSERT INTO agg.shot_xg(season_id, match_id, shot_no, xg, model_id)
SELECT z.season_id, z.match_id, z.shot_no,
  -- The logit bounded at ±30 before the sigmoid, as probability() bounds it.
  CASE WHEN z.penalty THEN %(penalty)s::float8 ELSE 1 / (1 + exp(-greatest(-30::float8, least(30::float8,
      %(intercept)s::float8 + %(angle)s::float8 * z.th + %(distance)s::float8 * z.d + %(distance_sq)s::float8 * z.d * z.d / 100
    + %(angle_distance)s::float8 * z.th * z.d / 10
    + CASE z.body WHEN 'header' THEN %(header)s::float8 + %(header_distance)s::float8 * z.d / 10 WHEN 'other' THEN %(other_body)s::float8 ELSE 0 END
    + CASE z.situation WHEN 'from_corner' THEN %(from_corner)s::float8 WHEN 'set_piece' THEN %(set_piece)s::float8
        WHEN 'fast_break' THEN %(fast_break)s::float8 WHEN 'free_kick' THEN %(free_kick)s::float8
        WHEN 'throw_in_set_piece' THEN %(throw_in)s::float8 WHEN 'individual_play' THEN %(individual_play)s::float8 ELSE 0 END)))) END,
  %(model)s
FROM (SELECT s.season_id, s.match_id, s.shot_no, s.situation IS NOT DISTINCT FROM 'penalty' AS penalty,
        coalesce(s.situation::text, 'regular_play') AS situation, coalesce(s.body_part::text, 'right_foot') AS body, {_GEOMETRY}
      {_SHOTS} AND (%(season)s::smallint IS NULL OR s.season_id = %(season)s::smallint)) z
WHERE NOT z.penalty OR %(penalty)s::float8 IS NOT NULL
"""


def features(situation, body, distance, angle):
    """The model's terms for one shot, in the order of TERMS."""
    header = 1.0 if body == "header" else 0.0
    return [1.0, angle, distance, distance * distance / 100, angle * distance / 10, header, 1.0 if body == "other" else 0.0,
            *(1.0 if situation == name else 0.0 for name in SITUATIONS), header * distance / 10]


def _solve(matrix, vector):
    """Gauss-Jordan with partial pivoting, for the model's few terms."""
    size = len(vector)
    rows = [row[:] + [vector[i]] for i, row in enumerate(matrix)]
    for i in range(size):
        pivot = max(range(i, size), key=lambda r: abs(rows[r][i]))
        rows[i], rows[pivot] = rows[pivot], rows[i]
        for r in range(size):
            if r != i and rows[r][i]:
                factor = rows[r][i] / rows[i][i]
                for k in range(i, size + 1):
                    rows[r][k] -= factor * rows[i][k]
    return [rows[i][size] / rows[i][i] for i in range(size)]


def probability(coefficients, terms):
    z = sum(c * t for c, t in zip(coefficients, terms))
    return 1 / (1 + exp(-max(-30.0, min(30.0, z))))


def _likelihood(beta, rows, ridge):
    """Log-likelihood of the bins under the coefficients, less the ridge's penalty."""
    total = -0.5 * ridge * sum(b * b for b in beta)
    for terms, n, goals in rows:
        p = min(1 - 1e-12, max(1e-12, probability(beta, terms)))
        total += goals * log(p) + (n - goals) * log(1 - p)
    return total


def _derivatives(beta, rows, ridge):
    """Gradient and Hessian of the objective, the negative log-likelihood plus the ridge."""
    size = len(beta)
    hessian = [[ridge if i == j else 0.0 for j in range(size)] for i in range(size)]
    gradient = [ridge * b for b in beta]
    for terms, n, goals in rows:
        p = probability(beta, terms)
        weight, residual = n * p * (1 - p), n * p - goals
        for i in range(size):
            if terms[i]:
                gradient[i] += terms[i] * residual
                scaled = terms[i] * weight
                row = hessian[i]
                for j in range(i, size):
                    if terms[j]:
                        row[j] += scaled * terms[j]
    for i in range(size):
        for j in range(i):
            hessian[i][j] = hessian[j][i]
    return gradient, hessian


def bounds(constrained=True):
    """Each term's (lowest, highest) value: CONSTRAINTS, or none at all."""
    return [CONSTRAINTS.get(term, (-inf, inf)) if constrained else (-inf, inf) for term in TERMS]


class FitFailed(RuntimeError):
    """A fit that is not published: it did not converge, its coefficients or objective are not
    finite, or it breaks CONSTRAINTS (VI-23 stage 3, FAILURE_MODES §10.2). Raised before anything
    is written: the models and the scores already published stay as they were."""


def unpublishable(coefficients, info):
    """Why a fit's result cannot be published, or None when it can."""
    if not info.get("converged"):
        return f"the fit did not converge (iterations {info.get('iterations')}, objective {info.get('objective')})"
    objective = info.get("objective")
    if objective is None or not isfinite(objective) or not all(isfinite(c) for c in coefficients):
        return "the fit's coefficients or objective are not finite"
    broken = violations(coefficients)
    return f"the fit breaks the model's constraints ({', '.join(broken)})" if broken else None


def violations(coefficients, tolerance=1e-12):
    """The constraints the coefficients break, as text (none for a model of this version)."""
    out = []
    for term, value in zip(TERMS, coefficients):
        lo, hi = CONSTRAINTS.get(term, (-inf, inf))
        if value < lo - tolerance or value > hi + tolerance:
            out.append(f"{term} = 0" if lo == hi else f"{term} >= {lo:g}" if lo > -inf else f"{term} <= {hi:g}")
    return out


def _release(beta, gradient, hessian, held, limits, enough):
    """The held coefficient whose release lowers the objective the most, or None: its gradient
    must pull it inside its bounds (at its lowest value a negative gradient, at its highest a
    positive one) for a gain, g² / 2h along its own axis, above `enough` (below, the gradient
    is the rounding of the sums). A term fixed by its bounds is never released."""
    best, release = enough, None
    for i in sorted(held):
        lo, hi = limits[i]
        inward = 0.0 if lo == hi else -gradient[i] if beta[i] == lo else gradient[i]
        gain = inward * inward / (2 * hessian[i][i]) if inward > 0 else 0.0
        if gain > best:
            best, release = gain, i
    return release


def _newton(gradient, hessian, free):
    """The Newton step on the free coefficients and its decrement, -g·step (twice the fall of
    the objective it predicts)."""
    if not free:
        return [], 0.0
    step = _solve([[hessian[i][j] for j in free] for i in free], [-gradient[i] for i in free])
    return step, -sum(gradient[i] * s for i, s in zip(free, step))


def fit(bins, *, iterations=200, ridge=1e-6, constrained=True, diagnostics=False):
    """Logistic regression on bins [(situation, body, distance, angle, shots, goals)] within
    CONSTRAINTS; returns the coefficients in the order of TERMS, or None below MIN_FIT shots
    (with diagnostics: the pair (coefficients, how the fit ended)).

    A primal active-set Newton method, for bounds: the coefficients held at a bound stay there
    while Newton steps, halved until the objective falls enough (Armijo), move the others; a
    step that would cross a bound stops on it and holds that coefficient. Once the free ones
    are optimal (the Newton decrement is below 1e-12 of the objective), the held coefficient
    whose release lowers the objective the most is released. It ends when none would
    (the optimality conditions): `converged`. Each pass reads the same bins in the same order:
    the same bins give the same coefficients. When the free optimum is inside the bounds, it
    is the answer. `constrained=False` is version 1's free model (evaluate_xg.py compares the
    two). `ridge` keeps a term no shot carries (a situation absent from the base) at 0."""
    rows = [(features(situation, body, float(d), float(th)), n, goals) for situation, body, d, th, n, goals in bins if n]
    shots = sum(n for _, n, _ in rows)
    scored = sum(goals for _, _, goals in rows)
    if shots < MIN_FIT or not 0 < scored < shots:
        info = {"converged": False, "iterations": 0, "objective": None, "max_violation": None, "held": [], "reason": "too few shots or goals"}
        return (None, info) if diagnostics else None
    size = len(TERMS)
    limits = bounds(constrained)
    rate = scored / shots
    beta = [0.0] * size
    beta[0] = log(rate / (1 - rate))
    held = {i for i, (lo, hi) in enumerate(limits) if beta[i] in (lo, hi)}  # every bounded term starts on its bound, 0
    value = -_likelihood(beta, rows, ridge)
    steps, converged = 0, False
    while steps < iterations:
        gradient, hessian = _derivatives(beta, rows, ridge)
        free = [i for i in range(size) if i not in held]
        step, decrement = _newton(gradient, hessian, free)
        enough = 1e-12 * (1 + abs(value))
        if decrement <= enough:
            # Optimal with these held: release the one that would lower the objective the most.
            release = _release(beta, gradient, hessian, held, limits, enough)
            if release is None:
                converged = True
                break
            held.discard(release)
            continue
        steps += 1
        direction = [0.0] * size
        for i, s in zip(free, step):
            direction[i] = s
        # The longest feasible step, and the bound that stops it.
        longest, blocking = 1.0, None
        for i in free:
            lo, hi = limits[i]
            room = (hi - beta[i]) / direction[i] if direction[i] > 0 and hi < inf else \
                (lo - beta[i]) / direction[i] if direction[i] < 0 and lo > -inf else None
            if room is not None and room < longest:
                longest, blocking = max(room, 0.0), i
        t = longest
        while True:
            trial = [min(hi, max(lo, b + t * d)) for b, d, (lo, hi) in zip(beta, direction, limits)]
            if blocking is not None and t == longest:
                trial[blocking] = limits[blocking][1] if direction[blocking] > 0 else limits[blocking][0]
            candidate = -_likelihood(trial, rows, ridge)
            if candidate <= value - 1e-4 * t * decrement:
                break
            t /= 2
            if t < 1e-12:
                break
        if t < 1e-12:
            break  # the objective no longer tells the step from its rounding
        beta, value = trial, candidate
        if blocking is not None and t == longest:
            held.add(blocking)
    if not converged:
        # Stopped by the iteration cap or by a step the objective cannot resolve: the
        # optimality conditions are read at the point reached.
        gradient, hessian = _derivatives(beta, rows, ridge)
        free = [i for i in range(size) if i not in held]
        _, decrement = _newton(gradient, hessian, free)
        enough = 1e-12 * (1 + abs(value))
        converged = decrement <= enough and _release(beta, gradient, hessian, held, limits, enough) is None
    if not diagnostics:
        return beta
    worst = max(max(0.0, lo - b, b - hi) for b, (lo, hi) in zip(beta, limits))
    return beta, {"converged": converged, "iterations": steps, "objective": value, "max_violation": worst,
                  "held": [TERMS[i] for i in sorted(held)]}


def log_loss(coefficients, bins):
    """Mean log loss of the model on bins of shots (its judgement on shots not fitted)."""
    total = shots = 0
    for situation, body, d, th, n, goals in bins:
        p = min(1 - 1e-9, max(1e-9, probability(coefficients, features(situation, body, float(d), float(th)))))
        total -= goals * log(p) + (n - goals) * log(1 - p)
        shots += n
    return total / shots if shots else None


def _latest(conn):
    return conn.execute(
        f"SELECT id, shots, penalty, {', '.join(TERMS)} FROM agg.xg_models WHERE version = %s ORDER BY fitted_at DESC, id DESC LIMIT 1", (MODEL_VERSION,)
    ).fetchone()


def refresh(conn, season):
    """Score a season's shots (after its matches changed); fits the model first when there
    is none, or when the base holds REFIT_GROWTH times the shots of the last fit, and then
    scores every season again so that all shots are read by one model. Returns the number
    of shots scored (0 when the base holds too few shots to fit a model).

    A fit is published only when it converged, with finite coefficients and objective, inside
    CONSTRAINTS; otherwise FitFailed is raised before the publication transaction opens, and
    the models and scores already published stay as they were (FAILURE_MODES §10.2). The new
    model, every season's scores and the old models' removal are one transaction.

    The fit runs outside any transaction: the base ends a session that stays idle inside
    one (60 s), and a fit takes longer than that on the worker."""
    model = _latest(conn)
    if model is not None:
        held = conn.execute(f"SELECT count(*) {_SHOTS} AND s.situation IS DISTINCT FROM 'penalty'").fetchone()[0]
        if held > model[1] * REFIT_GROWTH:
            model = None
    fitted = None
    if model is None:
        bins = conn.execute(BINS).fetchall()
        coefficients, info = fit(bins, diagnostics=True)
        if coefficients is None:
            return 0
        problem = unpublishable(coefficients, info)
        if problem:
            raise FitFailed(problem)
        taken, scored = conn.execute(PENALTIES).fetchone()
        fitted = (sum(b[4] for b in bins), sum(b[5] for b in bins), scored / taken if taken else None, coefficients)
    with conn.transaction():
        scope = season
        if fitted is not None:
            shots, goals, penalty, coefficients = fitted
            ident = conn.execute(
                f"""INSERT INTO agg.xg_models(version, shots, goals, penalty, {', '.join(TERMS)})
                    VALUES (%s, %s, %s, %s, {', '.join(['%s'] * len(TERMS))}) RETURNING id""",
                (MODEL_VERSION, shots, goals, penalty, *coefficients),
            ).fetchone()[0]
            model = (ident, shots, penalty, *coefficients)
            scope = None  # every season, by the new model
        params = {"model": model[0], "penalty": model[2], "season": scope, **dict(zip(TERMS, model[3:]))}
        if scope is None:
            conn.execute("DELETE FROM agg.shot_xg")
        else:
            conn.execute("DELETE FROM agg.shot_xg WHERE season_id = %s", (scope,))
        written = conn.execute(SCORE, params).rowcount
        conn.execute("DELETE FROM agg.xg_models m WHERE NOT EXISTS (SELECT 1 FROM agg.shot_xg x WHERE x.model_id = m.id) AND m.id <> %s", (model[0],))
    return written
