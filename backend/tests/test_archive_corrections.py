"""Archive corrections after the Astra and Fable reviews (VI-27), written before the code: FAILURE_MODES.md §22.

The builders, edition.mjs, the loader, the plan and the apply run for real on a disposable local PostgreSQL
(VEGA_V2_ARCHIVE_CORRECTIONS_TEST_DSN, database vega_v2_archive_corrections_test). The archive API checks run
the real read API handler under the vega_read role.
"""

import contextlib
import copy
import csv
import gzip
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlparse
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from vega import archives  # noqa: E402
from archive_fixtures import GOALS, make_sources  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_ARCHIVE_CORRECTIONS_TEST_DSN")
NODE = shutil.which("node")
SEASON = "2015/2016"
ARSENAL = "r:2015-16/en.1:0"


def goal_rows(changes):
    """GOALS with some rows replaced ({index: row or None to drop})."""
    rows = list(GOALS)
    for index, row in sorted(changes.items(), reverse=True):
        if row is None:
            del rows[index]
        else:
            rows[index] = row
    return {"eng-premier-league": rows}


def champs_zip(path, rows, name="europe-champions-league-master/2008-09/champs.csv"):
    text = io.StringIO()
    writer = csv.writer(text)
    writer.writerow(["Round", "Date", "Team 1", "FT", "HT", "Team 2"])
    writer.writerows(rows)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(name, text.getvalue())
    return path


def plain_zip(path, name, rows):
    text = io.StringIO()
    writer = csv.writer(text)
    writer.writerow(["Round", "Date", "Team 1", "FT", "HT", "Team 2"])
    writer.writerows(rows)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(name, text.getvalue())
    return path


class QuarantineListTest(unittest.TestCase):
    """22m: the reviewed quarantine is exact: keys, source file and its SHA-256, and the reason."""

    def test_the_reviewed_records(self):
        q = archives.QUARANTINE
        concacaf = sorted(k for k, v in q.items() if v["reason"] == "wrong_competition_edition")
        self.assertEqual(len(concacaf), 33)
        self.assertEqual((concacaf[0], concacaf[-1]), ("g:champions-league:2008-09-17:1783", "g:champions-league:2009-04-23:1815"))
        # The pinned goals manifest's hash of the CSV, and the one the reviewed evidence cites.
        self.assertTrue(all(q[k]["file"] == "worldclub/goals/champions-league.csv" and q[k]["sha256"].startswith("944c94ab")
                            and q[k]["evidence_sha256"].startswith("af15101e") for k in concacaf))
        self.assertEqual(q["g:fra-coupe-de-france:2021-12-17:2247"]["reason"], "abandoned_status_unrepresented")
        self.assertEqual(q["g:fra-coupe-de-france:2021-12-17:2247"]["production_id"], 732633)
        self.assertEqual(q["g:eng-league-cup:1990-10-10:389"]["production_id"], 516140)
        self.assertEqual(len(q), 35)


@unittest.skipUnless(DSN and psycopg and NODE, "requires a disposable local archive corrections DB (VEGA_V2_ARCHIVE_CORRECTIONS_TEST_DSN), psycopg and node")
class CorrectionsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_archive_corrections_test":
            raise RuntimeError("dedicated local archive corrections DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        self.x = self.db.execute
        self.x("RESET ROLE")
        self.x("""TRUNCATE core.matches, core.rounds, core.competition_seasons, core.competitions, core.provider_ids, core.teams,
                  core.source_revisions, ops.resource_versions, ops.parse_failures, ops.archive_plans RESTART IDENTITY CASCADE""")
        if self.x("SELECT to_regclass('ops.archive_removals')").fetchone()[0]:
            self.x("TRUNCATE ops.archive_removals")  # identities restart: an old tombstone would refuse a new row (§24)
        self.work = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.work, True)
        self.n = 0

    def sources(self, goals=None):
        self.n += 1
        return make_sources(self.work / f"s{self.n}", goals)

    def state(self):
        return self.x("""SELECT m.archive_key, m.id, m.status::text, m.home_score, m.away_score, m.home_team_id, m.away_team_id,
                                m.home_team_name, m.away_team_name, m.revision, m.updated_at, m.archive_position, m.xmin::text
                         FROM core.matches m WHERE m.archive_key IS NOT NULL ORDER BY 1""").fetchall()

    def events(self):
        return self.x("""SELECT m.archive_key, e.event_type::text, e.seq, e.team_id, e.minute, e.player_name, e.player_id, e.xmin::text
                         FROM core.match_events e JOIN core.matches m ON m.id = e.match_id ORDER BY 1, 3""").fetchall()

    def published(self):
        """What a reader is shown: the source revisions and every archive season version."""
        return (self.x("SELECT * FROM core.source_revisions ORDER BY source").fetchall(),
                self.x("SELECT resource_kind, resource_id, version, updated_at FROM ops.resource_versions ORDER BY 1, 2").fetchall())

    def api(self, season=SEASON):
        """(status, etag, meta.version) of the real /api/read/archive under vega_read."""
        js = """import {createReader} from './src/db.mjs';import {createHandler} from './src/handler.mjs';
const [dsn,season]=process.argv.slice(1);const r=createReader(dsn,{role:'vega_read'});const h=createHandler({read:r.read});
const res=await h(new Request('https://local/api/read/archive?season='+encodeURIComponent(season)));
const body=await res.json();console.log(JSON.stringify({status:res.status,etag:res.headers.get('etag'),version:body?.meta?.version}));await r.end();"""
        done = subprocess.run([NODE, "--input-type=module", "-e", js, DSN, season], cwd=ROOT / "api", capture_output=True, text=True, timeout=120)
        self.assertEqual(done.returncode, 0, done.stderr)
        out = json.loads(done.stdout.strip().splitlines()[-1])
        return out["status"], out["etag"], out["version"]

    def fresh(self, source, seasons=(SEASON,)):
        return archives.run(self.db, source, set(seasons))

    def entries(self, plan, season=SEASON):
        return {m["key"]: m for m in plan["seasons"][season]["matches"]}

    # -- events and goals --
    def test_22g_a_goal_team_the_candidate_would_clear_holds_the_match(self):
        self.fresh(self.sources())
        before, events = self.state(), self.events()
        self.assertTrue(all(e[3] for e in events))  # every stored goal names its team
        # The two West Ham goals now name a team neither side matches.
        nobody = goal_rows({0: GOALS[0][:4] + ("Nobody Town",) + GOALS[0][5:], 1: GOALS[1][:4] + ("Nobody Town",) + GOALS[1][5:]})
        source = self.sources(nobody)
        plan = archives.plan(self.db, source, {SEASON})
        entry = self.entries(plan)[ARSENAL]
        self.assertEqual((entry["class"], entry["held"]), ("held", "team_cleared"))
        report = archives.apply(self.db, source, plan, {SEASON})
        self.assertEqual(report["seasons"][SEASON], "partial")
        self.assertEqual((self.state(), self.events()), (before, events))

    def test_22h_a_corrected_scorer_keeps_the_card(self):
        self.fresh(self.sources())
        match = self.x("SELECT id, home_team_id FROM core.matches WHERE archive_key = %s", (ARSENAL,)).fetchone()
        self.x("INSERT INTO core.match_events(season_id, match_id, seq, event_type, team_id, minute) VALUES (2015, %s, 100, 'yellow_card', %s, 88)", match)
        amended = goal_rows({0: GOALS[0][:3] + ("Cheikhou Kouyaté amended",) + GOALS[0][4:]})
        source = self.sources(amended)
        plan = archives.plan(self.db, source, {SEASON})
        entry = self.entries(plan)[ARSENAL]
        self.assertEqual(entry["class"], "goals")
        self.assertEqual([e[:2] for e in entry["before"]["events"] if e[0] != "goal"], [["yellow_card", "100"]])  # every stored event, bound
        self.assertEqual(archives.apply(self.db, source, plan, {SEASON})["seasons"][SEASON], "applied")
        rows = [e for e in self.events() if e[0] == ARSENAL]
        self.assertEqual([(e[1], e[5]) for e in rows], [("goal", "Cheikhou Kouyaté amended"), ("goal", "Mauro Zárate"), ("yellow_card", None)])

    def test_22i_a_missing_goals_family_refuses_the_run(self):
        self.fresh(self.sources())
        before, published = self.state(), self.published()
        source = self.sources()
        shutil.rmtree(source / "worldclub")
        with self.assertRaises(archives.ArchiveError) as caught:
            archives.plan(self.db, source, {SEASON})
        self.assertIn("goals", str(caught.exception))
        with self.assertRaises(archives.ArchiveError):
            archives.run(self.db, source, {SEASON})
        broken = self.sources()
        (broken / "worldclub/goals/eng-premier-league.csv.gz").unlink()
        with self.assertRaises(archives.ArchiveError):
            archives.plan(self.db, broken, {SEASON})
        self.assertEqual((self.state(), self.published()), (before, published))

    def test_22j_fewer_goals_hold_the_match(self):
        self.fresh(self.sources())
        before, events = self.state(), self.events()
        source = self.sources(goal_rows({1: None}))  # Zárate's goal gone from the file
        plan = archives.plan(self.db, source, {SEASON})
        self.assertEqual(self.entries(plan)[ARSENAL]["held"], "goals_lost")
        archives.apply(self.db, source, plan, {SEASON})
        self.assertEqual((self.state(), self.events()), (before, events))

    # -- the appearance-ordinal feed --
    def ordinal_sources(self, champs_rows, england_rows=()):
        source = self.sources()
        folder = source / "openfootball"
        champs_zip(folder / "footballcsv-europe-test.zip", champs_rows)
        plain_zip(folder / "footballcsv-england-test.zip", "england-master/1990-91/eng.1.csv", england_rows)
        plain_zip(folder / "footballcsv-deutschland-test.zip", "deutschland-master/1990-91/de.1.csv", [])
        plain_zip(folder / "footballcsv-soccerdata-test.zip", "soccerdata-master/1990-91/eng.2.csv", [])
        return source

    def test_22k_an_appearance_ordinal_never_mints_a_team(self):
        rows = [("Group A", "(Wed) 17 Sep 2008 (W1)", "Real Madrid › ESP (1)", "2-0", "1-0", "Liverpool FC › ENG (1)"),
                ("Group A", "(Tue) 21 Oct 2008 (W3)", "Liverpool FC › ENG (2)", "1-1", "0-0", "Real Madrid › ESP (2)")]
        england = [("1", "Sat Aug 25 1990", "Club (2)", "1-0", "0-0", "Other Club")]
        # An already-reviewed binding of one exact raw side: it keeps its team.
        known = self.x("INSERT INTO core.teams(name) VALUES ('Real Madrid › ESP (1)') RETURNING id").fetchone()[0]
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','vega',%s,%s)",
               (f"archive:{archives.normalize('Europe')}:{archives.normalize('Real Madrid › ESP (1)')}", known))
        teams = self.x("SELECT count(*) FROM core.teams").fetchone()[0]
        source = self.ordinal_sources(rows, england)
        self.fresh(source, ("2008/2009", "1990/1991"))
        champs = self.x("""SELECT home_team_name, home_team_id, away_team_name, away_team_id FROM core.matches
                           WHERE archive_key LIKE 'r:europe/2008-09/champs:%' ORDER BY archive_key""").fetchall()
        self.assertEqual(champs, [("Real Madrid › ESP (1)", known, "Liverpool FC › ENG (1)", None),
                                  ("Liverpool FC › ENG (2)", None, "Real Madrid › ESP (2)", None)])
        self.assertFalse(self.x("SELECT 1 FROM core.teams WHERE name LIKE '%%›%%' AND id <> %s", (known,)).fetchone())
        # Another feed's « (2) » is a name, decoded by no rule: its teams are made as before.
        self.assertEqual(self.x("SELECT count(*) FROM core.teams").fetchone()[0], teams + 2)
        self.assertTrue(self.x("SELECT 1 FROM core.teams WHERE name = 'Club (2)'").fetchone())
        # The edition says what each side is.
        results, _ = archives.build_sources(source, self.work / "built")
        index = json.loads((results / "index.json").read_text())
        path = next(results / Path(e["path"]).name for e in index["seasons"] if e["id"] == "2008/2009")
        side = archives.edition(path, None)["matches"][0]["sides"]["team1"]
        self.assertEqual(side, {"raw": "Liverpool FC › ENG (2)", "label": "Liverpool FC", "association": "ENG", "ordinal": 2})

    def test_22l_a_champs_side_of_another_form_stops_the_build(self):
        source = self.ordinal_sources([("Group A", "(Wed) 17 Sep 2008 (W1)", "Real Madrid (1)", "2-0", "1-0", "Liverpool FC › ENG (1)")])
        with self.assertRaises(archives.ArchiveError):
            archives.plan(self.db, source, {"2008/2009"})

    # -- reviewed quarantines --
    def test_22m_a_quarantined_key_is_kept_as_stored_and_not_written_fresh(self):
        everton = "g:eng-premier-league:2015-08-09:2"
        reviewed = {everton: {"reason": "wrong_competition_edition", "file": "worldclub/goals/eng-premier-league.csv.gz",
                              "sha256": "test", "production_id": None}}
        with patch.dict(archives.QUARANTINE, reviewed, clear=True):
            self.fresh(self.sources())
            self.assertNotIn(everton, [r[0] for r in self.state()])
        self.x("TRUNCATE core.matches, core.provider_ids, core.teams, core.competition_seasons, core.competitions, ops.resource_versions, core.source_revisions RESTART IDENTITY CASCADE")
        self.fresh(self.sources())
        stored = {r[0]: r for r in self.state()}[everton]
        changed = goal_rows({3: ("2015-2016", "2015-08-09", "Everton vs. Watford 3:2", "Ross Barkley", "Everton", "45+2", "1", "1")})
        with patch.dict(archives.QUARANTINE, reviewed, clear=True):
            source = self.sources(changed)
            plan = archives.plan(self.db, source, {SEASON})
            self.assertEqual(self.entries(plan)[everton]["held"], "wrong_competition_edition")
            archives.apply(self.db, source, plan, {SEASON})
        self.assertEqual({r[0]: r for r in self.state()}[everton], stored)

    # -- plan and apply --
    def test_22n_two_seasons_sharing_a_new_team_apply_once(self):
        shared = {"eng-fa-cup": [("2014-2015", "2015-01-01", "Shared FC vs. Other FC 1:0", "Someone", "Shared FC", "10", "1", "0"),
                                 ("2015-2016", "2016-01-01", "Shared FC vs. Other FC 1:0", "Someone", "Shared FC", "10", "1", "0")]}
        source = self.sources(shared)
        seasons = {"2014/2015", SEASON}
        plan = archives.plan(self.db, source, seasons)
        report = archives.apply(self.db, source, plan, seasons)
        self.assertEqual(report["seasons"], {"2014/2015": "applied", SEASON: "applied"})
        self.assertEqual(report["status"], "complete")
        self.assertEqual(self.x("SELECT count(*) FROM core.teams WHERE name = 'Shared FC'").fetchone()[0], 1)
        settled, published = self.state(), self.published()
        again = archives.apply(self.db, source, plan, seasons)
        self.assertNotEqual(again["status"], "complete")
        self.assertEqual((self.state(), self.published()), (settled, published))

    def test_22o_a_change_between_plan_and_apply_is_drift(self):
        self.fresh(self.sources())
        self.x("UPDATE core.matches SET home_team_name = 'Arsenal' WHERE archive_key = %s", (ARSENAL,))  # §23: a stored score is a published observation (held); a renamed side is a plain restore
        source = self.sources()
        plan = archives.plan(self.db, source, {SEASON})
        self.assertEqual(self.entries(plan)[ARSENAL]["class"], "changed")
        match, team = self.x("SELECT id, home_team_id FROM core.matches WHERE archive_key = %s", (ARSENAL,)).fetchone()
        self.x("INSERT INTO core.match_events(season_id, match_id, seq, event_type, team_id, minute) VALUES (2015, %s, 100, 'yellow_card', %s, 88)", (match, team))
        before, events, published = self.state(), self.events(), self.published()
        report = archives.apply(self.db, source, plan, {SEASON})
        self.assertEqual((report["seasons"][SEASON], report["status"]), ("drift", "refused"))
        self.assertEqual((self.state(), self.events(), self.published()), (before, events, published))
        # A binding moved between plan and apply.
        self.x("DELETE FROM core.match_events WHERE event_type = 'yellow_card'")
        plan = archives.plan(self.db, source, {SEASON})
        other = self.x("INSERT INTO core.teams(name) VALUES ('Moved') RETURNING id").fetchone()[0]
        self.x("UPDATE core.provider_ids SET entity_id = %s WHERE entity_type = 'team' AND entity_id = %s", (other, team))
        self.assertEqual(archives.apply(self.db, source, plan, {SEASON})["seasons"][SEASON], "drift")
        # A team the plan creates, created meanwhile by someone else.
        newcomer = {"eng-premier-league": GOALS + [("2015-2016", "2015-08-30", "Brand New vs. Everton 1:0", "X", "Brand New", "5", "1", "0")]}
        source = self.sources(newcomer)
        plan = archives.plan(self.db, source, {SEASON})
        [key] = [k for k in plan["seasons"][SEASON]["teams_to_create"] if k.endswith(":brand new")]
        made = self.x("INSERT INTO core.teams(name) VALUES ('Brand New') RETURNING id").fetchone()[0]
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','vega',%s,%s)", (key, made))
        self.assertEqual(archives.apply(self.db, source, plan, {SEASON})["seasons"][SEASON], "drift")

    def test_22p_refused_drifted_or_noop_applies_publish_nothing(self):
        self.fresh(self.sources())
        etag, published = self.api(), self.published()
        self.assertEqual(etag[0], 200)
        source = self.sources()
        plan = archives.plan(self.db, source, {SEASON})
        # Inputs that are not the plan's: refused before anything.
        other = self.sources(goal_rows({2: GOALS[2][:3] + ("Jamie Vardy jr",) + GOALS[2][4:]}))
        with self.assertRaises(archives.ArchiveError):
            archives.apply(self.db, other, plan, {SEASON})
        self.assertEqual((self.api(), self.published()), (etag, published))
        # The same inputs, nothing to change.
        self.assertEqual(plan["seasons"][SEASON]["matches"], [])
        archives.apply(self.db, source, plan, {SEASON})
        self.assertEqual((self.api(), self.published()), (etag, published))
        # A drifted season.
        self.x("UPDATE core.matches SET home_score = 9 WHERE archive_key = %s", (ARSENAL,))
        changed = archives.plan(self.db, source, {SEASON})
        self.x("UPDATE core.matches SET home_score = 8 WHERE archive_key = %s", (ARSENAL,))
        published = self.published()
        etag = self.api()
        self.assertEqual(archives.apply(self.db, source, changed, {SEASON})["seasons"][SEASON], "drift")
        self.assertEqual((self.api(), self.published()), (etag, published))

    def test_22q_no_mode_refuses_and_fresh_needs_an_empty_season(self):
        from vega.store import connect_local

        source = self.sources()
        with patch.dict(os.environ, {"V2_DATABASE_URL": DSN}), patch("vega.worker.connect", connect_local):
            self.assertEqual(archives.main(["--sources", str(source)]), 2)
            self.assertEqual(self.state(), [])
            self.assertEqual(archives.main(["--sources", str(source), "--fresh"]), 0)
            stored = self.state()
            self.assertEqual(len(stored), 4)
            self.assertEqual(archives.main(["--sources", str(source), "--fresh"]), 1)
            self.assertEqual(self.state(), stored)
        task = (ROOT.parent / "infra/aws/worker.yaml").read_text()
        self.assertIn("Command: [--sources, !Sub 's3://${ArchiveSourcesBucket}/data/sources', --fresh]", task)
        self.assertIn('\\"--fresh\\"', (ROOT.parent / "infra/aws/import-test.sh").read_text())

    def test_22r_a_held_record_beside_a_repair_is_a_partial_apply(self):
        self.fresh(self.sources())
        self.x("UPDATE core.matches SET home_team_name = 'Leicester' WHERE archive_key = 'r:2015-16/en.1:1'")  # §23: a stored score is a published observation (held); a renamed side is a plain restore
        source = self.sources(goal_rows({1: None}))  # Arsenal–West Ham loses a goal: held
        plan = archives.plan(self.db, source, {SEASON})
        entries = self.entries(plan)
        self.assertEqual((entries[ARSENAL]["class"], entries["r:2015-16/en.1:1"]["class"]), ("held", "changed"))
        path = self.work / "plan.json"
        path.write_text(archives.canonical(plan) + "\n")
        digest = __import__("hashlib").sha256(path.read_bytes()).hexdigest()
        from vega.store import connect_local

        with patch.dict(os.environ, {"V2_DATABASE_URL": DSN}), patch("vega.worker.connect", connect_local):
            self.assertEqual(archives.main(["--sources", str(source), "--apply", str(path), "--plan-sha256", digest, "--seasons", SEASON]), 3)
        self.assertEqual(self.x("SELECT home_team_name FROM core.matches WHERE archive_key = 'r:2015-16/en.1:1'").fetchone()[0], "Leicester City FC")
        self.assertEqual(len([e for e in self.events() if e[0] == ARSENAL]), 2)

    def test_22s_the_collect_role_plans_and_applies_and_still_cannot_read_agg(self):
        self.fresh(self.sources())
        match = self.x("SELECT id FROM core.matches WHERE archive_key = %s", (ARSENAL,)).fetchone()[0]
        self.x("INSERT INTO ops.data_warnings(match_id, kind, detail) VALUES (%s, 'duplicate_match', 'test')", (match,))
        self.x("UPDATE core.matches SET home_team_name = 'Arsenal' WHERE archive_key = %s", (ARSENAL,))  # §23: a stored score is a published observation (held); a renamed side is a plain restore
        self.x("SET ROLE vega_collect")
        self.addCleanup(self.x, "RESET ROLE")
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            with self.db.transaction():
                self.x("SELECT 1 FROM agg.team_elo LIMIT 1")
        self.assertEqual(archives.Loader(self.db).dependents([match]), {match: ["ops.data_warnings.match_id"]})
        # Least privilege: no other role runs it, and collect still has no agg table (written after migration 134).
        for role in ("vega_read", "vega_calc"):
            self.x(f"SET ROLE {role}")
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                with self.db.transaction():
                    self.x("SELECT * FROM ops.archive_match_dependents(ARRAY[1])")
        self.x("SET ROLE vega_collect")
        self.assertFalse(self.x("""SELECT 1 FROM information_schema.role_table_grants WHERE grantee = 'vega_collect' AND table_schema = 'agg'""").fetchone())
        source = self.sources()
        plan = archives.plan(self.db, source, {SEASON})
        self.assertEqual(archives.apply(self.db, source, plan, {SEASON})["seasons"][SEASON], "applied")
        self.assertEqual(self.x("SELECT home_team_name FROM core.matches WHERE id = %s", (match,)).fetchone()[0], "Arsenal FC")

    def test_22u_a_stored_plan_is_applied_by_its_digest_once(self):
        from vega.store import connect_local

        self.fresh(self.sources())
        self.x("UPDATE core.matches SET home_team_name = 'Arsenal' WHERE archive_key = %s", (ARSENAL,))  # §23: a stored score is a published observation (held); a renamed side is a plain restore
        source = self.sources()
        digest = archives.store_plan(self.db, archives.plan(self.db, source, {SEASON}))
        self.assertEqual(archives.stored_plan(self.db, digest)["seasons"][SEASON]["counts"]["changed"], 1)
        other = connect_local(DSN)
        self.addCleanup(other.close)
        report = archives.apply_stored(other, source, digest)
        self.assertEqual(report["status"], "complete")
        receipt = self.x("SELECT applied_at IS NOT NULL, receipt->>'status' FROM ops.archive_plans WHERE sha256 = %s", (digest,)).fetchone()
        self.assertEqual(receipt, (True, "complete"))
        settled = self.state()
        with self.assertRaises(archives.ArchiveError):
            archives.apply_stored(other, source, digest)
        self.assertEqual(self.state(), settled)


@unittest.skipUnless(NODE, "requires node")
class PackagedLayoutTest(unittest.TestCase):
    """22t: the image's file set gives the checkout's parser manifest; a missing file is an error."""

    def manifest(self, app, env):
        code = "import json, vega.archives as a; print(json.dumps(a.code_manifest()))"
        done = subprocess.run([sys.executable, "-I", "-c", f"import sys; sys.path.insert(0, {str(app)!r}); {code}"],
                              capture_output=True, text=True, env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1", **env), cwd=app)
        return done

    def test_22t(self):
        repo = ROOT.parent
        app = Path(tempfile.mkdtemp()) / "app"
        self.addCleanup(shutil.rmtree, app.parent, True)
        # The Dockerfile's COPY lines for the archive import.
        shutil.copytree(ROOT / "vega", app / "vega", ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copytree(ROOT / "archives", app / "backend/archives", ignore=shutil.ignore_patterns("__pycache__"))
        shared = app / "dashboard/shared"
        shared.mkdir(parents=True)
        for name in ("archive.js", "archive-text.js", "openfootball-history.js"):
            shutil.copy(repo / "dashboard/shared" / name, shared / name)
        shutil.copytree(repo / "dashboard/shared/legacy-8018e08", shared / "legacy-8018e08")
        env = {"VEGA_ARCHIVE_SCRIPTS": str(app / "backend/archives/builders"), "VEGA_ARCHIVE_EDITION": str(app / "backend/archives/edition.mjs")}
        packaged = self.manifest(app, env)
        self.assertEqual(packaged.returncode, 0, packaged.stderr)
        self.assertEqual(json.loads(packaged.stdout), archives.code_manifest())
        self.assertIn("shared/legacy-8018e08/archive.js", archives.code_manifest())
        self.assertIn("vega/archives.py", archives.code_manifest())
        (shared / "legacy-8018e08/openfootball-history.js").unlink()
        missing = self.manifest(app, env)
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("ArchiveError", missing.stderr)
        dockerfile = (ROOT / "Dockerfile").read_text()
        self.assertIn("COPY dashboard/shared/legacy-8018e08 dashboard/shared/legacy-8018e08", dockerfile)


if __name__ == "__main__":
    unittest.main()
