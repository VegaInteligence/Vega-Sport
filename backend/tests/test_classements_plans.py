"""The plan shapes of migration 159's reads (FAILURE_MODES.md §43.4, 43s-43u), on the small test bases of
test_standings_phases.py and test_nation_match_copies.py. Written before the change. The times are measured on the
second review's base (evidence/classements/perf/); here the plan's form, which is what makes them grow:
- 43s: api.nation_list reads each partition of core.matches twice, never a third time, and tests a copy by equal
  keys, not by a join filter on abs();
- 43t: the route's standings statement calls no function over the whole table, reads the withheld editions by their
  id, and reads core.standings_official without an edition condition (sequential scans off) no more often than with
  150's view, custom and generic plans (on this small base the planner may check the Vega branch's authority once
  over the whole table, as it did with 150; on the review's base every scan has the edition condition, perf/);
- 43u: api.nation_matches re-executes no materialized CTE once per kept match.
"""

import json
import os
from pathlib import Path
import re
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prerequisites import required  # noqa: E402
from template_base import fresh  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_CLASSEMENTS_TEST_DSN")
# The statement standingsBody (reference.mjs) sends, read from the route's source.
ROUTE = (ROOT / "api" / "src" / "routes" / "reference.mjs").read_text(encoding="utf-8")


def route_sql():
    found = re.search(r"const rows = await read\(\s*`([\s\S]*?)`,\s*\[competition, season \?\? null\]", ROUTE)
    assert found, "standingsBody's statement"
    return found[1]


def nodes(plan):
    yield plan
    for child in plan.get("Plans", []):
        yield from nodes(child)


def body(db, signature):
    """A function's SQL body, its argument named by the signature turned into $1."""
    source, = db.execute("SELECT prosrc FROM pg_proc WHERE oid = %s::regprocedure", (signature,)).fetchone()
    return source


def explain(db, sql, args, analyze=False, generic=False):
    with db.transaction():
        db.execute("SET LOCAL jit = off")
        db.execute("SET LOCAL max_parallel_workers_per_gather = 0")
        db.execute("SET LOCAL enable_seqscan = off")
        if generic:
            db.execute("SET LOCAL plan_cache_mode = force_generic_plan")
            db.execute(f"PREPARE plan_shape({', '.join(['text'] * len(args))}) AS {sql}")
            try:
                from psycopg import sql as q

                values = q.SQL(", ").join(q.Literal(a) for a in args)
                plan = db.execute(q.SQL("EXPLAIN (FORMAT JSON) EXECUTE plan_shape({})").format(values)).fetchone()[0]
            finally:
                db.execute("DEALLOCATE plan_shape")
        else:
            options = "ANALYZE, FORMAT JSON" if analyze else "FORMAT JSON"
            plan = db.execute(f"EXPLAIN ({options}) {sql}", args).fetchone()[0]
    return plan[0]["Plan"]


@required(DSN and psycopg, "requires VEGA_V2_CLASSEMENTS_TEST_DSN and psycopg")
class Plans(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import test_nation_match_copies as nations
        import test_standings_phases as standings

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_classements_test":
            raise RuntimeError("dedicated local test DB required")
        cls.db = fresh(DSN)
        standings.build(cls.db)
        nations.build(cls.db)
        # Volume enough for the planner to choose as it does on the review's base (30 000 SportScore rows over 1 500
        # editions): 400 other editions of 20 official rows, half with Vega's own table too.
        with cls.db.transaction():
            x = cls.db.execute
            x("INSERT INTO core.competitions(id, name, kind) SELECT 5000 + c, 'League ' || c, 'league' FROM generate_series(1, 400) c")
            x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current)
                 SELECT 50000 + c, 5000 + c, 2026, '2026', true FROM generate_series(1, 400) c""")
            x("INSERT INTO core.teams(id, name) SELECT 900000 + t, 'Club ' || t FROM generate_series(1, 20) t")
            x("""INSERT INTO core.standings_official(competition_season_id, stage, group_name, team_id, position, played, won, drawn, lost,
                   goals_for, goals_against, points, source, as_of)
                 SELECT 50000 + c, NULL, NULL, 900000 + t, t, 10, 0, 10, 0, 5, 5, 100 - t, 'sportscore', '2026-11-01T00:00Z'
                 FROM generate_series(1, 400) c, generate_series(1, 20) t""")
            x("""INSERT INTO agg.standings(competition_season_id, stage, group_name, team_id, position, played, won, drawn, lost,
                   goals_for, goals_against, points, updated_at)
                 SELECT 50000 + c, NULL, NULL, 900000 + t, t, 10, 0, 10, 0, 5, 5, 10, '2026-11-01T00:00Z'
                 FROM generate_series(1, 200) c, generate_series(1, 20) t""")
        cls.db.execute("ANALYZE")

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def test_43s_nation_list_reads_the_matches_twice_and_hashes_the_copy_test(self):
        sql = body(self.db, "api.nation_list(smallint)").replace("season_key", "%s::smallint")
        plan = explain(self.db, sql, (2025,) * sql.count("%s"))
        scans = {}
        for node in nodes(plan):
            if re.fullmatch(r"matches(_s\d+|_archive)?", node.get("Relation Name", "")):
                scans[node["Relation Name"]] = scans.get(node["Relation Name"], 0) + 1
        self.assertTrue(scans)
        self.assertEqual(set(scans.values()), {2}, scans)
        filters = [n.get("Join Filter", "") for n in nodes(plan)]
        self.assertFalse([f for f in filters if "abs(" in f], filters)

    def unrestricted(self, generic, view=None):
        """The scans of core.standings_official in the route's statement without an edition condition, and the
        function scans of the whole-table rank check; with `view`, api.standings replaced by it (rolled back)."""
        sql = route_sql() if generic else route_sql().replace("$1", "%s").replace("$2::text", "%s::text")
        with self.db.transaction():
            if view:
                self.db.execute(view)
            plan = explain(self.db, sql, ("l_3Ci5Cg", None), generic=generic)
            every = list(nodes(plan))
            loose = 0
            for node in every:
                if node.get("Relation Name") == "standings_official":
                    conditions = node.get("Index Cond", "") + node.get("Recheck Cond", "") + "".join(
                        c.get("Index Cond", "") for c in node.get("Plans", []))
                    loose += "competition_season_id" not in conditions
            whole = [n.get("Function Call") for n in every if n.get("Function Name") == "standings_rank_conflicts"
                     or n.get("Function Call", "").replace(" ", "").endswith("standings_withheld()")]
            raise psycopg.Rollback()  # the replaced view goes; the with block swallows it
        return loose, whole

    def test_43t_the_standings_statement_reads_no_more_than_150_did(self):
        # 150's view, as the review's baseline: the route's statement read the whole table at most where it did.
        text = (ROOT / "sql" / "150_sportscore_standings_quarantine.sql").read_text(encoding="utf-8")
        view = text[text.index("CREATE OR REPLACE VIEW api.standings AS"):text.index("INSERT INTO ops.resource_versions")]
        self.assertIn("api.standings_withheld(k.competition_season_id)", route_sql())
        for generic in (False, True):
            with self.subTest(generic=generic):
                before, _ = self.unrestricted(generic, view)
                after, whole = self.unrestricted(generic)
                self.assertEqual(whole, [])
                self.assertLessEqual(after, before, (after, before))

    def test_43u_nation_matches_runs_no_cte_once_per_kept_match(self):
        sql = body(self.db, "api.nation_matches(integer)").replace("team_key", "%s::integer")
        plan = explain(self.db, sql, (1,) * sql.count("%s"), analyze=True)
        repeated = [(n["Node Type"], n.get("CTE Name"), n["Actual Loops"]) for n in nodes(plan)
                    if n["Node Type"] == "CTE Scan" and n["Actual Loops"] > 1]
        self.assertEqual(repeated, [])
        self.assertFalse([n.get("Join Filter") for n in nodes(plan) if "abs(" in n.get("Join Filter", "")])


if __name__ == "__main__":
    unittest.main()
