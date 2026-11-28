"""Judge Vega's match forecasts on what was played (docs/calculs/09-audit-2026-11/FAILURE_MODES.md §89.2).

Six commands, around one input schema and one report:
  evaluate_forecast.py from-log --write-input FILE
      the forecasts kept before each kick-off (agg.match_forecast_log, 185) of the matches played since, read from
      the base named by VEGA_EVALUATE_DSN (the read role is enough): what was published;
  evaluate_forecast.py from-api --base URL --from YYYY-MM-DD --to YYYY-MM-DD --write-input FILE [--league ID=DIV ...]
      the played matches of the leagues asked (the seven of models.EUROPE_LEAGUES without --league) and each one's
      kick-off point of /api/forecasts/live: the forecast rebuilt from the two strengths before the match with the
      coefficients in service today. No form, and coefficients fitted on a base that holds the matches judged. A
      match whose point starts from the forecast read again with the line-ups is another forecast: left out and
      counted. A played match whose goal events do not give its score has no point (404): counted missing;
  evaluate_forecast.py backtest --cutoff YYYY-MM-DD --write-input FILE [--no-form] [--observed FILE | --write-observed FILE]
      the model (forecast.fit) and the form's coefficients (forecast.fit_form) fitted on the matches strictly before
      the cutoff, then every match from it forecast with them. The matches come from the base (VEGA_EVALUATE_DSN, the
      calculation role: core and agg are read) or from a file --write-observed wrote;
  evaluate_forecast.py add-odds --input FILE --odds CSV [CSV ...] --write-input FILE
      adds the bookmakers' closing average (football-data.co.uk's columns AvgCH, AvgCD, AvgCA, AvgC>2.5, AvgC<2.5) to
      the matches the rows name, by the archive reader's own rule (vega.sources.footballdata.pair: a name is
      recognised from three of its rows, so a file of a few rows links nothing). A match the files do not name
      keeps the price it had; the rows read are added up from one run to the next;
  evaluate_forecast.py report --input FILE --output FILE
      log loss and Brier score of the three outcomes against the base rate, calibration, and, on the matches that
      have one, the market: its scores, the difference with a bootstrap interval, the draws, the disagreements;
  evaluate_forecast.py synthetic --seed N --write-input FILE
      a made-up input in the schema, for the tests. It says nothing of real performance.

The input, schema vega-forecast-evaluation-input/1, is a JSON object:
  {"schema": "vega-forecast-evaluation-input/1",
   "provenance": {"kind": "log" | "kickoff-point" | "backtest" | "synthetic", "description": str, ...},
   "matches": [{"match": str, "date": "YYYY-MM-DD", "competition": str, "home_goals": int, "away_goals": int,
                "forecast": {"home": p, "draw": p, "away": p[, "home_goals": rate, "away_goals": rate, "rho": number]},
                ["market": {"home": p, "draw": p, "away": p[, "over25": p]},]
                ["division": football-data's code, "home": name, "away": name]}, ...]}
The scores are those after ninety minutes. Three chances may be 0.01 away from 1 (the API rounds them): they are
divided by their sum. An input that breaks the schema is rejected with exit code 2, no report, and a message that
starts with the reason: schema, date, duplicate, probability, score or partition (no match to judge, or a cutoff
that leaves too few matches before it or none after). A read of the API or of the base that fails stops the command
with exit code 4 and nothing is written.

The report is canonical JSON (sorted keys): the same input gives the same bytes, and its sha256 is the hash of the
report without that key. Every comparison with the market reads only the matches that have both and says how many.
"""

import argparse
import csv
import hashlib
import io
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from math import isfinite, log
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vega import forecast, models  # noqa: E402
from vega.sources import footballdata  # noqa: E402

SCHEMA = "vega-forecast-evaluation-input/1"
REPORT = "vega-forecast-evaluation-report/1"
KINDS = ("log", "kickoff-point", "backtest", "synthetic")
TOLERANCE = 0.01  # how far three chances may be from 1
MAX_LEAD = timedelta(days=15)  # a kept forecast older than this at the kick-off is stale (a postponed match)
RESAMPLES, SEED = 1000, 89  # the bootstrap of a difference
FAVOURITE = (0.0, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0)
DRAW = (0.0, 0.20, 0.24, 0.27, 1.0)
DISAGREEMENT = (0.0, 0.03, 0.06, 0.10, 1.0)
# football-data.co.uk's division of a competition of the base, by its name and country.
DIVISION_OF = {("Premier League", "ENG"): "E0", ("Championship", "ENG"): "E1", ("League One", "ENG"): "E2", ("League Two", "ENG"): "E3",
               ("LaLiga", "ESP"): "SP1", ("LaLiga2", "ESP"): "SP2", ("Bundesliga", "GER"): "D1", ("2. Bundesliga", "GER"): "D2",
               ("Serie A", "ITA"): "I1", ("Serie B", "ITA"): "I2", ("Ligue 1", "FRA"): "F1", ("Ligue 2", "FRA"): "F2",
               ("Liga Portugal", "POR"): "P1", ("Eredivisie", "NED"): "N1"}
FIRST_DIVISION = {country: division for (_, country), division in DIVISION_OF.items() if division in ("E0", "SP1", "D1", "I1", "F1", "P1", "N1")}
API_LEAGUES = {league: FIRST_DIVISION[country] for league, country in models.EUROPE_LEAGUES.items()}
SYNTHETIC_MODEL = {"home": (0.26, 0.93), "away": (0.02, 0.91), "rho": -0.03}


class Rejected(Exception):
    def __init__(self, reason, detail):
        super().__init__(f"{reason}: {detail}")
        self.reason = reason


class ReadFailed(Exception):
    pass


LINEUPS = object()  # a kick-off point that starts from the forecast read again with the line-ups


# ---------------------------------------------------------------------------------------------------------- the input


def _chances(value, where):
    """Three chances, each in ]0, 1[, within TOLERANCE of 1, divided by their sum."""
    if not isinstance(value, dict):
        raise Rejected("probability", f"{where}: no chances")
    trio = [value.get(side) for side in ("home", "draw", "away")]
    if not all(isinstance(p, (int, float)) and not isinstance(p, bool) and isfinite(p) and 0 < p < 1 for p in trio):
        raise Rejected("probability", f"{where}: a chance outside ]0, 1[")
    total = sum(trio)
    if abs(total - 1) > TOLERANCE:
        raise Rejected("probability", f"{where}: the three chances add up to {total:.4f}")
    return [p / total for p in trio]


def validate(data):
    """The matches of an input, checked: [{match, date, competition, actual (0 home, 1 draw, 2 away), goals, p,
    rates (home, away, rho) or None, market or None, market_over or None}]. Raises Rejected."""
    if not isinstance(data, dict) or data.get("schema") != SCHEMA:
        raise Rejected("schema", f"not a {SCHEMA}")
    provenance = data.get("provenance")
    if not isinstance(provenance, dict) or provenance.get("kind") not in KINDS or not isinstance(data.get("matches"), list):
        raise Rejected("schema", "a provenance of a known kind and a list of matches are needed")
    out, seen = [], set()
    for item in data["matches"]:
        if not isinstance(item, dict) or not isinstance(item.get("match"), str) or not item["match"]:
            raise Rejected("schema", "a match without a key")
        key = item["match"]
        if key in seen:
            raise Rejected("duplicate", key)
        seen.add(key)
        try:
            day = date.fromisoformat(item.get("date"))
        except (TypeError, ValueError):
            raise Rejected("date", f"{key}: {item.get('date')!r}") from None
        score = (item.get("home_goals"), item.get("away_goals"))
        if not all(isinstance(g, int) and not isinstance(g, bool) and 0 <= g <= 30 for g in score):
            raise Rejected("score", f"{key}: {score!r}")
        chances = item.get("forecast")
        p = _chances(chances, key)
        rates = tuple(chances.get(name) for name in ("home_goals", "away_goals", "rho"))
        if any(v is None for v in rates):
            rates = None
        elif not (all(isinstance(v, (int, float)) and isfinite(v) for v in rates) and rates[0] > 0 and rates[1] > 0):
            raise Rejected("probability", f"{key}: expected goals that are no rates")
        market = item.get("market")
        over = market.get("over25") if isinstance(market, dict) else None
        if over is not None and not (isinstance(over, (int, float)) and 0 < over < 1):
            raise Rejected("probability", f"{key}: the market's chance of more than 2.5 goals")
        out.append({"match": key, "date": day, "competition": str(item.get("competition") or ""), "goals": score[0] + score[1],
                    "actual": 0 if score[0] > score[1] else 1 if score[0] == score[1] else 2, "p": p, "rates": rates,
                    "market": _chances(market, f"{key} (market)") if market is not None else None, "market_over": over})
    if not out:
        raise Rejected("partition", "no match to judge")
    return out


def synthetic(seed, count=4000):
    """A made-up input: scores drawn from a known law, which is the forecast; three matches in four have a « market »,
    the same law reading a quarter of the gap between the two strengths."""
    rng = random.Random(seed)
    rho = SYNTHETIC_MODEL["rho"]
    matches = []
    for k in range(count):
        home, away = rng.gauss(1600, 120), rng.gauss(1600, 120)
        lh, la = forecast.rates(SYNTHETIC_MODEL, home, away)
        grid = forecast.score_grid(lh, la, rho)
        draw, left = rng.random(), None
        for i, row in enumerate(grid):
            for j, share in enumerate(row):
                draw -= share
                if draw < 0 and left is None:
                    left = (i, j)
        score = left or (0, 0)
        win, level, loss = forecast.outcome(grid)
        item = {"match": f"s{k:05d}", "date": (date(2025, 8, 1) + timedelta(days=k // 12)).isoformat(), "competition": f"Synthetic {'AB'[k % 2]}",
                "home_goals": score[0], "away_goals": score[1],
                "forecast": {"home": round(win, 6), "draw": round(level, 6), "away": round(loss, 6), "home_goals": round(lh, 6), "away_goals": round(la, 6), "rho": rho}}
        if k % 4:
            blurred = forecast.score_grid(*forecast.rates(SYNTHETIC_MODEL, 1600 + (home - 1600) / 4, 1600 + (away - 1600) / 4), rho)
            w, d, l = forecast.outcome(blurred)
            item["market"] = {"home": round(w, 6), "draw": round(d, 6), "away": round(l, 6), "over25": round(_over(blurred), 6)}
        matches.append(item)
    return {"schema": SCHEMA,
            "provenance": {"kind": "synthetic", "seed": seed, "generated_by": "backend/tools/evaluate_forecast.py synthetic",
                           "description": "Scores drawn from a fixed law that is also the forecast; the « market » is that law blurred. Not real data."},
            "matches": matches}


# --------------------------------------------------------------------------------------------------------- the report


def _over(grid):
    return sum(share for i, row in enumerate(grid) for j, share in enumerate(row) if i + j >= 3)


def _loss(p, actual):
    return -log(max(p[actual], 1e-12))


def _brier(p, actual):
    return sum((p[k] - (1.0 if k == actual else 0.0)) ** 2 for k in range(3))


def _binary(p, happened):
    return -log(max(1e-12, p if happened else 1 - p))


def _mean(values):
    values = list(values)
    return round(sum(values) / len(values), 6)


def _scores(rows, key):
    return {"log_loss": _mean(_loss(r[key], r["actual"]) for r in rows), "brier": _mean(_brier(r[key], r["actual"]) for r in rows)}


def _interval(differences):
    """The mean of the differences and its bootstrap 95 % interval over matches, from a fixed seed."""
    rng, n = random.Random(SEED), len(differences)
    means = sorted(sum(differences[rng.randrange(n)] for _ in range(n)) / n for _ in range(RESAMPLES))
    return {"log_loss": _mean(differences), "low": round(means[int(RESAMPLES * 0.025)], 6), "high": round(means[int(RESAMPLES * 0.975) - 1], 6),
            "resamples": RESAMPLES, "seed": SEED}


def _buckets(rows, edges, value):
    """The rows by a value's bands [low, high[ (the last one closed), the empty ones left out."""
    for low, high in zip(edges, edges[1:]):
        last = high == edges[-1]
        yield low, high, [r for r in rows if low <= value(r) < high or (last and value(r) == high)]


def report(data):
    rows = validate(data)
    n = len(rows)
    rate = [sum(1 for r in rows if r["actual"] == k) / n for k in range(3)]
    favourite = lambda r, key="p": 0 if r[key][0] >= r[key][2] else 2  # noqa: E731
    out = {
        "schema": REPORT,
        "provenance": data["provenance"],
        "real_performance": data["provenance"]["kind"] != "synthetic",
        "matches": n,
        "from": min(r["date"] for r in rows).isoformat(),
        "to": max(r["date"] for r in rows).isoformat(),
        "outcomes": {"home": round(rate[0], 6), "draw": round(rate[1], 6), "away": round(rate[2], 6)},
        "forecast": _scores(rows, "p"),
        # The frequencies of the matches judged themselves: the best a forecast that tells no match apart can do.
        "base_rate": {"log_loss": round(-sum(q * log(q) for q in rate if q), 6), "brier": round(1 - sum(q * q for q in rate), 6)},
        "calibration": {
            "favourite": [{"from": low, "to": high, "matches": len(part), "forecast": _mean(r["p"][favourite(r)] for r in part),
                           "won": _mean(float(r["actual"] == favourite(r)) for r in part)}
                          for low, high, part in _buckets(rows, FAVOURITE, lambda r: r["p"][favourite(r)]) if part],
            "draw": [{"from": low, "to": high, "matches": len(part), "forecast": _mean(r["p"][1] for r in part), "played": _mean(float(r["actual"] == 1) for r in part)}
                     for low, high, part in _buckets(rows, DRAW, lambda r: r["p"][1]) if part],
        },
    }
    priced = [r for r in rows if r["market"]]
    competitions = {}
    for r in rows:
        competitions.setdefault(r["competition"], []).append(r)
    out["by_competition"] = []
    for name in sorted(competitions):
        part = competitions[name]
        with_market = [r for r in part if r["market"]]
        entry = {"competition": name, "matches": len(part), "forecast": _scores(part, "p")}
        if with_market:
            entry["market"] = {"matches": len(with_market), "forecast": _scores(with_market, "p"), "market": _scores(with_market, "market")}
        out["by_competition"].append(entry)
    if priced:
        out["market"] = {
            "matches": len(priced),
            "forecast": _scores(priced, "p"),
            "market": _scores(priced, "market"),
            "difference": _interval([_loss(r["p"], r["actual"]) - _loss(r["market"], r["actual"]) for r in priced]),
            "draws": [{"from": low, "to": high, "matches": len(part), "forecast": _mean(r["p"][1] for r in part), "market": _mean(r["market"][1] for r in part),
                       "played": _mean(float(r["actual"] == 1) for r in part)}
                      for low, high, part in _buckets(priced, DRAW, lambda r: r["market"][1]) if part],
            "disagreement": [{"from": low, "to": high, "matches": len(part), "forecast": _scores(part, "p")["log_loss"], "market": _scores(part, "market")["log_loss"]}
                             for low, high, part in _buckets(priced, DISAGREEMENT, lambda r: abs(r["p"][0] - r["market"][0])) if part],
        }
    scored = [(r, _over(forecast.score_grid(*r["rates"]))) for r in rows if r["rates"]]
    if scored:
        played = sum(1 for r, _ in scored if r["goals"] >= 3) / len(scored)
        out["over25"] = {
            "matches": len(scored),
            "played": round(played, 6),
            "forecast": {"mean": _mean(p for _, p in scored), "log_loss": _mean(_binary(p, r["goals"] >= 3) for r, p in scored)},
            "base_rate": {"log_loss": round(-sum(q * log(q) for q in (played, 1 - played) if q), 6)},
        }
        both = [(r, p) for r, p in scored if r["market_over"] is not None]
        if both:
            out["over25"]["market"] = {"matches": len(both), "mean": _mean(r["market_over"] for r, _ in both),
                                       "forecast": _mean(_binary(p, r["goals"] >= 3) for r, p in both),
                                       "market": _mean(_binary(r["market_over"], r["goals"] >= 3) for r, _ in both)}
    out["sha256"] = hashlib.sha256(canonical(out)).hexdigest()
    return out


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


# ------------------------------------------------------------------------------------------------- the bookmakers' file


def _row_day(value):
    for pattern in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime((value or "").strip(), pattern).date()
        except ValueError:
            continue
    return None


def add_odds(data, files):
    """The input with the closing average of the rows that name one of its matches. `files`: [(name, bytes)]."""
    validate(data)
    source, prices = [], {}
    for name, body in files:
        for number, row in enumerate(csv.DictReader(io.StringIO(footballdata._text(body))), 2):
            row = {(k or "").strip(): v for k, v in row.items()}
            home, away, day = (row.get("HomeTeam") or "").strip(), (row.get("AwayTeam") or "").strip(), _row_day(row.get("Date"))
            goals = [(row.get(c) or "").strip() for c in ("FTHG", "FTAG")]
            if not (home and away and day and all(g.isdigit() for g in goals)):
                continue  # an empty line, a match not played
            key = (name, number)
            source.append((key, 0, (row.get("Div") or "").strip(), day, home, away, int(goals[0]), int(goals[1])))
            prices[key] = (footballdata._prices(row, "AvgC"), footballdata._price(row.get("AvgC>2.5")), footballdata._price(row.get("AvgC<2.5")))
    base = [(m["match"], 0, m["division"], date.fromisoformat(m["date"]), m["home"], m["away"], m["home_goals"], m["away_goals"])
            for m in data["matches"] if m.get("division") and m.get("home") and m.get("away")]
    links = footballdata.pair(source, base)
    markets = {}
    for key, match in links.items():
        trio, over, under = prices[key]
        if all(trio):
            inverse = [1 / price for price in trio]
            markets[match] = {"home": inverse[0] / sum(inverse), "draw": inverse[1] / sum(inverse), "away": inverse[2] / sum(inverse)}
            if over and under:
                markets[match]["over25"] = (1 / over) / (1 / over + 1 / under)
    # A match these files do not name keeps the price an earlier run gave it.
    matches = [{**m, "market": markets[m["match"]]} if m["match"] in markets else m for m in data["matches"]]
    earlier = data["provenance"].get("odds") or {}
    provenance = {**data["provenance"],
                  "odds": {"rows": earlier.get("rows", 0) + len(source), "linked": earlier.get("linked", 0) + len(links),
                           "unlinked": earlier.get("unlinked", 0) + len(source) - len(links), "priced": sum(1 for m in matches if "market" in m)},
                  "odds_columns": "AvgCH, AvgCD, AvgCA (closing average, margin taken out), AvgC>2.5, AvgC<2.5",
                  "odds_files": [*(data["provenance"].get("odds_files") or []),
                                 *({"name": Path(name).name, "sha256": hashlib.sha256(body).hexdigest()} for name, body in files)]}
    return {"schema": SCHEMA, "provenance": provenance, "matches": matches}


# ------------------------------------------------------------------------------------------------------ the public API


def http_get(base):
    def get(path):
        for attempt in range(3):
            request = urllib.request.Request(base.rstrip("/") + path, headers={"User-Agent": "vega-evaluate-forecast/1", "Accept": "application/json"})
            try:
                with urllib.request.urlopen(request, timeout=45) as answer:
                    return answer.status, json.load(answer)
            except urllib.error.HTTPError as error:
                if error.code < 500 and error.code != 429:
                    return error.code, None
            except (urllib.error.URLError, TimeoutError, ValueError):
                pass
            time.sleep(2 + 3 * attempt)
        return 0, None

    return get


def from_api(get, leagues, start, end, workers=1):
    """The played matches of `leagues` ({league id: division}) between two days, each with its kick-off point.
    `get(path)` answers (status, body). A match without a point is counted missing, one whose point starts from the
    line-up forecast is counted apart; neither is judged. Any other answer raises ReadFailed."""
    fixtures = []
    for league, division in leagues.items():
        cursor = None
        while True:
            query = {"league": league, "status": "played", "from": start, "to": end, "limit": "100", **({"cursor": cursor} if cursor else {})}
            status, body = get("/api/fixtures?" + urlencode(query))
            page = body.get("data", {}).get("matches") if status == 200 and isinstance(body, dict) and isinstance(body.get("data"), dict) else None
            if not isinstance(page, list):
                raise ReadFailed(f"/api/fixtures of {league}: {status}")
            fixtures += [(m, division) for m in page if isinstance(m.get("score_home"), int) and isinstance(m.get("score_away"), int)]
            cursor = (body.get("pagination") or {}).get("nextCursor")
            if not cursor:
                break

    def point(fixture):
        match, division = fixture
        status, body = get("/api/forecasts/live?" + urlencode({"match": match["id"]}))
        if status == 404:
            return None
        if status != 200 or not isinstance(body, dict):
            raise ReadFailed(f"/api/forecasts/live of {match['id']}: {status}")
        if body.get("lineups"):
            return LINEUPS
        try:
            first, rates = body["points"][0], body["rates"]
            if first["minute"] != 0:
                raise KeyError("minute")
            chances = {"home": first["home"], "draw": first["draw"], "away": first["away"],
                       "home_goals": rates["home"], "away_goals": rates["away"], "rho": body["rho"]}
            return {"match": match["id"], "date": match["date"], "competition": match["league"]["name"], "division": division,
                    "home": match["home_team"]["name"], "away": match["away_team"]["name"], "home_goals": match["score_home"],
                    "away_goals": match["score_away"], "forecast": chances}
        except (KeyError, IndexError, TypeError) as error:
            raise ReadFailed(f"/api/forecasts/live of {match['id']}: an answer of another shape ({error!r})") from None

    if workers > 1:
        with ThreadPoolExecutor(workers) as pool:
            points = list(pool.map(point, fixtures))
    else:
        points = [point(f) for f in fixtures]
    matches = [p for p in points if p and p is not LINEUPS]
    return {"schema": SCHEMA,
            "provenance": {"kind": "kickoff-point", "generated_by": "backend/tools/evaluate_forecast.py from-api", "from": start, "to": end, "leagues": leagues,
                           "api": {"played": len(fixtures), "missing": sum(1 for p in points if p is None), "with_lineups": sum(1 for p in points if p is LINEUPS)},
                           "description": "Each played match's kick-off point of /api/forecasts/live: the forecast rebuilt from the two strengths before the "
                                          "match with the coefficients in service at the reading. No form; coefficients fitted on a base that holds these "
                                          "matches. Left out: the matches whose point starts from the line-up forecast (with_lineups), and those without a "
                                          "point, whose goal events do not give their score (missing)."},
            "matches": matches}


# ----------------------------------------------------------------------------------------------------------- the base

# The forecasts kept (185) of the matches played since, with what judges them (api.match_forecast_log).
LOG_ROWS = """
SELECT match_id AS match, kickoff_at AS kickoff, computed_at, competition, country_code AS country, home_name AS home, away_name AS away,
  home_score AS home_goals, away_score AS away_goals, home_win, draw, away_win, home_goals AS expected_home, away_goals AS expected_away, rho, model_version
FROM api.match_forecast_log
WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
ORDER BY kickoff_at, match_key"""
# The matches the model is fitted on (forecast.FITTED's joins and filters), each with its day, its competition and its
# two sides: what a backtest needs.
OBSERVED = """
SELECT m.id::text AS match, (coalesce(m.kickoff_at, m.match_date::timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::date AS date,
  c.name AS competition, c.country_code AS country, th.name AS home, ta.name AS away, m.home_team_id AS home_id, m.away_team_id AS away_id,
  eh.elo_before::float8 AS elo_home, ea.elo_before::float8 AS elo_away, coalesce(m.is_neutral, false) AS neutral,
  coalesce(m.home_score_90, m.home_score)::int AS home_goals, coalesce(m.away_score_90, m.away_score)::int AS away_goals,
  sh.xg::float8 AS home_xg, sa.xg::float8 AS away_xg
FROM core.matches m
JOIN agg.team_elo eh ON eh.match_id = m.id AND eh.team_id = m.home_team_id
JOIN agg.team_elo ea ON ea.match_id = m.id AND ea.team_id = m.away_team_id
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
JOIN core.competitions c ON c.id = cs.competition_id
JOIN core.teams th ON th.id = m.home_team_id AND th.is_national IS NOT TRUE
JOIN core.teams ta ON ta.id = m.away_team_id
LEFT JOIN core.team_match_stats sh ON sh.season_id = m.season_id AND sh.match_id = m.id AND sh.team_id = m.home_team_id AND sh.period = 'all'
LEFT JOIN core.team_match_stats sa ON sa.season_id = m.season_id AND sa.match_id = m.id AND sa.team_id = m.away_team_id AND sa.period = 'all'
WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
ORDER BY coalesce(m.kickoff_at, m.match_date::timestamp AT TIME ZONE 'UTC') NULLS FIRST, m.id"""


def _dicts(cursor):
    names = [column.name for column in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def _rows(conn, query):
    try:
        return _dicts(conn.execute(query))
    except Exception as error:  # psycopg's errors, without importing it where no base is read
        if type(error).__module__.split(".")[0] != "psycopg":
            raise
        raise ReadFailed(f"the base refused the read: {type(error).__name__}") from None


def log_rows(conn):
    return _rows(conn, LOG_ROWS)


def observed_rows(conn):
    """The fitted matches that have a day, in kick-off order, their day as text and football-data's division."""
    rows = [r for r in _rows(conn, OBSERVED) if r["date"] is not None]
    for r in rows:
        r["date"], r["division"] = r["date"].isoformat(), DIVISION_OF.get((r["competition"], r.pop("country")))
    return rows


def from_log(rows):
    """The input of the kept forecasts (log_rows). A row not written before the match was played, or more than
    MAX_LEAD before it (a postponed match never forecast again), is stale: left out and counted."""
    matches = []
    for r in rows:
        if r["kickoff"] is None or not timedelta(0) < r["kickoff"] - r["computed_at"] <= MAX_LEAD:
            continue
        matches.append({"match": r["match"], "date": r["kickoff"].astimezone(timezone.utc).date().isoformat(), "competition": r["competition"],
                        "division": DIVISION_OF.get((r["competition"], r["country"])), "home": r["home"], "away": r["away"],
                        "home_goals": r["home_goals"], "away_goals": r["away_goals"], "computed_at": r["computed_at"].isoformat(), "model_version": r["model_version"],
                        "forecast": {"home": r["home_win"], "draw": r["draw"], "away": r["away_win"], "home_goals": r["expected_home"], "away_goals": r["expected_away"],
                                     "rho": r["rho"]}})
    return {"schema": SCHEMA,
            "provenance": {"kind": "log", "generated_by": "backend/tools/evaluate_forecast.py from-log",
                           "log": {"rows": len(rows), "judged": len(matches), "stale": len(rows) - len(matches)},
                           "description": "The last forecast written before each kick-off (agg.match_forecast_log), form included, before the line-ups: what was published."},
            "matches": matches}


def backtest(rows, cutoff, form=True):
    """The input of a backtest. `rows` (observed_rows) in kick-off order; the model and the form's coefficients are
    fitted on the matches strictly before `cutoff`, the matches from it are forecast."""
    rows = sorted(rows, key=lambda r: r["date"])  # stable: the kick-off order within a day stays
    before = [r for r in rows if r["date"] < cutoff]
    if len(before) < forecast.MIN_FIT or len(before) == len(rows):
        raise Rejected("partition", f"{len(before)} matches before {cutoff}, {len(rows) - len(before)} from it")
    model = forecast.fit([(r["elo_home"], r["elo_away"], r["neutral"], r["home_goals"], r["away_goals"]) for r in before])
    side = lambda r, name: r.get(name + "_id", r[name])  # noqa: E731
    forms, _ = forecast.with_forms([(side(r, "home"), side(r, "away"), r["home_goals"], r["away_goals"], r["home_xg"], r["away_xg"]) for r in rows])
    weights, cases = (0.0, 0.0), []
    if form:
        cases = [(forecast.delta(r["elo_home"], r["elo_away"], r["neutral"]), h[0] - a[0], h[1] - a[1], r["home_goals"], r["away_goals"])
                 for r, (h, a) in zip(rows, forms) if r["date"] < cutoff and h and a]
        weights = forecast.fit_form(cases, model)
    matches = []
    for r, (h, a) in zip(rows, forms):
        if r["date"] < cutoff:
            continue
        f = forecast.forecast(model, r["elo_home"] + forecast.form_shift(weights, h), r["elo_away"] + forecast.form_shift(weights, a), r["neutral"])
        matches.append({"match": r["match"], "date": r["date"], "competition": r["competition"], "division": r.get("division"), "home": r["home"], "away": r["away"],
                        "home_goals": r["home_goals"], "away_goals": r["away_goals"],
                        "forecast": {"home": f["home"], "draw": f["draw"], "away": f["away"], "home_goals": f["home_goals"], "away_goals": f["away_goals"], "rho": model["rho"]}})
    return {"schema": SCHEMA,
            "provenance": {"kind": "backtest", "generated_by": "backend/tools/evaluate_forecast.py backtest", "cutoff": cutoff,
                           "fit": {"matches": len(before), "home": list(model["home"]), "away": list(model["away"]), "rho": model["rho"],
                                   "form": list(weights) if form else None, "form_matches": len(cases)},
                           "description": "Model fitted strictly before the cutoff, each later match forecast from its two strengths before it"
                                          + (" and both sides' form." if form else ", without the form.")
                                          + " The strengths' starting levels are those of the whole history."},
            "matches": matches}


# ------------------------------------------------------------------------------------------------------- the commands


def _connect():
    dsn = os.environ.get("VEGA_EVALUATE_DSN")
    if not dsn:
        raise ReadFailed("VEGA_EVALUATE_DSN is not set")
    try:
        import psycopg
    except ImportError:
        raise ReadFailed("psycopg is not installed") from None
    try:
        return psycopg.connect(dsn, autocommit=True)
    except psycopg.Error as error:
        raise ReadFailed(f"the base refused the connection: {type(error).__name__}") from None


def _read(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError) as error:
        raise Rejected("schema", f"{path}: {error}") from None


def _write(path, data):
    Path(path).write_text(json.dumps(data, sort_keys=True) + "\n")


def _league(text):
    league, _, division = text.partition("=")
    if not league or not division:
        raise argparse.ArgumentTypeError("a league is written ID=DIVISION, as l_3FJFUl=F1")
    return league, division


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    one = commands.add_parser("synthetic")
    one.add_argument("--seed", type=int, required=True)
    one.add_argument("--write-input", required=True)
    one = commands.add_parser("report")
    one.add_argument("--input", required=True)
    one.add_argument("--output", required=True)
    one = commands.add_parser("add-odds")
    one.add_argument("--input", required=True)
    one.add_argument("--odds", nargs="+", required=True)
    one.add_argument("--write-input", required=True)
    one = commands.add_parser("from-api")
    one.add_argument("--base", required=True)
    one.add_argument("--from", dest="start", type=date.fromisoformat, required=True)
    one.add_argument("--to", dest="end", type=date.fromisoformat, required=True)
    one.add_argument("--league", type=_league, action="append")
    one.add_argument("--workers", type=int, default=3)
    one.add_argument("--write-input", required=True)
    one = commands.add_parser("from-log")
    one.add_argument("--write-input", required=True)
    one = commands.add_parser("backtest")
    one.add_argument("--cutoff", type=date.fromisoformat, required=True)
    one.add_argument("--no-form", action="store_true")
    one.add_argument("--observed")
    one.add_argument("--write-observed")
    one.add_argument("--write-input", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "synthetic":
            _write(args.write_input, synthetic(args.seed))
        elif args.command == "report":
            result = report(_read(args.input))
            Path(args.output).write_bytes(canonical(result) + b"\n")
            print(f"matches={result['matches']} log_loss={result['forecast']['log_loss']} base_rate={result['base_rate']['log_loss']}"
                  + (f" market={result['market']['market']['log_loss']} on {result['market']['matches']}" if "market" in result else ""))
        elif args.command == "add-odds":
            result = add_odds(_read(args.input), [(name, Path(name).read_bytes()) for name in args.odds])
            _write(args.write_input, result)
            print(" ".join(f"{k}={v}" for k, v in result["provenance"]["odds"].items()))
        elif args.command == "from-api":
            result = from_api(http_get(args.base), dict(args.league) if args.league else API_LEAGUES, args.start.isoformat(), args.end.isoformat(), args.workers)
            _write(args.write_input, result)
            print(" ".join(f"{k}={v}" for k, v in result["provenance"]["api"].items()))
        elif args.command == "from-log":
            with _connect() as conn:
                result = from_log(log_rows(conn))
            _write(args.write_input, result)
            print(" ".join(f"{k}={v}" for k, v in result["provenance"]["log"].items()))
        else:
            if args.observed:
                rows = _read(args.observed)
            else:
                with _connect() as conn:
                    rows = observed_rows(conn)
            if args.write_observed:
                _write(args.write_observed, rows)
            result = backtest(rows, args.cutoff.isoformat(), form=not args.no_form)
            _write(args.write_input, result)
            print(f"fitted={result['provenance']['fit']['matches']} forecast={len(result['matches'])}")
    except Rejected as error:
        print(error, file=sys.stderr)
        return 2
    except ReadFailed as error:
        print(f"read failed: {error}", file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
