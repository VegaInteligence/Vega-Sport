"""Owned PostgreSQL archive publication, rollback and maintenance contracts.

Uses a disposable loopback database with no application schema. Unlike the
rollback-only reader fixture, this test commits synthetic publications so the
real dedicated Node maintenance connection can verify its own transaction.
All objects created here are removed in finally; the CI cluster is disposable.
"""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "dashboard/scripts"), str(ROOT / "tests")]
from archive_projection import MODEL, refresh_archive_projection
from consolidated_model import MODEL_DIGEST
from consolidation_postgres import PGliteCopyAdapter
from relational_catalog import publish_catalog

SEASON = "2018/2019"
RESULTS_PATH = "raw/openfootball/2018-19.json"
GOALS_PATH = "raw/historical-goals/2018-19.json"


def main():
    address = os.environ["TEST_DATABASE_URL"]
    target = urlsplit(address)
    if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path not in (
        "/vega_refactor_test", "/vega_archive_projection_test",
    ):
        raise RuntimeError("A disposable loopback archive test database is required")
    checks = []

    def check(name, value):
        if not value:
            raise AssertionError(name)
        checks.append(name)

    source = """
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root=process.argv[1], options=JSON.parse(process.argv[2]);
const require=createRequire(pathToFileURL(root+'/dashboard/package.json'));
const {Client}=require('pg');
const {refreshArchiveProjection}=await import(pathToFileURL(root+'/dashboard/scripts/archive_projection.mjs'));
const client=new Client({connectionString:process.env.TEST_DATABASE_URL});
await client.connect();
const expireAfterInsert=Boolean(options.deadlineAfterInsert); delete options.deadlineAfterInsert;
const realNow=performance.now.bind(performance); let expired=false; const budgets=[];
Object.defineProperty(performance,'now',{value:()=>realNow()+(expired?45000:0)});
const realQuery=client.query.bind(client);
client.query=async(config,...args)=>{
  const text=typeof config==='string'?config:config.text;
  if(text.startsWith("SELECT set_config('statement_timeout'")) budgets.push(Number.parseInt(config.values[0],10));
  const result=await realQuery(config,...args);
  if(expireAfterInsert && text.startsWith('INSERT INTO statarena_app.archive_read_matches')) expired=true;
  return result;
};
try {
  const receipt=await refreshArchiveProjection(client,'2018/2019',options);
  console.log(JSON.stringify({...receipt,deadlineBudgets:budgets}));
}
catch(error) { console.error(error.message); process.exitCode=1; }
finally { await client.end(); }
"""

    def maintenance(*, error=None, **options):
        result = subprocess.run(["node", "--input-type=module", "-e", source, str(ROOT), json.dumps(options)],
                                text=True, capture_output=True, check=False, timeout=90)
        if error:
            check(error, result.returncode != 0 and error in result.stderr)
            return None
        if result.returncode:
            raise RuntimeError(result.stderr[-3000:])
        return json.loads(result.stdout)

    results = {"season": SEASON, "competitions": [{"id": "2018-19/fr.1", "name": "Ligue 1", "country": "France", "matches": [
        {"date": "2018-10-01", "team1": "Paris Saint-Germain", "team2": "Lille", "score": {"ft": [2, 1]}},
        {"date": "2018-10-02", "team1": "Nantes", "team2": "Nice", "score": {"ft": [0, 0]}},
    ]}]}
    goal = {"date": "2018-10-02", "match": "Paris Saint-Germain vs. Lille 2:1", "minute": "23", "player": "Thomas Müller",
            "team": "Paris Saint-Germain", "score": [1, 0]}
    goals = {"season": SEASON, "competitions": [{"id": "fra", "name": "France", "country": "France", "events": [
        goal, copy.deepcopy(goal),
        {"date": "2018-10-03", "match": "Rapid Wien vs. Admira 3:0", "minute": "5", "player": "X", "team": "Rapid Wien", "score": [1, 0]},
    ]}]}
    index = {"seasons": [{"id": SEASON}]}
    created = False
    retired_created = False
    with psycopg.connect(address, autocommit=True) as db:
        check("fresh disposable schema", db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0] is None)
        publishing = PGliteCopyAdapter(db) if "PGlite" in db.execute("SELECT version()").fetchone()[0] else db
        try:
            with db.transaction():
                for filename in ("006_catalog_models.sql", "032_archive_read_projection.sql"):
                    db.execute((ROOT / "dashboard/backend/migrations" / filename).read_text(), prepare=False)
            created = True

            def state():
                return (
                    db.execute("SELECT resource_id,source_digest,updated_at FROM statarena_app.catalog_editions ORDER BY resource_id").fetchall(),
                    db.execute("SELECT ctid::text,xmin::text,row_to_json(p)::text FROM statarena_app.archive_read_editions p ORDER BY season").fetchall(),
                    db.execute("SELECT ctid::text,xmin::text,row_to_json(m)::text FROM statarena_app.archive_read_matches m ORDER BY season,ordinal").fetchall(),
                )

            def header():
                return db.execute("SELECT version,summary,source_fence FROM statarena_app.archive_read_editions WHERE season=%s", (SEASON,)).fetchone()

            initial = [("raw/openfootball/index.json", index), ("raw/historical-goals/index.json", index), (RESULTS_PATH, results)]
            check("sources publish while an expected stream is still pending", publish_catalog(publishing, initial) == {"changed": 3, "unchanged": 0})
            check("incomplete season has no invented projection", header() is None)
            check("remaining source creates the complete projection atomically", publish_catalog(publishing, [(GOALS_PATH, goals)]) == {"changed": 1, "unchanged": 0})
            first = header()
            check("exact deduplicated goals, unmatched match and whole-edition totals", first[1] == {
                "matches": 3, "results": 3, "withGoals": 2, "goals": 2, "competitions": 1,
            })
            before = state()
            check("unchanged source replay is a no-op", publish_catalog(publishing, initial + [(GOALS_PATH, goals)]) == {"changed": 0, "unchanged": 4})
            check("unchanged replay retains projection row versions", state() == before)
            receipt = maintenance()
            check("maintenance reuses the exact current projection", receipt["ready"] and not receipt["changed"] and receipt["matches"] == 3 and state() == before)
            budgets = receipt["deadlineBudgets"]
            check("each query consumes the remaining overall budget", len(budgets) >= 5 and all(0 < b <= 44000 for b in budgets)
                  and all(right <= left for left, right in zip(budgets, budgets[1:])))

            corrected = copy.deepcopy(goals)
            for event in corrected["competitions"][0]["events"][:2]:
                event["player"] = "Joueur corrigé"
            publish_catalog(publishing, [(GOALS_PATH, corrected)])
            check("source correction advances the archive version", header()[0] != first[0])
            check("search is regenerated from corrected players", db.execute("SELECT count(*) FROM statarena_app.archive_read_matches WHERE position('corrige' IN search_players)>0").fetchone()[0] == 1)
            stable = state()

            db.execute("CREATE FUNCTION statarena_app.reject_archive_fixture() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture archive insertion rejected'; END$$")
            db.execute("CREATE TRIGGER reject_archive_fixture BEFORE INSERT ON statarena_app.archive_read_matches FOR EACH ROW EXECUTE FUNCTION statarena_app.reject_archive_fixture()")
            invalidated = copy.deepcopy(corrected)
            invalidated["competitions"][0]["events"][0]["player"] = "Failed update"
            try:
                publish_catalog(publishing, [(GOALS_PATH, invalidated)])
            except psycopg.errors.RaiseException:
                check("publisher failure rolls back both sources and projection", state() == stable)
            else:
                raise AssertionError("Projection failure committed a source publication")
            maintenance(force=True, error="fixture archive insertion rejected")
            check("dedicated maintenance failure rolls back the old projection", state() == stable)
            db.execute("DROP TRIGGER reject_archive_fixture ON statarena_app.archive_read_matches")
            db.execute("DROP FUNCTION statarena_app.reject_archive_fixture()")
            maintenance(force=True, deadlineAfterInsert=True, error="Archive refresh deadline exhausted")
            check("overall deadline after a real insert rolls back the complete replacement", state() == stable)

            sources_before = state()[0]
            receipt = maintenance(force=True)
            check("explicit rebuild preserves every canonical header", receipt["changed"] and state()[0] == sources_before)
            check("Node maintenance and Python publisher share the version", receipt["version"] == header()[0])
            preceding = header()
            publish_catalog(publishing, [("raw/historical-goals/index.json", {"seasons": []})])
            check("index membership changes rebuild the expected-stream fence", header()[0] != preceding[0] and header()[2]["expected_scopes"] == ["results"])
            check("index membership does not discard a still-published source", header()[1] == preceding[1])

            db.execute("CREATE TABLE statarena_app.consolidation_state(key text PRIMARY KEY,value jsonb NOT NULL)")
            control = {"mode": "backfill", "model_digest": MODEL_DIGEST, "revision": 7}
            db.execute("INSERT INTO statarena_app.consolidation_state VALUES('control',%s)", (Jsonb(control),))
            maintenance(error="Archive refresh is paused during this storage operation")
            stable = state()
            try:
                publish_catalog(publishing, [(GOALS_PATH, invalidated)])
            except RuntimeError as error:
                check("normal source publication stays paused in backfill", "paused" in str(error) and state() == stable)
            else:
                raise AssertionError("Normal publication bypassed the migration pause")
            receipt = maintenance(maintenance=True, force=True)
            check("explicit derived-only maintenance is safe in backfill", receipt["changed"] and receipt["controlUnchanged"] and receipt["controlRevision"] == 7)
            check("maintenance preserves the complete consolidation control", db.execute("SELECT value FROM statarena_app.consolidation_state WHERE key='control'").fetchone()[0] == control)
            for mode in ("rollback", "unknown"):
                db.execute("UPDATE statarena_app.consolidation_state SET value=jsonb_set(value,'{mode}',%s)", (Jsonb(mode),))
                maintenance(maintenance=True, error="Archive refresh is paused during this storage operation")
            check("model and merger revision agree", MODEL["revision"] == db.execute("SELECT revision FROM statarena_app.archive_read_editions WHERE season=%s", (SEASON,)).fetchone()[0])
            # Prime the same connection's SQL-function plan, then reproduce
            # the table-to-view name switch used by provider consolidation.
            check("unpublished fixture season has no expected stream", db.execute("SELECT statarena_app.archive_source_fence('0999/1000')->'expected_scopes'").fetchone()[0] == [])
            db.execute("CREATE SCHEMA vega_archive_retired_fixture")
            retired_created = True
            db.execute("CREATE TABLE statarena_app.archive_index_fixture_next (LIKE statarena_app.cat_archive_results_index_seasons INCLUDING ALL)")
            db.execute("INSERT INTO statarena_app.archive_index_fixture_next SELECT * FROM statarena_app.cat_archive_results_index_seasons")
            with db.transaction():
                db.execute("ALTER TABLE statarena_app.cat_archive_results_index_seasons SET SCHEMA vega_archive_retired_fixture")
                db.execute("CREATE VIEW statarena_app.cat_archive_results_index_seasons AS SELECT * FROM statarena_app.archive_index_fixture_next")
            db.execute("""INSERT INTO statarena_app.archive_index_fixture_next(resource_id,record_no,parent_no,position,missing,null_groups,id)
                SELECT resource_id,999,0,999,'{}','{}','0999/1000' FROM statarena_app.catalog_editions
                WHERE catalog='archive-index' AND scope='results' AND edition=''""")
            check("cached source fence follows the new view after a schema switch and publication", db.execute("SELECT statarena_app.archive_source_fence('0999/1000')->'expected_scopes'").fetchone()[0] == ["results"]
                  and db.execute("SELECT count(*) FROM vega_archive_retired_fixture.cat_archive_results_index_seasons WHERE id='0999/1000'").fetchone()[0] == 0)
        finally:
            if created:
                db.execute("DROP SCHEMA statarena_app CASCADE")
            if retired_created:
                db.execute("DROP SCHEMA vega_archive_retired_fixture CASCADE")
        check("owned fixture schema removed", db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0] is None)
        print(json.dumps({"status": "passed", "server_version": db.info.server_version, "checks": checks,
                          "writes": "synthetic loopback fixture only; owned schema removed"}))


if __name__ == "__main__":
    main()
