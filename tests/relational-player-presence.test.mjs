import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createPlayerPresenceRoute } from "../dashboard/backend/services/relational-player-presence.js";
const request = (route, params, options) => {
  const u = new URL("https://example.test/api/read/presence");
  u.search = new URLSearchParams(params);
  return route(new Request(u, options), u.pathname, u.searchParams);
};
const base = {
  season: "2026/2027",
  player: "p_000001",
  matches: "m_000001,m_000002",
};
test("validates input before SQL", async () => {
  const route = createPlayerPresenceRoute(() => {
    throw Error("unexpected SQL");
  });
  for (const params of [
    { ...base, player: "bad" },
    { ...base, matches: "m_000001,bad" },
    {
      ...base,
      matches: Array.from(
        { length: 201 },
        (_, i) => `m_${String(i).padStart(6, "0")}`,
      ).join(","),
    },
    { ...base, generation: "bad" },
  ])
    await assert.rejects(request(route, params), (e) => e.status === 400);
});
const url = process.env.VEGA_TEST_DATABASE_URL;
test(
  "SQL aggregates exact players, normalizes away, rejects invalid and respects generation",
  { skip: !url },
  async () => {
    const require = createRequire(
        new URL("../dashboard/package.json", import.meta.url),
      ),
      { Client } = require("pg"),
      db = new Client({ connectionString: url });
    await db.connect();
    try {
      await db.query("BEGIN");
      for (const n of ["003_relational_core.sql", "004_match_details.sql"])
        await db.query(
          readFileSync(
            new URL(`../dashboard/backend/migrations/${n}`, import.meta.url),
            "utf8",
          ),
        );
      await db.query(`UPDATE statarena_app.publications SET generation=42;
 INSERT INTO statarena_app.partitions(season,league_id,source_digest) VALUES ('2026/2027','l_000001','x');
 INSERT INTO statarena_app.players(id,player_id,name) VALUES ('p_000001','p_000001','A');
 INSERT INTO statarena_app.matches(id,season,league_id,status,home_id,away_id) VALUES ('m_000001','2026/2027','l_000001','finished','t_000001','t_000002'),('m_000002','2026/2027','l_000001','finished','t_000001','t_000002');
 INSERT INTO statarena_app.appearances(id,player_ref,player_id,match_id,team_id,season,league_id) VALUES ('a1','p_000001','p_000001','m_000001','t_000001','2026/2027','l_000001'),('a2','p_000001','p_000001','m_000002','t_000002','2026/2027','l_000001');
 INSERT INTO statarena_app.match_details(match_id) VALUES ('m_000001'),('m_000002');
 INSERT INTO statarena_app.match_families(match_id,family,subject_id,params,status,has_data,has_error,error_object,error_has_code,error_has_message,source_digest) VALUES ('m_000001','heatmaps','','{}',200,true,false,false,false,false,repeat('a',64)),('m_000002','heatmaps','','{"frame":"home_ltr"}',200,true,false,false,false,false,repeat('b',64));
 INSERT INTO statarena_app.heatmap_sheets(resource_id,record_no,missing,null_groups,match_id,grid_frame,grid_length,grid_width) SELECT resource_id,0,'{}','{}',match_id,CASE WHEN match_id='m_000001' THEN 'acting_ltr' ELSE 'home_ltr' END,16,12 FROM statarena_app.match_families;
 INSERT INTO statarena_app.player_heatmaps(resource_id,record_no,missing,null_groups,parent_no,position,team_id,player_id,side,actions,cells) SELECT resource_id,0,'{}','{}',0,0,CASE WHEN match_id='m_000001' THEN 't_000001' ELSE 't_000002' END,'p_000001',CASE WHEN match_id='m_000001' THEN 'home' ELSE 'away' END,3,CASE WHEN match_id='m_000001' THEN ARRAY[[1,2,3],[0,0,0]] ELSE ARRAY[[14,9,3]] END FROM statarena_app.match_families;`);
      const route = createPlayerPresenceRoute(
          async (sql, values) => (await db.query(sql, values)).rows,
        ),
        response = await request(route, base);
      const body = await response.json();
      assert.deepEqual(body.data, {
        requested: 2,
        covered: 2,
        actions: 6,
        length: 16,
        width: 12,
        cells: [[1, 2, 6]],
      });
      const etag = response.headers.get("etag");
      assert.equal(
        (await request(route, base, { headers: { "if-none-match": etag } }))
          .status,
        304,
      );
      await db.query(
        "UPDATE statarena_app.match_families SET source_digest=repeat('c',64) WHERE match_id='m_000001'",
      );
      assert.notEqual((await request(route, base)).headers.get("etag"), etag);
      await db.query(
        "UPDATE statarena_app.player_heatmaps SET side='home' WHERE team_id='t_000002'",
      );
      assert.equal((await (await request(route, base)).json()).data.covered, 1);
      await db.query(
        "UPDATE statarena_app.player_heatmaps SET side='away' WHERE team_id='t_000002'",
      );
      await db.query(
        "UPDATE statarena_app.player_heatmaps SET actions=4 WHERE team_id='t_000002'",
      );
      const invalid = await (await request(route, base)).json();
      assert.equal(invalid.data.covered, 1);
      await assert.rejects(
        request(route, { ...base, generation: "41" }),
        (e) => e.status === 409,
      );
    } finally {
      await db.query("ROLLBACK");
      await db.end();
    }
  },
);
