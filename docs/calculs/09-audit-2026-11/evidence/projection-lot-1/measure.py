"""Season projection, lot 1 (#217): how long a league takes to replay and how far its published shares move when
an input changes that should not move them. Reads nothing but the code: a made-up league of 20 clubs at mid-season.

    python3 -I docs/calculs/09-audit-2026-11/evidence/projection-lot-1/measure.py <path to backend>

Run it on main's backend and on the branch's to compare (the output names the model version)."""
import random
import statistics
import sys
import time
from math import exp

sys.path.insert(0, sys.argv[1])
from vega import forecast  # noqa: E402

MODEL = {"home": (0.26, 0.93), "away": (0.32, 0.91), "rho": -0.03, "matches": 1000}  # the tests' model
rng = random.Random(7)
teams = list(range(20))
elo = {t: 1780 - 18 * t + rng.gauss(0, 25) for t in teams}
first = [(h, a) for h in teams for a in teams if h < a]
table = {t: [0, 0, 0, 0] for t in teams}
(ah, bh), (aa, ba) = MODEL["home"], MODEL["away"]
for h, a in first:  # the first half, played once
    d = (elo[h] + 60 - elo[a]) / 400
    hs, as_ = forecast._goals(rng, exp(ah + bh * d)), forecast._goals(rng, exp(aa - ba * d))
    for t, gf, ga in ((h, hs, as_), (a, as_, hs)):
        table[t][0] += 3 if gf > ga else 1 if gf == ga else 0
        table[t][1] += gf
        table[t][2] += ga
        table[t][3] += 1
table = {t: tuple(v) for t, v in table.items()}
fixtures = [(a, h) for h, a in first]
order = sorted(teams, key=lambda t: -table[t][0])
leader, second, sixteenth, last = order[0], order[1], order[15], order[-1]
SEEDS = 30


def shares(tbl, fx, strengths, seed, n=1000):
    p = forecast.simulate(tbl, fx, MODEL, strengths, simulations=n, seed=seed)
    return 100 * p[leader]["positions"][0], 100 * p[second]["positions"][0], 100 * sum(p[sixteenth]["positions"][-3:])


print(f"model version: {forecast.MODEL_VERSION}; python {sys.version.split()[0]}")
start = time.perf_counter()
runs = [shares(table, fixtures, elo, seed) for seed in range(SEEDS)]
print(f"duration: {(time.perf_counter() - start) / SEEDS:.3f} s for one league, 190 matches left, 1 000 replays (mean of {SEEDS})")
for k, name in enumerate(("title, leader", "title, 2nd", "last three, 16th")):
    v = [r[k] for r in runs]
    print(f"  {name:17s}: mean {statistics.mean(v):5.1f} %, from {min(v):5.1f} to {max(v):5.1f} over {SEEDS} seeds")


def moves(label, tbl, fx, strengths):
    out = [tuple(y - x for x, y in zip(shares(table, fixtures, elo, seed), shares(tbl, fx, strengths, seed))) for seed in range(SEEDS)]
    print(label)
    for k, name in enumerate(("title, leader", "title, 2nd", "last three, 16th")):
        v = [d[k] for d in out]
        print(f"  {name:17s}: from {min(v):+.1f} to {max(v):+.1f} points (standard deviation {statistics.pstdev(v):.2f})")


moves("the last club gains one Elo point, same seed:", table, fixtures, {**elo, last: elo[last] + 1.0})
h, a = order[9], order[10]
played = dict(table)
for t in (h, a):
    p, f, g, n = played[t]
    played[t] = (p + 1, f + 1, g + 1, n + 1)
moves("a match between the 10th and the 11th is played 1-1, same seed:", played, [fx for fx in fixtures if fx != (h, a)], elo)
