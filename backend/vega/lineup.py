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

The same reading corrects a match's forecast once both clubs have confirmed their eleven
(forecast_matches()): each side's deviation from its usual line-up of the year
(agg.lineup_usuals, kept by refresh_usuals()) moves its strength by ELO × D points.
"""

from collections import defaultdict
from datetime import timedelta
from math import exp, sqrt

from . import forecast
from .power import LAMBDA, award_year

MODEL_VERSION = "lineup-v1"
STARTERS = 11  # a side's line-up is read only when it lists them all
MIN_HISTORY = 5  # earlier line-ups of the year a club needs before one is compared with them
MIN_FIT = 2000  # matches with two comparable line-ups, below which nothing is fitted
REFIT_GROWTH = 1.25  # the base rates this many times the matches of the last fit: fit again
EXCLUDED_ROLES = ("goalkeeper",)
# A match's confirmed line-ups are looked for from this long before its kick-off to this
# long after it (a line-up confirmed late still corrects the forecast the match page shows).
LOOK_BEFORE = timedelta(hours=3)
LOOK_AFTER = timedelta(hours=3)


def year_of(day):
    """The award year of a date: it starts on 1 August (power.award_year)."""
    return day.year if day.month >= 8 else day.year - 1


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
    shape of `previous`, {club: (its line-ups of the year, their sums added up)}). A match
    is kept when both sides list STARTERS starters and have MIN_HISTORY earlier line-ups
    to be compared with. Nothing of a match enters its own line-ups: its appearances are
    counted after it.
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
    return kept, totals, {club: (count, total) for club, (count, total) in history.items() if count}


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
    """An award year's rows for the fit, its players' totals for the year after, and its
    clubs' line-ups so far."""
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
        kept, previous, _ = read(conn, year, previous if before == year - 1 else {})
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


# The line-ups a match's forecast reads --------------------------------------

# The present award year when the ranking has been computed since its clubs' usual
# line-ups were last written (or they never were).
USUALS_DUE = """
SELECT r.season_id FROM agg.power_runs r
WHERE r.kind = 'players' AND r.status = 'published' AND r.season_id = %(year)s AND r.players > 0
  AND NOT EXISTS (SELECT 1 FROM agg.lineup_usual_runs u WHERE u.season_id = r.season_id AND u.computed_at >= r.finished_at)"""
# Matches about to start or just started whose two line-ups are confirmed and whose forecast
# has not read them as they stand: (match, season, date, home, away, neutral, the strengths
# the forecast read, its model, when the line-ups were last written).
MATCHES_DUE = """
SELECT m.id, m.season_id, m.match_date, m.home_team_id, m.away_team_id, coalesce(m.is_neutral, false),
  f.home_elo, f.away_elo, f.model_id, l.written
FROM core.matches m
JOIN agg.match_forecasts f ON f.match_id = m.id
JOIN LATERAL (SELECT count(*) FILTER (WHERE s.confirmed) AS confirmed, max(s.updated_at) AS written
              FROM core.lineups s WHERE s.season_id = m.season_id AND s.match_id = m.id) l ON l.confirmed = 2
WHERE m.status IN ('not_started', 'in_play') AND m.kickoff_at > %(now)s - %(after)s AND m.kickoff_at < %(now)s + %(before)s
  AND m.match_date IS NOT NULL AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM agg.match_lineup_forecasts x WHERE x.match_id = m.id AND x.computed_at >= l.written)
ORDER BY m.kickoff_at, m.id"""
# A match's starters, each with his role and his own totals of the award year and of the
# year before (the ranking's, as it last computed them: nothing of the match is in them).
MATCH_STARTERS = """
SELECT l.team_id, coalesce(cur.role, prev.role),
  coalesce(cur.own_total, 0) + coalesce(prev.own_total, 0),
  CASE WHEN cur.own_total IS NULL THEN 0 ELSE cur.minutes END + CASE WHEN prev.own_total IS NULL THEN 0 ELSE prev.minutes END
FROM core.lineup_players l
LEFT JOIN agg.player_power cur ON cur.season_id = %(year)s AND cur.player_id = l.player_id
LEFT JOIN agg.player_power prev ON prev.season_id = %(year)s - 1 AND prev.player_id = l.player_id
WHERE l.season_id = %(season)s AND l.match_id = %(match)s AND l.is_starter AND l.team_id IS NOT NULL"""


def usuals_due(conn, today):
    """The award year whose clubs' usual line-ups are to be written again, in a list."""
    return [year for (year,) in conn.execute(USUALS_DUE, {"year": year_of(today)}).fetchall()]


def refresh_usuals(conn, year):
    """Write each club's line-ups of the award year so far: how many, and their sums added
    up, each sum from the rates known before its match (deviations()). Returns the clubs
    written. Read, compute, write: no transaction is open while the year is gone through."""
    previous = {
        player: (float(own), float(minutes), role)
        for player, own, minutes, role in conn.execute(
            "SELECT player_id, own_total, minutes, role FROM agg.player_power WHERE season_id = %s AND own_total IS NOT NULL", (year - 1,)
        ).fetchall()
    }
    _, _, usual = read(conn, year, previous)
    with conn.transaction():
        conn.execute("DELETE FROM agg.lineup_usuals WHERE season_id = %s", (year,))
        with conn.cursor().copy("COPY agg.lineup_usuals(season_id, team_id, lineups, total) FROM STDIN") as copy:
            for team, (count, total) in sorted(usual.items()):
                copy.write_row((year, team, count, total))
        conn.execute(
            """INSERT INTO agg.lineup_usual_runs(season_id, clubs) VALUES (%s, %s)
               ON CONFLICT (season_id) DO UPDATE SET computed_at = now(), clubs = EXCLUDED.clubs""",
            (year, len(usual)),
        )
    return len(usual)


def side_sums(starters):
    """{club: the sum of its outfield starters' rates}, for the clubs listing STARTERS
    starters. starters: [(club, role, own contribution, minutes)]."""
    count, total = defaultdict(int), defaultdict(float)
    for team, role, own, minutes in starters:
        count[team] += 1
        if role not in EXCLUDED_ROLES:
            total[team] += rate(float(own), float(minutes))
    return {team: total[team] for team, n in count.items() if n == STARTERS}


def forecast_matches(conn, now, seen=None):
    """Forecast again the matches about to start whose two confirmed line-ups the forecast
    has not read: each side's strength moved by what its eleven is worth against its usual
    one. Returns the matches written. `seen`: {match: when its line-ups were written}, the
    matches already looked at for which nothing can be said (a club without enough
    earlier line-ups); they are not looked at again until their line-ups change."""
    seen = {} if seen is None else seen
    rows = conn.execute(MATCHES_DUE, {"now": now, "before": LOOK_BEFORE, "after": LOOK_AFTER}).fetchall()
    for match in set(seen) - {row[0] for row in rows}:
        del seen[match]  # no longer about to start: forgotten
    due = [row for row in rows if seen.get(row[0]) != row[9]]
    if not due:
        return 0
    worth = conn.execute("SELECT elo_per_unit FROM agg.lineup_models WHERE version = %s ORDER BY fitted_at DESC, id DESC LIMIT 1", (MODEL_VERSION,)).fetchone()
    written = 0
    for match, season, day, home, away, neutral, home_elo, away_elo, model_id, lineups_written in due:
        seen[match] = lineups_written
        coefficients = conn.execute("SELECT home_base, home_slope, away_base, away_slope, rho FROM agg.forecast_models WHERE id = %s", (model_id,)).fetchone()
        if worth is None or coefficients is None:
            continue
        year = year_of(day)
        sums = side_sums(conn.execute(MATCH_STARTERS, {"year": year, "season": season, "match": match}).fetchall())
        usual = {team: total / count for team, count, total in conn.execute(
            "SELECT team_id, lineups, total FROM agg.lineup_usuals WHERE season_id = %s AND team_id = ANY(%s) AND lineups >= %s", (year, [home, away], MIN_HISTORY)
        ).fetchall()}
        if not all(team in sums and team in usual for team in (home, away)):
            continue
        deviation_home, deviation_away = sums[home] - usual[home], sums[away] - usual[away]
        model = {"home": (coefficients[0], coefficients[1]), "away": (coefficients[2], coefficients[3]), "rho": coefficients[4]}
        f = forecast.forecast(model, home_elo + worth[0] * deviation_home, away_elo + worth[0] * deviation_away, neutral)
        with conn.transaction():
            conn.execute(
                """INSERT INTO agg.match_lineup_forecasts(match_id, season_id, home_win, draw, away_win, home_goals, away_goals, likely_home, likely_away,
                     home_elo, away_elo, home_deviation, away_deviation, elo_per_unit)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (match_id) DO UPDATE SET home_win = EXCLUDED.home_win, draw = EXCLUDED.draw, away_win = EXCLUDED.away_win,
                     home_goals = EXCLUDED.home_goals, away_goals = EXCLUDED.away_goals, likely_home = EXCLUDED.likely_home, likely_away = EXCLUDED.likely_away,
                     home_elo = EXCLUDED.home_elo, away_elo = EXCLUDED.away_elo, home_deviation = EXCLUDED.home_deviation, away_deviation = EXCLUDED.away_deviation,
                     elo_per_unit = EXCLUDED.elo_per_unit, computed_at = now()""",
                (match, season, f["home"], f["draw"], f["away"], f["home_goals"], f["away_goals"], f["score"][0], f["score"][1],
                 home_elo, away_elo, deviation_home, deviation_away, worth[0]),
            )
        seen.pop(match, None)
        written += 1
    return written
