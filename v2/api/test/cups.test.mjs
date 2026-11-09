// Contract tests of the cup reads: what main's source projections answer, written as
// typed rows by the cups adapter (test/seed.py), must come back unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { get, skip } from "./context.mjs";

// The very bodies the seed wrote (v2/tests/cup_samples.py).
const samples = JSON.parse(
  spawnSync("python3", ["-c", "import json,sys;sys.path.insert(0,sys.argv[1]);from cup_samples import SAMPLES;print(json.dumps(SAMPLES))",
    fileURLToPath(new URL("../../tests", import.meta.url))], { encoding: "utf8" }).stdout,
);
const sample = (kind, competition, season) => samples.find(([k, c, s]) => k === kind && c === competition && s === season)[3];

// The cups by their Vega id, found through the index (as the site does).
async function cupId(key, format) {
  const { cups } = (await get("/api/cups/index")).body;
  return cups.find((c) => c.key === key && c.format === format)?.id;
}

test("the cup index lists each cup by its Vega id, never by its source", { skip }, async () => {
  const { response, body } = await get("/api/cups/index");
  assert.equal(response.status, 200);
  for (const cup of body.cups) {
    assert.match(cup.id, /^l_v\d{7}$/);
    assert.ok(["matches-v1", "rounds-v1", "results-v1", "table-v1"].includes(cup.format));
    assert.ok(cup.seasons.length > 0 && cup.source.name);
  }
  const euro = body.cups.find((c) => c.key === "euro");
  assert.deepEqual([euro.name, euro.format, euro.seasons], ["Euro 2028", "matches-v1", ["2024", "2028"]]);
});

test("cup editions round-trip main's source projections", { skip }, async () => {
  const euro = await cupId("euro", "matches-v1");
  const germany = await cupId("germany-cup", "rounds-v1");
  const nations = await cupId("nations-league", "results-v1");
  assert.ok(euro && germany && nations);
  const edition = (id, season) => get(`/api/cups/edition?competition=${id}&season=${encodeURIComponent(season)}`);
  assert.deepEqual((await edition(euro, "2024")).body, sample("open-cups", "euro", "2024"));
  assert.deepEqual((await edition(euro, "2028")).body, sample("open-cups", "euro", "2028")); // no score yet
  assert.deepEqual((await edition(germany, "2025/2026")).body, sample("openligadb", "germany-cup", "2025/2026"));
  assert.deepEqual((await edition(nations, "2026/2027")).body, sample("nations-results", "nations-league", "2026/2027"));
  assert.equal((await edition(euro, "1990")).response.status, 404);
  assert.equal((await get("/api/cups/edition?competition=euro&season=2024")).response.status, 400);
  assert.equal((await get(`/api/cups/edition?competition=${euro}`)).response.status, 400);
  for (const legacy of ["/api/open-cups?competition=euro&season=2024", "/api/openligadb?competition=germany-cup&season=2025/2026", "/api/nations-results?season=2026/2027"])
    assert.equal((await get(legacy)).response.status, 404);
});

test("cup snapshots: editions with their worker times, native cups, standings", { skip }, async () => {
  const euro = await cupId("euro", "matches-v1");
  const snapshot = (await get(`/api/cup-snapshot?kind=edition&competition=${euro}&season=2024`)).body;
  assert.deepEqual(snapshot, { ...sample("open-cups", "euro", "2024"), worker: { checkedAt: "2025-09-20T08:00:00.000Z", updatedAt: "2025-09-20T08:00:00.000Z" } });
  const nations = await cupId("nations-league", "results-v1");
  assert.equal((await get(`/api/cup-snapshot?kind=edition&competition=${nations}&season=2026/2027`)).body.matches.length, 1);
  const native = (await get("/api/cup-snapshot?kind=native&competition=l_3FJFUl&season=2025/2026")).body;
  assert.equal(native.matches.length, 6);
  assert.deepEqual(native.matches[0], {
    id: "m_aaaaa1", season: "2025/2026", date: "2025-09-01", time_utc: "2025-09-01T19:00:00Z", status: "finished",
    home_team: { id: "t_aaaaa1", name: "Olympique Été", image_url: "https://img.example/t1.png" },
    away_team: { id: "t_aaaaa2", name: "Racing Club", image_url: null },
    league: { id: "l_3FJFUl", name: "Ligue 1", image_url: "https://img.example/l1.png", season: "2025/2026" }, score_home: 2, score_away: 0,
  });
  assert.deepEqual(native.rounds, { m_aaaaa1: { name: "1", playoff: false } });
  const standings = (await get("/api/cup-snapshot?kind=standings&competition=l_3FJFUl&season=2025/2026")).body;
  assert.deepEqual([standings.competition, standings.source, standings.tables[0].rows.length], ["Ligue 1", "Vega", 4]);
  assert.equal((await get("/api/cup-snapshot?kind=native&competition=l_zzzzzz&season=2025/2026")).response.status, 404);
  for (const kind of ["open-cups", "openligadb", "nations-results", "other"])
    assert.equal((await get(`/api/cup-snapshot?kind=${kind}&competition=${euro}&season=2024`)).response.status, 400);
});

test("cup editions stay out of the PitchAPI-era reads", { skip }, async () => {
  const manifest = (await get("/api/dashboard/manifest")).body;
  assert.deepEqual(manifest.competitions.map((c) => c.id), ["l_3FJFUl"]);
  assert.deepEqual((await get("/api/fixtures?season=2023/2024")).body.data.matches, []);
});

// The source's CSV lines (quoted fields allowed), as main served them from its catalogue.
const csv = (name) => {
  const [head, ...lines] = readFileSync(new URL(`../../tests/fixtures/open_matchday/${name}`, import.meta.url), "utf8").trim().split(/\r?\n/);
  const split = (line) => [...line.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].slice(0, -1).map((m) => m[2] ?? m[1]);
  const keys = split(head);
  return lines.map((line) => Object.fromEntries(split(line).map((v, i) => [keys[i], v])));
};

test("open-matchday catalogue and tables, as main's", { skip }, async () => {
  const index = (await get("/api/cup-index?kind=supplemental")).body;
  assert.equal(index.meta.source_generated_at_utc, "2026-11-09T05:30:38Z");
  assert.deepEqual(index.competitions.map((c) => [c.folder, c.name, c.season, c.tables.results.rows, c.tables.fixtures.rows, c.country_code]), [
    ["AUT_CUP_ofb-cup", "OFB Cup", "2026/2027", 7, 4, "AUT"], ["ENG_1_premier-league", "Premier League", "2026/2027", 5, 3, "ENG"],
  ]);
  for (const folder of ["ENG_1_premier-league", "AUT_CUP_ofb-cup"]) {
    const results = (await get(`/api/cup-table?competition=${folder}&season=2026%2F2027&kind=results`)).body;
    // Not kept: the local kick-off time, the goal minutes (no side) and the row's sub-source.
    assert.deepEqual(results, csv(`${folder}.results_2627.csv`).map((r) => ({ ...r, time: "", goal_minutes: "", source: "" })), folder);
    const fixtures = (await get(`/api/cup-table?competition=${folder}&season=2026%2F2027&kind=fixtures`)).body;
    assert.deepEqual(fixtures, csv(`${folder}.fixtures_2627.csv`).map((r) => ({ ...r, time: "" })), folder);
  }
  assert.equal((await get("/api/cup-index?kind=worker")).response.status, 404);
  assert.equal((await get("/api/cup-table?competition=XYZ_1_none&season=2026%2F2027&kind=results")).response.status, 404);
  assert.equal((await get("/api/cup-table?competition=bad&season=2026%2F2027&kind=results")).response.status, 400);
});
