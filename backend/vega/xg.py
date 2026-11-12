"""Vega's own expected goals: the chance of a goal from where and how a shot is taken.

A logistic model on what the base knows of every shot: the distance to the goal's centre,
the angle the goal fills from there, the body part and the situation. It knows nothing of
the defenders or of the keeper's position, which the provider's model does: it is a
second reading and a fallback, not a replacement (docs/calculs/02-metriques-attendues).

The model is fitted on bins of shots (the same situation, body part, metre of distance
and twentieth of a radian of angle), which the base counts in one statement; every shot
is then scored in SQL with the fitted coefficients. A penalty is worth the share of the
base's penalties that were scored.
"""

from math import exp, log

MODEL_VERSION = "xg-v1"
MIN_FIT = 20000  # shots; below, no model is fitted
REFIT_GROWTH = 1.25  # the base holds this many times the shots of the last fit: fit again
PITCH_LENGTH, PITCH_WIDTH, GOAL_WIDTH = 105.0, 68.0, 7.32
SITUATIONS = ("from_corner", "set_piece", "fast_break", "free_kick", "throw_in_set_piece", "individual_play")
# The model's terms, in the order of agg.xg_models' columns.
TERMS = ("intercept", "angle", "distance", "distance_sq", "angle_distance", "header", "other_body",
         "from_corner", "set_piece", "fast_break", "free_kick", "throw_in", "individual_play", "header_distance")

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
  CASE WHEN z.penalty THEN %(penalty)s::float8 ELSE 1 / (1 + exp(-(
      %(intercept)s::float8 + %(angle)s::float8 * z.th + %(distance)s::float8 * z.d + %(distance_sq)s::float8 * z.d * z.d / 100
    + %(angle_distance)s::float8 * z.th * z.d / 10
    + CASE z.body WHEN 'header' THEN %(header)s::float8 + %(header_distance)s::float8 * z.d / 10 WHEN 'other' THEN %(other_body)s::float8 ELSE 0 END
    + CASE z.situation WHEN 'from_corner' THEN %(from_corner)s::float8 WHEN 'set_piece' THEN %(set_piece)s::float8
        WHEN 'fast_break' THEN %(fast_break)s::float8 WHEN 'free_kick' THEN %(free_kick)s::float8
        WHEN 'throw_in_set_piece' THEN %(throw_in)s::float8 WHEN 'individual_play' THEN %(individual_play)s::float8 ELSE 0 END))) END,
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


def fit(bins, *, iterations=50, ridge=1e-6):
    """Logistic regression by Newton's method on bins [(situation, body, distance, angle,
    shots, goals)]; returns the coefficients in the order of TERMS, or None below MIN_FIT
    shots. A step is halved until it improves the fit, so a start far from the answer
    cannot run away. `ridge` keeps a term no shot carries (a situation absent from the
    base) at 0."""
    rows = [(features(situation, body, float(d), float(th)), n, goals) for situation, body, d, th, n, goals in bins if n]
    shots = sum(n for _, n, _ in rows)
    scored = sum(goals for _, _, goals in rows)
    if shots < MIN_FIT or not 0 < scored < shots:
        return None
    size = len(TERMS)
    rate = scored / shots
    beta = [0.0] * size
    beta[0] = log(rate / (1 - rate))
    best = _likelihood(beta, rows, ridge)
    for _ in range(iterations):
        hessian = [[ridge if i == j else 0.0 for j in range(size)] for i in range(size)]
        gradient = [-ridge * b for b in beta]
        for terms, n, goals in rows:
            p = probability(beta, terms)
            weight, residual = n * p * (1 - p), goals - n * p
            for i in range(size):
                if terms[i]:
                    gradient[i] += terms[i] * residual
                    scaled = terms[i] * weight
                    for j in range(i, size):
                        hessian[i][j] += scaled * terms[j]
        for i in range(size):
            for j in range(i):
                hessian[i][j] = hessian[j][i]
        step = _solve(hessian, gradient)
        scale = 1.0
        while scale > 1e-6:
            trial = [b + scale * s for b, s in zip(beta, step)]
            value = _likelihood(trial, rows, ridge)
            if value >= best:
                break
            scale /= 2
        else:
            break  # no step improves the fit: it has converged
        moved = max(abs(scale * s) for s in step)
        beta, best = trial, value
        if moved < 1e-9:
            break
    return beta


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
    of shots scored.

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
        coefficients = fit(bins)
        if coefficients is None:
            return 0
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
