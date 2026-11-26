// GH257: unconditional public reads through the production transport, handler and PostgreSQL role.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import pg from "pg";
import { DB_BUDGET_MS, readTiming } from "../../../infra/aws/smoke-public-reads.mjs";
import { adapt } from "../../../infra/aws/transport.mjs";
import { context, skip } from "./context.mjs";
import { createReader } from "../src/db.mjs";
import { createHandler } from "../src/handler.mjs";
import { routeFamily } from "../src/route-family.mjs";
import * as profiles from "../src/routes/profiles.mjs";

const season = "2025/2026";
const scope = "season=" + season + "&leagues=all";
const team = "t_aaaaa1";
const club = "/api/teams/" + team;
const match = "/api/matches/m_aaaaa1";
const passing = club + "/passing?season=" + season;
const lineups = match + "/lineups";
const substitutions = "/api/teams/t_v0008011/substitutions?season=" + season;
const photo = "https://img.example/p1.png";
const dressed = (d) => [d.home, d.away].flatMap((l) => [...l.starters, ...l.subs]);
const ids = (rows) => rows.map((r) => r.id);
const scenarios = [
  [club, ({ data }) => assert.deepEqual([data.id, data.name], [team, "Olympique Été"])],
  [club + "/age-profile?season=" + season, ({ data }) =>
    assert.deepEqual(data.minutesByAge, [{ age: 26, minutes: 90 }, { age: null, minutes: 260 }])],
  [club + "/absences", ({ data }) => assert.deepEqual(data, { id: team, asOf: null, squad: { players: 0, read: 0 }, absences: [] }),
    { reason: "The fixture has no Transfermarkt squad or absence read." }],
  [club + "/similar?season=" + season, null, { status: 404, reason: "The shared fixture has no ten clubs with published style axes." }],
  [club + "/squad?season=" + season, null, { status: 404, reason: "The shared fixture has no Transfermarkt club valuation." }],
  [passing, ({ data }) => {
    assert.equal(data.id, team);
    assert.deepEqual([data.pair.passes, ids(data.pair.players)], [14, ["p_aaaab1", "p_aaaab2"]]);
    assert.deepEqual(data.pair.players, [{ id: "p_aaaab1", name: "Élie Durand", image_url: photo }, { id: "p_aaaab2", name: "Marc Petit" }]);
    assert.deepEqual([data.triangle.passes, ids(data.triangle.players)], [25, ["p_aaaab1", "p_aaaab2", "p_aaaab4"]]);
  }],
  [club + "/substitutions?season=" + season, ({ data }) =>
    assert.deepEqual([data.id, data.matches, data.pointsThen, data.points, data.substitutes], [team, 2, 4, 4, []]),
  { reason: "The shared fixture has two complete impact matches and no decisive substitute. The separate club fixture checks a populated top three." }],
  ["/api/read/club?" + scope + "&team=" + team, ({ data }) => {
    assert.deepEqual(data.meta.actor, { kind: "club", id: team });
    assert.deepEqual(ids(data.fixtures), ["m_aaaaa5", "m_aaaaa3", "m_aaaaa1"]);
  }],
  ["/api/read/clubs?" + scope + "&analysis=1", ({ data, pagination }) => {
    assert.equal(pagination.total, 4);
    const found = data.clubs.find((r) => r.id === team);
    assert.deepEqual([found.matches, found.points], [3, 4]);
  }],
  ["/api/clubs/europe?season=" + season, ({ data }) => assert.deepEqual(ids(data.clubs).sort(), [team, "t_aaaaa2", "t_aaaaa3", "t_aaaaa4"])],
  ["/api/clubs/europe/matches?season=" + season + "&league=l_3FJFUl", ({ data }) => assert.deepEqual(ids(data.matches), ["m_aaaaa1", "m_aaaaa2", "m_aaaaa3", "m_aaaaa4", "m_aaaaa5"])],
  ["/api/club-facts?club=" + team, (body) => assert.deepEqual([body.founded, body.stadium], ["1950", "Stade Été"])],
  ["/api/stadium?club=" + team, (body) => assert.deepEqual([body.id, body.capacity], ["Q1150", 41000])],
  ["/api/club-links?club=" + team, (body) => assert.equal(body.links[team].entityId, "uefa:52747")],
  ["/api/rankings/club?club=" + team, (body) => assert.deepEqual(body.rows.map((r) => r.row.position), [40])],
  ["/api/players/p_aaaab2", ({ data }) => {
    assert.deepEqual([data.id, data.name, data.birth_date, data.height_cm, data.preferred_foot, data.contract_team, data.market_value_eur],
      ["p_aaaab2", "Marc Petit", "1999-05-06", 181, "both", "Olympique Été", 15000000]);
  }],
  ["/api/read/player?" + scope + "&player=p_aaaab1", ({ data }) =>
    assert.deepEqual(data.appearances.map((a) => [a.matchId, a.goals]), [["m_aaaaa1", 2], ["m_aaaaa3", 0], ["m_aaaaa5", 0]])],
  ["/api/read/players?" + scope, ({ data, pagination }) => {
    assert.deepEqual(ids(data.players), ["p_aaaab4", "p_aaaab3", "p_aaaab1", "p_aaaab2"]);
    assert.equal(pagination.total, 4);
    assert.deepEqual(data.players[2].totals.goals, 2);
  }],
  [match, ({ data }) => assert.deepEqual([data.id, data.status, data.home_team.id, data.score_home, data.score_away], ["m_aaaaa1", "finished", team, 2, 0])],
  [lineups, ({ data }) => {
    assert.equal(data.match_id, "m_aaaaa1");
    assert.deepEqual(dressed(data).map((r) => [r.player_id, r.image_url]).sort(),
      [["p_aaaab1", photo], ["p_aaaab2", null], ["p_aaaab4", null]]);
  }],
  ["/api/rankings/level?season=" + season, (body) =>
    assert.deepEqual(body.rows.map((r) => [r.playerId, r.rank, r.score]), [["p_aaaab1", 1, 79.7], ["p_aaaab4", 2, 50], ["p_aaaab3", 3, 40.5]])],
  ["/api/read/home?" + scope, ({ data }) => assert.deepEqual([data.resultCount, data.featured.id, data.tables[0].rows[0].id], [5, "m_aaaaa1", team])],
];

const report = {
  setup: {
    node: process.version, role: "vega_read", maxConnections: 1, statementTimeoutMs: 8000,
    fixture: ["backend/api/test/seed.py", "backend/api/test/public-cold-reads-fixture.sql", "backend/api/test/public-cold-reads-noise.sql"],
    command: "PYTHONPATH=backend VEGA_V2_API_NODE_TEST_DSN=<local DSN> node --test backend/api/test/public-cold-reads.test.mjs",
    cold: "unconditional GET via the production Lambda transport, without a CDN; PostgreSQL buffers may be warm",
  },
  requests: [], plans: {}, coverage: [], assertions: [],
};
let owner, reader;
const evidence = process.env.VEGA_COLD_READ_EVIDENCE ?? join(tmpdir(), "vega-cold-reads-" + process.pid + ".json");

before(async () => {
  if (skip) return;
  const dsn = process.env.VEGA_V2_API_NODE_TEST_DSN;
  owner = new pg.Client({ connectionString: dsn });
  await owner.connect();
  report.setup.postgres = (await owner.query("SHOW server_version")).rows[0].server_version;
  reader = createReader(dsn, { role: "vega_read", max: 1, idleSessionMs: 120_000 });
  await owner.query("UPDATE core.match_coverage SET lineups='ok' WHERE season_id=2025 AND match_id=1");
});

after(async () => {
  await Promise.all([owner?.end(), reader?.end()]);
  if (skip) return;
  mkdirSync(dirname(evidence), { recursive: true });
  writeFileSync(evidence, JSON.stringify(report, null, 2) + "\n");
  console.log("public read evidence " + evidence);
});

async function request(path, { headers = {}, database = reader, expected = 200, reason = null } = {}) {
  const at = new URL(path, "https://api.test");
  const statements = [];
  const run = adapt(createHandler({
    read: (sql, values, options) => {
      statements.push({ sql, values, options });
      return database.read(sql, values, options);
    },
    mediaBase: "https://media.test/",
    clock: () => context.now,
    versions: { strict: true },
  }));
  const started = performance.now();
  const response = await run({
    version: "2.0", rawPath: at.pathname, rawQueryString: at.search.slice(1), headers,
    requestContext: { http: { method: "GET" } },
  });
  const { statusCode: status, body: text } = response;
  const conditional = Object.hasOwn(headers, "if-none-match");
  const serverTiming = response.headers["server-timing"];
  const timing = readTiming(serverTiming);
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } finally {
    report.requests.push({
      path, family: routeFamily(at.pathname), expected, reason, status, conditional, wallMs: performance.now() - started,
      serverTiming, dbMs: timing?.dbMs ?? null, statements: statements.length,
      bytes: Buffer.byteLength(text), etag: response.headers.etag, body,
    });
  }
  assert.equal(status, expected, path + " " + text.slice(0, 160));
  if (expected === 200) assert.ok(body && Buffer.byteLength(text) > 2, path + " JSON body");
  if (expected === 304) assert.equal(text, "", path + " undefined body for 304");
  if (expected === 200 || expected === 304) {
    assert.ok(timing, path + " measured SQL time");
    assert.equal(timing.queries, statements.length, path + " measured by its real handler");
    assert.ok(statements.length > 0 && timing.dbMs <= DB_BUDGET_MS, path + " exceeded the SQL budget: " + serverTiming);
  }
  return { body, headers: response.headers, statements };
}

test("cold public read scenarios cover the club panels and cross-family reads", { skip }, async (t) => {
  for (const [path, verify, options] of scenarios) {
    await t.test(path, async () => {
      const { body } = await request(path, { expected: options?.status ?? 200, reason: options?.reason ?? null });
      if (verify) verify(body);
      else assert.equal(body.error.code, "RESOURCE_NOT_FOUND");
    });
  }
  await t.test("inventory tracks the declared club panel paths", () => {
    const covered = scenarios.map(([path]) => new URL(path, "https://api.test").pathname).filter((p) => p.startsWith(club));
    report.coverage = covered;
    assert.deepEqual(covered.sort(), profiles.CLUB_PROFILE_SUFFIXES.map((suffix) => club + suffix).sort());
  });
});

const EXPECTED = {
  id: "t_v0008011", season, matches: 3, pointsThen: 4, points: 9, gained: 5, minute: 63,
  leading: { matches: 1, pointsThen: 3, points: 3 }, level: { matches: 1, pointsThen: 1, points: 3 },
  behind: { matches: 1, pointsThen: 0, points: 3 },
  substitutes: [
    { id: "p_cold01", name: "Zoé", entries: 1, minutes: 29, goals: 2, assists: 1 },
    { id: "p_v0000202", name: "Brune", entries: 1, minutes: 50, goals: 2, assists: 0, image_url: "https://img.example/substitution.png" },
    { id: "p_v0000201", name: "Aline", entries: 2, minutes: 45, goals: 1, assists: 1 },
  ],
};

async function plansFromRequests(stage) {
  const plans = report.plans[stage] = {};
  for (const [family, path, sqlOfInterest] of [
    ["substitutions", substitutions, /api\.team_(?:substitute|change)_matches/],
    ["passing", passing, /api\.player_(?:profiles|identities)/],
    ["lineups", lineups, /api\.match_lineup_player_rows/],
  ]) {
    const answer = await request(path);
    if (family === "substitutions") assert.deepEqual(answer.body.data, EXPECTED);
    const selected = answer.statements.filter(({ sql }) => sqlOfInterest.test(sql));
    assert.equal(selected.length, family === "substitutions" ? 2 : 1, family + " plan statements captured");
    plans[family] = [];
    for (const statement of selected) {
      const result = { ...statement };
      plans[family].push(result);
      try {
        const [row] = await reader.read("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + statement.sql, statement.values, statement.options);
        result.explain = row["QUERY PLAN"][0];
        result.scans = scans(result.explain.Plan);
      } catch (error) {
        result.error = { code: error.code, message: error.message };
      }
    }
  }
}

function scans(node) {
  const loops = node["Actual Loops"];
  const tuples = (node["Actual Rows"] + (node["Rows Removed by Filter"] ?? 0) + (node["Rows Removed by Index Recheck"] ?? 0)) * loops;
  const thisScan = node["Relation Name"] && loops > 0
    ? [{ relation: node["Relation Name"], node: node["Node Type"], loops, tuples }]
    : [];
  return thisScan.concat((node.Plans ?? []).flatMap(scans));
}

const facts = /^(matches|lineup_players|player_match_stats|match_events)(_|$)/;
const people = /^(players|assets)(_|$)/;
const profileOnly = /^(player_contracts|player_fact_observations|player_market_values|provider_players|provider_links)(_|$)/;
const work = (plan, re) => plan.scans.filter((s) => re.test(s.relation)).reduce((n, s) => n + s.tuples, 0);
const blocks = (plan) => ["Shared Hit Blocks", "Shared Read Blocks", "Temp Read Blocks", "Temp Written Blocks"]
  .reduce((count, field) => count + (plan.explain.Plan[field] ?? 0), 0);

test("substitutes and identity reads stay bounded as other teams, seasons and profiles grow", { skip }, async (t) => {
  await owner.query(readFileSync(new URL("./public-cold-reads-fixture.sql", import.meta.url), "utf8"));
  await t.test("substitution results, errors and validator before load", async () => {
    const first = await request(substitutions);
    assert.deepEqual(first.body.data, EXPECTED);
    assert.ok(first.headers.etag);
    await request(substitutions, { headers: { "if-none-match": first.headers.etag }, expected: 304 });
    await request(substitutions.replace(season, "2025"), { expected: 400 });
    await request(substitutions.replace("t_v0008011", "t_zzzzzz"), { expected: 404 });
    await request(substitutions.replace(season, "2024/2025"), { expected: 404, reason: "A bench entry alone is not impact data." });
  });
  await plansFromRequests("small");
  await owner.query(readFileSync(new URL("./public-cold-reads-noise.sql", import.meta.url), "utf8"));
  await plansFromRequests("loaded");
  for (const family of Object.keys(report.plans.loaded)) {
    await t.test(family + " plans", () => {
      for (const [i, plan] of report.plans.loaded[family].entries()) {
        const previous = report.plans.small[family][i];
        assert.ok(previous.explain && plan.explain, JSON.stringify({ small: previous.error, loaded: plan.error }));
        const checks = {
          family, i, small: { facts: work(previous, facts), people: work(previous, people), blocks: blocks(previous) },
          loaded: { facts: work(plan, facts), people: work(plan, people), blocks: blocks(plan) },
          heavy: plan.scans.filter((s) => profileOnly.test(s.relation)),
        };
        report.assertions.push(checks);
        assert.ok(checks.loaded.facts < 500, JSON.stringify(checks));
        assert.ok(checks.loaded.people < 500, JSON.stringify(checks));
        assert.ok(checks.loaded.blocks <= checks.small.blocks * 4 + 256, JSON.stringify(checks));
        assert.deepEqual(checks.heavy, [], "an identity-only read must not execute rich profile tables");
      }
    });
  }
  await t.test("the old tag expires when an incomplete match is corrected and the tied name changes", async () => {
    const prior = await request(substitutions);
    await owner.query("INSERT INTO core.match_events(season_id,match_id,seq,team_id,event_type,minute) VALUES (2025,8004,3,8011,'goal',79)");
    await owner.query("UPDATE core.players SET name='Zélie' WHERE id=201");
    const found = await request(substitutions, { headers: { "if-none-match": prior.headers.etag } });
    assert.notEqual(found.headers.etag, prior.headers.etag);
    assert.deepEqual(found.body.data, {
      ...EXPECTED, matches: 4, pointsThen: 7, points: 12, minute: 52, leading: { matches: 2, pointsThen: 6, points: 6 },
      substitutes: [...EXPECTED.substitutes.slice(0, 2),
        { id: "p_v0000203", name: "Aline", entries: 1, minutes: 45, goals: 1, assists: 1, image_url: "https://img.example/substitution.png" }],
    });
  });
});

test("a corrected player photo reaches both passing and line-ups under their old tags", { skip }, async (t) => {
  const reads = await Promise.all([passing, lineups].map(async (path) => {
    const first = await request(path);
    await request(path, { headers: { "if-none-match": first.headers.etag }, expected: 304 });
    return first;
  }));
  const revision = async () => (await owner.query("SELECT revision FROM core.matches WHERE id=1")).rows[0].revision;
  const beforeRevision = await revision();
  const updated = "https://img.example/p1-corrected.png";
  await owner.query("UPDATE core.assets SET source_url=$1 WHERE id=3", [updated]);
  assert.equal(await revision(), beforeRevision);
  await t.test("passing", async () => {
    const found = await request(passing, { headers: { "if-none-match": reads[0].headers.etag } });
    assert.notEqual(found.headers.etag, reads[0].headers.etag);
    assert.equal(found.body.data.pair.players[0].image_url, updated);
    assert.equal("image_url" in found.body.data.pair.players[1], false);
  });
  await t.test("line-ups", async () => {
    const found = await request(lineups, { headers: { "if-none-match": reads[1].headers.etag } });
    assert.notEqual(found.headers.etag, reads[1].headers.etag);
    assert.deepEqual(dressed(found.body.data).map((r) => [r.player_id, r.image_url]).sort(),
      [["p_aaaab1", updated], ["p_aaaab2", null], ["p_aaaab4", null]]);
  });
});

test("a timed-out substitution read still fails instead of returning invented zeros", { skip }, async () => {
  const short = createReader(process.env.VEGA_V2_API_NODE_TEST_DSN, { role: "vega_read", timeoutMs: 200 });
  await owner.query("BEGIN");
  try {
    await owner.query("LOCK core.player_match_stats IN ACCESS EXCLUSIVE MODE");
    const { body } = await request(substitutions, { database: short, expected: 503 });
    assert.deepEqual(body.error, { code: "DATA_UNAVAILABLE", message: "Données indisponibles.", retry: true });
  } finally {
    await owner.query("ROLLBACK");
    await short.end();
  }
});
