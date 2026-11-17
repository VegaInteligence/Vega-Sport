"""Evaluate Vega's xG fits on a dated, versioned, immutable input (VI-23 B9, calculation audit of
16 November 2026; docs/calculs/09-audit-2026-11/FAILURE_MODES.md §10.1).

Two commands:
  evaluate_xg.py --synthetic --seed N --write-input FILE
      writes a synthetic input in the schema below (shots drawn from a fixed model);
  evaluate_xg.py --input FILE --cutoff YYYY-MM-DD --output FILE [--iterations N]
      fits version 1's free model and version 2's constrained one (vega/xg.py) on the shots
      dated before the cutoff, and reads both on the shots dated on or after it. N caps the
      fits' Newton steps (vega/xg.py's default, 200, without it).

The input, schema vega-xg-evaluation-input/1, is a JSON object:
  {"schema": "vega-xg-evaluation-input/1",
   "provenance": {"kind": "synthetic" | "snapshot", "description": str, "generated_by": str,
                  "seed": int | null, "snapshot_sha256": 64 hex | null (null when synthetic),
                  "observation_times": bool},
   "shots": [{"match": str, "shot": str, "date": "YYYY-MM-DD", "x": 0..105, "y": 0..68,
              "body": right_foot | left_foot | header | other,
              "situation": regular_play | from_corner | set_piece | fast_break | free_kick |
                           throw_in_set_piece | individual_play | penalty,
              "outcome": goal | saved | miss | post, "own_goal": bool}, ...]}
x runs to the goal at 105, as core.shots does. An input that breaks the schema is rejected with
exit code 2, no report, and a message naming the reason: schema, date, duplicate (a (match,
shot) twice), conflict (one match with two dates), coordinate, body, situation, outcome, or
partition (the cutoff leaves the training or the test shots empty, or too few to fit).

The split is by date, train strictly before the cutoff and test from it; a match has one date,
so it lies in one partition. Own goals and penalties (their own rate) are counted apart.
The report is canonical JSON (sorted keys): the same input gives the same bytes, and its
sha256 is the hash of the report without that key. It says whether the comparison is
complete: `complete` and `status` (« ok »; « nonconverged » when a fit stopped before its
optimum; « invalid » when a converged fit is not finite or not feasible), and `failed_fits`. An
incomplete report keeps each fit's terminal-iterate metrics, where finite, as diagnostics, not as
fitted optima; it is written, and the tool exits 3 (FAILURE_MODES §10.2).

The input carries no time at which a shot became known: this is an event-time retrospective
evaluation, never a replay of what was known when. A synthetic input says nothing of real
predictive performance, which stays unavailable until a real snapshot is evaluated.
"""

import argparse
import hashlib
import json
import random
import sys
from datetime import date, timedelta
from math import atan2, floor, hypot, isfinite, log
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vega import xg  # noqa: E402

SCHEMA = "vega-xg-evaluation-input/1"
BODIES = ("right_foot", "left_foot", "header", "other")
SITUATIONS = ("regular_play", *xg.SITUATIONS, "penalty")
OUTCOMES = ("goal", "saved", "miss", "post")
FIELDS = {"match", "shot", "date", "x", "y", "body", "situation", "outcome", "own_goal"}
DISTANCE_BANDS = ((0, 6), (6, 12), (12, 18), (18, 25), (25, 35), (35, None))
# The synthetic shots' model: the documented validation coefficients of version 1
# (docs/calculs/02-metriques-attendues/05-xg-vega.md), whose chance rises again far out.
SYNTHETIC_TRUTH = [-1.375, 1.027, -0.167, 0.155, 1.467, 0.114, -0.177, -0.706, -0.414, 0.510, 0.608, -0.478, -0.377, -1.374]


class Rejected(Exception):
    def __init__(self, reason, detail):
        super().__init__(f"{reason}: {detail}")
        self.reason = reason


def geometry(x, y):
    """Distance to the goal's centre and the angle the goal fills, as the SQL reads them (xg._GEOMETRY)."""
    dx, dy = xg.PITCH_LENGTH - x, xg.PITCH_WIDTH / 2 - y
    angle = max(0.0, atan2(xg.GOAL_WIDTH * max(dx, 0.01), dx * dx + dy * dy - (xg.GOAL_WIDTH / 2) ** 2))
    return hypot(dx, dy), angle


# ------------------------------------------------------------------ synthetic input


def synthetic(seed):
    """A synthetic input: 2,000 matches from July 2024 to April 2025, about 24 shots each."""
    rng = random.Random(seed)
    start, days = date(2024, 7, 1), 303
    bodies = ["right_foot"] * 55 + ["left_foot"] * 27 + ["header"] * 16 + ["other"] * 2
    situations = (["regular_play"] * 62 + ["from_corner"] * 10 + ["set_piece"] * 6 + ["fast_break"] * 6
                  + ["free_kick"] * 5 + ["throw_in_set_piece"] * 3 + ["individual_play"] * 6)
    shots = []
    for m in range(2000):
        match = f"m{m:04d}"
        day = (start + timedelta(days=m * days // 2000)).isoformat()
        for k in range(18 + rng.randrange(14)):
            own_goal = rng.random() < 0.003
            if not own_goal and rng.random() < 0.015:
                body, situation, x, y = "right_foot", "penalty", 94.0, 34.0
                outcome = "goal" if rng.random() < 0.76 else rng.choice(("saved", "miss", "post"))
            else:
                body, situation = rng.choice(bodies), rng.choice(situations)
                reach = rng.gammavariate(2.0, 3.5) if body == "header" else rng.gammavariate(2.2, 7.0)
                x = round(max(0.0, xg.PITCH_LENGTH - min(60.0, max(0.5, reach))), 2)
                y = round(min(xg.PITCH_WIDTH, max(0.0, xg.PITCH_WIDTH / 2 + rng.gauss(0, 8))), 2)
                chance = xg.probability(SYNTHETIC_TRUTH, xg.features(situation, body, *geometry(x, y)))
                outcome = "goal" if own_goal or rng.random() < chance else rng.choice(("saved", "miss", "miss", "post"))
            shots.append({"match": match, "shot": f"{match}-{k:02d}", "date": day, "x": x, "y": y, "body": body,
                          "situation": situation, "outcome": outcome, "own_goal": own_goal})
    return {
        "schema": SCHEMA,
        "provenance": {
            "kind": "synthetic",
            "description": "Shots drawn from xG version 1's documented coefficients, a model that rises again far "
                           "from goal; positions, body parts and situations drawn at random. Not real data.",
            "generated_by": "backend/tools/evaluate_xg.py --synthetic",
            "seed": seed,
            "snapshot_sha256": None,
            "observation_times": False,
        },
        "shots": shots,
    }


# ------------------------------------------------------------------------ validation


def validate(data):
    """The input's shots, checked against the schema; raises Rejected."""
    if not isinstance(data, dict) or data.get("schema") != SCHEMA:
        raise Rejected("schema", f"the input's schema is not {SCHEMA}")
    provenance = data.get("provenance")
    if not isinstance(provenance, dict) or provenance.get("kind") not in ("synthetic", "snapshot") \
            or not isinstance(provenance.get("observation_times"), bool):
        raise Rejected("schema", "provenance needs kind (synthetic or snapshot) and observation_times")
    digest = provenance.get("snapshot_sha256")
    if provenance["kind"] == "synthetic" and digest is not None:
        raise Rejected("schema", "a synthetic input has no snapshot_sha256")
    if provenance["kind"] == "snapshot" and not (isinstance(digest, str) and len(digest) == 64
                                                 and all(c in "0123456789abcdef" for c in digest)):
        raise Rejected("schema", "a snapshot input names its snapshot_sha256")
    shots = data.get("shots")
    if not isinstance(shots, list) or not shots:
        raise Rejected("schema", "shots must be a non-empty list")
    seen, dates = set(), {}
    for index, shot in enumerate(shots):
        where = f"shot {index}"
        if not isinstance(shot, dict) or set(shot) != FIELDS:
            raise Rejected("schema", f"{where} must have exactly the fields {sorted(FIELDS)}")
        if not isinstance(shot["match"], str) or not isinstance(shot["shot"], str) or not shot["match"] or not shot["shot"]:
            raise Rejected("schema", f"{where}: match and shot are non-empty strings")
        try:
            if not isinstance(shot["date"], str) or len(shot["date"]) != 10:
                raise ValueError
            date.fromisoformat(shot["date"])
        except ValueError:
            raise Rejected("date", f"{where}: {shot['date']!r} is not a date YYYY-MM-DD") from None
        key = (shot["match"], shot["shot"])
        if key in seen:
            raise Rejected("duplicate", f"{where}: shot {key} appears twice")
        seen.add(key)
        if dates.setdefault(shot["match"], shot["date"]) != shot["date"]:
            raise Rejected("conflict", f"{where}: match {shot['match']} has two dates")
        for axis, top in (("x", xg.PITCH_LENGTH), ("y", xg.PITCH_WIDTH)):
            value = shot[axis]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= top:
                raise Rejected("coordinate", f"{where}: {axis} = {value!r} is outside [0, {top:g}]")
        for field, allowed in (("body", BODIES), ("situation", SITUATIONS), ("outcome", OUTCOMES)):
            if shot[field] not in allowed:
                raise Rejected(field, f"{where}: unknown {field} {shot[field]!r}")
        if not isinstance(shot["own_goal"], bool):
            raise Rejected("schema", f"{where}: own_goal is a boolean")
    return shots


# ------------------------------------------------------------------------ evaluation


def _round(value):
    return floor(value + 0.5)  # SQL's round() of a positive number


def binned(shots):
    """The fit's bins, as xg.BINS groups the base's shots: situation, body part, metre, twentieth of a radian."""
    groups = {}
    for s in shots:
        d, th = s["geometry"]
        key = (s["situation"], s["body"], _round(d), _round(th * 20))
        g = groups.setdefault(key, [0.0, 0.0, 0, 0])
        g[0] += d
        g[1] += th
        g[2] += 1
        g[3] += s["outcome"] == "goal"
    return [(k[0], k[1], g[0] / g[2], g[1] / g[2], g[2], g[3]) for k, g in sorted(groups.items())]


def _band(d):
    for lo, hi in DISTANCE_BANDS:
        if hi is None or d < hi:
            return f"{lo}-{hi}m" if hi is not None else f"{lo}m+"
    return None


def read(coefficients, shots):
    """Log loss, Brier score and calibration of a model on shots."""
    loss = brier = 0.0
    tables = {"distance": {}, "situation": {}}
    for s in shots:
        p = xg.probability(coefficients, xg.features(s["situation"], s["body"], *s["geometry"]))
        goal = 1.0 if s["outcome"] == "goal" else 0.0
        clipped = min(1 - 1e-12, max(1e-12, p))
        loss -= goal * log(clipped) + (1 - goal) * log(1 - clipped)
        brier += (p - goal) ** 2
        for table, key in (("distance", _band(s["geometry"][0])), ("situation", s["situation"])):
            cell = tables[table].setdefault(key, [0, 0, 0.0])
            cell[0] += 1
            cell[1] += int(goal)
            cell[2] += p
    order = {"distance": [_band(lo) for lo, _ in DISTANCE_BANDS], "situation": list(SITUATIONS)}
    calibration = {
        table: [{"key": key, "shots": cells[key][0], "goals": cells[key][1], "expected": cells[key][2],
                 "observed_rate": cells[key][1] / cells[key][0], "mean_xg": cells[key][2] / cells[key][0]}
                for key in order[table] if key in cells]
        for table, cells in tables.items()
    }
    return {"log_loss": loss / len(shots), "brier": brier / len(shots), "calibration": calibration}


def _partition(shots):
    dates = sorted({s["date"] for s in shots})
    return {"shots": len(shots), "matches": len({s["match"] for s in shots}),
            "first_date": dates[0] if dates else None, "last_date": dates[-1] if dates else None}


def _finite(value):
    """A metric kept in the report only when it is a finite number (json allows nothing else)."""
    return value if isinstance(value, float) and isfinite(value) else None


def _failure(name, coefficients, info):
    """Why a fit's result is no optimum, or None: « nonconverged » or « invalid »."""
    if not info["converged"]:
        return "nonconverged"
    objective = info["objective"]
    if objective is None or not isfinite(objective) or not all(isfinite(c) for c in coefficients):
        return "invalid"
    return "invalid" if name == "constrained" and xg.violations(coefficients) else None


def evaluate(raw, data, cutoff, iterations=None):
    shots = validate(data)
    excluded = {"own_goals": 0, "penalties": 0}
    kept = []
    for s in sorted(shots, key=lambda s: (s["date"], s["match"], s["shot"])):
        if s["own_goal"]:
            excluded["own_goals"] += 1
        elif s["situation"] == "penalty":
            excluded["penalties"] += 1
        else:
            kept.append(dict(s, geometry=geometry(float(s["x"]), float(s["y"]))))
    train = [s for s in kept if s["date"] < cutoff]
    test = [s for s in kept if s["date"] >= cutoff]
    if not train or not test:
        raise Rejected("partition", f"the cutoff {cutoff} leaves {len(train)} training and {len(test)} test shots")
    if len(train) < xg.MIN_FIT:
        raise Rejected("partition", f"the cutoff {cutoff} leaves {len(train)} training shots, fewer than the fit needs ({xg.MIN_FIT})")
    bins = binned(train)
    models, failures = {}, {}
    cap = {} if iterations is None else {"iterations": iterations}
    for name, constrained in (("unconstrained", False), ("constrained", True)):
        coefficients, info = xg.fit(bins, constrained=constrained, diagnostics=True, **cap)
        if coefficients is None:
            raise Rejected("partition", f"the training shots fit no {name} model ({info['reason']})")
        failure = _failure(name, coefficients, info)
        if failure:
            failures[name] = failure
        tested = read(coefficients, test)
        models[name] = {
            "version": "xg-v1 (free)" if not constrained else xg.MODEL_VERSION,
            "coefficients": {term: _finite(c) for term, c in zip(xg.TERMS, coefficients)},
            "fit": {"converged": info["converged"], "iterations": info["iterations"], "objective": _finite(info["objective"]),
                    "max_violation": _finite(info["max_violation"]), "held": info["held"]},
            "train_log_loss": _finite(read(coefficients, train)["log_loss"]),
            "log_loss": _finite(tested["log_loss"]),
            "brier": _finite(tested["brier"]),
            "calibration": tested["calibration"],
            "violations": xg.violations(coefficients),
        }
    provenance = data["provenance"]
    report = {
        "tool": "backend/tools/evaluate_xg.py",
        "input": {"sha256": hashlib.sha256(raw).hexdigest(), "schema": data["schema"], "provenance": provenance,
                  "shots": len(shots)},
        "split": {"cutoff": cutoff, "rule": "train: date < cutoff; test: date >= cutoff; one date per match",
                  "train": _partition(train), "test": _partition(test)},
        "excluded": excluded,
        "models": models,
        "evaluation": "event-time retrospective evaluation",
        "observation_times": provenance["observation_times"],
        "real_data": "unavailable" if provenance["kind"] == "synthetic" else f"snapshot {provenance['snapshot_sha256']}",
        "claims": "none: the constraints are a property of the model; no predictive improvement is claimed",
        "complete": not failures,
        "status": "ok" if not failures else "nonconverged" if "nonconverged" in failures.values() else "invalid",
        "failed_fits": sorted(failures),
    }
    if failures:
        report["claims"] = ("none: an incomplete comparison; the failed fits' metrics are terminal-iterate diagnostics, "
                            "not fitted optima, and no predictive improvement is claimed")
    body = json.dumps(report, sort_keys=True, separators=(",", ":"), allow_nan=False)
    report["sha256"] = hashlib.sha256(body.encode()).hexdigest()
    return json.dumps(report, sort_keys=True, indent=1, allow_nan=False) + "\n", failures


def _cap(text):
    value = int(text)
    if value < 0:
        raise argparse.ArgumentTypeError("the cap of Newton steps is a non-negative integer")
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--synthetic", action="store_true")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--write-input", type=Path)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--cutoff")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--iterations", type=_cap, help="the fits' cap of Newton steps (default: vega/xg.py's)")
    args = parser.parse_args(argv)
    if args.synthetic:
        if args.seed is None or args.write_input is None or args.input or args.cutoff or args.output or args.iterations is not None:
            parser.error("--synthetic takes --seed N and --write-input FILE only")
        args.write_input.write_text(json.dumps(synthetic(args.seed), sort_keys=True, separators=(",", ":")) + "\n")
        return 0
    if args.input is None or args.cutoff is None or args.output is None or args.seed is not None or args.write_input:
        parser.error("give --input FILE --cutoff YYYY-MM-DD --output FILE, or --synthetic --seed N --write-input FILE")
    try:
        try:
            if len(args.cutoff) != 10:
                raise ValueError
            date.fromisoformat(args.cutoff)
        except ValueError:
            raise Rejected("date", f"the cutoff {args.cutoff!r} is not a date YYYY-MM-DD") from None
        raw = args.input.read_bytes()
        try:
            data = json.loads(raw)
        except ValueError as error:
            raise Rejected("schema", f"the input is not JSON ({error})") from None
        text, failures = evaluate(raw, data, args.cutoff, args.iterations)
    except Rejected as rejected:
        print(f"evaluate_xg: rejected: {rejected}", file=sys.stderr)
        return 2
    args.output.write_text(text)
    if failures:
        detail = ", ".join(f"{name} {failure}" for name, failure in sorted(failures.items()))
        print(f"evaluate_xg: incomplete: a fit did not converge to a valid optimum ({detail}); "
              f"the report keeps its terminal-iterate diagnostics: {args.output}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
