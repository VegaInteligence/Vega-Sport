// Contract tests of the cup reads: what main's source projections answer, written as
// typed rows by the cups adapter (test/seed.py), must come back unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { get, skip } from "./context.mjs";

// The very bodies the seed wrote (v2/tests/cup_samples.py).
const samples = JSON.parse(
  spawnSync("python3", ["-c", "import json,sys;sys.path.insert(0,sys.argv[1]);from cup_samples import SAMPLES;print(json.dumps(SAMPLES))",
    fileURLToPath(new URL("../../tests", import.meta.url))], { encoding: "utf8" }).stdout,
);
const sample = (kind, competition, season) => samples.find(([k, c, s]) => k === kind && c === competition && s === season)[3];

test("open cups, OpenLigaDB and nations results round-trip", { skip }, async () => {
  assert.deepEqual((await get("/api/open-cups?competition=euro&season=2024")).body, sample("open-cups", "euro", "2024"));
  assert.deepEqual((await get("/api/open-cups?competition=euro&season=2028")).body, sample("open-cups", "euro", "2028")); // no score yet
  assert.deepEqual((await get("/api/openligadb?competition=germany-cup&season=2025/2026")).body, sample("openligadb", "germany-cup", "2025/2026"));
  assert.deepEqual((await get("/api/nations-results?season=2026/2027")).body, sample("nations-results", "nations-league", "2026/2027"));
  assert.equal((await get("/api/open-cups?competition=euro&season=1990")).response.status, 400);
  assert.equal((await get("/api/open-cups?competition=bad%20key&season=2024")).response.status, 400);
});

test("cup snapshots: source editions with their worker times, native cups, standings", { skip }, async () => {
  const euro = (await get("/api/cup-snapshot?kind=open-cups&competition=euro&season=2024")).body;
  assert.deepEqual(euro, { ...sample("open-cups", "euro", "2024"), worker: { checkedAt: "2025-09-20T08:00:00.000Z", updatedAt: "2025-09-20T08:00:00.000Z" } });
  const nations = (await get("/api/cup-snapshot?kind=nations-results&competition=nations-league&season=2026/2027")).body;
  assert.equal(nations.matches.length, 1);
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
  assert.equal((await get("/api/cup-snapshot?kind=other&competition=euro&season=2024")).response.status, 400);
});

test("cup editions stay out of the PitchAPI-era reads", { skip }, async () => {
  const manifest = (await get("/api/dashboard/manifest")).body;
  assert.deepEqual(manifest.competitions.map((c) => c.id), ["l_3FJFUl"]);
  assert.deepEqual((await get("/api/fixtures?season=2023/2024")).body.data.matches, []);
});
