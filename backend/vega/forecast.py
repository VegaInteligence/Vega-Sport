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

Nothing here knows a bookmaker's odds: the model is judged on matches it has not seen
(docs/calculs/06-accueil-et-matchs/03-pronostics-et-projections.md).

refresh(conn, season) writes, for a season in progress: the model fitted on every finished
club match (agg.forecast_models), the forecast of each match still to play
(agg.match_forecasts) and the projection of each domestic league (agg.season_projections,
agg.season_projection_places). The worker runs it with the season's daily models, after
the Elo.
"""

from collections import defaultdict
from math import exp, log
import random

from .power import ELO_HOME, fit_poisson

MODEL_VERSION = "forecast-v1"
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


def simulate(table, fixtures, model, strengths, *, simulations=SIMULATIONS, spread=STRENGTH_SPREAD, seed=0):
    """Project a league. `table`: {team: (points, goals for, goals against, played)} so far;
    `fixtures`: [(home, away)] still to play; `strengths`: {team: Elo}. Returns
    {team: {"positions": [share of replays at 1st, 2nd, …], "points": mean final points}}.
    A fixture of a club without a strength is left out of the replays."""
    teams = sorted(set(table) | {t for f in fixtures for t in f})
    index = {team: i for i, team in enumerate(teams)}
    games = [(index[h], index[a]) for h, a in fixtures if h in strengths and a in strengths]
    left = [0] * len(teams)
    for h, a in games:
        left[h] += 1
        left[a] += 1
    base = [tuple(table.get(team, (0, 0, 0, 0)))[:4] + (0,) * (4 - len(tuple(table.get(team, (0, 0, 0, 0)))[:4])) for team in teams]
    # The share of each club's season still to play scales how far its strength may move.
    reach = [spread * (left[i] / (left[i] + base[i][3])) ** 0.5 if left[i] + base[i][3] else 0.0 for i in range(len(teams))]
    elo = [strengths.get(team, 0.0) for team in teams]
    (ah, bh), (aa, ba) = model["home"], model["away"]
    rng = random.Random(seed)
    counts = [[0] * len(teams) for _ in teams]
    points_sum = [0.0] * len(teams)
    for _ in range(simulations):
        now = [elo[i] + (rng.gauss(0.0, reach[i]) if reach[i] else 0.0) for i in range(len(teams))]
        points = [b[0] for b in base]
        scored = [b[1] for b in base]
        conceded = [b[2] for b in base]
        for h, a in games:
            d = (now[h] + ELO_HOME - now[a]) / 400
            hs, as_ = _goals(rng, exp(ah + bh * d)), _goals(rng, exp(aa - ba * d))
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
        order = sorted(range(len(teams)), key=lambda i: (-points[i], -(scored[i] - conceded[i]), -scored[i], rng.random()))
        for position, i in enumerate(order):
            counts[i][position] += 1
            points_sum[i] += points[i]
    return {team: {"positions": [c / simulations for c in counts[i]], "points": points_sum[i] / simulations} for team, i in index.items()}


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

# The finished club matches of the PitchAPI editions, with both strengths before them and
# the score after ninety minutes where the match went further.
FITTED = """
SELECT eh.elo_before, ea.elo_before, coalesce(m.is_neutral, false),
  coalesce(m.home_score_90, m.home_score), coalesce(m.away_score_90, m.away_score)
FROM core.matches m
JOIN agg.team_elo eh ON eh.match_id = m.id AND eh.team_id = m.home_team_id
JOIN agg.team_elo ea ON ea.match_id = m.id AND ea.team_id = m.away_team_id
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
JOIN core.teams th ON th.id = m.home_team_id AND th.is_national IS NOT TRUE
WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL"""
# The season's matches of the PitchAPI editions: (match, edition, home, away, neutral,
# status, home score, away score, regular round?, domestic league?).
SEASON = """
SELECT m.id, m.competition_season_id, m.home_team_id, m.away_team_id, coalesce(m.is_neutral, false), m.status::text,
  m.home_score, m.away_score, coalesce(r.stage::text, 'regular') = 'regular',
  c.country_code IS NOT NULL AND left(c.country_code, 3) <> 'INT'
FROM core.matches m
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
JOIN core.competitions c ON c.id = cs.competition_id
LEFT JOIN core.rounds r ON r.id = m.round_id
WHERE m.season_id = %s AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL"""
MIN_LEAGUE = 8  # clubs: a table of fewer is no league to project


def league_state(rows):
    """Per edition, from SEASON's rows: {edition: (table, fixtures)} of its regular rounds,
    for the domestic leagues with a match still to play. table: {team: (points, goals
    for, goals against, played)}; fixtures: [(home, away)]."""
    tables, fixtures = defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0])), defaultdict(list)
    for _, edition, home, away, _, status, hs, as_, regular, domestic in rows:
        if not (regular and domestic):
            continue
        if status == "finished" and hs is not None and as_ is not None:
            for team, gf, ga in ((home, hs, as_), (away, as_, hs)):
                entry = tables[edition][team]
                entry[0] += 3 if gf > ga else 1 if gf == ga else 0
                entry[1] += gf
                entry[2] += ga
                entry[3] += 1
        elif status == "not_started":
            fixtures[edition].append((home, away))
            tables[edition][home], tables[edition][away]  # a club that has not played yet is in the table
    return {edition: ({team: tuple(v) for team, v in tables[edition].items()}, games)
            for edition, games in fixtures.items() if len(tables[edition]) >= MIN_LEAGUE}


def refresh(conn, season):
    """The forecasts and projections of a season in progress (after power.refresh_elo);
    returns (matches forecast, leagues projected). A season with nothing left to play
    keeps none."""
    with conn.transaction():
        observed = conn.execute(FITTED).fetchall()
        rows = conn.execute(SEASON, (season,)).fetchall()
        strengths = dict(conn.execute("SELECT DISTINCT ON (team_id) team_id, elo FROM agg.team_power ORDER BY team_id, season_id DESC").fetchall())
    model = fit(observed)
    upcoming = [r for r in rows if r[5] == "not_started" and r[2] in strengths and r[3] in strengths]
    forecasts = [(r[0], forecast(model, strengths[r[2]], strengths[r[3]], r[4]), strengths[r[2]], strengths[r[3]]) for r in upcoming] if model else []
    leagues = {edition: (table, simulate(table, games, model, strengths, seed=edition))
               for edition, (table, games) in sorted(league_state(rows).items())} if model else {}
    with conn.transaction():
        conn.execute("DELETE FROM agg.match_forecasts WHERE season_id = %s", (season,))
        conn.execute("DELETE FROM agg.season_projections WHERE season_id = %s", (season,))
        if not model:
            return 0, 0
        run = conn.execute(
            """INSERT INTO agg.forecast_models(version, matches, home_base, home_slope, away_base, away_slope, rho, strength_spread, simulations)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (MODEL_VERSION, model["matches"], *model["home"], *model["away"], model["rho"], STRENGTH_SPREAD, SIMULATIONS),
        ).fetchone()[0]
        with conn.cursor().copy(
            """COPY agg.match_forecasts(match_id, season_id, home_win, draw, away_win, home_goals, away_goals, likely_home, likely_away,
                 home_elo, away_elo, model_id) FROM STDIN"""
        ) as copy:
            for match, f, eh, ea in forecasts:
                copy.write_row((match, season, f["home"], f["draw"], f["away"], f["home_goals"], f["away_goals"], *f["score"], eh, ea, run))
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
        # The models no forecast names any more go with what they forecast.
        conn.execute(
            """DELETE FROM agg.forecast_models f WHERE NOT EXISTS (SELECT 1 FROM agg.match_forecasts m WHERE m.model_id = f.id)
                 AND NOT EXISTS (SELECT 1 FROM agg.season_projections s WHERE s.model_id = f.id)"""
        )
    return len(forecasts), len(leagues)
