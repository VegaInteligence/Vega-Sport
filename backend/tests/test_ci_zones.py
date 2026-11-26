"""The CI runs only what a change can break (backend/ci/changed_suites.py, python_suites.py; ci.yml).

Failure modes guarded here:
- a site-only change still waits for the Python, Deploy and API suites (the 23 minutes of 26 Nov 2026);
- a site file the backend imports (src/services/, shared/, app/api/, the manifest) skips the backend's suites;
- a change to the read API or the SQL skips the API's own suites, or a Deploy file skips the Deploy's suites;
- a change to the CI itself, a push to main or a manual run skips anything;
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
        self.assertEqual(needed("backend/api/src/routes/home.mjs"), {"python", "deploy", "api", "image", "package"})

    def test_c_the_api_s_own_tests_run_the_api_suites_only(self):
        self.assertEqual(needed("backend/api/test/home-favourites.test.mjs"), {"deploy", "api", "image", "package"})
        self.assertEqual(needed("backend/account/test/schema.test.mjs") & {"python"}, set())

    def test_d_the_worker_runs_the_python_suites_not_the_api_s_nor_the_deploy_s(self):
        self.assertEqual(needed("backend/vega/worker.py"), {"python", "image"})

    def test_e_the_sql_runs_every_suite(self):
        self.assertTrue({"python", "deploy", "api"} <= needed("backend/sql/180_matchdays.sql"))

    def test_f_a_deploy_file_runs_the_deploy_s_suites(self):
        for path in ("infra/aws/deploy.sh", "infra/aws/run_lock.py", "backend/vega/migrate.py", "backend/Dockerfile",
                     ".github/workflows/deploy.yml", "backend/tests/test_deploy_flow.py", "backend/tests/deploy_repo.py"):
            with self.subTest(path):
                self.assertIn("deploy", needed(path))
        self.assertEqual(needed("infra/aws/deploy.sh") & {"python", "api", "site"}, set())

    def test_g_the_ci_itself_a_push_to_main_or_a_manual_run_runs_everything(self):
        everything = set(changed_suites.ZONES)
        self.assertEqual(needed(".github/workflows/ci.yml"), everything)
        self.assertEqual(needed("backend/ci/test_databases.py"), everything)
        self.assertEqual(needed(full=True), everything)
        self.assertEqual(changed_suites.outputs(everything),
                         'suites=["python","deploy","api"]\nsite=true\nimage=true\npackage=true')

    def test_h_documentation_runs_nothing(self):
        self.assertEqual(needed("backend/README.md", "infra/aws/README.md", "dashboard/README.md"), set())

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
        self.assertRegex(CI, r"github\.ref == 'refs/heads/main'")
        self.assertIn("suite: ${{ fromJSON(needs.changes.outputs.suites) }}", CI)
        self.assertIn("if: needs.changes.outputs.suites != '[]'", CI)
        for zone in ("site", "image", "package"):
            self.assertIn(f"if: needs.changes.outputs.{zone} == 'true'", CI)
        self.assertIn("run: python backend/ci/python_suites.py ${{ matrix.suite }}", CI)
        self.assertEqual(set(json.loads(re.search(r'suites=(\[.*\])', changed_suites.outputs(set(changed_suites.ZONES))).group(1))),
                         set(changed_suites.SUITES))


if __name__ == "__main__":
    unittest.main()
