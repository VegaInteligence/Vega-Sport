"""The CI runs only what a change can break (backend/ci/changed_suites.py, python_suites.py; ci.yml).

Failure modes guarded here:
- a site-only change still waits for the Python, Deploy and API suites (the 23 minutes of 26 Nov 2026);
- a site file the backend imports (src/services/, shared/, app/api/, the manifest) skips the backend's suites;
- a change to the read API or the SQL skips the API's own suites, or a Deploy file skips the Deploy's suites;
- a change to the CI itself, a push to main or a manual run skips anything;
- a file a test reads by name (README, fixture, workflow, Python module read by a Node test, a renamed component)
  skips that test's suite (Astra's review of #247, eight cases);
- a path no rule knows, or an empty list, skips anything; notes nobody reads start a suite;
- the two parts of the Python suites miss a test of the whole discovery, or run one twice;
- ci.yml no longer feeds the zones to its jobs.
"""

from pathlib import Path
import json
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend/ci"))
import changed_suites  # noqa: E402
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
                         'suites=["python","deploy","api"]\nsite=true\ninfra=true\nimage=true\npackage=true')
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
        self.assertEqual(out.splitlines(), ["suites=[]", "site=true", "infra=false", "image=false", "package=false"])

    def test_i_the_two_parts_are_the_whole_discovery_once(self):
        ids = lambda part: [t.id() for t in python_suites.tests(python_suites.part(part))]
        whole, python, deploy = ids("all"), ids("python"), ids("deploy")
        self.assertEqual(sorted(python + deploy), sorted(whole))
        self.assertFalse(set(python) & set(deploy))
        self.assertEqual({i.split(".")[0] for i in deploy}, set(changed_suites.DEPLOY_MODULES))
        self.assertIn("test_ci_zones.ZonesTest.test_i_the_two_parts_are_the_whole_discovery_once", python)


class WorkflowTest(unittest.TestCase):
    def test_j_ci_yml_feeds_the_zones_to_its_jobs(self):
        self.assertIn("python3 backend/ci/changed_suites.py", CI)
        self.assertIn("git diff --name-only --no-renames -z", CI)
        self.assertRegex(CI, r"github\.ref == 'refs/heads/main'")
        # Every change is classified (no workflow-level paths filter); only a PR's or main's older run is cancelled.
        self.assertNotRegex(CI, r"\n    paths:")
        self.assertIn("cancel-in-progress: true", CI)
        self.assertIn("github.run_id", CI)
        self.assertIn("suite: ${{ fromJSON(needs.changes.outputs.suites) }}", CI)
        self.assertIn("if: needs.changes.outputs.suites != '[]'", CI)
        for zone in ("site", "infra", "image", "package"):
            self.assertIn(f"if: needs.changes.outputs.{zone} == 'true'", CI)
        self.assertIn("run: python backend/ci/python_suites.py ${{ matrix.suite }}", CI)
        self.assertEqual(set(json.loads(re.search(r'suites=(\[.*\])', changed_suites.outputs(set(changed_suites.ZONES))).group(1))),
                         set(changed_suites.SUITES))


if __name__ == "__main__":
    unittest.main()
