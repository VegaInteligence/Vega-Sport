"""The league replays of FAILURE_MODES.md § 73 on a real league: the Premier League of 26 November 2026.

Rerun, from the repository root, with the worker's libraries (backend/requirements.txt):
    python backend/verification/league-replays-20261126/run.py

inputs.json holds what was read from the public API that morning (the table, the 270 matches left, each club's Elo,
the published projection of 1,000 replays) and the model: its four coefficients are not served, they were recovered by
a regression on the expected goals of 40 published forecasts (largest gap 0.005 goal).
"""

import json
from pathlib import Path
import statistics
import sys
import time

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
from vega import forecast

data = json.loads((HERE / "inputs.json").read_text(encoding="utf-8"))
clubs = data["clubs"]
name = {t: c["name"] for t, c in clubs.items()}
table = {t: tuple(c["table"]) for t, c in clubs.items()}
strengths = {t: c["elo"] for t, c in clubs.items()}
fixtures = [tuple(f) for f in data["fixtures"]]
model = data["model"]
teams = sorted(table)
index = {t: i for i, t in enumerate(teams)}


def reference(table, fixtures, replays, seed):
    """The same law by other means: one stream, numpy's own Poisson draws. [club][place] shares, mean points."""
    rng = np.random.default_rng(seed)
    base = np.array([table[t] for t in teams], float)
    left = np.zeros(len(teams))
    for h, a in fixtures:
        left[index[h]] += 1
        left[index[a]] += 1
    now = np.array([strengths[t] for t in teams]) + rng.standard_normal((replays, len(teams))) * forecast.STRENGTH_SPREAD * np.sqrt(left / (left + base[:, 3]))
    points, scored, conceded = (np.tile(base[:, k], (replays, 1)) for k in range(3))
    (ah, bh), (aa, ba) = model["home"], model["away"]
    for home, away in fixtures:
        h, a = index[home], index[away]
        d = (now[:, h] + forecast.ELO_HOME - now[:, a]) / 400
        hs, as_ = rng.poisson(np.exp(ah + bh * d)), rng.poisson(np.exp(aa - ba * d))
        scored[:, h] += hs; conceded[:, h] += as_; scored[:, a] += as_; conceded[:, a] += hs
        points[:, h] += 3 * (hs > as_) + (hs == as_); points[:, a] += 3 * (as_ > hs) + (hs == as_)
    order = np.lexsort((rng.random((replays, len(teams))), -scored, conceded - scored, -points), axis=1)
    return np.column_stack([np.bincount(order[:, p], minlength=len(teams)) for p in range(len(teams))]) / replays, points.mean(0)


def shares(positions):
    return positions[0], sum(positions[:4]), sum(positions[-3:])


checks = []


def check(label, ok, detail):
    checks.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {label}: {detail}")


print(f"numpy {np.__version__}; replays by default {forecast.SIMULATIONS}; {len(teams)} clubs, {len(fixtures)} matches left\n")

# 1. The projection against 300,000 replays of the same law drawn another way.
start = time.perf_counter()
live = forecast.simulate(table, fixtures, model, strengths, seed=1)
elapsed = time.perf_counter() - start
ref, ref_points = reference(table, fixtures, 300_000, 7)
print(f"{'club':26}{'title':>7}{'ref':>7}{'top 4':>8}{'ref':>7}{'last 3':>8}{'ref':>7}{'points':>8}{'ref':>7}   published (1,000 replays): title, top 4, last 3")
worst = 0.0
for t in sorted(teams, key=lambda t: -ref_points[index[t]]):
    mine, theirs = shares(live[t]["positions"]), shares(ref[index[t]].tolist())
    worst = max(worst, *(abs(m - r) for m, r in zip(mine, theirs)))
    p = data["published"][t]
    print(f"{name[t][:25]:26}" + "".join(f"{m * 100:{w}.1f}{r * 100:7.1f}" for m, r, w in zip(mine, theirs, (7, 8, 8)))
          + f"{live[t]['points']:8.1f}{ref_points[index[t]]:7.1f}   {p['title'] * 100:5.1f} {p['top4'] * 100:5.1f} {p['bottom3'] * 100:5.1f}")
print()
check("every share within 1.5 point of the reference", worst < 0.015, f"largest gap {worst * 100:.2f} point")
check("a 20-club league replayed 10,000 times in under 3 s", elapsed < 3, f"{elapsed:.2f} s")

# 2. What the replays alone move: the same league under 60 other seeds.
leader = max(teams, key=lambda t: ref[index[t], 0])
fourth = min(teams, key=lambda t: abs(ref[index[t], :4].sum() - 0.5))
runs = [forecast.simulate(table, fixtures, model, strengths, seed=seed) for seed in range(100, 160)]
for club, pick, label in ((leader, lambda p: p[0], "title"), (fourth, lambda p: sum(p[:4]), "top 4")):
    values = [pick(r[club]["positions"]) * 100 for r in runs]
    check(f"{name[club]}'s {label} over 60 seeds", statistics.pstdev(values) < 0.6,
          f"{min(values):.1f} to {max(values):.1f} %, standard deviation {statistics.pstdev(values):.2f} point (1.4 and 1.6 with 1,000 replays)")

# 3. One match played between two mid-table clubs: what moves for the others.
order = sorted(teams, key=lambda t: -ref_points[index[t]])
match = next(f for f in fixtures if set(f) <= set(order[9:13]))
after = dict(table)
for t in match:
    points, scored, conceded, played = after[t]
    after[t] = (points + 1, scored + 1, conceded + 1, played + 1)
rest = [f for f in fixtures if f != match]
ref_after, _ = reference(after, rest, 300_000, 11)
before, then = forecast.simulate(table, fixtures, model, strengths, seed=1), forecast.simulate(after, rest, model, strengths, seed=1)
others = [t for t in teams if t not in match]
moves = [abs(sum(before[t]["positions"][:4]) - sum(then[t]["positions"][:4])) * 100 for t in others]
true = [abs(ref[index[t], :4].sum() - ref_after[index[t], :4].sum()) * 100 for t in others]
print(f"\n{name[match[0]]} 1-1 {name[match[1]]} is played. {name[leader]}'s title: {before[leader]['positions'][0] * 100:.1f} -> {then[leader]['positions'][0] * 100:.1f} %"
      f" (reference {ref[index[leader], 0] * 100:.1f} -> {ref_after[index[leader], 0] * 100:.1f}; 79.1 -> 76.7 with 1,000 replays on one stream)")
check("the leader's title moves by less than 0.5 point", abs(before[leader]["positions"][0] - then[leader]["positions"][0]) < 0.005, "see above")
check("the top-4 share of the 18 clubs that did not play moves by less than 0.3 point on average", statistics.mean(moves) < 0.3,
      f"mean {statistics.mean(moves):.2f}, largest {max(moves):.2f} point (reference: mean {statistics.mean(true):.2f}, largest {max(true):.2f}; 0.81 and 2.50 with 1,000 replays on one stream)")
print(f"\n{sum(checks)}/{len(checks)} checks passed")
sys.exit(0 if all(checks) else 1)
