"""Players' whole statistical profile as a short vector, for "players like him".

Every additive statistic of a player's season, per 90 minutes, is standardised across
the season's players; the principal axes of that table (the directions along which
players differ the most) are learnt from the data, and each player is placed on the
first DIMENSIONS of them. Two players close in that space have the same kind of season
across every statistic at once, not on a hand-picked list of them
(docs/calculs/05-joueurs/04-similarite-radar-et-traits.md).

Nothing here knows a player's position: that neighbours share it is the check of the
method, not one of its inputs.

A player is placed only when the source measured at least MIN_KNOWN of the statistics kept
(VI-23 B8, calculation audit of 16 November 2026, finding 13d): a statistic not measured
takes the season's mean, and a profile mostly made of means would sit near the centre for no
reason of its own (two empty profiles were identical, at distance 0). The players placed
and the statistics kept are found together (eligible), the axes are learnt from the placed
players only, and any two of them share at least 80 % of the statistics as observations.
A value is known when it is a finite number: NaN and infinities are missing, like None
(coordinator's interim review, 17 Nov 2026), and a bad input never publishes a degenerate
geometry (the guards of embed).
"""

from math import isfinite, sqrt

from .metric_catalog import PLAYER_METRICS

MODEL_VERSION = "profile-embedding-v2"  # v1 placed every player, the unmeasured statistics imputed
DIMENSIONS = 10
MIN_MINUTES = 450  # a season shorter than five matches says too little
MIN_PLAYERS = 200  # below, no axes are learnt
MIN_COVERAGE = 0.6  # a statistic measured for fewer of the players is left out
MIN_KNOWN = (9, 10)  # a player measured on fewer of the statistics kept than 9 in 10 is not placed
CLIP = 3.0  # standard deviations: one extreme statistic does not place a player alone
# Not a way of playing: discipline, own goals, penalties and what only a few matches carry.
EXCLUDED = frozenset({
    "own_goals", "yellow_cards", "red_cards", "penalties_won", "penalties_missed", "penalties_scored",
    "penalties_conceded", "penalties_saved", "shootout_penalties_saved", "errors_led_to_goal", "errors_led_to_shot",
    "fantasy_points",
})
# A competition the source names as a women's one: its players are compared among themselves.
WOMEN = r"\mwomen"


def known(value):
    """A measured value: a finite number (None, NaN and infinities are not)."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value)


def per90(total, minutes):
    """A season total per 90 minutes of the time it was measured on; None when unmeasured."""
    return 90.0 * total / minutes if total is not None and minutes else None


def standardise(rows):
    """Columns of `rows` (lists of numbers or None) as z-scores clipped to ±CLIP.

    Returns (table, kept): `kept` are the indexes of the columns used, those measured for
    at least MIN_COVERAGE of the rows and that vary. A value not measured (not a finite
    number) takes the column's mean (0 once standardised): it says nothing either way.
    """
    width = len(rows[0]) if rows else 0
    columns, kept = [], []
    for j in range(width):
        values = [row[j] for row in rows]
        scale = _scale(values)
        if scale is None:
            continue
        mean, spread = scale
        columns.append([max(-CLIP, min(CLIP, (v - mean) / spread)) if known(v) else 0.0 for v in values])
        kept.append(j)
    return [list(row) for row in zip(*columns)] if columns else [], kept


def _scale(values):
    """A column's (mean, spread) over its known values, or None when it is measured for fewer
    than MIN_COVERAGE of the rows (or two of them), does not vary, or has moments that are not
    finite (a value so large that its square overflows)."""
    measured = [v for v in values if known(v)]
    if len(measured) < MIN_COVERAGE * len(values) or len(measured) < 2:
        return None
    mean = sum(measured) / len(measured)
    spread = sqrt(sum((v - mean) * (v - mean) for v in measured) / len(measured)) if isfinite(mean) else mean
    return (mean, spread) if isfinite(mean) and isfinite(spread) and spread > 1e-12 else None


def eligible(rows):
    """The rows placed and the columns read, found together: (members, kept).

    The columns kept are those standardise keeps on the members (measured for MIN_COVERAGE of
    them, and varying); a member must know MIN_KNOWN of the columns kept. Leaving out the rows
    that do not can leave a column under MIN_COVERAGE, which changes what the others must
    know: the two steps are repeated until no row leaves. The rows only ever leave, so the
    result is reached in a few rounds and depends on the table alone. With 9 of 10 columns
    known each, two members share at least 8 of 10 as observations."""
    width = len(rows[0]) if rows else 0
    members = list(range(len(rows)))
    need, of = MIN_KNOWN
    while True:
        kept = [j for j in range(width) if _scale([rows[i][j] for i in members]) is not None]
        left = [i for i in members if of * sum(known(rows[i][j]) for j in kept) >= need * len(kept)]
        if len(left) == len(members):
            return members, kept
        members = left


def covariance(table):
    """The columns' covariance matrix (the columns are centred near 0 already)."""
    count = len(table)
    columns = list(zip(*table))
    means = [sum(column) / count for column in columns]
    centred = [[v - mean for v in column] for column, mean in zip(columns, means)]
    size = len(centred)
    matrix = [[0.0] * size for _ in range(size)]
    for i in range(size):
        for j in range(i, size):
            matrix[i][j] = matrix[j][i] = sum(a * b for a, b in zip(centred[i], centred[j])) / count
    return matrix, means


def principal_axes(matrix, dimensions):
    """The `dimensions` leading eigenvectors of a symmetric matrix (cyclic Jacobi), each
    with its eigenvalue, the largest first. An axis's sign is fixed (its largest term is
    positive) so that two fits of the same data give the same vectors."""
    size = len(matrix)
    a = [row[:] for row in matrix]
    v = [[1.0 if i == j else 0.0 for j in range(size)] for i in range(size)]
    for _ in range(100):
        off = sum(a[i][j] ** 2 for i in range(size) for j in range(i + 1, size))
        if off < 1e-18:
            break
        for p in range(size):
            for q in range(p + 1, size):
                if abs(a[p][q]) < 1e-15:
                    continue
                theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
                t = (1 if theta >= 0 else -1) / (abs(theta) + sqrt(theta * theta + 1))
                c = 1 / sqrt(t * t + 1)
                s = t * c
                for k in range(size):
                    akp, akq = a[k][p], a[k][q]
                    a[k][p], a[k][q] = c * akp - s * akq, s * akp + c * akq
                for k in range(size):
                    apk, aqk = a[p][k], a[q][k]
                    a[p][k], a[q][k] = c * apk - s * aqk, s * apk + c * aqk
                for k in range(size):
                    vkp, vkq = v[k][p], v[k][q]
                    v[k][p], v[k][q] = c * vkp - s * vkq, s * vkp + c * vkq
    order = sorted(range(size), key=lambda i: -a[i][i])[:dimensions]
    axes = []
    for i in order:
        axis = [v[k][i] for k in range(size)]
        lead = max(range(size), key=lambda k: abs(axis[k]))
        if axis[lead] < 0:
            axis = [-x for x in axis]
        axes.append((a[i][i], axis))
    return axes


def embed(rows, dimensions=DIMENSIONS):
    """Place each eligible row (a player's per-90 statistics, None where unmeasured) on the
    leading axes of the eligible rows. Returns (vectors, share of the variance the axes keep,
    columns used), a vector being None for a row not placed; or None below MIN_PLAYERS
    eligible rows or `dimensions` usable columns, and None rather than a vector or a share
    that is not finite."""
    if len(rows) < MIN_PLAYERS:
        return None
    members, kept = eligible(rows)
    if len(members) < MIN_PLAYERS or len(kept) < dimensions:
        return None
    # The same columns as eligible's: standardise keeps them on the same rows.
    table, kept = standardise([rows[i] for i in members])
    matrix, means = covariance(table)
    axes = principal_axes(matrix, dimensions)
    total = sum(matrix[i][i] for i in range(len(matrix)))
    vectors = [None] * len(rows)
    for i, row in zip(members, table):
        vectors[i] = [sum((value - mean) * weight for value, mean, weight in zip(row, means, axis)) for _, axis in axes]
    share = sum(value for value, _ in axes) / total if total else 0.0
    if not isfinite(share) or not all(isfinite(x) for i in members for x in vectors[i]):
        return None
    return vectors, share, kept


def distance(a, b):
    return sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def statistics():
    """The season totals read: every statistic that adds up over matches, less EXCLUDED."""
    return [metric.key for metric in PLAYER_METRICS if metric.rule == "sum" and metric.key not in EXCLUDED]


def refresh(conn, season):
    """Place the season's eligible players (MIN_MINUTES or more, all competitions together,
    measured on MIN_KNOWN of the statistics kept) on the axes learnt from them; returns the
    number of players placed. A season with too few eligible players keeps no vector, and a
    player who is no longer eligible loses his.

    Read, compute, write: no transaction is open while the axes are computed. The base ends
    a session that stays idle inside a transaction (60 s), and the computation of a full
    season takes longer than that on the worker."""
    keys = statistics()
    columns = ", ".join(f"sum(s.{key}_sum), sum(s.{key}_min)" for key in keys)
    rows = conn.execute(
        f"""SELECT s.player_id, sum(s.minutes)::integer, bool_and(c.name ~* %(women)s), {columns}
            FROM agg.player_season_stats s
            JOIN core.competition_seasons cs ON cs.id = s.competition_season_id
            JOIN core.competitions c ON c.id = cs.competition_id
            WHERE s.season_id = %(season)s GROUP BY s.player_id HAVING sum(s.minutes) >= %(minutes)s ORDER BY s.player_id""",
        {"season": season, "minutes": MIN_MINUTES, "women": WOMEN},
    ).fetchall()
    result = embed([[per90(row[3 + 2 * i], row[4 + 2 * i]) for i in range(len(keys))] for row in rows])
    with conn.transaction():
        conn.execute("DELETE FROM agg.player_embeddings WHERE season_id = %s", (season,))
        conn.execute("DELETE FROM agg.embedding_models WHERE season_id = %s", (season,))
        if result is None:
            return 0
        vectors, kept_share, kept = result
        placed = [(row, vector) for row, vector in zip(rows, vectors) if vector is not None]
        conn.execute(
            "INSERT INTO agg.embedding_models(season_id, version, players, statistics, variance_kept) VALUES (%s, %s, %s, %s, %s)",
            (season, MODEL_VERSION, len(placed), len(kept), kept_share),
        )
        names = ", ".join(f"e{i + 1}" for i in range(DIMENSIONS))
        with conn.cursor().copy(f"COPY agg.player_embeddings(season_id, player_id, minutes, women, {names}) FROM STDIN") as copy:
            for (player, minutes, women, *_), vector in placed:
                copy.write_row((season, player, minutes, bool(women), *vector))
    return len(placed)
