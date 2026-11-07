import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { refreshHomeProjections } from "../dashboard/scripts/home_projection.mjs";
import {
  homeReadQuery,
  homeReadRecord,
  createHomeReadRoute,
} from "../dashboard/backend/services/relational-home.js";

const url = process.env.HOME_PROJECTION_TEST_DATABASE_URL;
test(
  "real PostgreSQL publisher, trigger, temporal fence and cached parity",
  { skip: !url },
  async () => {
    const parsed = new URL(url);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname));
    assert.equal(parsed.pathname, "/home_projection_test");
    const { Client } = createRequire(
      new URL("../dashboard/package.json", import.meta.url),
    )("pg");
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      for (const name of [
        "003_relational_core.sql",
        "006_catalog_models.sql",
        "035_home_projection.sql",
      ])
        await client.query(
          await readFile(
            new URL(`../dashboard/backend/migrations/${name}`, import.meta.url),
            "utf8",
          ),
        );
      const migrationBytes = await readFile(
        new URL(
          "../dashboard/backend/migrations/035_home_projection.sql",
          import.meta.url,
        ),
      );
      await client.query(
        "CREATE TABLE statarena_app.worker_schema(version text PRIMARY KEY,digest text NOT NULL)",
      );
      await client.query(
        "INSERT INTO statarena_app.worker_schema VALUES($1,$2)",
        [
          "035_home_projection.sql",
          createHash("sha256").update(migrationBytes).digest("hex"),
        ],
      );
      const publicExecute = await client.query(`SELECT EXISTS(
        SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid='statarena_app.queue_home_projection()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'
      ) AS allowed`);
      assert.equal(publicExecute.rows[0].allowed, false);
      await client.query(
        "INSERT INTO statarena_app.partitions(season,league_id,source_digest,retrieved_at,start_date,end_date) VALUES('2025/2026','l_4WFCIZ','digest','2026-11-06T08:00:00Z','2026-08-01','2026-11-06')",
      );
      await client.query(
        "INSERT INTO statarena_app.competitions(id,name,country,latest_season) VALUES('l_4WFCIZ','Premier League','ENG','2025/2026')",
      );
      await client.query(
        "INSERT INTO statarena_app.matches(id,season,league_id,league,date,day,time_utc,status,home_id,home_name,home_score,away_id,away_name,away_score) VALUES('m_123456','2025/2026','l_4WFCIZ','Premier League','2026-11-05','2026-11-05','2026-11-05T15:00:00Z','finished','t_111111','Alpha',2,'t_222222','Beta',0)",
      );
      await client.query(
        "INSERT INTO statarena_app.fixtures(id,season,league_id,day,time_utc,status,home_team_id,home_name,away_team_id,away_name) VALUES('m_234567','2025/2026','l_4WFCIZ','2026-11-06','2026-11-06T12:00:05Z','not_started','t_111111','Alpha','t_222222','Beta')",
      );
      await client.query(
        "INSERT INTO statarena_app.players(id,player_id,name) VALUES('ref1','p_123456','Player One')",
      );
      await client.query(
        "INSERT INTO statarena_app.appearances(id,player_ref,player_id,match_id,team_id,team,league_id,season,date,minutes,rating,goals,xg) VALUES('a_1','ref1','p_123456','m_123456','t_111111','Alpha','l_4WFCIZ','2025/2026','2026-11-05',90,8,2,1.1)",
      );
      await client.query(
        "UPDATE statarena_app.publications SET generation=7,published_at='2026-11-06T10:00:00Z'",
      );
      assert.equal(
        (
          await client.query(
            "SELECT generation FROM statarena_app.home_projection_queue",
          )
        ).rows[0].generation,
        "7",
      );
      const now = Date.parse("2026-11-06T12:00:00Z");
      assert.equal((await refreshHomeProjections(client, () => now)).scopes, 2);
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int n FROM statarena_app.home_projection_queue",
          )
        ).rows[0].n,
        0,
      );
      const filters = {
        scope: { season: "2025/2026", leagueIds: null },
        archive: false,
        personalTeams: [],
        personalPlayers: [],
      };
      const params = new URLSearchParams({ season: "2025/2026" });
      const q = homeReadQuery(filters, params, now);
      const snapshot = (await client.query(q.sql, q.values)).rows[0];
      const projection = (
        await client.query(
          "SELECT * FROM statarena_app.home_projection WHERE scope_key=$1",
          [JSON.stringify(filters)],
        )
      ).rows[0];
      assert.deepEqual(
        homeReadRecord(projection.snapshot),
        homeReadRecord(snapshot),
      );
      assert.equal(new Date(projection.valid_until).getTime(), now + 5000);
      assert.equal(homeReadRecord(snapshot).resultCount, 1);
      assert.equal(homeReadRecord(snapshot).leaders.goals[0].goals, 2);
      let aggregateCalls = 0,
        clock = now + 1000;
      const route = createHomeReadRoute(
        async (sql, values) => {
          if (sql.includes("/*vega:compact:home*/")) aggregateCalls++;
          return (await client.query(sql, values)).rows;
        },
        () => clock,
      );
      const req = new Request("https://api.test/api/read/home?" + params);
      const response = await route(req, "/api/read/home", params);
      assert.equal((await response.json()).data.period.asOf, now + 1000);
      assert.equal(aggregateCalls, 0);
      clock = now + 5000;
      await route(req, "/api/read/home", params);
      assert.equal(
        aggregateCalls,
        1,
        "kickoff invalidates the projection at the exact boundary",
      );
      await client.query(
        "INSERT INTO statarena_app.matches(id,season,league_id,date,day,status,home_id,home_name,home_score,away_id,away_name,away_score) VALUES('m_345678','2025/2026','l_4WFCIZ','2026-11-09','2026-11-09','finished','t_111111','Alpha',1,'t_222222','Beta',0)",
      );
      await client.query("UPDATE statarena_app.publications SET generation=8");
      clock = Date.parse("2026-11-09T11:59:59Z");
      const archiveParams = new URLSearchParams({
        season: "2025/2026",
        archive: "1",
      });
      const archiveReq = new Request(
        "https://api.test/api/read/home?" + archiveParams,
      );
      const before = (
        await (await route(archiveReq, "/api/read/home", archiveParams)).json()
      ).data;
      const callsBefore = aggregateCalls;
      clock += 1000;
      const after = (
        await (await route(archiveReq, "/api/read/home", archiveParams)).json()
      ).data;
      assert.equal(after.period.start, "2026-11-09");
      assert.notEqual(before.period.start, after.period.start);
      assert.equal(
        aggregateCalls,
        callsBefore + 1,
        "date-only kickoff at noon invalidates archive cache",
      );
      await client.query("UPDATE statarena_app.publications SET generation=9");
      assert.equal(
        (
          await client.query(
            "SELECT generation FROM statarena_app.home_projection_queue",
          )
        ).rows[0].generation,
        "9",
      );
      const beforeGenerationRead = aggregateCalls;
      await route(req, "/api/read/home", params);
      assert.equal(aggregateCalls, beforeGenerationRead + 1);
    } finally {
      await client.end();
    }
  },
);
