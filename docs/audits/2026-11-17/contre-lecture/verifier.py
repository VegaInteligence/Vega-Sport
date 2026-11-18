"""Rejoue les contrôles portables dans un répertoire temporaire, sans connexion réseau."""
import csv
import gzip
import hashlib
import itertools
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zlib
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

root = Path(__file__).resolve().parent
report = root.parent
repo = report.parents[2]
P = root / "joueurs"
T = root / "equipes"


def data(path):
    return json.loads(path.read_bytes())


def table(path):
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_script(copy, script, args, outputs):
    subprocess.run([sys.executable, str(copy / script), *map(str, args)], cwd=copy,
                   capture_output=True, text=True, check=True)
    for actual, expected in outputs:
        assert (copy / actual).read_bytes() == (P / expected).read_bytes(), expected


lines = (root / "SHA256SUMS").read_text().splitlines()
expected_files = set()
for line in lines:
    expected, name = line.split("  ", 1)
    assert name not in expected_files and digest(root / name) == expected, name
    expected_files.add(name)
assert expected_files == {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and p != root / "SHA256SUMS"}
with tempfile.TemporaryDirectory(prefix="vega-contre-lecture-") as temp:
    tmp = Path(temp)
    copy = tmp / "joueurs"
    shutil.copytree(P, copy)
    run_script(copy, "award.py", [report / "notes-transaction"],
               [(s, s) for s in ("pending-by-award-edition.csv", "pending-by-award.json")])
    run_script(copy, "support.py", [], [(s, s) for s in ("support-results.json", "support-by-partition-award-role.csv")])
    run_script(copy, "support-editions/replay.py", [], [(s, s) for s in ("support-editions/keepers-by-edition.csv", "support-editions/summary.json")])
    psl = copy / "psl-lineage"
    run_script(psl, "analyse.py", ["--output", psl / "repete"], [("repete/" + s, "psl-lineage/" + s)
               for s in ("fixture-lineage-182.csv", "pending-current-14.csv", "findings.json")])
    route = tmp / "score-witness.mjs"
    shutil.copyfile(T / route.name, route)
    if digest(repo / "backend/api/src/routes/rankings.mjs") != "fe84548cf0f03337b38d966ff6a4192bb240563ea2c8fa1bfea822ef1f111be9":
        raise ValueError("Le lecteur doit correspondre au blob de production documenté.")
    subprocess.run(["node", str(route), str(repo)], cwd=tmp, capture_output=True, text=True, check=True)
    replay = data(tmp / "score-witness.json")
    retained = data(T / "score-witness.json")
    assert {k: v for k, v in replay.items() if k != "node"} == {k: v for k, v in retained.items() if k != "node"}

keepers = data(P / "support-editions/summary.json")
assert [keepers[k] for k in ("lines", "distinct_editions", "mismatched_to_cent")] == [699, 301, 3364]
one, three, four = keepers["rows"]
assert (one["graded"], one["measured_saves"], one["editions"]) == (52665, 46343, 134)
assert (three["graded"], three["both_primitives"], four["three_primitives"]) == (52051, 47990, 52293)
assert data(P / "support-results.json")["counts"]["partial"] == 104792
refs = table(P / "references/by-award.csv")
assert [sum(int(r[key]) for r in refs) for key in ("stored", "grade_gap_over_0.01", "different_rounded_before_display_filter")] == [2282580, 7681, 1083]
ref = data(P / "reference-0714.json")
assert ref["reference_version_changes"] == [] and ref["shared_keys"] == ref["unchanged_contribution_stored_z_and_grade_run"] == 37
first = data(P / "first-award/result.json")
assert first["after_normal_daily"]["grades"] == {"2021": 50} and first["after_method_recompute"]["grades"] == {"2020": 50, "2021": 50}
third = data(P / "psl-lineage/double-side-final/result.json")
assert [r["sqlstate"] for r in third["failed_repeats"]] == ["23505", "23505"] and third["preserved_published_state"]
assert data(P / "psl-lineage/findings.json")["edition_counts"]["outside"] == 0

# Reconcile the supplied official assignments to the frozen rows by physical match ID.
source = T / "db/inputs.json.zlib"
assert digest(source) == data(T / "db/receipt.json")["sha256"]
frozen = json.loads(zlib.decompress(source.read_bytes()))
elo = {row[1]: row for row in frozen["elo"]["rows"]}
assert len(elo) == 81923 and all(r[2:5] == [2, 2097, 2097] for r in elo.values())
states = Counter(r[8] for r in elo.values())
assert states == {None: 81622, False: 44, True: 257}
sources = Counter((r[9], r[8]) for r in elo.values())
for r in table(T / "neutral-by-source.csv"):
    assert [sources[r["source"], k] for k in (None, False, True)] == [int(r[k]) for k in ("NULL", "false", "true")]
venues = table(T / "venues-attested.csv")
assert len({r["match_id"] for r in venues}) == len(venues) == 612
for r in venues:
    stored = elo[int(r["match_id"])]
    assert stored[8] is None and stored[10:12] == [int(r["rds_home_id"]), int(r["rds_away_id"])] and stored[7] == r["date"] and r["url"]
vs = Counter(r["venue_status"] for r in venues)
assert [vs["neither_home_association"], vs["nominal_home_hosts"] + vs["club_home_ground_nominal_home"],
        vs["nominal_away_hosts"] + vs["club_home_ground_nominal_away"], vs["club_from_stadium_association_ground_unverified"]] == [508, 65, 25, 14]
stages = table(T / "stages.csv")
assert len({r["match_id"] for r in stages}) == len(stages) == 301 and len({r["edition"] for r in stages}) == 7
factor = {"group": 1., "bronze": 1., "r16": 1.05, "quarter": 1.05, "semi": 1.10, "final": 1.15}
miss = 0
for r in stages:
    stored = elo[int(r["match_id"])]
    assert stored[7] == r["date"] and stored[14] == int(r["edition"]) and stored[20] is None and stored[9] == "international_results"
    assert stored[12:14] == [int(r["home_goals"]), int(r["away_goals"])] and stored[5] == stored[6] == float(r["stored_weight"])
    assert r["organizer_url"] and int(r["stored_elo_sides"]) == 2 and int(r["player_grade_rows"]) == int(r["player_power_rows"]) == 0
    weight = 1.2 * factor[r["official_tournament_stage"]]
    assert abs(weight - float(r["documented_weight"])) < 1e-6
    different = abs(weight - stored[5]) > 1e-6
    assert different == (r["decision"] == "round_premium_missing")
    miss += different
assert miss == 81
copa = data(T / "copa-final.json")
arg, col = frozen["copa_final"]["rows"]
assert arg[0] == 5467 and col[0] == 5491 and copa["match"] == 739114
prob = 1 / (1 + 10 ** ((col[1] - arg[1]) / 400))
assert round(arg[2] - arg[1], 5) == 10.21558 and round(20 * 1.38 * (1 - prob), 5) == 11.74788
assert round(20 * (1.38 - 1.20) * (1 - prob), 5) == 1.53233

# RDS stores each distinct match ID once. Raw club IDs here precede the deployed identity projection.
# The exact duplicate census uses the admitted (projected) sides from its own compact projection.
pairs = defaultdict(list)
with gzip.open(T / "cotes-admises.csv.gz", "rt", newline="") as handle:
    admitted_rows = list(csv.DictReader(handle))
assert {int(r["match_id"]) for r in admitted_rows} == set(elo)
for row in admitted_rows:
    pair = tuple(sorted((int(row["home_id"]), int(row["away_id"]))))
    pairs[pair].append((date.fromisoformat(row["day"]), int(row["match_id"])))
assert sum(map(len, pairs.values())) == len(elo)
nearby = set()
for events in pairs.values():
    ordered = sorted(events)
    for i, (day, first_id) in enumerate(ordered):
        for second_day, second_id in itertools.islice(ordered, i + 1, None):
            if (second_day - day).days > 1:
                break
            nearby.add(tuple(sorted((first_id, second_id))))
argentina = data(T / "duplicate-candidates.json")
assert nearby == {(r["first_id"], r["second_id"]) for r in argentina} and len(nearby) == 5
spain = data(T / "spanish-outside-id-census.json")
assert len(spain) == 5 and all(r["all_four_sides_stored"] and not r["exact_unordered_pair_equal"] for r in spain)
grades = Counter()
for row in table(T / "archive-by-edition.csv"):
    for i in range(3):
        grades[i] += int(row[f"club_{i}_rated_teams"])
assert grades == {0: 75863, 1: 161583, 2: 253481}
prior = same = n = 0
with gzip.open(T / "archive-two-rated.csv.gz", "rt", newline="") as inp:
    for row in csv.DictReader(inp):
        latest = max(row["home_first_2097_day"], row["away_first_2097_day"])
        prior += latest < row["day"]
        same += latest <= row["day"]
        n += 1
assert (n, prior, same) == (253481, 652, 656)
worldcup = table(T / "worldcup-restored-665.csv")
assert len({r["match_id"] for r in worldcup}) == len(worldcup) == 665
assert all(r["branch_status"] == "finished" and r["branch_is_neutral"] == "" and int(r["match_id"]) not in elo for r in worldcup)
assert sum(r["fifa_reversed_orientation"] == "True" for r in worldcup) == 38
belgium = data(T / "belgique/sensitivity.json")
changed = table(T / "belgique/changed-after.csv")
assert len(changed) == belgium["later_sides_with_different_f32_after"] == 32
assert (belgium["distinct_later_matches"], belgium["distinct_later_teams"]) == (16, 9)
assert len(data(T / "afcon-final.json")["stored_2097"]) == 2
assert data(T / "counter-116.json")["2097_missing_or_extra_keys"] == 0
print(json.dumps({"status":"PASS","artifacts":len(expected_files),"admitted_players":2297613,"grades":2282580,
                  "partial_support":104792,"psl_current_ungraded":14,"reference_gap_over_cent":7681,
                  "role_and_edition_rows":699,"elo_matches":len(elo),"elo_sides":sum(r[2] for r in elo.values()),
                  "venue_witnesses":len(venues),"third_territory":508,"bracket_matches":len(stages),
                  "missing_round_premiums":miss,"archive_pairs_both_prior":prior,
                  "argentina_exact_id_candidates":len(nearby),"espana_separate_official_duplicates":len(spain),
                  "worldcup_restored_branch":len(worldcup),"belgian_later_sides":len(changed),"node_route_assertions":replay["checks"]},ensure_ascii=False))
