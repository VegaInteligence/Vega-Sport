// PostgreSQL -> the rankings handler -> HTTP -> the report route (FAILURE_MODES §20).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { GET as report } from "../../../dashboard/frontend/app/api/rapport/route.js";
import { context, skip } from "./context.mjs";

const MATCH = "m_aaaaa1";
const ORENBURG = "m_08LEIz";
const rankingPath = (id) => `/api/rankings/match?match=${id}`;
const reportPath = (id) => `/api/rapport?id=${id}`;
const integer = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const tenth = (grade) => Math.round(grade * 10) / 10;
const indexOfGrade = (grade) => 4 * Math.log10(grade / (100 - grade));
const withoutExact = ({ gradeExact, ...row }) => row;
const reportRows = ({ grades, best, playerOfMatch }) => [...grades, ...best.home, ...best.away, playerOfMatch].filter(Boolean);
let owner, server, origin, previousOrigin, rankingOverride;

before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  server = createServer(async (req, res) => {
    const request = new Request(origin + req.url, { headers: req.headers });
    try {
      const response = req.url.startsWith("/api/rapport?")
        ? await report(request)
        : rankingOverride && req.url === rankingPath(MATCH)
          ? Response.json(rankingOverride)
          : await context.handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  previousOrigin = process.env.ORION_API_ORIGIN;
  process.env.ORION_API_ORIGIN = origin;
});

after(async () => {
  if (previousOrigin === undefined) delete process.env.ORION_API_ORIGIN;
  else process.env.ORION_API_ORIGIN = previousOrigin;
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await owner?.end();
});

async function read(path, headers) {
  const response = await fetch(origin + path, { headers });
  return { response, body: response.status === 304 ? null : await response.json() };
}

async function setIndex(player, z) {
  const { rowCount } = await owner.query(
    `UPDATE agg.player_match_grades SET z=$1::real
     WHERE season_id=2025 AND match_id=api.internal_id('match',$2) AND player_id=api.internal_id('player',$3)`,
    [z, MATCH, player],
  );
  assert.equal(rowCount, 1, player);
}

function exactInDatabase(id) {
  return context.reader.read("SELECT player_id, grade FROM api.match_grades WHERE match_key=api.internal_id('match',$1)", [id])
    .then((rows) => new Map(rows.map(({ player_id, grade }) => [player_id, grade])));
}

test("ranking and report publish the precise score without changing old fields, even on a same-tenth revision", { skip }, async (t) => {
  await setIndex("p_aaaab1", indexOfGrade(48.49));
  await setIndex("p_aaaab4", indexOfGrade(48.52));
  await setIndex("p_aaaab2", -0.6);
  const before = await read(rankingPath(MATCH));
  assert.equal(before.response.status, 200);
  assert.deepEqual(before.body.grades.map(({ playerId, grade, rank }) => [playerId, grade, rank]), [
    ["p_aaaab4", 48.5, 1], ["p_aaaab1", 48.5, 2], ["p_aaaab2", 41.5, 3], ["p_aaaab3", null, null],
  ]);
  const exact = await exactInDatabase(MATCH);
  const initialReport = await read(reportPath(MATCH));
  assert.equal(initialReport.response.status, 200);
  const unchanged = await read(rankingPath(MATCH), { "If-None-Match": before.response.headers.get("etag") });
  assert.equal(unchanged.response.status, 304);

  // Only the bottom candidate changes; it stays below the other candidate and its tenth stays 48.5.
  await setIndex("p_aaaab1", indexOfGrade(48.51));
  const revised = await read(rankingPath(MATCH), { "If-None-Match": before.response.headers.get("etag") });
  const revisedExact = await exactInDatabase(MATCH);
  const revisedReport = await read(reportPath(MATCH));
  const row = (rows) => rows.find((g) => (g.playerId ?? g.id) === "p_aaaab1");
  t.diagnostic(JSON.stringify({
    oldPublication: { sql: exact.get("p_aaaab1"), ranking: row(before.body.grades), report: row(initialReport.body.grades), etag: before.response.headers.get("etag") },
    newPublication: { sql: revisedExact.get("p_aaaab1"), ranking: row(revised.body?.grades ?? []), report: row(revisedReport.body.grades), status: revised.response.status, etag: revised.response.headers.get("etag") },
  }));
  for (const grade of before.body.grades) {
    assert.equal(grade.gradeExact, grade.grade === null ? null : exact.get(grade.playerId), grade.playerId);
    if (grade.grade !== null) assert.equal(tenth(grade.gradeExact), grade.grade);
  }
  assert.equal(revised.response.status, 200);
  assert.equal(revisedReport.response.status, 200);
  assert.notEqual(revised.response.headers.get("etag"), before.response.headers.get("etag"));
  assert.deepEqual(revised.body.grades.map(withoutExact), before.body.grades.map(withoutExact));
  assert.deepEqual(reportRows(revisedReport.body).map(withoutExact), reportRows(initialReport.body).map(withoutExact));
  for (const [ranking, result] of [[before.body, initialReport.body], [revised.body, revisedReport.body]]) {
    const byId = new Map(ranking.grades.map((g) => [g.playerId, g.gradeExact]));
    for (const player of reportRows(result)) assert.equal(player.gradeExact, byId.get(player.id), player.id);
  }
  assert.equal(row(revised.body.grades).gradeExact, revisedExact.get("p_aaaab1"));
  assert.deepEqual([row(before.body.grades), row(revised.body.grades)].map((g) => integer.format(g.gradeExact)), ["48", "49"]);
  assert.deepEqual([row(before.body.grades), row(revised.body.grades)].map((g) => integer.format(g.grade)), ["49", "49"]);
});

test("ranking protects hidden and non-finite notes and preserves the measured bounds and request errors", { skip }, async (t) => {
  for (const [id, z] of [["p_aaaab1", "Infinity"], ["p_aaaab2", "-Infinity"], ["p_aaaab4", "NaN"]]) await setIndex(id, z);
  const { response, body } = await read(rankingPath(MATCH));
  t.diagnostic(JSON.stringify(body));
  assert.equal(response.status, 200);
  const graded = new Map(body.grades.map((g) => [g.playerId, [g.grade, g.gradeExact, g.rank]]));
  assert.deepEqual(graded.get("p_aaaab1"), [100, 100, 2]);
  assert.deepEqual(graded.get("p_aaaab2"), [0, 0, 3]);
  assert.deepEqual(graded.get("p_aaaab3"), [null, null, null]);
  assert.deepEqual(graded.get("p_aaaab4"), [null, null, 1]); // Legacy rank and null grade.
  assert.equal((await read(rankingPath("m_aaaaa6"))).response.status, 404);
  assert.equal((await read(rankingPath("aaaaa1"))).response.status, 400);
  assert.equal((await read(rankingPath(MATCH) + "&x=1")).response.status, 400);
});

test("report accepts an old ranking response and rejects inconsistent or invalid precision", { skip }, async () => {
  await setIndex("p_aaaab1", indexOfGrade(48.49));
  const { body } = await read(rankingPath(MATCH));
  const grades = body.grades.map(withoutExact);
  rankingOverride = { ...body, grades };
  try {
    const legacy = await read(reportPath(MATCH));
    assert.equal(legacy.response.status, 200);
    assert.ok(reportRows(legacy.body).every((g) => !Object.hasOwn(g, "gradeExact")));
    const expected = reportRows(legacy.body);
    for (const invalid of [48.55, -1, 101, "48.49", "Infinity", null]) {
      rankingOverride.grades = grades.map((g) => ({ ...g, gradeExact: g.playerId === "p_aaaab1" ? invalid : 99 }));
      const updated = await read(reportPath(MATCH));
      assert.equal(updated.response.status, 200);
      assert.deepEqual(reportRows(updated.body).map(withoutExact), expected);
      assert.ok(reportRows(updated.body).every((g) => g.gradeExact === null), String(invalid));
    }
  } finally {
    rankingOverride = undefined;
  }
});

test("the recorded Orenburg–CSKA boundary goes through SQL and both HTTP routes", { skip }, async (t) => {
  const seed = spawnSync("python3", [fileURLToPath(new URL("./seed_match.py", import.meta.url)), process.env.VEGA_V2_API_NODE_TEST_DSN], { encoding: "utf8" });
  assert.equal(seed.status, 0, seed.stderr);
  const { rows: [{ id: run }] } = await owner.query(
    "INSERT INTO agg.power_runs(kind,season_id,method_version,status) VALUES ('players',2026,'vi32-fixture','published') RETURNING id",
  );
  // Recorded grade values of these players (capture 18 November); recreate their real z storage.
  const witnesses = [["p_3jm88H", "winger", 82, 48.5004176439616], ["p_13nLyq", "centre_back", 90, 48.4903434662912]];
  for (const [id, role, minutes, exact] of witnesses) {
    await owner.query(
      `INSERT INTO agg.player_match_grades(season_id,match_id,player_id,award_season,team_id,role,minutes,z,first_z,run_id)
       VALUES (2026,api.internal_id('match',$1),api.internal_id('player',$2),2026,api.internal_id('team','t_2Mlwuk'),$3,$4,$5::real,$5::real,$6)`,
      [ORENBURG, id, role, minutes, indexOfGrade(exact), run],
    );
  }
  const ranking = await read(rankingPath(ORENBURG));
  const result = await read(reportPath(ORENBURG));
  const sql = await exactInDatabase(ORENBURG);
  t.diagnostic(JSON.stringify({ sql: [...sql], ranking: ranking.body, reportGrades: result.body.grades }));
  assert.equal(ranking.response.status, 200);
  assert.equal(result.response.status, 200);
  assert.deepEqual(ranking.body.grades.map((g) => [g.playerId, g.grade, g.rank]), witnesses.map(([id], i) => [id, 48.5, i + 1]));
  for (const [i, [id, , , recorded]] of witnesses.entries()) {
    assert.ok(Math.abs(sql.get(id) - recorded) < 1e-6, id);
    assert.equal(ranking.body.grades[i].gradeExact, sql.get(id));
    assert.equal(result.body.grades[i].gradeExact, sql.get(id));
  }
  assert.deepEqual(result.body.grades.map((g) => integer.format(g.gradeExact)), ["49", "48"]);
});
