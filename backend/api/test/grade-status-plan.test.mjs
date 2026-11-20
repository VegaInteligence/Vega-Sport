// The performance read's grade status is read by key (docs/calculs/09-audit-2026-11/FAILURE_MODES.md §46, 46a and
// 46b, written before the change).
//
// api.player_grade_status (155) unions the statistics and the line-ups. Joined to the route's `target` CTE, the planner
// pushed no condition into it and built the whole view at each call (14.1 s for one row on 1.5 M statistics). The route's
// own SQL is captured here and its grade-status part planned, with the values the route binds and as a generic plan:
// every scan of a statistics or line-up partition must be an index scan on the participation's key.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { context, get, skip } from "./context.mjs";
import { createHandler } from "../src/handler.mjs";

const ROUTE = "/api/read/performance?season=2025/2026&leagues=all&appearance=m_aaaaa1:p_aaaab1";
const KEYED = /^(player_match_stats|lineup_players)(_s\d{4})?$/;

/** The SQL and values the route sends for its snapshot (the statement naming the grade status). */
async function routeStatement(path) {
  const sent = [];
  const read = (sql, values) => {
    sent.push({ sql, values });
    return context.reader.read(sql, values);
  };
  const handle = createHandler({ read, mediaBase: "https://media.test/", clock: () => context.now });
  const response = await handle(new Request("https://api.test" + path));
  assert.equal(response.status, 200);
  const found = sent.filter((s) => s.sql.includes("api.player_grade_status"));
  assert.equal(found.length, 1, "one statement reads the grade status");
  return found[0];
}

/** The route's statement reduced to its CTEs and its grade-status column. */
function gradeStatusOnly(sql) {
  const select = sql.lastIndexOf("SELECT publication.*");
  const column = sql.match(/\(SELECT gs\.grade_status[\s\S]*?\) AS grade_status/);
  assert.ok(select > 0 && column, "the route's grade-status column");
  return `${sql.slice(0, select)}SELECT ${column[0]} FROM publication`;
}

/** Every plan node reading a statistics or line-up partition, with its index condition (a bitmap heap scan's is its child's),
 * outside the CTEs' own plans (the appearance itself, found by its keys, is `target`'s). */
function keyedScans(node, out = []) {
  if ((node["Subplan Name"] || "").startsWith("CTE ")) return out;
  if (KEYED.test(node["Relation Name"] || "")) {
    const conditions = [node["Index Cond"], ...(node.Plans || []).map((p) => p["Index Cond"])].filter(Boolean).join(" AND ");
    out.push({ table: node["Relation Name"], type: node["Node Type"], conditions });
  }
  for (const child of node.Plans || []) keyedScans(child, out);
  return out;
}

async function plans(statement) {
  const client = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await client.connect();
  try {
    await client.query("SET ROLE vega_read");
    await client.query("SET search_path = api");
    // The seed is a few rows: a sequential scan is cheaper there whatever the shape. Off, any scan left without an
    // index condition is one no index can serve.
    await client.query("SET enable_seqscan = off");
    const custom = (await client.query(`EXPLAIN (FORMAT JSON) ${statement.sql}`, statement.values)).rows[0]["QUERY PLAN"][0].Plan;
    await client.query("SET plan_cache_mode = force_generic_plan");
    const generic = (await client.query(`EXPLAIN (FORMAT JSON, GENERIC_PLAN) ${statement.sql}`)).rows[0]["QUERY PLAN"][0].Plan;
    return { custom, generic };
  } finally {
    await client.end();
  }
}

test("46a: the performance read still names the grade status of its key", { skip }, async () => {
  const { response, body } = await get(ROUTE);
  assert.equal(response.status, 200);
  assert.equal(body.data.gradeStatus, "graded");
  assert.equal((await get(ROUTE.replace("m_aaaaa1:p_aaaab1", "m_aaaaa5:p_aaaab2"))).body.data.gradeStatus, "no_minutes");
});

test("46b: the grade status is read by index on its key, custom and generic plans", { skip }, async () => {
  const statement = await routeStatement(ROUTE);
  const { custom, generic } = await plans({ sql: gradeStatusOnly(statement.sql), values: statement.values });
  for (const [name, plan] of Object.entries({ custom, generic })) {
    const scans = keyedScans(plan);
    assert.ok(scans.some((s) => s.table.startsWith("lineup_players")), `${name}: the line-up branch is read`);
    assert.ok(scans.filter((s) => s.table.startsWith("player_match_stats")).length >= 2, `${name}: the statistics branch and its NOT EXISTS`);
    // On the participation's key: the primary key (season, match, player) or the player's index (player, season), as
    // the planner prefers for the seed's few rows; never a scan without a condition.
    for (const scan of scans) {
      assert.doesNotMatch(scan.type, /Seq Scan/, `${name}: ${scan.type} on ${scan.table}`);
      assert.match(scan.conditions, /\bplayer_id = /, `${name}: ${scan.type} on ${scan.table} without a condition on the player`);
    }
  }
});
