"""What a starting eleven changes to a match, and what replacing one player would.

A club's Elo is its strength with the players it usually fields. A player's own rate is
what the ranking measures of him per 90 minutes, without the level of his club (power.py,
§ 8):
  r = 90 × Σ own contributions / (minutes + LAMBDA)
read before a match on his previous award year and on the present one up to that match.
A line-up is the sum of the rates of its outfield starters; its deviation D is that sum
less the mean of the club's earlier line-ups of the year. The forecast (forecast.py) then
reads the two strengths as
  Δ' = Δ + ELO × (D_home − D_away) / 400
with ELO, the Elo points one unit of rate is worth, fitted by maximum likelihood on the
finished club matches, the forecast's own coefficients held as they are.

Goalkeepers are left out of a line-up's sum and have no "what if": measured apart, their
rate changes nothing to a match's result. The measures, and the judgement on a season not
seen, are in docs/calculs/05-joueurs/12-et-si-un-joueur-en-remplacait-un-autre.md.

The "what if" follows: a player of rate r_in in the place of a team-mate of rate r_out
moves the club by ELO × (r_in − r_out) points, and its expected points per league match
by what the forecast gives for that move against its league's other clubs (replace()).
It is an estimate from how line-ups relate to results. It knows nothing of how a player
adapts to another club, league or system.
"""

from collections import defaultdict
from math import exp, sqrt

from . import forecast
from .power import LAMBDA, award_year

MODEL_VERSION = "lineup-v1"
STARTERS = 11  # a side's line-up is read only when it lists them all
MIN_HISTORY = 5  # earlier line-ups of the year a club needs before one is compared with them
MIN_FIT = 2000  # matches with two comparable line-ups, below which nothing is fitted
REFIT_GROWTH = 1.25  # the base rates this many times the matches of the last fit: fit again
EXCLUDED_ROLES = ("goalkeeper",)


def rate(total, minutes):
    """A player's own rate per 90 minutes, drawn towards 0 while he has played little."""
    return 90.0 * total / (minutes + LAMBDA)


def deviations(matches, appearances, starters, previous):
    """One award year's matches as the fit reads them.

    matches: [(match, home, away, Δ, home goals, away goals)] in kick-off order;
    appearances: {match: [(player, role, minutes, own contribution)]}, the ranking's
    player-matches; starters: {(match, team): [player]}; previous: {player: (own
    contribution, minutes, main role)} of the award year before.

    Returns ([(Δ, D_home − D_away, home goals, away goals)], the year's totals in the
    shape of `previous`). A match is kept when both sides list STARTERS starters and have
    MIN_HISTORY earlier line-ups to be compared with. Nothing of a match enters its own
    line-ups: its appearances are counted after it.
    """
    running = {}  # player: [own contribution, minutes, {role: minutes}]
    history = defaultdict(lambda: [0, 0.0])  # club: [line-ups so far, their sums added up]
    kept = []
    for match, home, away, delta, home_goals, away_goals in matches:
        played = appearances.get(match, ())
        role_here = {player: role for player, role, _, _ in played}
        sums = []
        for team in (home, away):
            players = starters.get((match, team), ())
            total = 0.0
            for player in players:
                now, past = running.get(player), previous.get(player)
                role = role_here.get(player) or (max(sorted(now[2]), key=now[2].get) if now else None) or (past[2] if past else None)
                if role in EXCLUDED_ROLES:
                    continue
                total += rate((now[0] if now else 0.0) + (past[0] if past else 0.0), (now[1] if now else 0.0) + (past[1] if past else 0.0))
            sums.append(total if len(players) == STARTERS else None)
        if None not in sums and history[home][0] >= MIN_HISTORY and history[away][0] >= MIN_HISTORY:
            usual_home, usual_away = history[home][1] / history[home][0], history[away][1] / history[away][0]
            kept.append((delta, (sums[0] - usual_home) - (sums[1] - usual_away), home_goals, away_goals))
        for team, total in zip((home, away), sums):
            if total is not None:
                history[team][0] += 1
                history[team][1] += total
        for player, role, minutes, contribution in played:
            entry = running.setdefault(player, [0.0, 0.0, defaultdict(float)])
            entry[0] += contribution
            entry[1] += minutes
            entry[2][role] += minutes
    totals = {player: (entry[0], entry[1], max(sorted(entry[2]), key=entry[2].get)) for player, entry in running.items()}
    return kept, totals


def likelihood(rows, coefficients, weight):
    """Log-likelihood (to a constant) of the scores under Δ' = Δ + weight × deviation.
    coefficients: ((a_home, b_home), (a_away, b_away)), the forecast's."""
    (ah, bh), (aa, ba) = coefficients
    total = 0.0
    for delta, deviation, home_goals, away_goals in rows:
        x = delta + weight * deviation
        zh, za = ah + bh * x, aa - ba * x
        total += home_goals * zh - exp(zh) + away_goals * za - exp(za)
    return total


def fit(rows, coefficients, *, low=-1.0, high=1.0, tolerance=1e-5):
    """(Elo points one unit of rate is worth, its standard error), or None below MIN_FIT
    rows. One parameter: a golden-section search, then the curvature at the maximum."""
    if len(rows) < MIN_FIT:
        return None
    ratio = (sqrt(5) - 1) / 2
    a, b = low, high
    c, d = b - ratio * (b - a), a + ratio * (b - a)
    fc, fd = likelihood(rows, coefficients, c), likelihood(rows, coefficients, d)
    while b - a > tolerance:
        if fc > fd:
            b, d, fd = d, c, fc
            c = b - ratio * (b - a)
            fc = likelihood(rows, coefficients, c)
        else:
            a, c, fc = c, d, fd
            d = a + ratio * (b - a)
            fd = likelihood(rows, coefficients, d)
    weight, step = (a + b) / 2, 0.01
    curve = (likelihood(rows, coefficients, weight + step) - 2 * likelihood(rows, coefficients, weight)
             + likelihood(rows, coefficients, weight - step)) / step ** 2
    return 400 * weight, (400 / sqrt(-curve) if curve < 0 else None)


def points(model, elo, opponents, shift=0.0):
    """A club's expected points per league match against a side of `opponents` Elo, half
    of its matches at home and half away, with `shift` Elo points added to the club."""
    home = forecast.forecast(model, elo + shift, opponents)
    away = forecast.forecast(model, opponents, elo + shift)
    return 0.5 * (3 * home["home"] + home["draw"]) + 0.5 * (3 * away["away"] + away["draw"])


def replace(model, elo_per_unit, elo, opponents, rate_in, rate_out):
    """(Elo points, expected points per league match) a club gains when a player of own
    rate `rate_in` plays in the place of one of rate `rate_out`. model: the forecast's."""
    shift = elo_per_unit * (rate_in - rate_out)
    return shift, points(model, elo, opponents, shift) - points(model, elo, opponents)


# Database -----------------------------------------------------------------

# The award years the ranking has read players of, in order.
YEARS = """
SELECT DISTINCT r.season_id FROM agg.power_runs r
WHERE r.kind = 'players' AND r.status = 'published' AND r.season_id IS NOT NULL AND r.players > 0 ORDER BY 1"""
# An award year's finished club matches of the PitchAPI editions, as the forecast is fitted
# on them (forecast.FITTED), in kick-off order.
MATCHES = """
SELECT m.id, m.home_team_id, m.away_team_id, eh.elo_before, ea.elo_before, coalesce(m.is_neutral, false),
  coalesce(m.home_score_90, m.home_score), coalesce(m.away_score_90, m.away_score)
FROM core.matches m
JOIN agg.team_elo eh ON eh.match_id = m.id AND eh.team_id = m.home_team_id
JOIN agg.team_elo ea ON ea.match_id = m.id AND ea.team_id = m.away_team_id
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
JOIN core.teams th ON th.id = m.home_team_id AND th.is_national IS NOT TRUE
WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
  AND m.season_id = ANY(%(seasons)s) AND m.match_date >= %(start)s AND m.match_date < %(end)s
ORDER BY coalesce(m.kickoff_at, m.match_date::timestamp AT TIME ZONE 'UTC'), m.id"""
# The ranking's player-matches of the year, each contribution counted for its match's stakes
# as the season's total counts it.
APPEARANCES = """
SELECT p.match_id, p.player_id, p.role, p.minutes, p.contribution * coalesce(p.stakes, 1)
FROM agg.player_power_matches p WHERE p.season_id = %(year)s AND p.contribution IS NOT NULL"""
STARTING = """
SELECT l.match_id, l.team_id, l.player_id
FROM core.lineup_players l
JOIN core.matches m ON m.id = l.match_id AND m.season_id = l.season_id
WHERE l.season_id = ANY(%(seasons)s) AND l.is_starter AND l.team_id IS NOT NULL
  AND m.status = 'finished' AND m.match_date >= %(start)s AND m.match_date < %(end)s"""


def read(conn, year, previous):
    """An award year's rows for the fit, and its players' totals for the year after."""
    start, end = award_year(year)
    args = {"year": year, "seasons": [year, year + 1], "start": start, "end": end}
    matches = [(match, home, away, forecast.delta(elo_home, elo_away, neutral), home_goals, away_goals)
               for match, home, away, elo_home, elo_away, neutral, home_goals, away_goals in conn.execute(MATCHES, args).fetchall()]
    appearances = defaultdict(list)
    for match, player, role, minutes, contribution in conn.execute(APPEARANCES, args).fetchall():
        appearances[match].append((player, role, float(minutes), float(contribution)))
    starters = defaultdict(list)
    for match, team, player in conn.execute(STARTING, args).fetchall():
        starters[(match, team)].append(player)
    return deviations(matches, appearances, starters, previous)


def refresh(conn):
    """Fit the worth of a line-up when there is no model of this version, or when the base
    rates REFIT_GROWTH times the matches it did at the last fit; one model is kept. Returns
    the matches fitted on, 0 when there are too few (or no forecast model), None when no
    fit was due.

    Read, compute, write: no transaction is open while the years are gone through (the
    base ends a session that stays idle inside one, 60 s)."""
    coefficients = conn.execute(
        "SELECT home_base, home_slope, away_base, away_slope FROM agg.forecast_models ORDER BY fitted_at DESC, id DESC LIMIT 1"
    ).fetchone()
    if coefficients is None:
        return 0
    rated = conn.execute("SELECT count(*) / 2 FROM agg.team_elo").fetchone()[0]
    last = conn.execute(
        "SELECT rated FROM agg.lineup_models WHERE version = %s ORDER BY fitted_at DESC, id DESC LIMIT 1", (MODEL_VERSION,)
    ).fetchone()
    if last is not None and rated <= last[0] * REFIT_GROWTH:
        return None
    rows, previous, before = [], {}, None
    for (year,) in conn.execute(YEARS).fetchall():
        # A year the base does not hold the one before of starts from nothing.
        kept, previous = read(conn, year, previous if before == year - 1 else {})
        rows += kept
        before = year
    fitted = fit(rows, ((coefficients[0], coefficients[1]), (coefficients[2], coefficients[3])))
    if fitted is None or fitted[1] is None:
        return 0
    with conn.transaction():
        conn.execute("DELETE FROM agg.lineup_models")
        conn.execute(
            "INSERT INTO agg.lineup_models(version, matches, rated, elo_per_unit, elo_per_unit_error) VALUES (%s, %s, %s, %s, %s)",
            (MODEL_VERSION, len(rows), rated, fitted[0], fitted[1]),
        )
    return len(rows)
