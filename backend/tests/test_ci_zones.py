"""The CI runs only what a change can break (backend/ci/changed_suites.py, python_suites.py; ci.yml).

Failure modes guarded here:
- a site-only change still waits for the Python, Deploy and API suites (the 23 minutes of 26 Nov 2026);
- a site file the backend imports (src/services/, shared/, app/api/, the manifest) skips the backend's suites;
- a change to the read API or the SQL skips the API's own suites, or a Deploy file skips the Deploy's suites;
- a module of backend/tests the API's seed imports (the template base, the archive and cup samples) skips the API's
  suites, whose 58 files all start from that seed;
- a change to the CI itself, a push to main or a manual run skips anything;
- a file a test reads by name (README, fixture, workflow, Python module read by a Node test, a renamed component)
  skips that test's suite (Astra's review of #247, eight cases);
- a path no rule knows, or an empty list, skips anything; notes nobody reads start a suite;
- the parts of the Python and Deploy suites miss a test of the whole discovery, run one twice, leave one empty or
  drift apart (one part far longer than another: the 18 minutes of the Deploy's suites in one entry);
- a module of the Deploy's suites is kept whole in one part although each of its tests builds its own world: the 22
  tests of test_account_deploy (160 to 257 s from one run to the next) made deploy-1 the slowest job of every run of
  28 Nov 2026 (7 min 12 s and 7 min 22 s), whatever the weights;
- a module that fails to import is counted in a part, or fails one part only, instead of failing every part;
- ci.yml no longer feeds the zones and the parts to its jobs, or cancels main's run in progress (all eleven of main's
  runs cancelled on 26 Nov 2026, main never checked whole).
"""

from collections import Counter
from pathlib import Path
import json
import re
import statistics
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend/ci"))
import changed_suites  # noqa: E402
import durations  # noqa: E402
import python_suites  # noqa: E402

CI = (ROOT / ".github/workflows/ci.yml").read_text()


def needed(*paths, full=False):
    return changed_suites.zones(paths, full)


class ZonesTest(unittest.TestCase):
    def test_a_site_only_change_runs_the_site_only(self):
        self.assertEqual(needed("dashboard/frontend/src/components/MatchTabs.jsx", "tests/match-tabs.test.mjs",
                                "dashboard/frontend/app/match/[id]/page.jsx", "dashboard/frontend/src/styles.css",
                                "dashboard/frontend/public/logo.svg", "dashboard/frontend/src/views/Home.jsx"),
                         {"site"})
        self.assertIn('suites=[]', changed_suites.outputs(needed("dashboard/frontend/src/styles.css")))

    def test_a2_a_site_file_the_backend_imports_runs_the_backend_s_zones(self):
        backend = {"site", "python", "deploy", "api", "image", "package"}
        for path in ("dashboard/frontend/src/services/match-tabs.js", "dashboard/shared/competition-scope.js",
                     "dashboard/frontend/app/api/rapport/route.js", "dashboard/manifest/manifest.json",
                     "dashboard/frontend/src/hooks/useSeason.js", "dashboard/package.json", "dashboard/bun.lock"):
            with self.subTest(path):
                self.assertEqual(needed(path), backend)

    def test_b_the_read_api_runs_its_suites_the_python_ones_and_the_deploy_s(self):
        self.assertEqual(needed("backend/api/src/routes/home.mjs"), {"site", "python", "deploy", "api", "image", "package"})

    def test_c_the_api_s_own_tests_run_the_api_suites_only(self):
        self.assertEqual(needed("backend/api/test/home-favourites.test.mjs"), {"site", "deploy", "api", "image", "package"})
        self.assertEqual(needed("backend/account/test/schema.test.mjs") & {"python"}, set())

    def test_c2_what_the_api_s_seed_imports_from_the_python_suites_runs_the_api_suites(self):
        seed = (ROOT / "backend/api/test/seed.py").read_text()
        imported = re.findall(r"^from (\w+) import", seed, re.M)
        shared = [name for name in imported if (ROOT / "backend/tests" / f"{name}.py").exists()]
        self.assertEqual(sorted(shared), ["archive_fixtures", "cup_samples", "template_base"])
        for name in shared:
            with self.subTest(name):
                self.assertTrue({"python", "api"} <= needed(f"backend/tests/{name}.py"), needed(f"backend/tests/{name}.py"))

    def test_d_the_worker_runs_the_python_suites_not_the_api_s_nor_the_deploy_s(self):
        self.assertEqual(needed("backend/vega/worker.py"), {"site", "python", "image"})

    def test_d2_a_backend_module_the_site_s_tests_import_runs_them(self):
        # Codex's review of #247: tests/cup-sources.test.mjs imports backend/sources/projections/open-cups.mjs.
        self.assertIn("site", needed("backend/sources/projections/open-cups.mjs"))

    def test_e_the_sql_runs_every_suite(self):
        self.assertTrue({"python", "deploy", "api"} <= needed("backend/sql/180_matchdays.sql"))

    def test_f_a_deploy_file_runs_the_deploy_s_suites(self):
        for path in ("infra/aws/deploy.sh", "infra/aws/run_lock.py", "backend/vega/migrate.py", "backend/Dockerfile",
                     ".github/workflows/deploy.yml", "backend/tests/test_deploy_flow.py", "backend/tests/deploy_repo.py"):
            with self.subTest(path):
                self.assertIn("deploy", needed(path))
        self.assertEqual(needed("infra/aws/deploy.sh") & {"site", "api", "package", "image"}, set())

    def test_f2_the_api_s_inputs_outside_backend_run_its_suites_and_package(self):
        # Codex's review of #247: infra/aws/transport.mjs is bundled by api-index.mjs and tested by edge.test.mjs.
        for path in ("infra/aws/transport.mjs", "infra/aws/api-index.mjs", "infra/aws/live-index.mjs"):
            with self.subTest(path):
                self.assertTrue({"python", "deploy", "api", "package"} <= needed(path))
        self.assertIn("api", needed("infra/aws/api.yaml"))

    def test_g_the_ci_itself_a_push_to_main_or_a_manual_run_runs_everything(self):
        everything = set(changed_suites.ZONES)
        self.assertEqual(needed(".github/workflows/ci.yml"), everything)
        self.assertEqual(needed("backend/ci/test_databases.py"), everything)
        self.assertEqual(needed(full=True), everything)
        self.assertEqual(changed_suites.outputs(everything),
                         'suites=["python","deploy","api"]\n'
                         'parts=["python-1","python-2","deploy-1","deploy-2","deploy-3","deploy-4","deploy-5","deploy-6","api"]\nsite=true\ninfra=true\nimage=true\npackage=true')
        self.assertEqual(needed(), everything)
        self.assertEqual(needed("", " "), everything)

    def test_h_notes_nobody_reads_run_nothing(self):
        self.assertEqual(needed("WORKLOG.md", "docs/calculs/09-audit-2026-11/FAILURE_MODES_OPTIMISATIONS.md",
                                "docs/calculs/09-audit-2026-11/reviews/ci-zones.txt"), set())

    def test_h2_a_file_a_test_reads_by_name_runs_that_test_s_suite(self):
        # Astra's review of #247 (fddd7fd): each change below broke a test whose suite did not run.
        cases = {
            "infra/aws/README.md": {"python", "deploy"},           # test_cost_caps.py:159, test_deploy_grants.py:356
            "backend/tests/fixtures/cfn-handlers.json": {"deploy"},  # test_deploy_grants.py:267
            "dashboard/frontend/AGENTS.md": {"site"},                # tests/media-initials.test.mjs:80
            ".github/workflows/pilot.yml": {"python"},               # test_pilot_bounds.py:207
            "backend/vega/planner.py": {"api"},                      # backend/api/test/ops.test.mjs:166
            "backend/tests/fixtures/match_m_08LEIz/players_halves.json": {"api"},  # player-halves-real.test.mjs:36
            "docs/audits/2026-11-17/controles/verification-integree/identites-838-registre.csv": {"python"},
            "dashboard/frontend/src/components/MatchNav.jsx": {"python", "deploy"},  # renamed: the old path
        }
        for path, zones in cases.items():
            with self.subTest(path):
                self.assertTrue(zones <= needed(path), needed(path))

    def test_h2b_a_shared_fixture_runs_every_suite_that_reads_fixtures(self):
        # Codex's review of #247 (af2b636): match-families.test.mjs reads match_m_08LEIz/${name}, a path no literal names.
        self.assertEqual(needed("backend/tests/fixtures/match_m_08LEIz/events.json") & {"python", "deploy", "api", "site"},
                         {"python", "deploy", "api", "site"})

    def test_h3_a_path_no_rule_knows_runs_everything(self):
        self.assertEqual(needed("dashboard/frontend/src/styles.css", "Makefile"), set(changed_suites.ZONES))
        self.assertEqual(needed(".gitignore"), set(changed_suites.ZONES))

    def test_h4_the_cli_reads_git_s_nul_separated_list(self):
        import subprocess
        out = subprocess.run([sys.executable, str(ROOT / "backend/ci/changed_suites.py"), "-z"], capture_output=True,
                             text=True, input="dashboard/frontend/src/styles.css\0tests/a b.test.mjs\0", check=True).stdout
        self.assertEqual(out.splitlines(), ["suites=[]", "parts=[]", "site=true", "infra=false", "image=false", "package=false"])

    def test_i_the_two_parts_are_the_whole_discovery_once(self):
        ids = lambda part: [t.id() for t in python_suites.tests(python_suites.part(part))]
        whole, python, deploy = ids("all"), ids("python"), ids("deploy")
        self.assertEqual(sorted(python + deploy), sorted(whole))
        self.assertFalse(set(python) & set(deploy))
        self.assertEqual({i.split(".")[0] for i in deploy}, set(changed_suites.DEPLOY_MODULES))
        self.assertIn("test_ci_zones.ZonesTest.test_i_the_two_parts_are_the_whole_discovery_once", python)

    def test_i2_the_matrix_s_parts_run_the_whole_discovery_each_test_once(self):
        ids = lambda part: [t.id() for t in python_suites.tests(python_suites.part(part))]
        whole = Counter(ids("all"))
        self.assertEqual(set(whole.values()), {1})
        parts = json.loads(re.search(r"parts=(\[.*\])", changed_suites.outputs(set(changed_suites.ZONES))).group(1))
        ran = Counter()
        for name in parts:
            if name != "api":
                found = ids(name)
                self.assertTrue(found, f"{name} runs nothing")
                ran.update(found)
        self.assertEqual(ran, whole)
        self.assertEqual(parts, ["python-1", "python-2", "deploy-1", "deploy-2", "deploy-3", "deploy-4", "deploy-5", "deploy-6", "api"])

    def test_i3_a_part_keeps_its_units_whole_and_in_discovery_order(self):
        order = {i: n for n, i in enumerate(t.id() for t in python_suites.discover())}
        owner = {}
        for name in python_suites.names()[3:]:
            found = [t.id() for t in python_suites.tests(python_suites.part(name))]
            self.assertEqual(found, sorted(found, key=order.get), name)
            for unit in {durations.unit(i) for i in found}:
                # A test of a module that plays deploy.sh, or a whole module elsewhere, is never split between two parts.
                self.assertEqual(owner.setdefault(unit, name), name, unit)
        self.assertIn("test_deploy_flow.DeployFlowTest.test_GH157_x_runtask_refused_lost_unknown_missing_and_past_its_window", owner)
        self.assertIn("test_account_deploy.AccountDeployTest.test_w7_w10_w11_everything_prepared_deploys_the_account_in_order", owner)
        self.assertIn("test_worker", owner)

    def test_i3b_the_modules_that_play_deploy_sh_are_split_test_by_test(self):
        # Each of their tests plays deploy.sh in a world of its own (its state file, its stand-ins, its repository or
        # its cloned base): none needs what another left, so a part may hold any of them.
        for module in ("test_deploy_flow.DeployFlowTest", "test_account_deploy.AccountDeployTest", "test_panna_deploy.PannaDeployTest"):
            self.assertEqual(durations.unit(f"{module}.test_x"), f"{module}.test_x")
        for whole in ("test_deploy_grants.GrantsTest.test_x", "test_worker.WorkerTest.test_x", "test_panna.PannaTest.test_x"):
            self.assertEqual(durations.unit(whole), whole.split(".")[0])
        deploy = [t.id() for t in python_suites.discover() if python_suites.group(t) == "deploy"]
        spread = {}
        for name in python_suites.names():
            if name.startswith("deploy-"):
                for i in (t.id() for t in python_suites.tests(python_suites.part(name))):
                    spread.setdefault(i.split(".")[0], set()).add(name)
        self.assertEqual(set(spread), {i.split(".")[0] for i in deploy})
        # The 22 tests of the account's Deploy are no longer one part's load.
        self.assertGreater(len(spread["test_account_deploy"]), 1, spread)
        # No weight of a module split test by test is left in the file: it would never be read again.
        weights = json.loads(python_suites.DURATIONS.read_text())
        self.assertEqual([key for key in weights if key in durations.UNIT_BY_METHOD], [])
        # One unit never weighs a part's whole share: the parts can be balanced.
        loads = [weights.get(u, 0) for u in {durations.unit(i) for i in deploy}]
        self.assertLess(max(loads), sum(loads) / changed_suites.PARTS["deploy"], sorted(loads)[-3:])

    def test_i4_the_parts_are_balanced_by_measured_time_and_a_new_unit_weighs_the_median(self):
        self.assertEqual(python_suites.assign(["a", "b", "c", "d"], 2, {"a": 5, "b": 4, "c": 3, "d": 2}),
                         {"a": 1, "b": 2, "c": 2, "d": 1})
        # An unknown unit weighs the median of the known ones (3), ties broken by id.
        self.assertEqual(python_suites.assign(["x", "a", "b"], 2, {"a": 5, "b": 1}), {"a": 1, "x": 2, "b": 2})
        weights = json.loads(python_suites.DURATIONS.read_text())
        for group, count in (("python", changed_suites.PARTS["python"]), ("deploy", changed_suites.PARTS["deploy"])):
            tests = [t for t in python_suites.discover() if python_suites.group(t) == group]
            units = sorted({durations.unit(t.id()) for t in tests})
            known = [u for u in units if u in weights]
            # The file still describes the suites: a refresh is due once a fifth of the time is guessed.
            self.assertGreaterEqual(len(known), 0.8 * len(units), f"durations.json is stale for {group}")
            loads = [0.0] * count
            default = statistics.median(weights[u] for u in known)
            for u, i in python_suites.assign(units, count, weights).items():
                loads[i - 1] += weights.get(u, default)
            self.assertLess(max(loads), 1.25 * sum(loads) / count, (group, loads))

    def test_i5_a_module_that_fails_to_import_fails_every_part_before_any_test(self):
        import subprocess
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "test_broken.py").write_text("import no_such_module_anywhere\n")
            Path(tmp, "test_fine.py").write_text("import unittest\nclass T(unittest.TestCase):\n    def test_x(self): pass\n")
            with self.assertRaises(ImportError) as raised:
                python_suites.part("python-1", start=Path(tmp))
            self.assertIn("test_broken", str(raised.exception))
            with self.assertRaises(ImportError):
                python_suites.part("all", start=Path(tmp))
        # A part the matrix does not have is refused, not run empty.
        out = subprocess.run([sys.executable, str(ROOT / "backend/ci/python_suites.py"), "deploy-9"], capture_output=True, text=True)
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("usage", out.stderr)

    def test_i6_durations_reads_a_ci_log(self):
        log = [
            "2026-11-26T09:53:17.7984913Z ##[endgroup]",
            "2026-11-26T09:53:45.0313890Z test_GH1 (test_deploy_flow.DeployFlowTest.test_GH1) ... ok",
            "2026-11-26T09:53:45.1000000Z test_GH2 (test_deploy_flow.DeployFlowTest.test_GH2)",
            "2026-11-26T09:53:50.0000000Z deploy.sh step 3",
            "2026-11-26T09:54:00.1000000Z A docstring's first line ... ok",
            "2026-11-26T09:54:01.1000000Z test_a (test_worker.WorkerTest.test_a) ... ok",
            "2026-11-26T09:54:03.1000000Z test_b (test_worker.WorkerTest.test_b) ... skipped 'no docker'",
        ]
        got = durations.from_log(log)
        self.assertEqual(set(got), {"test_deploy_flow.DeployFlowTest.test_GH1", "test_deploy_flow.DeployFlowTest.test_GH2", "test_worker"})
        self.assertAlmostEqual(got["test_deploy_flow.DeployFlowTest.test_GH1"], 27.2, places=1)
        self.assertAlmostEqual(got["test_deploy_flow.DeployFlowTest.test_GH2"], 15.07, places=1)
        self.assertAlmostEqual(got["test_worker"], 3.0, places=1)


class WorkflowTest(unittest.TestCase):
    def test_j_ci_yml_feeds_the_zones_to_its_jobs(self):
        self.assertIn("python3 backend/ci/changed_suites.py", CI)
        self.assertIn("git diff --name-only --no-renames -z", CI)
        self.assertRegex(CI, r"github\.ref == 'refs/heads/main'")
        # Every change is classified (no workflow-level paths filter); only a PR's or main's older run is cancelled.
        self.assertNotRegex(CI, r"\n    paths:")
        self.assertIn("github.run_id", CI)
        # Main's run in progress is never cancelled: only a pull request's (or a branch push's own) is.
        self.assertIn("cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}", CI)
        self.assertNotIn("cancel-in-progress: true", CI)
        self.assertIn("parts: ${{ steps.zones.outputs.parts }}", CI)
        self.assertIn("part: ${{ fromJSON(needs.changes.outputs.parts) }}", CI)
        self.assertIn("if: needs.changes.outputs.parts != '[]'", CI)
        self.assertNotIn("matrix.suite", CI)
        self.assertIn("if: startsWith(matrix.part, 'deploy-')", CI)
        for zone in ("site", "infra", "image", "package"):
            self.assertIn(f"if: needs.changes.outputs.{zone} == 'true'", CI)
        self.assertIn("run: python backend/ci/python_suites.py ${{ matrix.part }}", CI)
        self.assertEqual(set(json.loads(re.search(r'suites=(\[.*\])', changed_suites.outputs(set(changed_suites.ZONES))).group(1))),
                         set(changed_suites.SUITES))


if __name__ == "__main__":
    unittest.main()
