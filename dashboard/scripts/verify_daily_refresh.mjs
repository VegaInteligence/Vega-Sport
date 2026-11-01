/** Workflow E2E contract, written before the worker implementation. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(app, "outputs/vercel-daily");
await fs.mkdir(out, { recursive: true });
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orion-daily-e2e-"));
const report = {
  command: "cd dashboard && bun scripts/verify_daily_refresh.mjs",
  setup:
    "Bun worker process + local HTTP fixture + temporary canonical JSON; no real provider/key",
  expected:
    "13 families and normalized rows, deduplication, unchanged history, 401 prevents publication, 429 retries",
  status: "failed",
  checks: [],
};
const logs = [],
  calls = [];
let authFailure = false,
  throttle = true,
  retried = false;
const fixture = {
  id: "m_000001",
  date: "2026-10-31",
  time_utc: "2026-10-31T20:00:00Z",
  status: "finished",
  home_team: { id: "t_000001", name: "Home" },
  away_team: { id: "t_000002", name: "Away" },
  score_home: 1,
  score_away: 0,
};
const upcoming = {
  ...fixture,
  id: "m_000002",
  date: "2026-11-02",
  time_utc: "2026-11-02T20:00:00Z",
  status: "not_started",
  score_home: null,
  score_away: null,
};
const league = {
  id: "l_3FJFUl",
  name: "Ligue 1",
  country_code: "FRA",
  seasons: ["2026/2027", "2025/2026"],
};
const player = {
  player: { id: "p_000001", name: "Observed Player" },
  team_id: "t_000001",
  team_name: "Home",
  stats: [
    {
      stats: {
        minutes: { key: "minutes_played", stat: { value: 90 } },
        goals: { key: "goals", stat: { value: 1 } },
        rating: { key: "rating_title", stat: { value: 8.2 } },
      },
    },
  ],
};
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const u = new URL(request.url),
      p = u.pathname.replace(/^\/v1/, "");
    calls.push(p);
    if (authFailure)
      return Response.json(
        { error: { code: "UNAUTHORIZED" } },
        { status: 401 },
      );
    if (p.endsWith("/stats") && throttle) {
      throttle = false;
      retried = true;
      return Response.json(
        { error: { code: "RATE_LIMIT_EXCEEDED" } },
        { status: 429, headers: { "Retry-After": "0" } },
      );
    }
    if (p === "/leagues") return Response.json({ data: { leagues: [league] } });
    if (p === `/leagues/${league.id}/matches`) {
      assert.equal(u.searchParams.get("season"), "2026/2027");
      return Response.json({ data: { league, matches: [fixture, upcoming] } });
    }
    if (/^\/(players|teams)\//.test(p))
      return Response.json({
        data: { id: p.split("/").at(-1), name: "Observed Profile" },
      });
    if (p.startsWith("/leagues/"))
      return Response.json({ data: { ...league, season: "2026/2027" } });
    if (p === `/matches/${fixture.id}/players`)
      return Response.json({ data: [player] });
    if (p.endsWith("/shots")) return Response.json({ data: { periods: [] } });
    if (p.endsWith("/stats"))
      return Response.json({
        data: { periods: [{ period: "All", groups: [] }] },
      });
    if (p.endsWith("/lineups"))
      return Response.json({
        data: {
          home: { starters: [], substitutes: [], confirmed: false },
          away: { starters: [], substitutes: [], confirmed: false },
        },
      });
    if (p === `/matches/${fixture.id}`) return Response.json({ data: fixture });
    if (p === `/matches/${upcoming.id}`)
      return Response.json({ data: upcoming });
    return Response.json({ data: {} });
  },
});
async function run() {
  const child = Bun.spawn(
    [
      process.execPath,
      "scripts/daily_refresh.mjs",
      "--data-root",
      dir,
      "--now",
      "2026-11-01T00:00:00Z",
    ],
    {
      cwd: app,
      env: {
        ...process.env,
        PITCHAPI_API_KEY: "pk_test_local_fixture",
        PITCHAPI_BASE_URL: `http://127.0.0.1:${server.port}/v1`,
        PITCH_REQUESTS_PER_SECOND: "1000",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  logs.push({ code, stdout, stderr });
  return code;
}
const read = async (ref) =>
  JSON.parse(gunzipSync(await fs.readFile(path.join(dir, ref.path))));
try {
  await fs.mkdir(path.join(dir, "raw/seasons/2025-2026"), { recursive: true });
  const historical = Buffer.from(
    '[{"id":"preserved-history","missing":null}]\n',
  );
  await fs.writeFile(
    path.join(dir, "raw/seasons/2025-2026/sentinel.json"),
    historical,
  );
  await fs.writeFile(
    path.join(dir, "raw/index.json"),
    JSON.stringify({
      schemaVersion: 3,
      storage: "json-relational",
      defaultSeason: "2025/2026",
      seasons: [{ id: "2025/2026", chunks: [] }],
    }),
  );
  assert.equal(await run(), 0, "first collection process");
  let index = JSON.parse(await fs.readFile(path.join(dir, "raw/index.json"))),
    season = index.seasons.find((s) => s.id === "2026/2027"),
    tables = season.chunks[0].tables;
  assert.equal(season.chunks.length, 1);
  assert.equal((await read(tables.matches)).length, 1);
  assert.equal((await read(tables.performances)).length, 1);
  assert.equal(
    (await read(tables.fixtures)).find((m) => m.id === upcoming.id).score_home,
    null,
  );
  const lookup = JSON.parse(
      await fs.readFile(path.join(dir, "raw/match-observations.json")),
    ),
    shards = JSON.parse(
      await fs.readFile(path.join(dir, "raw/observation-shards.json")),
    );
  assert.equal(
    Object.keys(shards[lookup[fixture.id][0].shard].tables).length,
    13,
  );
  assert.equal(retried, true);
  assert.deepEqual(
    await fs.readFile(path.join(dir, "raw/seasons/2025-2026/sentinel.json")),
    historical,
  );
  report.checks.push(
    "First run: normalized match/player, null future score, 13 families, 429 retry, preserved historical bytes",
  );
  assert.equal(await run(), 0, "repeated collection process");
  index = JSON.parse(await fs.readFile(path.join(dir, "raw/index.json")));
  season = index.seasons.find((s) => s.id === "2026/2027");
  assert.equal((await read(season.chunks[0].tables.matches)).length, 1);
  assert.equal((await read(season.chunks[0].tables.performances)).length, 1);
  report.checks.push("Repeated run: no duplicate match/player rows");
  const before = await fs.readFile(path.join(dir, "raw/index.json"));
  authFailure = true;
  assert.notEqual(await run(), 0, "401 fails process");
  assert.deepEqual(await fs.readFile(path.join(dir, "raw/index.json")), before);
  assert.ok(!JSON.stringify(logs).includes("pk_test_local_fixture"));
  report.checks.push(
    "401: failed process, manifest intact, no credential in logs",
  );
  report.providerCalls = calls.length;
  report.status = "passed";
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  server.stop(true);
  await fs.writeFile(
    path.join(out, "worker-evidence.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await fs.writeFile(
    path.join(out, "worker-runtime.log"),
    logs.map((l) => `exit=${l.code}\n${l.stdout}${l.stderr}`).join("\n"),
  );
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
